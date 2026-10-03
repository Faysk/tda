import type { LoreRouteKind } from "@/features/lore/model";

export type CampaignOverviewNarrativeLink = Readonly<{
	routeKind: LoreRouteKind;
	label: string;
	href: string;
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

export const CAMPAIGN_OVERVIEW_PUBLIC_ENTITY_TYPES = [
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
