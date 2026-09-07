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
	focusId: string;
	nodes: WorldNodeDTO[];
	edges: WorldEdgeDTO[];
};

export type WorldDemoDataset = {
	nodes: WorldNodeDTO[];
	edges: WorldEdgeDTO[];
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
