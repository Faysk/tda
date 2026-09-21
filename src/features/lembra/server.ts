import "server-only";

import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import {
	mediaClient,
	privateMediaClient,
} from "@/integrations/r2/server";
import { inspectLembraImage, lembraSha256, type LembraImageInfo } from "./image";
import {
	LEMBRA_MAX_BYTES,
	LEMBRA_PREVIEW_BUCKET,
	LEMBRA_PRIVATE_BUCKET,
	LEMBRA_UPLOAD_CHUNK_BYTES,
	lembraExtensionForMime,
	lembraPendingChunkObjectKey,
	lembraReferenceObjectKey,
	lembraUploadChunkCount,
	type LembraMediaMime,
} from "./model";

export type VerifiedLembraUpload = LembraImageInfo &
	Readonly<{
		bucket: string;
		objectKey: string;
		readBackVerified: true;
	}>;

type S3ResponseError = Readonly<{
	name?: string;
	$metadata?: Readonly<{ httpStatusCode?: number }>;
}>;

function failure(code: string): never {
	throw new Error(`LEMBRA_MEDIA_${code}`);
}

function responseError(error: unknown): S3ResponseError {
	return error as S3ResponseError;
}

function isNotFound(error: unknown): boolean {
	const response = responseError(error);
	return (
		response.$metadata?.httpStatusCode === 404 ||
		response.name === "NotFound" ||
		response.name === "NoSuchKey"
	);
}

function isPreconditionFailed(error: unknown): boolean {
	const response = responseError(error);
	return (
		response.$metadata?.httpStatusCode === 412 ||
		response.name === "PreconditionFailed"
	);
}

function lembraProductionRuntime() {
	return process.env.VERCEL_ENV === "production";
}

export function lembraPersistenceEnabled() {
	return lembraProductionRuntime() || process.env.TDA_LEMBRA_ENABLED === "true";
}

function lembraMediaClient() {
	return lembraProductionRuntime() ? privateMediaClient() : mediaClient();
}

export function lembraStagingBucket(): string {
	const expected = lembraProductionRuntime()
		? LEMBRA_PRIVATE_BUCKET
		: LEMBRA_PREVIEW_BUCKET;
	const configured = lembraProductionRuntime()
		? process.env.R2_PRIVATE_BUCKET
		: process.env.R2_PREVIEW_BUCKET;
	if (configured !== expected) failure("STAGING_BUCKET_MISMATCH");
	return configured;
}

async function objectBytes(
	client: S3Client,
	bucket: string,
	objectKey: string,
	{
		minBytes = 24,
		maxBytes = LEMBRA_MAX_BYTES,
	}: { minBytes?: number; maxBytes?: number } = {},
): Promise<Uint8Array> {
	const head = await client.send(
		new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
	);
	if (
		typeof head.ContentLength !== "number" ||
		head.ContentLength < minBytes ||
		head.ContentLength > maxBytes
	) {
		failure("R2_INVALID_SIZE");
	}

	const result = await client.send(
		new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
	);
	if (!result.Body) failure("R2_EMPTY_BODY");
	if (
		typeof result.ContentLength !== "number" ||
		result.ContentLength !== head.ContentLength ||
		result.ContentLength < minBytes ||
		result.ContentLength > maxBytes
	) {
		failure("R2_LENGTH_MISMATCH");
	}

	const bytes = Uint8Array.from(await result.Body.transformToByteArray());
	if (bytes.length !== result.ContentLength) failure("R2_LENGTH_MISMATCH");
	return bytes;
}

async function putImmutable({
	client,
	bucket,
	objectKey,
	bytes,
	info,
}: {
	client: S3Client;
	bucket: string;
	objectKey: string;
	bytes: Uint8Array;
	info: LembraImageInfo;
}) {
	let exists = false;
	try {
		const head = await client.send(
			new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
		);
		exists = true;
		if (
			head.ContentLength !== info.bytes ||
			head.ContentType !== info.mimeType ||
			head.Metadata?.sha256 !== info.sha256
		) {
			failure("R2_COLLISION");
		}
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}

	if (!exists) {
		try {
			await client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: objectKey,
					Body: bytes,
					ContentType: info.mimeType,
					ContentLength: info.bytes,
					Metadata: { sha256: info.sha256 },
					CacheControl: "private, no-store",
					IfNoneMatch: "*",
				}),
			);
		} catch (error) {
			if (!isPreconditionFailed(error)) throw error;
		}
	}

	const readBack = await objectBytes(client, bucket, objectKey);
	if (
		readBack.length !== info.bytes ||
		lembraSha256(readBack) !== info.sha256
	) {
		failure("R2_READBACK_FAILED");
	}
}

