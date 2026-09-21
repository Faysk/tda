import "server-only";

import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import {
	mediaClient,
	mediaConnectionConfig,
	privateMediaClient,
	privateMediaConnectionConfig,
} from "@/integrations/r2/server";
import { inspectLembraImage, lembraSha256, type LembraImageInfo } from "./image";
import {
	LEMBRA_MAX_BYTES,
	LEMBRA_PREVIEW_BUCKET,
	LEMBRA_PRIVATE_BUCKET,
	LEMBRA_UPLOAD_EXPIRES_SECONDS,
	lembraExtensionForMime,
	lembraPendingObjectKey,
	lembraReferenceObjectKey,
	type LembraMediaMime,
} from "./model";
import { presignLembraPutObject, type LembraPresignedPut } from "./presign";

export type VerifiedLembraUpload = LembraImageInfo &
	Readonly<{
		bucket: string;
		objectKey: string;
		readBackVerified: true;
	}>;

export type PresignedLembraUpload = LembraPresignedPut &
	Readonly<{
		bucket: string;
		pendingObjectKey: string;
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

function lembraMediaConnectionConfig() {
	return lembraProductionRuntime()
		? privateMediaConnectionConfig()
		: mediaConnectionConfig();
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
): Promise<Uint8Array> {
	const head = await client.send(
		new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
	);
	if (
		typeof head.ContentLength !== "number" ||
		head.ContentLength < 24 ||
		head.ContentLength > LEMBRA_MAX_BYTES
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
		result.ContentLength < 24 ||
		result.ContentLength > LEMBRA_MAX_BYTES
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

export function presignLembraPendingUpload({
	referenceId,
	uploadId,
	sha256,
	mimeType,
}: {
	referenceId: string;
	uploadId: string;
	sha256: string;
	mimeType: LembraMediaMime;
}): PresignedLembraUpload {
	const pendingObjectKey = lembraPendingObjectKey({
		referenceId,
		uploadId,
		sha256,
		extension: lembraExtensionForMime(mimeType),
	});
	if (!pendingObjectKey) failure("INVALID_PENDING_OBJECT_KEY");

	const bucket = lembraStagingBucket();
	const { accountId, accessKeyId, secretAccessKey } =
		lembraMediaConnectionConfig();
	return {
		...presignLembraPutObject({
			accountId,
			bucket,
			objectKey: pendingObjectKey,
			accessKeyId,
			secretAccessKey,
			contentType: mimeType,
			expiresIn: LEMBRA_UPLOAD_EXPIRES_SECONDS,
		}),
		bucket,
		pendingObjectKey,
	};
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
	const pendingObjectKey = lembraPendingObjectKey({
		referenceId,
		uploadId,
		sha256: expectedSha256,
		extension: lembraExtensionForMime(expectedMimeType),
	});
	if (!pendingObjectKey) failure("INVALID_PENDING_OBJECT_KEY");

	const bucket = lembraStagingBucket();
	const client = lembraMediaClient();
	const pendingBytes = await objectBytes(client, bucket, pendingObjectKey);
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
