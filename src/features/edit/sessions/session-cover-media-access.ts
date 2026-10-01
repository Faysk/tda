import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";

export type SessionCoverMediaAccessFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable"
	| "not_found";

export type AuthorizedSessionCoverTarget = Readonly<{
	authUserId: string;
	profileId: string;
	campaignId: string;
	sessionId: string;
	client: SupabaseClient;
}>;

export async function authorizeSessionCoverTarget(
	campaignSlug: string,
	sessionId: string,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedSessionCoverTarget }>
	| Readonly<{ ok: false; reason: SessionCoverMediaAccessFailure }>
> {
	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.contentEdit,
		campaignSlug,
	});
	if (!access.ok) return access;

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client
		.from("sessions")
		.select("id,campaign_id,campaigns!inner(slug)")
		.eq("id", sessionId)
		.eq("campaigns.slug", campaignSlug)
		.maybeSingle();
	if (error) return { ok: false, reason: "dependency_unavailable" };
	if (!data?.id || !data.campaign_id)
		return { ok: false, reason: "not_found" };

	return {
		ok: true,
		target: {
			authUserId: access.authUserId,
			profileId: access.profileId,
			campaignId: String(data.campaign_id),
			sessionId: String(data.id),
			client,
		},
	};
}
