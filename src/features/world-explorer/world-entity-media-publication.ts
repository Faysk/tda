import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import type { WorldGraphDraft } from "./model";
import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	worldEntityMediaCanBecomePublic,
	worldEntityPortraitObjectKey,
	worldEntityPublicMediaUrl,
} from "./world-entity-media";
import {
	promoteWorldEntityPortrait,
	worldEntityMediaEnabled,
} from "./world-entity-media-server";

export type WorldEntityMediaPublicationStatus = "unchanged" | "saved" | "pending";

type AssetRow = Readonly<{
	id: string;
	campaign_id: string;
	status: "staged" | "verified_public" | "retired";
	staged_bucket: string;
	object_key: string;
	sha256: string;
	mime_type: "image/png" | "image/webp";
	byte_size: number | string;
	width: number;
	height: number;
	read_back_verified: boolean;
	public_bucket: string | null;
	public_object_key: string | null;
	public_delivery_verified: boolean;
	public_verified_at: string | null;
}>;

function extensionFor(mimeType: AssetRow["mime_type"]): "png" | "webp" {
	return mimeType === "image/png" ? "png" : "webp";
}

function safeAssetForEntity(
	asset: AssetRow,
	campaignSlug: string,
	entityId: string,
): boolean {
	const expected = worldEntityPortraitObjectKey({
		campaignSlug,
		entityId,
		sha256: asset.sha256,
		extension: extensionFor(asset.mime_type),
	});
	return Boolean(
		expected &&
		asset.object_key === expected &&
		asset.status !== "retired" &&
		asset.read_back_verified === true &&
		Number.isSafeInteger(Number(asset.byte_size)) &&
		Number(asset.byte_size) > 0 &&
		asset.width > 0 &&
		asset.height > 0,
	);
}

/**
 * Graph/layout publication stays authoritative if media delivery fails after it.
 * Media then reports `pending` and keeps the previous public portrait intact.
 */
export async function publishWorldEntityMediaDraft({
	client,
	authUserId,
	profileId,
	leaseToken,
	draft,
}: {
	client: SupabaseClient;
	authUserId: string;
	profileId: string;
	leaseToken: string;
	draft: WorldGraphDraft;
}): Promise<WorldEntityMediaPublicationStatus> {
	if (!worldEntityMediaEnabled()) return "unchanged";
	const bindings = draft.nodes
		.filter((node) => node.primaryMediaAssetId !== undefined)
		.map((node) => ({
			entityId: node.id,
			assetId: node.primaryMediaAssetId ?? null,
			visibility: node.visibility,
			focalX: node.primaryMediaFocalPoint?.x ?? 0.5,
			focalY: node.primaryMediaFocalPoint?.y ?? 0.5,
		}));
	if (!bindings.length) return "unchanged";

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (campaignError || !campaign?.id) {
		console.error(
			"World entity media publication campaign lookup failed",
			campaignError?.message,
		);
		return "pending";
	}

	const requestedAssetIds = [
		...new Set(bindings.flatMap((binding) => (binding.assetId ? [binding.assetId] : []))),
	];
	let assetRows: AssetRow[] = [];
	if (requestedAssetIds.length) {
		const { data, error } = await client
			.from("media_assets")
			.select(
				"id,campaign_id,status,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
			)
			.eq("campaign_id", campaign.id)
			.in("id", requestedAssetIds);
		if (error) {
			console.error("World entity media publication asset lookup failed", error.message);
			return "pending";
		}
		assetRows = (data ?? []) as AssetRow[];
		if (assetRows.length !== requestedAssetIds.length) return "pending";
	}

	const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
	for (const binding of bindings) {
		if (!binding.assetId) continue;
		const asset = assetById.get(binding.assetId);
		if (!asset || !safeAssetForEntity(asset, CAMPAIGN_SLUG, binding.entityId)) {
			return "pending";
		}

		if (!worldEntityMediaCanBecomePublic(binding.visibility)) {
			continue;
		}

		if (
			asset.status === "verified_public" &&
			worldEntityPublicMediaUrl(asset, {
				campaignSlug: CAMPAIGN_SLUG,
				entityId: binding.entityId,
			})
		) {
			continue;
		}
		if (asset.status !== "staged") return "pending";

		try {
			const promoted = await promoteWorldEntityPortrait({
				campaignSlug: CAMPAIGN_SLUG,
				entityId: binding.entityId,
				stagedBucket: asset.staged_bucket,
				objectKey: asset.object_key,
				info: {
					sha256: asset.sha256,
					mimeType: asset.mime_type,
					extension: extensionFor(asset.mime_type),
					bytes: Number(asset.byte_size),
					width: asset.width,
					height: asset.height,
				},
			});
			const { error: updateError } = await client
				.from("media_assets")
				.update({
					status: "verified_public",
					public_bucket: WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
					public_object_key: promoted.publicObjectKey,
					public_delivery_verified: true,
					public_verified_at: promoted.verifiedAt,
					updated_at: promoted.verifiedAt,
				})
				.eq("id", asset.id)
				.eq("campaign_id", campaign.id)
				.eq("status", "staged");
			if (updateError) {
				console.error(
					"World entity media verification persistence failed",
					updateError.message,
				);
				return "pending";
			}
		} catch (error) {
			console.error(
				"World entity media promotion failed",
				error instanceof Error ? error.message : "unknown_error",
			);
			return "pending";
		}
	}

	const { data, error } = await client.rpc("publish_world_entity_media_atomic", {
		p_auth_user_id: authUserId,
		p_actor_profile_id: profileId,
		p_campaign_slug: CAMPAIGN_SLUG,
		p_lease_token: leaseToken,
		p_bindings: bindings.map(({ entityId, assetId, focalX, focalY }) => ({
			entityId,
			assetId,
			focalX,
			focalY,
		})),
	});
	if (error || !data || typeof data !== "object" || Array.isArray(data)) {
		console.error("World entity media binding publication failed", error?.message);
		return "pending";
	}
	const payload = data as Readonly<Record<string, unknown>>;
	return payload.ok === true ? "saved" : "pending";
}
