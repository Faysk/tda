import "server-only";

import { createHash } from "node:crypto";
import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { mediaClient } from "@/integrations/r2/server";
import {
	WORLD_ENTITY_MEDIA_MAX_BYTES,
	WORLD_ENTITY_MEDIA_PRIVATE_BUCKET,
	WORLD_ENTITY_MEDIA_PREVIEW_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN,
	type WorldEntityMediaMime,
	worldEntityPortraitObjectKey,
} from "./world-entity-media";

export type WorldEntityImageInfo = Readonly<{
	sha256: string;
	mimeType: WorldEntityMediaMime;
	extension: "png" | "webp";
	bytes: number;
	width: number;
	height: number;
}>;

export type VerifiedWorldEntityUpload = WorldEntityImageInfo &
	Readonly<{
		bucket: string;
		objectKey: string;
		readBackVerified: true;
	}>;

function failure(code: string): never {
	throw new Error(`WORLD_ENTITY_MEDIA_${code}`);
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const chunk = Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii");
		const size = Buffer.from(bytes.subarray(offset + 4, offset + 8)).readUInt32LE(0);
		const data = offset + 8;
		if (data + size > bytes.length) return null;
		if (chunk === "VP8X" && size >= 10) {
			return {
				width: readUint24LE(bytes, data + 4) + 1,
				height: readUint24LE(bytes, data + 7) + 1,
			};
		}
		if (
			chunk === "VP8 " &&
			size >= 10 &&
			bytes[data + 3] === 0x9d &&
			bytes[data + 4] === 0x01 &&
			bytes[data + 5] === 0x2a
		) {
			return {
				width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
				height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff,
			};
		}
		if (chunk === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
			const b1 = bytes[data + 1];
			const b2 = bytes[data + 2];
			const b3 = bytes[data + 3];
			const b4 = bytes[data + 4];
			return {
				width: 1 + (((b2 & 0x3f) << 8) | b1),
				height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
			};
		}
		offset = data + size + (size % 2);
	}
	return null;
}

export function inspectWorldEntityImage(bytes: Uint8Array): WorldEntityImageInfo {
	if (bytes.length < 24 || bytes.length > WORLD_ENTITY_MEDIA_MAX_BYTES) failure("INVALID_SIZE");

	const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
	const isPng = Buffer.from(bytes.subarray(0, 8)).equals(pngSignature);
	if (isPng) {
		if (Buffer.from(bytes.subarray(12, 16)).toString("ascii") !== "IHDR") {
			failure("INVALID_PNG");
		}
		const width = Buffer.from(bytes.subarray(16, 20)).readUInt32BE(0);
		const height = Buffer.from(bytes.subarray(20, 24)).readUInt32BE(0);
		if (!width || !height || width > 16384 || height > 16384) failure("INVALID_DIMENSIONS");
		return {
			sha256: sha256(bytes),
			mimeType: "image/png",
			extension: "png",
			bytes: bytes.length,
			width,
			height,
		};
	}

	const isWebp =
		Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
		Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
	if (!isWebp) failure("UNSUPPORTED_IMAGE");
	const declaredSize = Buffer.from(bytes.subarray(4, 8)).readUInt32LE(0) + 8;
	if (declaredSize !== bytes.length) failure("INVALID_WEBP");
	const dimensions = webpDimensions(bytes);
	if (
		!dimensions ||
		!dimensions.width ||
		!dimensions.height ||
		dimensions.width > 16384 ||
		dimensions.height > 16384
	) {
		failure("INVALID_DIMENSIONS");
	}
	return {
		sha256: sha256(bytes),
		mimeType: "image/webp",
		extension: "webp",
		bytes: bytes.length,
		width: dimensions.width,
		height: dimensions.height,
	};
}

export function worldEntityMediaEnabled(): boolean {
	return process.env.TDA_WORLD_ENTITY_MEDIA_ENABLED === "true";
}

export function worldEntityMediaStagingBucket(): string {
	const production = process.env.VERCEL_ENV === "production";
	const expected = production
		? WORLD_ENTITY_MEDIA_PRIVATE_BUCKET
		: WORLD_ENTITY_MEDIA_PREVIEW_BUCKET;
	const configured = production ? process.env.R2_PRIVATE_BUCKET : process.env.R2_PREVIEW_BUCKET;
	if (configured !== expected) failure("STAGING_BUCKET_MISMATCH");
	return configured;
}

