import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	type EditCapability,
} from "@/features/edit/access/policy";
import { isCampaignMediaKey } from "@/features/media/campaign-media";
import { editDataClient } from "@/integrations/supabase/server";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SessionCampaignAccessFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable"
	| "not_found";

export type AuthorizedSessionCampaignTarget = Readonly<{
	authUserId: string;
	profileId: string;
	campaignId: string;
	campaignTechnicalSlug: string;
	sessionId: string;
	client: SupabaseClient;
}>;

function campaignSlugFromJoin(value: unknown): string | null {
	const candidate = Array.isArray(value) ? value[0] : value;
	if (!candidate || typeof candidate !== "object") return null;
	const slug = (candidate as Record<string, unknown>).slug;
	return isCampaignMediaKey(slug) ? slug : null;
}

/**
 * Resolves the session owner server-side before authorizing the exact campaign.
 * The browser never supplies campaign identity for media mutations.
 */
export async function authorizeSessionCampaignTarget(
	sessionId: string,
	capability: EditCapability,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedSessionCampaignTarget }>
	| Readonly<{ ok: false; reason: SessionCampaignAccessFailure }>
> {
	if (!UUID_PATTERN.test(sessionId))
		return { ok: false, reason: "not_found" };

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

		const { data, error } = await client
			.from("sessions")
			.select("id,campaign_id,campaigns!inner(slug)")
			.eq("id", sessionId)
			.maybeSingle();
		if (error)
			return { ok: false, reason: "dependency_unavailable" };
		if (!data?.id || !data.campaign_id)
			return { ok: false, reason: "not_found" };

		const campaignTechnicalSlug = campaignSlugFromJoin(data.campaigns);
		if (!campaignTechnicalSlug)
			return { ok: false, reason: "dependency_unavailable" };

		const access = authorizeCampaignCapability(
			context,
			capability,
			campaignTechnicalSlug,
		);
		if (!access.ok) return access;

		return {
			ok: true,
			target: {
				authUserId: identity.authUserId,
				profileId: access.profileId,
				campaignId: String(data.campaign_id),
				campaignTechnicalSlug,
				sessionId: String(data.id),
				client,
			},
		};
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
