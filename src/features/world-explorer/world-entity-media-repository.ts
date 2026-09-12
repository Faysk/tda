import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorldGraphDraft } from "./model";
import {
	worldEntityPublicMediaUrl,
	type WorldEntityMediaAssetRecord,
} from "./world-entity-media";
import { worldEntityMediaEnabled } from "./world-entity-media-server";

type MediaBindingRow = Readonly<{
	entity_id: string;
	asset_id: string;
}>;

type MediaAssetRow = Readonly<{
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

function toAssetRecord(row: MediaAssetRow): WorldEntityMediaAssetRecord | null {
	const bytes = Number(row.byte_size);
	if (!Number.isSafeInteger(bytes) || bytes <= 0) return null;
	return {
		id: row.id,
		campaignId: row.campaign_id,
		stagedBucket: row.staged_bucket,
		objectKey: row.object_key,
		sha256: row.sha256,
		mimeType: row.mime_type,
		bytes,
		width: row.width,
		height: row.height,
		status: row.status,
		publicBucket: row.public_bucket,
		publicObjectKey: row.public_object_key,
		readBackVerified: row.read_back_verified,
		publicDeliveryVerified: row.public_delivery_verified,
		publicVerifiedAt: row.public_verified_at,
	};
}

async function loadBindings(
	client: SupabaseClient,
	campaignId: string,
	entityIds: readonly string[],
): Promise<MediaBindingRow[]> {
	if (!worldEntityMediaEnabled() || entityIds.length === 0) return [];
	const { data, error } = await client
		.from("entity_media_bindings")
		.select("entity_id,asset_id")
		.eq("campaign_id", campaignId)
		.eq("role", "portrait")
		.in("entity_id", [...entityIds]);
	if (error) throw new Error(`World entity media binding lookup failed: ${error.message}`);
	return (data ?? []) as MediaBindingRow[];
}

export async function hydrateWorldGraphDraftMedia(
	client: SupabaseClient,
	campaignSlug: string,
	draft: WorldGraphDraft,
): Promise<WorldGraphDraft> {
	if (!worldEntityMediaEnabled() || draft.nodes.length === 0) return draft;
	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", campaignSlug)
		.maybeSingle();
	if (campaignError || !campaign?.id) {
		throw new Error(
			`World entity media campaign lookup failed: ${campaignError?.message ?? "campaign_not_found"}`,
		);
	}
	const bindings = await loadBindings(
		client,
		campaign.id,
		draft.nodes.map((node) => node.id),
	);
	const assetByEntity = new Map(bindings.map((binding) => [binding.entity_id, binding.asset_id]));
	return {
		...draft,
		nodes: draft.nodes.map((node) =>
			node.primaryMediaAssetId !== undefined
				? node
				: { ...node, primaryMediaAssetId: assetByEntity.get(node.id) ?? null },
		),
	};
}

/**
 * Resolves only explicitly bound and verified public portraits.
 * Provider URLs are never read from entity metadata or accepted from callers.
 */
export async function loadWorldEntityPortraitUrls(
	client: SupabaseClient,
	campaignId: string,
	entityIds: readonly string[],
): Promise<Map<string, string>> {
	const bindings = await loadBindings(client, campaignId, entityIds);
	if (!bindings.length) return new Map();

	const assetIds = [...new Set(bindings.map((binding) => binding.asset_id))];
	const { data: assetData, error: assetError } = await client
		.from("media_assets")
		.select(
			"id,campaign_id,status,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.eq("campaign_id", campaignId)
		.in("id", assetIds);
	if (assetError) throw new Error(`World entity media asset lookup failed: ${assetError.message}`);

	const byId = new Map(
		((assetData ?? []) as MediaAssetRow[])
			.map((row) => [row.id, toAssetRecord(row)] as const)
			.filter((entry): entry is readonly [string, WorldEntityMediaAssetRecord] => Boolean(entry[1])),
	);
	const urls = new Map<string, string>();
	for (const binding of bindings) {
		const asset = byId.get(binding.asset_id);
		if (!asset) continue;
		const url = worldEntityPublicMediaUrl(asset, binding.entity_id);
		if (url) urls.set(binding.entity_id, url);
	}
	return urls;
}
