import "server-only";

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
import {
	inspectWorldEntityImage,
	type WorldEntityImageInfo,
	worldEntityMediaSha256,
} from "./world-entity-media-image";

export type VerifiedWorldEntityUpload = WorldEntityImageInfo &
	Readonly<{
		bucket: string;
		objectKey: string;
		readBackVerified: true;
	}>;

function failure(code: string): never {
	throw new Error(`WORLD_ENTITY_MEDIA_${code}`);
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

async function objectBytes(
	client: S3Client,
	bucket: string,
	objectKey: string,
): Promise<Uint8Array> {
	const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
	if (
		typeof head.ContentLength !== "number" ||
		head.ContentLength < 24 ||
		head.ContentLength > WORLD_ENTITY_MEDIA_MAX_BYTES
	) {
		failure("R2_INVALID_SIZE");
	}
	const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
	if (!result.Body) failure("R2_EMPTY_BODY");
	const bytes = Uint8Array.from(await result.Body.transformToByteArray());
	if (bytes.length !== head.ContentLength) failure("R2_LENGTH_MISMATCH");
	return bytes;
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
		if (
			response.$metadata?.httpStatusCode !== 404 &&
			response.name !== "NotFound" &&
			response.name !== "NoSuchKey"
		) {
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
	if (readBack.length !== info.bytes || worldEntityMediaSha256(readBack) !== info.sha256) {
		failure("R2_READBACK_FAILED");
	}
}

/**
 * Server-side fallback upload. Browser direct upload will use a short-lived
 * presigned PUT, then call the same byte-level verification boundary below.
 */
export async function uploadWorldEntityPortrait({
	campaignSlug,
	entityId,
	bytes,
}: {
	campaignSlug: string;
	entityId: string;
	bytes: Uint8Array;
}): Promise<VerifiedWorldEntityUpload> {
	const info = inspectWorldEntityImage(bytes);
	const objectKey = worldEntityPortraitObjectKey({
		campaignSlug,
		entityId,
		sha256: info.sha256,
		extension: info.extension,
	});
	if (!objectKey) failure("INVALID_OBJECT_KEY");
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

/**
 * Finalizes a direct-to-R2 upload. The caller supplies the intent that was
 * authorized before upload; R2 bytes are re-read and independently inspected.
 */
export async function verifyWorldEntityPortraitObject({
	campaignSlug,
	entityId,
	expectedSha256,
	expectedMimeType,
	expectedBytes,
}: {
	campaignSlug: string;
	entityId: string;
	expectedSha256: string;
	expectedMimeType: WorldEntityMediaMime;
	expectedBytes?: number;
}): Promise<VerifiedWorldEntityUpload> {
	const extension = expectedMimeType === "image/png" ? "png" : "webp";
	const objectKey = worldEntityPortraitObjectKey({
		campaignSlug,
		entityId,
		sha256: expectedSha256,
		extension,
	});
	if (!objectKey) failure("INVALID_OBJECT_KEY");
	const bucket = worldEntityMediaStagingBucket();
	const bytes = await objectBytes(mediaClient(), bucket, objectKey);
	const info = inspectWorldEntityImage(bytes);
	if (
		info.sha256 !== expectedSha256 ||
		info.mimeType !== expectedMimeType ||
		(expectedBytes !== undefined && info.bytes !== expectedBytes)
	) {
		failure("UPLOAD_INTENT_MISMATCH");
	}
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
	campaignSlug,
	entityId,
	stagedBucket,
	objectKey,
	info,
}: {
	campaignSlug: string;
	entityId: string;
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
	const expectedObjectKey = worldEntityPortraitObjectKey({
		campaignSlug,
		entityId,
		sha256: info.sha256,
		extension: info.extension,
	});
	if (!expectedObjectKey || objectKey !== expectedObjectKey) failure("OBJECT_SCOPE_MISMATCH");

	const client = mediaClient();
	const bytes = await objectBytes(client, stagedBucket, objectKey);
	const inspected = inspectWorldEntityImage(bytes);
	if (
		inspected.sha256 !== info.sha256 ||
		inspected.mimeType !== info.mimeType ||
		inspected.bytes !== info.bytes ||
		inspected.width !== info.width ||
		inspected.height !== info.height
	) {
		failure("STAGED_INTEGRITY_FAILED");
	}

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
	const response = await fetch(url, {
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) failure("PUBLIC_DELIVERY_FAILED");
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > WORLD_ENTITY_MEDIA_MAX_BYTES) {
		failure("PUBLIC_DELIVERY_TOO_LARGE");
	}
	const delivered = new Uint8Array(await response.arrayBuffer());
	const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
	if (
		mime !== info.mimeType ||
		delivered.length !== info.bytes ||
		worldEntityMediaSha256(delivered) !== info.sha256
	) {
		failure("PUBLIC_DELIVERY_MISMATCH");
	}
	return {
		publicBucket: bucket,
		publicObjectKey: objectKey,
		verifiedAt: new Date().toISOString(),
	};
}
