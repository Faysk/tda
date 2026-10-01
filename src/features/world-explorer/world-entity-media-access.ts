import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import { isCampaignMediaKey } from "@/features/media/campaign-media";
import { editDataClient } from "@/integrations/supabase/server";
import { sanitizeWorldGraphDraft } from "./graph-contract";

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
	campaignTechnicalSlug: string;
	client: SupabaseClient;
}>;

function authorizeMediaCapabilities(
	context: EditAccessContext,
	campaignTechnicalSlug: string,
	requireLayout: boolean,
) {
	const contentAccess = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.contentEdit,
		campaignTechnicalSlug,
	);
	if (!contentAccess.ok) return contentAccess;
	if (!requireLayout) return contentAccess;
	const layoutAccess = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.worldLayoutEdit,
		campaignTechnicalSlug,
	);
	if (!layoutAccess.ok) return layoutAccess;
	if (contentAccess.profileId !== layoutAccess.profileId)
		return { ok: false, reason: "forbidden" as const };
	return contentAccess;
}

async function authenticatedContext(): Promise<
	| Readonly<{
			ok: true;
			authUserId: string;
			context: EditAccessContext;
			client: SupabaseClient;
	  }>
	| Readonly<{ ok: false; reason: WorldEntityMediaAccessFailure }>
> {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return identity;
	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return { ok: false, reason: "dependency_unavailable" };
		if (!context.profileId)
			return { ok: false, reason: "profile_unresolved" };
		const client = editDataClient();
		if (!client)
			return { ok: false, reason: "dependency_unavailable" };
		return {
			ok: true,
			authUserId: identity.authUserId,
			context,
			client,
		};
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

async function campaignIdentity(
	client: SupabaseClient,
	campaignId: string,
): Promise<string | null> {
	const { data, error } = await client
		.from("campaigns")
		.select("slug")
		.eq("id", campaignId)
		.maybeSingle();
	if (error) throw new Error("world_media_campaign_lookup");
	return isCampaignMediaKey(data?.slug) ? data.slug : null;
}

export async function authorizeWorldEntityMediaTarget(
	leaseToken: string,
	entityId: string,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedWorldEntityMediaTarget }>
	| Readonly<{ ok: false; reason: WorldEntityMediaAccessFailure }>
> {
	const session = await authenticatedContext();
	if (!session.ok) return session;
	const { client, context, authUserId } = session;
	const profileId = context.profileId;
	if (!profileId) return { ok: false, reason: "profile_unresolved" };

	const { data: lease, error: leaseError } = await client
		.from("world_edit_leases")
		.select("campaign_id,draft_graph,expires_at,graph_draft_initialized")
		.eq("holder_profile_id", profileId)
		.eq("lease_token", leaseToken)
		.maybeSingle();
	if (leaseError) return { ok: false, reason: "dependency_unavailable" };
	if (
		!lease ||
		typeof lease.campaign_id !== "string" ||
		lease.graph_draft_initialized !== true ||
		typeof lease.expires_at !== "string" ||
		Date.parse(lease.expires_at) <= Date.now()
	) {
		return { ok: false, reason: "lease_lost" };
	}

	let campaignTechnicalSlug: string | null;
	try {
		campaignTechnicalSlug = await campaignIdentity(client, lease.campaign_id);
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
	if (!campaignTechnicalSlug)
		return { ok: false, reason: "dependency_unavailable" };

	const capability = authorizeMediaCapabilities(
		context,
		campaignTechnicalSlug,
		true,
	);
	if (!capability.ok) return capability;

	const draft = sanitizeWorldGraphDraft(lease.draft_graph);
	const normalizedEntityId = entityId.toLowerCase();
	if (
		!draft ||
		!draft.nodes.some(
			(node) => node.id.toLowerCase() === normalizedEntityId,
		)
	) {
		return { ok: false, reason: "lease_lost" };
	}

	return {
		ok: true,
		target: {
			authUserId,
			profileId: capability.profileId,
			campaignId: lease.campaign_id,
			campaignTechnicalSlug,
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
	const session = await authenticatedContext();
	if (!session.ok) return session;
	const { client, context, authUserId } = session;

	const { data: asset, error: assetError } = await client
		.from("media_assets")
		.select("id,campaign_id")
		.eq("id", assetId)
		.maybeSingle();
	if (assetError)
		return { ok: false, reason: "dependency_unavailable" };
	if (!asset?.id || typeof asset.campaign_id !== "string")
		return { ok: false, reason: "not_found" };

	let campaignTechnicalSlug: string | null;
	try {
		campaignTechnicalSlug = await campaignIdentity(client, asset.campaign_id);
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
	if (!campaignTechnicalSlug)
		return { ok: false, reason: "dependency_unavailable" };

	const capability = authorizeMediaCapabilities(
		context,
		campaignTechnicalSlug,
		false,
	);
	if (!capability.ok) return capability;

	return {
		ok: true,
		target: {
			authUserId,
			profileId: capability.profileId,
			campaignId: asset.campaign_id,
			campaignTechnicalSlug,
			client,
		},
	};
}
