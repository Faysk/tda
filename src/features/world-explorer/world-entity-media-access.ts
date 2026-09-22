import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import { sanitizeWorldGraphDraft } from "./graph-contract";

export type WorldEntityMediaAccessFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable"
	| "lease_lost";

export type AuthorizedWorldEntityMediaTarget = Readonly<{
	authUserId: string;
	profileId: string;
	campaignId: string;
	client: SupabaseClient;
}>;

async function authorizedMediaEditor(): Promise<
	| Readonly<{ ok: true; authUserId: string; profileId: string }>
	| Readonly<{ ok: false; reason: WorldEntityMediaAccessFailure }>
> {
	const [contentAccess, layoutAccess] = await Promise.all([
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.contentEdit,
			campaignSlug: CAMPAIGN_SLUG,
		}),
		authorizeCampaignCapabilityServer({
			action: EDIT_CAPABILITIES.worldLayoutEdit,
			campaignSlug: CAMPAIGN_SLUG,
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
	leaseToken: string,
	entityId: string,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedWorldEntityMediaTarget }>
	| Readonly<{ ok: false; reason: WorldEntityMediaAccessFailure }>
> {
	const authorization = await authorizedMediaEditor();
	if (!authorization.ok) return authorization;

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", CAMPAIGN_SLUG)
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
			client,
		},
	};
}
