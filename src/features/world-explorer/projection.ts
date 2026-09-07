import type {
	WorldDemoDataset,
	WorldFilter,
	WorldGraphProjection,
	WorldNodeDTO,
} from "./model";

function matchesFilter(node: WorldNodeDTO, filter: WorldFilter): boolean {
	if (filter === "all") return true;
	if (filter === "moments") return node.kind === "moment";
	if (node.kind !== "entity") return false;

	switch (filter) {
		case "characters":
			return node.entityType === "pc" || node.entityType === "npc";
		case "npcs":
			return node.entityType === "npc";
		case "locations":
			return node.entityType === "location";
		case "factions":
			return node.entityType === "faction" || node.entityType === "organization";
		case "songs":
			return node.entityType === "song";
		default:
			return true;
	}
}

export function resolveWorldFocusId(
	dataset: WorldDemoDataset,
	requestedFocus: string | null | undefined,
	fallbackId = "dandelion",
): string {
	const normalized = requestedFocus?.trim().toLocaleLowerCase("pt-BR");
	if (!normalized) return fallbackId;
	const match = dataset.nodes.find(
		(node) =>
			node.id.toLocaleLowerCase("pt-BR") === normalized ||
			node.slug?.toLocaleLowerCase("pt-BR") === normalized,
	);
	return match?.id ?? fallbackId;
}

export function filterWorldProjection(
	projection: WorldGraphProjection,
	filter: WorldFilter,
): WorldGraphProjection {
	if (filter === "all") return projection;
	const nodes = projection.nodes.filter(
		(node) =>
			node.id === projection.focusId || matchesFilter(node, filter),
	);
	const visibleIds = new Set(nodes.map((node) => node.id));
	return {
		...projection,
		nodes,
		edges: projection.edges.filter(
			(edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
		),
	};
}

export function buildWorldProjection(
	dataset: WorldDemoDataset,
	focusId: string,
	filter: WorldFilter = "all",
): WorldGraphProjection {
	const focus = dataset.nodes.find((node) => node.id === focusId);
	if (!focus) {
		throw new Error(`Unknown World Explorer focus: ${focusId}`);
	}

	const directEdges = dataset.edges.filter(
		(edge) => edge.source === focusId || edge.target === focusId,
	);
	const neighborIds = new Set<string>([focusId]);
	for (const edge of directEdges) {
		neighborIds.add(edge.source);
		neighborIds.add(edge.target);
	}

	const projection: WorldGraphProjection = {
		demo: true,
		focusId,
		nodes: dataset.nodes.filter((node) => neighborIds.has(node.id)),
		edges: directEdges,
	};
	return filterWorldProjection(projection, filter);
}

export function relationLabelFor(
	projection: WorldGraphProjection,
	nodeId: string,
): string | null {
	const edge = projection.edges.find(
		(item) => item.source === nodeId || item.target === nodeId,
	);
	return edge?.label ?? null;
}
