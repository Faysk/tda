import { sanitizeWorldLayoutProjection } from "./layout-contract";
import type {
	WorldDemoDataset,
	WorldFilter,
	WorldGraphProjection,
	WorldNodeDTO,
	WorldRelationFilter,
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

function datasetHeroIds(dataset: WorldDemoDataset): string[] {
	const explicit = dataset.heroIds?.filter((id) =>
		dataset.nodes.some((node) => node.id === id),
	);
	if (explicit?.length) return explicit;
	return dataset.nodes
		.filter((node) => node.kind === "entity" && node.entityType === "pc")
		.map((node) => node.id);
}

function layoutForVisibleNodes(
	projection: WorldGraphProjection,
	nodes: readonly WorldNodeDTO[],
) {
	return sanitizeWorldLayoutProjection(
		projection.layout,
		new Set(nodes.map((node) => node.id)),
		projection.mode,
	);
}

export function resolveWorldFocusId(
	dataset: WorldDemoDataset,
	requestedFocus: string | null | undefined,
): string | null {
	const normalized = requestedFocus?.trim().toLocaleLowerCase("pt-BR");
	if (!normalized) return null;
	const match = dataset.nodes.find(
		(node) =>
			node.id.toLocaleLowerCase("pt-BR") === normalized ||
			node.slug?.toLocaleLowerCase("pt-BR") === normalized,
	);
	return match?.id ?? null;
}

export function filterWorldProjection(
	projection: WorldGraphProjection,
	filter: WorldFilter,
): WorldGraphProjection {
	if (filter === "all") return projection;

	const preserveHeroContext = projection.mode === "overview" && filter !== "characters";
	const nodes = projection.nodes.filter(
		(node) =>
			node.id === projection.focusId ||
			(preserveHeroContext && projection.heroIds.includes(node.id)) ||
			matchesFilter(node, filter),
	);
	const visibleIds = new Set(nodes.map((node) => node.id));
	return {
		...projection,
		heroIds: projection.heroIds.filter((id) => visibleIds.has(id)),
		nodes,
		edges: projection.edges.filter(
			(edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
		),
		layout: layoutForVisibleNodes(projection, nodes),
	};
}

export function filterWorldRelations(
	projection: WorldGraphProjection,
	family: WorldRelationFilter,
): WorldGraphProjection {
	if (family === "all") return projection;
	const edges = projection.edges.filter((edge) => edge.family === family);
	const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
	if (projection.focusId) connected.add(projection.focusId);
	for (const heroId of projection.heroIds) connected.add(heroId);
	const nodes = projection.nodes.filter((node) => connected.has(node.id));
	const visibleIds = new Set(nodes.map((node) => node.id));
	return {
		...projection,
		heroIds: projection.heroIds.filter((id) => visibleIds.has(id)),
		nodes,
		edges: edges.filter(
			(edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
		),
		layout: layoutForVisibleNodes(projection, nodes),
	};
}

export function searchWorldProjection(
	projection: WorldGraphProjection,
	query: string,
): WorldGraphProjection {
	const normalized = query.trim().toLocaleLowerCase("pt-BR");
	if (!normalized) return projection;
	const matchingIds = new Set(
		projection.nodes
			.filter((node) =>
				`${node.label} ${node.subtitle ?? ""}`
					.toLocaleLowerCase("pt-BR")
					.includes(normalized),
			)
			.map((node) => node.id),
	);
	const expandedIds = new Set(matchingIds);
	for (const edge of projection.edges) {
		if (matchingIds.has(edge.source)) expandedIds.add(edge.target);
		if (matchingIds.has(edge.target)) expandedIds.add(edge.source);
	}
	if (projection.focusId) expandedIds.add(projection.focusId);
	const nodes = projection.nodes.filter((node) => expandedIds.has(node.id));
	const visibleIds = new Set(nodes.map((node) => node.id));
	return {
		...projection,
		heroIds: projection.heroIds.filter((id) => visibleIds.has(id)),
		nodes,
		edges: projection.edges.filter(
			(edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
		),
		layout: layoutForVisibleNodes(projection, nodes),
	};
}

export function buildWorldProjection(
	dataset: WorldDemoDataset,
	focusId: string | null = null,
	filter: WorldFilter = "all",
): WorldGraphProjection {
	const heroIds = datasetHeroIds(dataset);
	const relationTypes = dataset.relationTypes ?? [];
	const demo = dataset.demo ?? true;
	if (!focusId) {
		const nodes = dataset.nodes;
		return filterWorldProjection(
			{
				demo,
				mode: "overview",
				focusId: null,
				heroIds,
				nodes,
				edges: dataset.edges,
				relationTypes,
				layout: sanitizeWorldLayoutProjection(
					dataset.layout,
					new Set(nodes.map((node) => node.id)),
					"overview",
				),
			},
			filter,
		);
	}

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
		demo,
		mode: "focus",
		focusId,
		heroIds: heroIds.filter((id) => neighborIds.has(id)),
		nodes: dataset.nodes.filter((node) => neighborIds.has(node.id)),
		edges: directEdges,
		relationTypes,
	};
	return filterWorldProjection(projection, filter);
}

export function relationLabelFor(
	projection: WorldGraphProjection,
	nodeId: string,
	referenceId?: string | null,
): string | null {
	const edge = projection.edges.find((item) => {
		const touchesNode = item.source === nodeId || item.target === nodeId;
		if (!touchesNode) return false;
		if (!referenceId) return true;
		return item.source === referenceId || item.target === referenceId;
	});
	return edge?.label ?? null;
}

export function connectedNodeIds(
	projection: WorldGraphProjection,
	nodeId: string | null,
): Set<string> {
	if (!nodeId) return new Set();
	const connected = new Set<string>([nodeId]);
	for (const edge of projection.edges) {
		if (edge.source === nodeId) connected.add(edge.target);
		if (edge.target === nodeId) connected.add(edge.source);
	}
	return connected;
}
