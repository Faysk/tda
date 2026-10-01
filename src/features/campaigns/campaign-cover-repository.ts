import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
	campaignCoverPublicUrl,
	type CampaignCoverAsset,
} from "./campaign-cover-media";

type CampaignCoverTarget = Readonly<{
	campaignId: string;
	campaignMediaKey: string;
}>;

type BindingRow = Readonly<{
	campaign_id: unknown;
	asset_id: unknown;
}>;

type AssetRow = Readonly<{
	id: unknown;
	campaign_id: unknown;
	status: unknown;
	role_hint: unknown;
	object_key: unknown;
	sha256: unknown;
	mime_type: unknown;
	read_back_verified: unknown;
	public_bucket: unknown;
	public_object_key: unknown;
	public_delivery_verified: unknown;
	public_verified_at: unknown;
}>;

export type CampaignCoverReadState = Readonly<{
	hasBinding: boolean;
	publicUrl: string | null;
}>;

function text(value: unknown): string | null {
	return typeof value === "string" && value.length ? value : null;
}

function asCampaignCoverAsset(row: AssetRow): CampaignCoverAsset | null {
	const status =
		row.status === "staged" ||
		row.status === "verified_public" ||
		row.status === "retired"
			? row.status
			: null;
	const roleHint = text(row.role_hint);
	const objectKey = text(row.object_key);
	const sha256 = text(row.sha256);
	const mimeType = text(row.mime_type);
	if (!status || !roleHint || !objectKey || !sha256 || !mimeType) return null;
	return {
		status,
		roleHint,
		objectKey,
		sha256,
		mimeType,
		readBackVerified: row.read_back_verified === true,
		publicBucket: text(row.public_bucket),
		publicObjectKey: text(row.public_object_key),
		publicDeliveryVerified: row.public_delivery_verified === true,
		publicVerifiedAt: text(row.public_verified_at),
	};
}

export async function readCampaignCoverStates(
	client: SupabaseClient,
	targets: readonly CampaignCoverTarget[],
): Promise<Map<string, CampaignCoverReadState>> {
	const byCampaign = new Map<string, CampaignCoverReadState>();
	if (!targets.length) return byCampaign;

	const targetById = new Map(
		targets.map((target) => [target.campaignId, target] as const),
	);
	const ids = [...targetById.keys()];
	const { data: bindingData, error: bindingError } = await client
		.from("campaign_media_bindings")
		.select("campaign_id,asset_id")
		.eq("role", "cover")
		.in("campaign_id", ids);
	if (bindingError)
		throw new Error("Campaign cover binding lookup unavailable");

	const bindings = (bindingData ?? []) as BindingRow[];
	for (const binding of bindings) {
		const campaignId = text(binding.campaign_id);
		if (campaignId && targetById.has(campaignId)) {
			byCampaign.set(campaignId, { hasBinding: true, publicUrl: null });
		}
	}

	const assetIds = bindings
		.map((binding) => text(binding.asset_id))
		.filter((assetId): assetId is string => Boolean(assetId));
	if (!assetIds.length) return byCampaign;

	const { data: assetData, error: assetError } = await client
		.from("media_assets")
		.select(
			"id,campaign_id,status,role_hint,object_key,sha256,mime_type,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.in("campaign_id", ids)
		.in("id", assetIds);
	if (assetError)
		throw new Error("Campaign cover asset lookup unavailable");

	const assets = new Map(
		((assetData ?? []) as AssetRow[])
			.map((row) => {
				const id = text(row.id);
				const campaignId = text(row.campaign_id);
				return id && campaignId
					? ([id, { row, campaignId }] as const)
					: null;
			})
			.filter(
				(
					entry,
				): entry is readonly [string, { row: AssetRow; campaignId: string }] =>
					entry !== null,
			),
	);

	for (const binding of bindings) {
		const campaignId = text(binding.campaign_id);
		const assetId = text(binding.asset_id);
		if (!campaignId || !assetId) continue;
		const target = targetById.get(campaignId);
		const stored = assets.get(assetId);
		if (!target || !stored || stored.campaignId !== campaignId) continue;
		const asset = asCampaignCoverAsset(stored.row);
		if (!asset) continue;
		const publicUrl = campaignCoverPublicUrl(
			asset,
			target.campaignMediaKey,
		);
		if (publicUrl) {
			byCampaign.set(campaignId, { hasBinding: true, publicUrl });
		}
	}

	return byCampaign;
}

export async function readPublicCampaignCovers(
	client: SupabaseClient,
	targets: readonly CampaignCoverTarget[],
): Promise<Map<string, string>> {
	const states = await readCampaignCoverStates(client, targets);
	const publicUrls = new Map<string, string>();
	for (const [campaignId, state] of states) {
		if (state.publicUrl) publicUrls.set(campaignId, state.publicUrl);
	}
	return publicUrls;
}