export async function writeLembraUploadChunk({
	referenceId,
	uploadId,
	part,
	bytes,
}: {
	referenceId: string;
	uploadId: string;
	part: number;
	bytes: Uint8Array;
}): Promise<void> {
	const objectKey = lembraPendingChunkObjectKey({
		referenceId,
		uploadId,
		part,
	});
	if (!objectKey) failure("INVALID_PENDING_CHUNK_KEY");
	if (bytes.length < 1 || bytes.length > LEMBRA_UPLOAD_CHUNK_BYTES) {
		failure("INVALID_CHUNK_SIZE");
	}

	const bucket = lembraStagingBucket();
	await lembraMediaClient().send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: objectKey,
			Body: bytes,
			ContentType: "application/octet-stream",
			ContentLength: bytes.length,
			CacheControl: "private, no-store",
		}),
	);
}

export async function finalizeLembraPendingUpload({
	referenceId,
	uploadId,
	expectedSha256,
	expectedMimeType,
	expectedBytes,
}: {
	referenceId: string;
	uploadId: string;
	expectedSha256: string;
	expectedMimeType: LembraMediaMime;
	expectedBytes: number;
}): Promise<VerifiedLembraUpload> {
	const chunkCount = lembraUploadChunkCount(expectedBytes);
	if (!chunkCount) failure("INVALID_UPLOAD_SIZE");

	const bucket = lembraStagingBucket();
	const client = lembraMediaClient();
	const pendingBytes = new Uint8Array(expectedBytes);
	const chunkKeys: string[] = [];
	let offset = 0;

	for (let part = 0; part < chunkCount; part += 1) {
		const objectKey = lembraPendingChunkObjectKey({
			referenceId,
			uploadId,
			part,
		});
		if (!objectKey) failure("INVALID_PENDING_CHUNK_KEY");
		const expectedPartBytes = Math.min(
			LEMBRA_UPLOAD_CHUNK_BYTES,
			expectedBytes - offset,
		);
		const chunk = await objectBytes(client, bucket, objectKey, {
			minBytes: expectedPartBytes,
			maxBytes: expectedPartBytes,
		});
		pendingBytes.set(chunk, offset);
		offset += chunk.length;
		chunkKeys.push(objectKey);
	}

	if (offset !== expectedBytes) failure("UPLOAD_LENGTH_MISMATCH");

	const info = inspectLembraImage(pendingBytes);
	if (
		info.sha256 !== expectedSha256 ||
		info.mimeType !== expectedMimeType ||
		info.bytes !== expectedBytes
	) {
		failure("UPLOAD_INTENT_MISMATCH");
	}

	const objectKey = lembraReferenceObjectKey({
		referenceId,
		sha256: info.sha256,
		extension: info.extension,
	});
	if (!objectKey) failure("INVALID_OBJECT_KEY");

	await putImmutable({
		client,
		bucket,
		objectKey,
		bytes: pendingBytes,
		info,
	});

	await Promise.allSettled(
		chunkKeys.map((key) =>
			client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
		),
	);

	return {
		...info,
		bucket,
		objectKey,
		readBackVerified: true,
	};
}

export async function readVerifiedLembraObject({
	referenceId,
	bucket,
	objectKey,
	sha256,
	mimeType,
	bytes: expectedBytes,
	width,
	height,
}: {
	referenceId: string;
	bucket: string;
	objectKey: string;
	sha256: string;
	mimeType: LembraMediaMime;
	bytes: number;
	width: number;
	height: number;
}): Promise<Uint8Array> {
	const allowed = new Set<string>([
		LEMBRA_PREVIEW_BUCKET,
		LEMBRA_PRIVATE_BUCKET,
	]);
	if (!allowed.has(bucket)) failure("BUCKET_NOT_ALLOWED");

	const expectedKey = lembraReferenceObjectKey({
		referenceId,
		sha256,
		extension: lembraExtensionForMime(mimeType),
	});
	if (!expectedKey || expectedKey !== objectKey) {
		failure("OBJECT_SCOPE_MISMATCH");
	}

	const payload = await objectBytes(lembraMediaClient(), bucket, objectKey);
	const inspected = inspectLembraImage(payload);
	if (
		inspected.sha256 !== sha256 ||
		inspected.mimeType !== mimeType ||
		inspected.bytes !== expectedBytes ||
		inspected.width !== width ||
		inspected.height !== height
	) {
		failure("READBACK_INTEGRITY_FAILED");
	}

	return payload;
}
