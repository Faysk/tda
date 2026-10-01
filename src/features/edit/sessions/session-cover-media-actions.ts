"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { worldEntityMediaEnabled } from "@/features/world-explorer/world-entity-media-server";
import { authorizeSessionCoverTarget } from "./session-cover-media-access";
import {
	SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
	type SessionCoverMediaMime,
	type SessionCoverUploadIntent,
	isSessionCoverCampaignKey,
	isSessionCoverIntent,
	isSessionCoverMime,
	isSessionCoverSha256,
	isSessionCoverUuid,
	sessionCoverObjectKey,
} from "./session-cover-media";
import {
	finalizeSessionCoverPendingUpload,
	type VerifiedSessionCoverUpload,
} from "./session-cover-media-server";

export type SessionCoverUploadFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable"
	| "not_found"
	| "media_unavailable"
	| "invalid_payload";

type MediaAssetRow = Readonly<{
	id: string;
	status: "staged" | "verified_public" | "retired";
	role_hint: string;
	staged_bucket: string;
	object_key: string;
	sha256: string;
	mime_type: string;
	byte_size: number | string;
	width: number;
	height: number;
	read_back_verified: boolean;
}>;

function sameVerifiedAsset(
	row: MediaAssetRow,
	upload: VerifiedSessionCoverUpload,
): boolean {
	return (
		row.status !== "retired" &&
		row.role_hint === "session_cover" &&
		row.staged_bucket === upload.bucket &&
		row.object_key === upload.objectKey &&
		row.sha256 === upload.sha256 &&
		row.mime_type === upload.mimeType &&
		Number(row.byte_size) === upload.bytes &&
		row.width === upload.width &&
		row.height === upload.height &&
		row.read_back_verified === true
	);
}

async function existingAsset(
	client: SupabaseClient,
	campaignId: string,
	upload: VerifiedSessionCoverUpload,
): Promise<MediaAssetRow | null> {
	const { data, error } = await client
		.from("media_assets")
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified",
		)
		.eq("campaign_id", campaignId)
		.eq("staged_bucket", upload.bucket)
		.eq("object_key", upload.objectKey)
		.maybeSingle();
	if (error) throw new Error("session_cover_asset_lookup");
	return (data as MediaAssetRow | null) ?? null;
}

async function persistVerifiedAsset(input: {
	client: SupabaseClient;
	campaignId: string;
	profileId: string;
	upload: VerifiedSessionCoverUpload;
}): Promise<string> {
	const current = await existingAsset(
		input.client,
		input.campaignId,
		input.upload,
	);
	if (current) {
		if (!sameVerifiedAsset(current, input.upload))
			throw new Error("session_cover_asset_identity_collision");
		return current.id;
	}

	const { data, error } = await input.client
		.from("media_assets")
		.insert({
			campaign_id: input.campaignId,
			media_kind: "image",
			role_hint: "session_cover",
			status: "staged",
			staged_bucket: input.upload.bucket,
			object_key: input.upload.objectKey,
			sha256: input.upload.sha256,
			mime_type: input.upload.mimeType,
			byte_size: input.upload.bytes,
			width: input.upload.width,
			height: input.upload.height,
			read_back_verified: true,
			created_by: input.profileId,
		})
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified",
		)
		.maybeSingle();

	if (!error && data) {
		const inserted = data as MediaAssetRow;
		if (!sameVerifiedAsset(inserted, input.upload))
			throw new Error("session_cover_asset_insert_mismatch");
		return inserted.id;
	}

	const raced = await existingAsset(
		input.client,
		input.campaignId,
		input.upload,
	);
	if (raced && sameVerifiedAsset(raced, input.upload)) return raced.id;
	throw new Error("session_cover_asset_insert");
}

export async function sessionCoverMediaAvailabilityAction(): Promise<boolean> {
	return worldEntityMediaEnabled();
}

export async function requestSessionCoverUploadAction(
	campaignSlug: string,
	sessionId: string,
	intent: SessionCoverUploadIntent,
): Promise<
	| Readonly<{ ok: true; uploadId: string; chunkBytes: number }>
	| Readonly<{ ok: false; reason: SessionCoverUploadFailure }>
> {
	if (!worldEntityMediaEnabled())
		return { ok: false, reason: "media_unavailable" };
	if (!isSessionCoverCampaignKey(campaignSlug) || !isSessionCoverUuid(sessionId) || !isSessionCoverIntent(intent))
		return { ok: false, reason: "invalid_payload" };

	const authorization = await authorizeSessionCoverTarget(campaignSlug, sessionId);
	if (!authorization.ok) return authorization;

	return {
		ok: true,
		uploadId: randomUUID(),
		chunkBytes: SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
	};
}

