export const WORLD_ENTITY_TYPES = [
	"pc",
	"npc",
	"location",
	"faction",
	"organization",
	"song",
	"quest",
	"concept",
	"item",
	"arc",
] as const;

export type WorldEntityType = (typeof WORLD_ENTITY_TYPES)[number];

export type WorldNodeKind = "entity" | "moment";
export type WorldGraphMode = "overview" | "focus";
export type WorldNodeProminence = "hero" | "primary" | "supporting" | "context";
export type WorldRelationDirection = "directed" | "symmetric";

export type WorldRelationFamily =
	| "affinity"
	| "family"
	| "conflict"
	| "authority"
	| "faction"
	| "origin"
	| "mystic"
	| "creative"
	| "context";

export type WorldPositionHint = Readonly<{
	x: number;
	y: number;
}>;

export type WorldNodeDTO = {
	id: string;
	slug: string | null;
	kind: WorldNodeKind;
	entityType?: WorldEntityType;
	label: string;
	subtitle?: string;
	imageUrl?: string;
	status?: string;
	route?: string;
	/** Presentation-only weight. It never changes narrative authority. */
	prominence?: WorldNodeProminence;
	/** Optional curated seed used only by the canvas layout. */
	layoutHint?: WorldPositionHint;
};

export type WorldEdgeDTO = {
	id: string;
	source: string;
	target: string;
	relationType: string;
	label: string;
	direction: WorldRelationDirection;
	family: WorldRelationFamily;
};

export type WorldGraphProjection = {
	demo: boolean;
	mode: WorldGraphMode;
	focusId: string | null;
	heroIds: string[];
	nodes: WorldNodeDTO[];
	edges: WorldEdgeDTO[];
};

export type WorldDemoDataset = {
	nodes: WorldNodeDTO[];
	edges: WorldEdgeDTO[];
	heroIds?: string[];
};

export const WORLD_FILTERS = [
	"all",
	"characters",
	"npcs",
	"locations",
	"factions",
	"songs",
	"moments",
] as const;

export type WorldFilter = (typeof WORLD_FILTERS)[number];

export function isWorldFilter(value: string): value is WorldFilter {
	return WORLD_FILTERS.includes(value as WorldFilter);
}

export const WORLD_RELATION_FILTERS = [
	"all",
	"affinity",
	"family",
	"conflict",
	"authority",
	"faction",
	"origin",
	"mystic",
	"creative",
	"context",
] as const;

export type WorldRelationFilter = (typeof WORLD_RELATION_FILTERS)[number];
