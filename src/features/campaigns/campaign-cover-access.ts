import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { isCampaignId } from "./model";
import { canManageCampaignRegistry } from "./policy";
import { isCampaignMediaKey } from "@/features/media/campaign-media";
import { editDataClient } from "@/integrations/supabase/server";

export type CampaignCoverAccessFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "dependency_unavailable"
	| "not_found";

export type AuthorizedCampaignCoverTarget = Readonly<{
	authUserId: string;
	profileId: string;
	campaignId: string;
	campaignTechnicalSlug: string;
	campaignPublicSlug: string;
	visibility: "public" | "private";
	client: SupabaseClient;
}>;

export async function authorizeCampaignCoverTarget(
	campaignId: string,
): Promise<
	| Readonly<{ ok: true; target: AuthorizedCampaignCoverTarget }>
	| Readonly<{ ok: false; reason: CampaignCoverAccessFailure }>
> {
	if (!isCampaignId(campaignId))
		return { ok: false, reason: "not_found" };

	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return identity;

	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return { ok: false, reason: "dependency_unavailable" };
		if (!context.profileId)
			return { ok: false, reason: "profile_unresolved" };
		if (!canManageCampaignRegistry(context))
			return { ok: false, reason: "forbidden" };

		const client = editDataClient();
		if (!client)
			return { ok: false, reason: "dependency_unavailable" };
		const { data, error } = await client
			.from("campaigns")
			.select("id,slug,public_slug,visibility")
			.eq("id", campaignId)
			.maybeSingle();
		if (error)
			return { ok: false, reason: "dependency_unavailable" };
		if (!data?.id)
			return { ok: false, reason: "not_found" };
		if (
			!isCampaignMediaKey(data.slug) ||
			typeof data.public_slug !== "string" ||
			!data.public_slug ||
			(data.visibility !== "public" && data.visibility !== "private")
		) {
			return { ok: false, reason: "dependency_unavailable" };
		}

		return {
			ok: true,
			target: {
				authUserId: identity.authUserId,
				profileId: context.profileId,
				campaignId: data.id,
				campaignTechnicalSlug: data.slug,
				campaignPublicSlug: data.public_slug,
				visibility: data.visibility,
				client,
			},
		};
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
