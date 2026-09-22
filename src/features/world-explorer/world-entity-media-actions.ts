"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	WORLD_ENTITY_MEDIA_MAX_BYTES,
	WORLD_ENTITY_MEDIA_UPLOAD_CHUNK_BYTES,
	type WorldEntityMediaMime,
	isWorldEntityMediaAssetId,
	isWorldEntityMediaMime,
	isWorldEntityMediaSha256,
} from "./world-entity-media";
import { authorizeWorldEntityMediaTarget } from "./world-entity-media-access";
import {
	finalizeWorldEntityPortraitPendingUpload,
	type VerifiedWorldEntityUpload,
	worldEntityMediaEnabled,
} from "./world-entity-media-server";

export type WorldEntityMediaUploadFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable"
	| "media_unavailable"
	| "invalid_payload"
	| "lease_lost";

export type WorldEntityPortraitUploadIntent = Readonly<{
	sha256: string;
	mimeType: WorldEntityMediaMime;
	bytes: number;
}>;

export type RequestWorldEntityPortraitUploadResult =
	| Readonly<{
			ok: true;
			uploadId: string;
			chunkBytes: number;
	  }>
	| Readonly<{ ok: false; reason: WorldEntityMediaUploadFailure }>;

export type FinalizeWorldEntityPortraitUploadResult =
	| Readonly<{
			ok: true;
			assetId: string;
			sha256: string;
			mimeType: WorldEntityMediaMime;
			bytes: number;
			width: number;
			height: number;
	  }>
	| Readonly<{ ok: false; reason: WorldEntityMediaUploadFailure }>;

function sameVerifiedAsset(row: MediaAssetRow, upload: VerifiedWorldEntityUpload): boolean {
	return (
		row.status !== "retired" &&
		row.role_hint === "portrait" &&
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
	upload: VerifiedWorldEntityUpload,
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
	if (error) throw new Error(`asset_lookup:${error.message}`);
	return (data as MediaAssetRow | null) ?? null;
}

async function persistVerifiedAsset({
	client,
	campaignId,
	profileId,
	upload,
}: {
	client: SupabaseClient;
	campaignId: string;
	profileId: string;
	upload: VerifiedWorldEntityUpload;
}): Promise<string> {
	const current = await existingAsset(client, campaignId, upload);
	if (current) {
		if (!sameVerifiedAsset(current, upload)) {
			throw new Error("asset_identity_collision");
		}
		return current.id;
	}

	const { data, error } = await client
		.from("media_assets")
		.insert({
			campaign_id: campaignId,
			media_kind: "image",
			role_hint: "portrait",
			status: "staged",
			staged_bucket: upload.bucket,
			object_key: upload.objectKey,
			sha256: upload.sha256,
			mime_type: upload.mimeType,
			byte_size: upload.bytes,
			width: upload.width,
			height: upload.height,
			read_back_verified: true,
			created_by: profileId,
		})
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified",
		)
		.maybeSingle();
	if (!error && data) {
		const inserted = data as MediaAssetRow;
		if (!sameVerifiedAsset(inserted, upload)) throw new Error("asset_insert_mismatch");
		return inserted.id;
	}

	// A concurrent finalizer can win the unique (campaign,bucket,key) insert.
	// Re-read the canonical identity instead of mutating an existing asset.
	const raced = await existingAsset(client, campaignId, upload);
	if (raced && sameVerifiedAsset(raced, upload)) return raced.id;
	throw new Error(`asset_insert:${error?.message ?? "unknown"}`);
}

export async function requestWorldEntityPortraitUploadAction(
	leaseToken: string,
	entityId: string,
	intent: WorldEntityPortraitUploadIntent,
): Promise<RequestWorldEntityPortraitUploadResult> {
	if (!worldEntityMediaEnabled()) return { ok: false, reason: "media_unavailable" };
	if (
		!isWorldEntityMediaAssetId(leaseToken) ||
		!isWorldEntityMediaAssetId(entityId) ||
		!validIntent(intent)
	) {
		return { ok: false, reason: "invalid_payload" };
	}

	const authorization = await authorizeWorldEntityMediaTarget(leaseToken, entityId);
	if (!authorization.ok) return authorization;

	return {
		ok: true,
		uploadId: randomUUID(),
		chunkBytes: WORLD_ENTITY_MEDIA_UPLOAD_CHUNK_BYTES,
	};
}

export async function finalizeWorldEntityPortraitUploadAction(
	leaseToken: string,
	entityId: string,
	uploadId: string,
	intent: WorldEntityPortraitUploadIntent,
): Promise<FinalizeWorldEntityPortraitUploadResult> {
	if (!worldEntityMediaEnabled()) return { ok: false, reason: "media_unavailable" };
	if (
		!isWorldEntityMediaAssetId(leaseToken) ||
		!isWorldEntityMediaAssetId(entityId) ||
		!isWorldEntityMediaAssetId(uploadId) ||
		!validIntent(intent)
	) {
		return { ok: false, reason: "invalid_payload" };
	}

	const authorization = await authorizeWorldEntityMediaTarget(leaseToken, entityId);
	if (!authorization.ok) return authorization;
	const { client, campaignId, profileId } = authorization.target;

	try {
		const upload = await finalizeWorldEntityPortraitPendingUpload({
			campaignSlug: CAMPAIGN_SLUG,
			entityId,
			uploadId,
			expectedSha256: intent.sha256,
			expectedMimeType: intent.mimeType,
			expectedBytes: intent.bytes,
		});
		const assetId = await persistVerifiedAsset({
			client,
			campaignId,
			profileId,
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
			"World entity portrait upload finalization failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false, reason: "dependency_unavailable" };
	}
}
