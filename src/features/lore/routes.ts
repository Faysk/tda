import type { LoreEntityType, LoreRouteKind } from "./model";

const routeEntityTypes: Record<LoreRouteKind, readonly LoreEntityType[]> = {
	personagens: ["pc"],
	npcs: ["npc"],
	lugares: ["location"],
	faccoes: ["faction"],
	musicas: ["song"],
	quests: ["quest"],
};

const entityRouteKinds: Partial<Record<LoreEntityType, LoreRouteKind>> = {
	pc: "personagens",
	npc: "npcs",
	location: "lugares",
	faction: "faccoes",
	song: "musicas",
	quest: "quests",
};

export function routeAcceptsLoreEntity(
	routeKind: LoreRouteKind,
	entityType: LoreEntityType,
): boolean {
	return routeEntityTypes[routeKind].includes(entityType);
}

export function loreRouteKindForEntity(
	entityType: LoreEntityType,
): LoreRouteKind | null {
	return entityRouteKinds[entityType] ?? null;
}

export function primaryLoreEntityTypeForRoute(
	routeKind: LoreRouteKind,
): LoreEntityType {
	return routeEntityTypes[routeKind][0];
}

export function loreIndexHref(
	routeKind: LoreRouteKind,
	campaignRouteKey?: string,
): string {
	return campaignRouteKey
		? `/campanhas/${encodeURIComponent(campaignRouteKey)}/${routeKind}`
		: `/${routeKind}`;
}

export function loreHrefFor(
	entityType: LoreEntityType,
	slug: string,
	campaignRouteKey?: string,
): string | null {
	const routeKind = loreRouteKindForEntity(entityType);
	if (!routeKind) return null;
	return `${loreIndexHref(routeKind, campaignRouteKey)}/${encodeURIComponent(slug)}`;
}

export function loreEntityTypesForRoute(
	routeKind: LoreRouteKind,
): readonly LoreEntityType[] {
	return routeEntityTypes[routeKind];
}
