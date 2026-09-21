import "server-only";

import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { LEMBRA_CAPABILITIES } from "./model";

export type LembraAccessFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable";

export type LembraAccess =
	| Readonly<{ ok: true; authUserId: string; profileId: string }>
	| Readonly<{ ok: false; reason: LembraAccessFailure }>;

export async function authorizeLembraRead(): Promise<LembraAccess> {
	const decision = await authorizeCampaignCapabilityServer({
		action: LEMBRA_CAPABILITIES.read,
		campaignSlug: CAMPAIGN_SLUG,
	});
	return decision;
}

export async function authorizeLembraWrite(): Promise<LembraAccess> {
	const decision = await authorizeCampaignCapabilityServer({
		action: LEMBRA_CAPABILITIES.write,
		campaignSlug: CAMPAIGN_SLUG,
	});
	return decision;
}
