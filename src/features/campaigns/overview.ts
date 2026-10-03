import "server-only";

import { publishedDataClient } from "@/integrations/supabase/server";
import type { LoreRouteKind } from "@/features/lore/model";

export type CampaignOverviewNarrativeLink = Readonly<{
	routeKind: LoreRouteKind;
	label: string;
	href: string;
}>;

type OverviewCampaign = Readonly<{
	routeKey: string;
	technicalSlug: string;
}>;

const NARRATIVE_ROUTES = [
	{ routeKind: "personagens", label: "Personagens", entityTypes: ["pc"] },
	{ routeKind: "npcs", label: "NPCs", entityTypes: ["npc"] },
	{ routeKind: "lugares", label: "Lugares", entityTypes: ["location"] },
	{
		routeKind: "faccoes",
		label: "Facções",
		entityTypes: ["organization", "faction"],
	},
	{ routeKind: "quests", label: "Quests", entityTypes: ["quest"] },
	{ routeKind: "musicas", label: "Músicas", entityTypes: ["song"] },
] as const satisfies readonly {
	routeKind: LoreRouteKind;
	label: string;
	entityTypes: readonly string[];
}[];

const PUBLIC_ENTITY_TYPES = [
	...new Set(NARRATIVE_ROUTES.flatMap((route) => route.entityTypes)),
];

export function campaignOverviewNarrativeLinksFromEntityTypes(
	routeKey: string,
	entityTypes: readonly string[],
): readonly CampaignOverviewNarrativeLink[] {
	const available = new Set(entityTypes);
	return NARRATIVE_ROUTES.flatMap((route) =>
		route.entityTypes.some((entityType) => available.has(entityType))
			? [
					{
						routeKind: route.routeKind,
						label: route.label,
						href: `/campanhas/${encodeURIComponent(routeKey)}/${route.routeKind}`,
					},
				]
			: [],
	);
}

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
		.in("entity_type", PUBLIC_ENTITY_TYPES)
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
