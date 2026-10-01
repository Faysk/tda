import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";
import { resolveEditSessionCampaign } from "./repository";

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
	campaignSlug: string;
	sessionId: string;
	client: SupabaseClient;
}>;

export async function authorizeSessionCoverTarget(
	sessionId: string,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedSessionCoverTarget }>
	| Readonly<{ ok: false; reason: SessionCoverMediaAccessFailure }>
> {
	let sessionCampaign;
	try {
		sessionCampaign = await resolveEditSessionCampaign(sessionId);
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
	if (!sessionCampaign || sessionCampaign.lifecycle !== "active")
		return { ok: false, reason: "not_found" };

	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.contentEdit,
		campaignSlug: sessionCampaign.technicalSlug,
	});
	if (!access.ok) return access;

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	return {
		ok: true,
		target: {
			authUserId: access.authUserId,
			profileId: access.profileId,
			campaignId: sessionCampaign.campaignId,
			campaignSlug: sessionCampaign.technicalSlug,
			sessionId: sessionCampaign.sessionId,
			client,
		},
	};
}