export async function finalizeSessionCoverUploadAction(
	campaignSlug: string,
	sessionId: string,
	uploadId: string,
	intent: SessionCoverUploadIntent,
): Promise<
	| Readonly<{
			ok: true;
			assetId: string;
			sha256: string;
			mimeType: SessionCoverMediaMime;
			bytes: number;
			width: number;
			height: number;
	  }>
	| Readonly<{ ok: false; reason: SessionCoverUploadFailure }>
> {
	if (!worldEntityMediaEnabled())
		return { ok: false, reason: "media_unavailable" };
	if (
		!isSessionCoverCampaignKey(campaignSlug) ||
		!isSessionCoverUuid(sessionId) ||
		!isSessionCoverUuid(uploadId) ||
		!isSessionCoverIntent(intent)
	)
		return { ok: false, reason: "invalid_payload" };

	const authorization = await authorizeSessionCoverTarget(campaignSlug, sessionId);
	if (!authorization.ok) return authorization;

	try {
		const upload = await finalizeSessionCoverPendingUpload({
			campaignSlug,
			sessionId,
			uploadId,
			expectedSha256: intent.sha256,
			expectedMimeType: intent.mimeType,
			expectedBytes: intent.bytes,
		});
		const assetId = await persistVerifiedAsset({
			client: authorization.target.client,
			campaignId: authorization.target.campaignId,
			profileId: authorization.target.profileId,
			upload,
		});
		return {
			ok: true,
			assetId,
			sha256: upload.sha256,
			mimeType: upload.mimeType,
			bytes: upload.bytes,
			width: upload.width,
			height: upload.height,
		};
	} catch (error) {
		console.error(
			"Session cover upload finalization failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false, reason: "dependency_unavailable" };
	}
}


export async function getSessionCoverAssetStatusAction(
	campaignSlug: string,
	sessionId: string,
	assetId: string,
): Promise<
	| Readonly<{
			ok: true;
			assetId: string;
			status: "staged" | "verified_public";
			mimeType: SessionCoverMediaMime;
			bytes: number;
			width: number;
			height: number;
			readBackVerified: true;
	  }>
	| Readonly<{ ok: false; reason: SessionCoverUploadFailure }>
> {
	if (!worldEntityMediaEnabled())
		return { ok: false, reason: "media_unavailable" };
	if (!isSessionCoverCampaignKey(campaignSlug) || !isSessionCoverUuid(sessionId) || !isSessionCoverUuid(assetId))
		return { ok: false, reason: "invalid_payload" };

	const authorization = await authorizeSessionCoverTarget(campaignSlug, sessionId);
	if (!authorization.ok) return authorization;

	const { data, error } = await authorization.target.client
		.from("media_assets")
		.select(
			"id,status,role_hint,object_key,sha256,mime_type,byte_size,width,height,read_back_verified",
		)
		.eq("campaign_id", authorization.target.campaignId)
		.eq("id", assetId)
		.maybeSingle();
	if (error)
		return { ok: false, reason: "dependency_unavailable" };
	if (!data)
		return { ok: false, reason: "not_found" };

	const status =
		data.status === "staged" || data.status === "verified_public"
			? data.status
			: null;
	const mimeType = isSessionCoverMime(data.mime_type) ? data.mime_type : null;
	const sha256 = isSessionCoverSha256(data.sha256) ? data.sha256 : null;
	const bytes = Number(data.byte_size);
	const width = Number(data.width);
	const height = Number(data.height);
	if (
		!status ||
		data.role_hint !== "session_cover" ||
		data.read_back_verified !== true ||
		!mimeType ||
		!sha256 ||
		!Number.isSafeInteger(bytes) ||
		bytes < 24 ||
		!Number.isSafeInteger(width) ||
		width < 1 ||
		!Number.isSafeInteger(height) ||
		height < 1
	) {
		return { ok: false, reason: "not_found" };
	}

	const extension = mimeType === "image/png" ? "png" : "webp";
	const expectedKey = sessionCoverObjectKey({
		campaignSlug,
		sessionId,
		sha256,
		extension,
	});
	if (!expectedKey || expectedKey !== data.object_key)
		return { ok: false, reason: "not_found" };

	return {
		ok: true,
		assetId,
		status,
		mimeType,
		bytes,
		width,
		height,
		readBackVerified: true,
	};
}
