import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
	authorizeCampaignCapabilityServer,
	getVerifiedServerIdentity,
} from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";
import { sanitizeWorldGraphDraft } from "./graph-contract";
import { isWorldEntityMediaAssetId } from "./world-entity-media";
import { isWorldCampaignSlug } from "./world-campaign";

export type WorldEntityMediaAccessFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable"
	| "lease_lost"
	| "not_found";

export type AuthorizedWorldEntityMediaTarget = Readonly<{
	authUserId: string;
	profileId: string;
	campaignId: string;
	campaignSlug: string;
	campaignTechnicalSlug: string;
	client: SupabaseClient;
}>;

async function authorizedMediaEditor(campaignSlug: string): Promise<
	| Readonly<{ ok: true; authUserId: string; profileId: string }>
	| Readonly<{ ok: false; reason: WorldEntityMediaAccessFailure }>
> {
	const [contentAccess, layoutAccess] = await Promise.all([
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.contentEdit,
			campaignSlug: campaignSlug,
		}),
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.worldLayoutEdit,
			campaignSlug: campaignSlug,
		}),
	]);
	if (!contentAccess.ok) return { ok: false, reason: contentAccess.reason };
	if (!layoutAccess.ok) return { ok: false, reason: layoutAccess.reason };
	if (
		contentAccess.authUserId !== layoutAccess.authUserId ||
		contentAccess.profileId !== layoutAccess.profileId
	) {
		return { ok: false, reason: "forbidden" };
	}
	return {
		ok: true,
		authUserId: contentAccess.authUserId,
		profileId: contentAccess.profileId,
	};
}

export async function authorizeWorldEntityMediaTarget(
	campaignSlug: string,
	leaseToken: string,
	entityId: string,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedWorldEntityMediaTarget }>
	| Readonly<{ ok: false; reason: WorldEntityMediaAccessFailure }>
> {
	if (!isWorldCampaignSlug(campaignSlug)) return { ok: false, reason: "forbidden" };
	const authorization = await authorizedMediaEditor(campaignSlug);
	if (!authorization.ok) return authorization;

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", campaignSlug)
		.maybeSingle();
	if (campaignError || !campaign?.id) {
		return { ok: false, reason: "dependency_unavailable" };
	}

	const { data: lease, error: leaseError } = await client
		.from("world_edit_leases")
		.select("draft_graph,expires_at,graph_draft_initialized")
		.eq("campaign_id", campaign.id)
		.eq("holder_profile_id", authorization.profileId)
		.eq("lease_token", leaseToken)
		.maybeSingle();
	if (leaseError) return { ok: false, reason: "dependency_unavailable" };
	if (
		!lease ||
		lease.graph_draft_initialized !== true ||
		typeof lease.expires_at !== "string" ||
		Date.parse(lease.expires_at) <= Date.now()
	) {
		return { ok: false, reason: "lease_lost" };
	}

	const draft = sanitizeWorldGraphDraft(lease.draft_graph);
	const normalizedEntityId = entityId.toLowerCase();
	if (!draft || !draft.nodes.some((node) => node.id.toLowerCase() === normalizedEntityId)) {
		return { ok: false, reason: "lease_lost" };
	}

	return {
		ok: true,
		target: {
			authUserId: authorization.authUserId,
			profileId: authorization.profileId,
			campaignId: campaign.id,
			campaignSlug,
			campaignTechnicalSlug: campaignSlug,
			client,
		},
	};
}


export async function authorizeWorldEntityMediaAsset(
	assetId: string,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedWorldEntityMediaTarget }>
	| Readonly<{ ok: false; reason: WorldEntityMediaAccessFailure }>
> {
	if (!isWorldEntityMediaAssetId(assetId))
		return { ok: false, reason: "not_found" };

	// Authenticate before resolving asset ownership. Besides keeping the preview
	// route contract at 401 for anonymous callers, this avoids turning asset
	// existence into an unauthenticated 404/401 oracle.
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return identity;

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data: asset, error: assetError } = await client
		.from("media_assets")
		.select("id,campaign_id")
		.eq("id", assetId)
		.maybeSingle();
	if (assetError) return { ok: false, reason: "dependency_unavailable" };
	if (!asset?.id || typeof asset.campaign_id !== "string")
		return { ok: false, reason: "not_found" };

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("slug")
		.eq("id", asset.campaign_id)
		.maybeSingle();
	if (campaignError) return { ok: false, reason: "dependency_unavailable" };
	if (!isWorldCampaignSlug(campaign?.slug))
		return { ok: false, reason: "dependency_unavailable" };

	const authorization = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.contentEdit,
		campaignSlug: campaign.slug,
	});
	if (!authorization.ok) return authorization;

	return {
		ok: true,
		target: {
			authUserId: authorization.authUserId,
			profileId: authorization.profileId,
			campaignId: asset.campaign_id,
			campaignSlug: campaign.slug,
			campaignTechnicalSlug: campaign.slug,
			client,
		},
	};
}
