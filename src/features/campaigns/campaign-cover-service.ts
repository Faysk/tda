import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
	WORLD_ENTITY_MEDIA_MAX_BYTES,
	type WorldEntityMediaMime,
} from "@/features/world-explorer/world-entity-media";
import { inspectWorldEntityImage } from "@/features/world-explorer/world-entity-media-image";
import type { AuthorizedCampaignCoverTarget } from "./campaign-cover-access";
import {
	CAMPAIGN_COVER_MEDIA_ROLE,
	campaignCoverPublicUrl,
	type CampaignCoverAsset,
} from "./campaign-cover-media";
import {
	promoteCampaignCover,
	stageCampaignCover,
} from "./campaign-cover-media-server";

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
	public_bucket: string | null;
	public_object_key: string | null;
	public_delivery_verified: boolean;
	public_verified_at: string | null;
}>;

function sameStagedIdentity(
	row: MediaAssetRow,
	upload: Awaited<ReturnType<typeof stageCampaignCover>>,
): boolean {
	return (
		row.status !== "retired" &&
		row.role_hint === CAMPAIGN_COVER_MEDIA_ROLE &&
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

function publicAsset(row: MediaAssetRow): CampaignCoverAsset {
	return {
		status: row.status,
		roleHint: row.role_hint,
		objectKey: row.object_key,
		sha256: row.sha256,
		mimeType: row.mime_type,
		readBackVerified: row.read_back_verified,
		publicBucket: row.public_bucket,
		publicObjectKey: row.public_object_key,
		publicDeliveryVerified: row.public_delivery_verified,
		publicVerifiedAt: row.public_verified_at,
	};
}

async function existingAsset(
	client: SupabaseClient,
	campaignId: string,
	bucket: string,
	objectKey: string,
): Promise<MediaAssetRow | null> {
	const { data, error } = await client
		.from("media_assets")
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.eq("campaign_id", campaignId)
		.eq("staged_bucket", bucket)
		.eq("object_key", objectKey)
		.maybeSingle();
	if (error) throw new Error("CAMPAIGN_COVER_ASSET_LOOKUP_FAILED");
	return (data as MediaAssetRow | null) ?? null;
}

async function persistStagedAsset(input: {
	target: AuthorizedCampaignCoverTarget;
	upload: Awaited<ReturnType<typeof stageCampaignCover>>;
}): Promise<MediaAssetRow> {
	const current = await existingAsset(
		input.target.client,
		input.target.campaignId,
		input.upload.bucket,
		input.upload.objectKey,
	);
	if (current) {
		if (!sameStagedIdentity(current, input.upload))
			throw new Error("CAMPAIGN_COVER_ASSET_IDENTITY_COLLISION");
		return current;
	}

	const { data, error } = await input.target.client
		.from("media_assets")
		.insert({
			campaign_id: input.target.campaignId,
			media_kind: "image",
			role_hint: CAMPAIGN_COVER_MEDIA_ROLE,
			status: "staged",
			staged_bucket: input.upload.bucket,
			object_key: input.upload.objectKey,
			sha256: input.upload.sha256,
			mime_type: input.upload.mimeType,
			byte_size: input.upload.bytes,
			width: input.upload.width,
			height: input.upload.height,
			read_back_verified: true,
			created_by: input.target.profileId,
		})
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.maybeSingle();
	if (!error && data) return data as MediaAssetRow;

	const raced = await existingAsset(
		input.target.client,
		input.target.campaignId,
		input.upload.bucket,
		input.upload.objectKey,
	);
	if (raced && sameStagedIdentity(raced, input.upload)) return raced;
	throw new Error("CAMPAIGN_COVER_ASSET_INSERT_FAILED");
}

async function promoteIfPublic(
	target: AuthorizedCampaignCoverTarget,
	asset: MediaAssetRow,
): Promise<MediaAssetRow> {
	if (target.visibility !== "public") return asset;

	const currentUrl = campaignCoverPublicUrl(
		publicAsset(asset),
		target.campaignTechnicalSlug,
	);
	if (currentUrl) return asset;
	if (asset.status !== "staged" || asset.read_back_verified !== true)
		throw new Error("CAMPAIGN_COVER_ASSET_NOT_PROMOTABLE");
	if (
		asset.mime_type !== "image/png" &&
		asset.mime_type !== "image/webp"
	)
		throw new Error("CAMPAIGN_COVER_ASSET_MIME_INVALID");

	const promoted = await promoteCampaignCover({
		campaignMediaKey: target.campaignTechnicalSlug,
		stagedBucket: asset.staged_bucket,
		objectKey: asset.object_key,
		sha256: asset.sha256,
		mimeType: asset.mime_type as WorldEntityMediaMime,
		bytes: Number(asset.byte_size),
		width: asset.width,
		height: asset.height,
	});

	const { data, error } = await target.client
		.from("media_assets")
		.update({
			status: "verified_public",
			public_bucket: promoted.publicBucket,
			public_object_key: promoted.publicObjectKey,
			public_delivery_verified: true,
			public_verified_at: promoted.verifiedAt,
			updated_at: promoted.verifiedAt,
		})
		.eq("campaign_id", target.campaignId)
		.eq("id", asset.id)
		.eq("status", "staged")
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.maybeSingle();
	if (!error && data) return data as MediaAssetRow;

	const current = await existingAsset(
		target.client,
		target.campaignId,
		asset.staged_bucket,
		asset.object_key,
	);
	if (
		current &&
		campaignCoverPublicUrl(
			publicAsset(current),
			target.campaignTechnicalSlug,
		)
	) {
		return current;
	}
	throw new Error("CAMPAIGN_COVER_PUBLIC_RECEIPT_FAILED");
}

async function bindCover(
	target: AuthorizedCampaignCoverTarget,
	assetId: string,
) {
	const now = new Date().toISOString();
	const { data, error } = await target.client
		.from("campaign_media_bindings")
		.upsert(
			{
				campaign_id: target.campaignId,
				role: "cover",
				asset_id: assetId,
				updated_by: target.profileId,
				updated_at: now,
			},
			{ onConflict: "campaign_id,role" },
		)
		.select("campaign_id,role,asset_id")
		.maybeSingle();
	if (
		error ||
		data?.campaign_id !== target.campaignId ||
		data?.role !== "cover" ||
		data?.asset_id !== assetId
	) {
		throw new Error("CAMPAIGN_COVER_BINDING_FAILED");
	}
}

export async function saveCampaignCover(input: {
	target: AuthorizedCampaignCoverTarget;
	bytes: Uint8Array;
	expectedMimeType: "image/png" | "image/webp";
}): Promise<{
	assetId: string;
	status: "staged" | "verified_public";
	publicUrl: string | null;
}> {
	if (
		input.bytes.length < 24 ||
		input.bytes.length > WORLD_ENTITY_MEDIA_MAX_BYTES
	) {
		throw new Error("CAMPAIGN_COVER_MEDIA_INVALID_SIZE");
	}
	const inspected = inspectWorldEntityImage(input.bytes);
	if (inspected.mimeType !== input.expectedMimeType)
		throw new Error("CAMPAIGN_COVER_MEDIA_MIME_MISMATCH");

	const upload = await stageCampaignCover({
		campaignMediaKey: input.target.campaignTechnicalSlug,
		bytes: input.bytes,
	});
	let asset = await persistStagedAsset({
		target: input.target,
		upload,
	});

	// Private campaigns retain the verified staged object only. Public campaigns
	// must complete immutable public delivery + GET verification before binding.
	if (input.target.visibility === "public") {
		asset = await promoteIfPublic(input.target, asset);
		await bindCover(input.target, asset.id);
	} else {
		await bindCover(input.target, asset.id);
	}

	const publicUrl =
		input.target.visibility === "public"
			? campaignCoverPublicUrl(
					publicAsset(asset),
					input.target.campaignTechnicalSlug,
				)
			: null;
	if (input.target.visibility === "public" && !publicUrl)
		throw new Error("CAMPAIGN_COVER_PUBLIC_URL_UNVERIFIED");

	return {
		assetId: asset.id,
		status:
			asset.status === "verified_public"
				? "verified_public"
				: "staged",
		publicUrl,
	};
}

export async function removeCampaignCoverBinding(
	target: AuthorizedCampaignCoverTarget,
): Promise<void> {
	const { error } = await target.client
		.from("campaign_media_bindings")
		.delete()
		.eq("campaign_id", target.campaignId)
		.eq("role", "cover");
	if (error) throw new Error("CAMPAIGN_COVER_BINDING_REMOVE_FAILED");
	// Deliberately do not delete media_assets rows or any R2 object. Rollback and
	// cover replacement are pointer operations over immutable bytes.
}
