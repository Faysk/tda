import "server-only";

import { resolvePublicCampaignRoute } from "@/features/campaigns/server";
import {
	LEGACY_CAMPAIGN_NAME,
	LEGACY_CAMPAIGN_PUBLIC_SLUG,
	LEGACY_CAMPAIGN_TECHNICAL_SLUG,
} from "@/features/sessions/model";
import type { LoreCampaignContext } from "./model";

export const LEGACY_LORE_CAMPAIGN_CONTEXT: LoreCampaignContext = {
	routeKey: LEGACY_CAMPAIGN_PUBLIC_SLUG,
	technicalSlug: LEGACY_CAMPAIGN_TECHNICAL_SLUG,
	name: LEGACY_CAMPAIGN_NAME,
};

export type LoreCampaignResolution =
	| Readonly<{
			ok: true;
			campaign: LoreCampaignContext;
			canonical: boolean;
			legacyCompatibility: boolean;
	  }>
	| Readonly<{
			ok: false;
			reason: "not_found" | "dependency_unavailable";
	  }>;

export async function resolveLoreCampaignContext(
	routeKey: string,
): Promise<LoreCampaignResolution> {
	const resolved = await resolvePublicCampaignRoute(routeKey);
	if (resolved.ok === true) {
		return {
			ok: true,
			campaign: {
				routeKey: resolved.campaign.routeKey,
				technicalSlug: resolved.campaign.technicalSlug,
				name: resolved.campaign.name,
			},
			canonical: resolved.canonical,
			legacyCompatibility: false,
		};
	}

	if (
		resolved.reason === "dependency_unavailable" &&
		routeKey === LEGACY_CAMPAIGN_PUBLIC_SLUG
	) {
		return {
			ok: true,
			campaign: LEGACY_LORE_CAMPAIGN_CONTEXT,
			canonical: true,
			legacyCompatibility: true,
		};
	}

	return resolved;
}
