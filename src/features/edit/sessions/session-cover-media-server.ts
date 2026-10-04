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
import { promoteGovernedImageObject } from "@/features/world-explorer/world-entity-media-server";
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

export type PreparedSessionCoverCampaignMove = Readonly<{
	sourceObjectKey: string;
	destinationObjectKey: string;
	sha256: string;
	stagedBucket: string;
	publicObjectKey: string | null;
	publicUrl: string | null;
	publicVerifiedAt: string | null;
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

function clientForStagingBucket(bucket: string): S3Client {
	if (bucket === WORLD_ENTITY_MEDIA_PRIVATE_BUCKET) return privateMediaClient();
	if (bucket === WORLD_ENTITY_MEDIA_PREVIEW_BUCKET) return mediaClient();
	failure("STAGING_BUCKET_NOT_ALLOWED");
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
	cacheControl = "private, no-store",
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
					CacheControl: cacheControl,
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


export async function promoteSessionCover(input: {
	campaignSlug: string;
	sessionId: string;
	stagedBucket: string;
	objectKey: string;
	sha256: string;
	mimeType: SessionCoverMediaMime;
	bytes: number;
	width: number;
	height: number;
}): Promise<{
	publicBucket: string;
	publicObjectKey: string;
	publicUrl: string;
	verifiedAt: string;
}> {
	const extension = input.mimeType === "image/png" ? "png" : "webp";
	const expectedKey = sessionCoverObjectKey({
		campaignSlug: input.campaignSlug,
		sessionId: input.sessionId,
		sha256: input.sha256,
		extension,
	});
	if (!expectedKey) failure("OBJECT_SCOPE_MISMATCH");

	return promoteGovernedImageObject({
		stagedBucket: input.stagedBucket,
		objectKey: input.objectKey,
		expectedObjectKey: expectedKey,
		info: {
			sha256: input.sha256,
			mimeType: input.mimeType,
			extension,
			bytes: input.bytes,
			width: input.width,
			height: input.height,
		},
		maxPixels: SESSION_COVER_MEDIA_MAX_PIXELS,
	});
}


/**
 * Materializes one immutable session-cover asset under a destination campaign
 * namespace without deleting the source object. PostgreSQL commits ownership
 * only after this function's read-back evidence has been persisted.
 */
export async function prepareSessionCoverCampaignMove(input: {
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	sessionId: string;
	stagedBucket: string;
	sourceObjectKey: string;
	sha256: string;
	mimeType: SessionCoverMediaMime;
	bytes: number;
	width: number;
	height: number;
	verifiedPublic: boolean;
}): Promise<PreparedSessionCoverCampaignMove> {
	const extension = input.mimeType === "image/png" ? "png" : "webp";
	const expectedSourceKey = sessionCoverObjectKey({
		campaignSlug: input.sourceCampaignSlug,
		sessionId: input.sessionId,
		sha256: input.sha256,
		extension,
	});
	const destinationObjectKey = sessionCoverObjectKey({
		campaignSlug: input.destinationCampaignSlug,
		sessionId: input.sessionId,
		sha256: input.sha256,
		extension,
	});
	if (
		!expectedSourceKey ||
		!destinationObjectKey ||
		expectedSourceKey !== input.sourceObjectKey ||
		expectedSourceKey === destinationObjectKey
	) {
		failure("CAMPAIGN_MOVE_SCOPE_MISMATCH");
	}

	const client = clientForStagingBucket(input.stagedBucket);
	const bytes = await exactObjectBytes(
		client,
		input.stagedBucket,
		input.sourceObjectKey,
		input.bytes,
	);
	const info = inspectWorldEntityImage(bytes);
	if (
		info.sha256 !== input.sha256 ||
		info.mimeType !== input.mimeType ||
		info.bytes !== input.bytes ||
		info.width !== input.width ||
		info.height !== input.height ||
		info.width * info.height > SESSION_COVER_MEDIA_MAX_PIXELS
	) {
		failure("CAMPAIGN_MOVE_SOURCE_INTEGRITY_FAILED");
	}

	await putImmutableCover(
		client,
		input.stagedBucket,
		destinationObjectKey,
		bytes,
		info,
	);

	if (!input.verifiedPublic) {
		return {
			sourceObjectKey: input.sourceObjectKey,
			destinationObjectKey,
			sha256: input.sha256,
			stagedBucket: input.stagedBucket,
			publicObjectKey: null,
			publicUrl: null,
			publicVerifiedAt: null,
		};
	}

	const promoted = await promoteGovernedImageObject({
		stagedBucket: input.stagedBucket,
		objectKey: destinationObjectKey,
		expectedObjectKey: destinationObjectKey,
		info,
		maxPixels: SESSION_COVER_MEDIA_MAX_PIXELS,
	});
	return {
		sourceObjectKey: input.sourceObjectKey,
		destinationObjectKey,
		sha256: input.sha256,
		stagedBucket: input.stagedBucket,
		publicObjectKey: promoted.publicObjectKey,
		publicUrl: promoted.publicUrl,
		publicVerifiedAt: promoted.verifiedAt,
	};
}
