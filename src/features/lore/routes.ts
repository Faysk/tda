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

export function loreHrefFor(
	entityType: LoreEntityType,
	slug: string,
): string | null {
	const routeKind = entityRouteKinds[entityType];
	if (!routeKind) return null;
	return `/${routeKind}/${encodeURIComponent(slug)}`;
}

export function loreEntityTypesForRoute(
	routeKind: LoreRouteKind,
): readonly LoreEntityType[] {
	return routeEntityTypes[routeKind];
}
