import "server-only";

import { publishedDataClient } from "@/integrations/supabase/server";
import {
	CAMPAIGN_OVERVIEW_PUBLIC_ENTITY_TYPES,
	campaignOverviewNarrativeLinksFromEntityTypes,
	type CampaignOverviewNarrativeLink,
} from "./overview-presentation";

type OverviewCampaign = Readonly<{
	routeKey: string;
	technicalSlug: string;
}>;

function fixtureNarrativeEntityTypes(routeKey: string): readonly string[] {
	if (routeKey === "cronicas-da-mesa") return ["pc", "location"];
	return [];
}

/**
 * Returns only public narrative categories that actually contain at least one
 * campaign-owned entity. No counts, entity names or private metadata are
 * projected into the campaign overview.
 */
export async function readPublicCampaignNarrativeLinks(
	campaign: OverviewCampaign,
): Promise<readonly CampaignOverviewNarrativeLink[] | null> {
	if (process.env.TDA_E2E_FIXTURES === "true") {
		return campaignOverviewNarrativeLinksFromEntityTypes(
			campaign.routeKey,
			fixtureNarrativeEntityTypes(campaign.routeKey),
		);
	}

	const client = publishedDataClient();
	if (!client) return null;

	const { data: campaignRow, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", campaign.technicalSlug)
		.eq("public_slug", campaign.routeKey)
		.eq("lifecycle", "active")
		.eq("visibility", "public")
		.maybeSingle();

	if (campaignError || typeof campaignRow?.id !== "string") {
		return campaignError ? null : [];
	}

	const { data, error } = await client
		.from("entities")
		.select("entity_type")
		.eq("campaign_id", campaignRow.id)
		.eq("visibility", "public_web")
		.in("entity_type", CAMPAIGN_OVERVIEW_PUBLIC_ENTITY_TYPES)
		.limit(500);

	if (error || !Array.isArray(data)) return null;

	const entityTypes = data.flatMap((row) =>
		typeof row?.entity_type === "string" ? [row.entity_type] : [],
	);
	return campaignOverviewNarrativeLinksFromEntityTypes(
		campaign.routeKey,
		entityTypes,
	);
}
