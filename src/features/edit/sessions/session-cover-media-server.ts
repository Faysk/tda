import "server-only";

import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { mediaClient, privateMediaClient } from "@/integrations/r2/server";
import {
	inspectWorldEntityImage,
	worldEntityMediaSha256,
} from "@/features/world-explorer/world-entity-media-image";
import {
	WORLD_ENTITY_MEDIA_PRIVATE_BUCKET,
	WORLD_ENTITY_MEDIA_PREVIEW_BUCKET,
} from "@/features/world-explorer/world-entity-media";
import {
	SESSION_COVER_MEDIA_MAX_BYTES,
	SESSION_COVER_MEDIA_MAX_PIXELS,
	SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
	type SessionCoverMediaMime,
	sessionCoverObjectKey,
	sessionCoverPendingChunkObjectKey,
	sessionCoverUploadChunkCount,
} from "./session-cover-media";

export type VerifiedSessionCoverUpload = Readonly<{
	bucket: string;
	objectKey: string;
	sha256: string;
	mimeType: SessionCoverMediaMime;
	extension: "png" | "webp";
	bytes: number;
	width: number;
	height: number;
	readBackVerified: true;
}>;

type S3Error = Readonly<{
	name?: string;
	$metadata?: Readonly<{ httpStatusCode?: number }>;
}>;

function failure(code: string): never {
	throw new Error("SESSION_COVER_MEDIA_" + code);
}

function isNotFound(error: unknown) {
	const response = error as S3Error;
	return (
		response.$metadata?.httpStatusCode === 404 ||
		response.name === "NotFound" ||
		response.name === "NoSuchKey"
	);
}

function isPreconditionFailed(error: unknown) {
	const response = error as S3Error;
	return (
		response.$metadata?.httpStatusCode === 412 ||
		response.name === "PreconditionFailed"
	);
}

function stagingBucket(): string {
	const production = process.env.VERCEL_ENV === "production";
	const expected = production
		? WORLD_ENTITY_MEDIA_PRIVATE_BUCKET
		: WORLD_ENTITY_MEDIA_PREVIEW_BUCKET;
	const configured = production
		? process.env.R2_PRIVATE_BUCKET
		: process.env.R2_PREVIEW_BUCKET;
	if (configured !== expected) failure("STAGING_BUCKET_MISMATCH");
	return configured;
}

function stagingClient(): S3Client {
	return process.env.VERCEL_ENV === "production"
		? privateMediaClient()
		: mediaClient();
}

async function exactObjectBytes(
	client: S3Client,
	bucket: string,
	objectKey: string,
	expectedBytes?: number,
): Promise<Uint8Array> {
	const head = await client.send(
		new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
	);
	if (
		typeof head.ContentLength !== "number" ||
		head.ContentLength < 1 ||
		head.ContentLength > SESSION_COVER_MEDIA_MAX_BYTES ||
		(expectedBytes !== undefined && head.ContentLength !== expectedBytes)
	)
		failure("R2_INVALID_SIZE");

	const result = await client.send(
		new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
	);
	if (!result.Body) failure("R2_EMPTY_BODY");
	const bytes = Uint8Array.from(await result.Body.transformToByteArray());
	if (
		bytes.length !== head.ContentLength ||
		(expectedBytes !== undefined && bytes.length !== expectedBytes)
	)
		failure("R2_LENGTH_MISMATCH");
	return bytes;
}

async function putImmutableCover(
	client: S3Client,
	bucket: string,
	objectKey: string,
	bytes: Uint8Array,
	info: ReturnType<typeof inspectWorldEntityImage>,
) {
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
		)
			failure("R2_COLLISION");
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

	const readBack = await exactObjectBytes(
		client,
		bucket,
		objectKey,
		info.bytes,
	);
	if (worldEntityMediaSha256(readBack) !== info.sha256)
		failure("R2_READBACK_FAILED");
}

export async function writeSessionCoverPendingUploadChunk(input: {
	campaignSlug: string;
	sessionId: string;
	uploadId: string;
	sha256: string;
	part: number;
	bytes: Uint8Array;
}) {
	const objectKey = sessionCoverPendingChunkObjectKey(input);
	if (!objectKey) failure("INVALID_PENDING_KEY");
	if (
		input.bytes.length < 1 ||
		input.bytes.length > SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES
	)
		failure("INVALID_CHUNK_SIZE");
	await stagingClient().send(
		new PutObjectCommand({
			Bucket: stagingBucket(),
			Key: objectKey,
			Body: input.bytes,
			ContentType: "application/octet-stream",
			ContentLength: input.bytes.length,
			CacheControl: "private, no-store",
		}),
	);
}

export async function finalizeSessionCoverPendingUpload(input: {
	campaignSlug: string;
	sessionId: string;
	uploadId: string;
	expectedSha256: string;
	expectedMimeType: SessionCoverMediaMime;
	expectedBytes: number;
}): Promise<VerifiedSessionCoverUpload> {
	const chunkCount = sessionCoverUploadChunkCount(input.expectedBytes);
	if (!chunkCount) failure("INVALID_UPLOAD_SIZE");

	const client = stagingClient();
	const bucket = stagingBucket();
	const bytes = new Uint8Array(input.expectedBytes);
	const chunkKeys: string[] = [];
	let offset = 0;

	for (let part = 0; part < chunkCount; part += 1) {
		const objectKey = sessionCoverPendingChunkObjectKey({
			campaignSlug: input.campaignSlug,
			sessionId: input.sessionId,
			uploadId: input.uploadId,
			sha256: input.expectedSha256,
			part,
		});
		if (!objectKey) failure("INVALID_PENDING_KEY");
		const expectedPartBytes = Math.min(
			SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
			input.expectedBytes - offset,
		);
		const chunk = await exactObjectBytes(
			client,
			bucket,
			objectKey,
			expectedPartBytes,
		);
		bytes.set(chunk, offset);
		offset += chunk.length;
		chunkKeys.push(objectKey);
	}
	if (offset !== input.expectedBytes) failure("UPLOAD_LENGTH_MISMATCH");

	const info = inspectWorldEntityImage(bytes);
	if (
		info.sha256 !== input.expectedSha256 ||
		info.mimeType !== input.expectedMimeType ||
		info.bytes !== input.expectedBytes
	)
		failure("UPLOAD_INTENT_MISMATCH");
	if (info.width * info.height > SESSION_COVER_MEDIA_MAX_PIXELS)
		failure("PIXEL_BUDGET_EXCEEDED");

	const objectKey = sessionCoverObjectKey({
		campaignSlug: input.campaignSlug,
		sessionId: input.sessionId,
		sha256: info.sha256,
		extension: info.extension,
	});
	if (!objectKey) failure("INVALID_OBJECT_KEY");

	await putImmutableCover(client, bucket, objectKey, bytes, info);
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