function publicBucket(): string {
	if (process.env.R2_PUBLIC_BUCKET !== WORLD_ENTITY_MEDIA_PUBLIC_BUCKET) {
		failure("PUBLIC_BUCKET_MISMATCH");
	}
	return WORLD_ENTITY_MEDIA_PUBLIC_BUCKET;
}

async function objectBytes(client: S3Client, bucket: string, objectKey: string): Promise<Uint8Array> {
	const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
	if (!result.Body) failure("R2_EMPTY_BODY");
	return Uint8Array.from(await result.Body.transformToByteArray());
}

async function putImmutableObject({
	client,
	bucket,
	objectKey,
	bytes,
	info,
	cacheControl,
}: {
	client: S3Client;
	bucket: string;
	objectKey: string;
	bytes: Uint8Array;
	info: WorldEntityImageInfo;
	cacheControl: string;
}) {
	let exists = false;
	try {
		const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
		exists = true;
		if (
			head.ContentLength !== info.bytes ||
			head.ContentType !== info.mimeType ||
			head.Metadata?.sha256 !== info.sha256
		) {
			failure("R2_COLLISION");
		}
	} catch (error) {
		const response = error as { name?: string; $metadata?: { httpStatusCode?: number } };
		if (response.$metadata?.httpStatusCode !== 404 && response.name !== "NotFound" && response.name !== "NoSuchKey") {
			throw error;
		}
	}
	if (!exists) {
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: objectKey,
				Body: bytes,
				ContentType: info.mimeType,
				ContentLength: info.bytes,
				Metadata: { sha256: info.sha256 },
				CacheControl: cacheControl,
				IfNoneMatch: "*",
			}),
		);
	}
	const readBack = await objectBytes(client, bucket, objectKey);
	if (readBack.length !== info.bytes || sha256(readBack) !== info.sha256) failure("R2_READBACK_FAILED");
}

export async function uploadWorldEntityPortrait({
	entityId,
	bytes,
}: {
	entityId: string;
	bytes: Uint8Array;
}): Promise<VerifiedWorldEntityUpload> {
	const info = inspectWorldEntityImage(bytes);
	const objectKey = worldEntityPortraitObjectKey({
		entityId,
		sha256: info.sha256,
		extension: info.extension,
	});
	if (!objectKey) failure("INVALID_ENTITY_ID");
	const bucket = worldEntityMediaStagingBucket();
	const client = mediaClient();
	await putImmutableObject({
		client,
		bucket,
		objectKey,
		bytes,
		info,
		cacheControl: "private, no-store",
	});
	return { ...info, bucket, objectKey, readBackVerified: true };
}

export async function readWorldEntityMediaObject({
	bucket,
	objectKey,
}: {
	bucket: string;
	objectKey: string;
}): Promise<Uint8Array> {
	const allowed = new Set<string>([
		WORLD_ENTITY_MEDIA_PREVIEW_BUCKET,
		WORLD_ENTITY_MEDIA_PRIVATE_BUCKET,
		WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	]);
	if (!allowed.has(bucket)) failure("BUCKET_NOT_ALLOWED");
	return objectBytes(mediaClient(), bucket, objectKey);
}

export async function promoteWorldEntityPortrait({
	stagedBucket,
	objectKey,
	info,
}: {
	stagedBucket: string;
	objectKey: string;
	info: WorldEntityImageInfo;
}): Promise<{ publicBucket: string; publicObjectKey: string; verifiedAt: string }> {
	if (
		stagedBucket !== WORLD_ENTITY_MEDIA_PREVIEW_BUCKET &&
		stagedBucket !== WORLD_ENTITY_MEDIA_PRIVATE_BUCKET
	) {
		failure("STAGING_BUCKET_NOT_ALLOWED");
	}
	const client = mediaClient();
	const bytes = await objectBytes(client, stagedBucket, objectKey);
	if (bytes.length !== info.bytes || sha256(bytes) !== info.sha256) failure("STAGED_INTEGRITY_FAILED");
	const bucket = publicBucket();
	await putImmutableObject({
		client,
		bucket,
		objectKey,
		bytes,
		info,
		cacheControl: "public, max-age=31536000, immutable",
	});
	const url = `${WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN}/${objectKey}`;
	const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
	if (!response.ok) failure("PUBLIC_DELIVERY_FAILED");
	const delivered = new Uint8Array(await response.arrayBuffer());
	const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
	if (mime !== info.mimeType || delivered.length !== info.bytes || sha256(delivered) !== info.sha256) {
		failure("PUBLIC_DELIVERY_MISMATCH");
	}
	return {
		publicBucket: bucket,
		publicObjectKey: objectKey,
		verifiedAt: new Date().toISOString(),
	};
}
