import type {
	WorldEdgeDTO,
	WorldGraphProjection,
	WorldNodeDTO,
	WorldRelationFamily,
} from "./model";

export type WorldInspectorConnection = Readonly<{
	edge: WorldEdgeDTO;
	destination: WorldNodeDTO;
}>;

export type WorldInspectorFamilyCount = Readonly<{
	family: WorldRelationFamily;
	count: number;
}>;

export type WorldInspectorContext = Readonly<{
	connections: WorldInspectorConnection[];
	moments: WorldInspectorConnection[];
	characterConnections: WorldInspectorConnection[];
	contextualConnections: number;
	familyCounts: WorldInspectorFamilyCount[];
	visibleRelationHighlights: WorldInspectorConnection[];
}>;

export function buildWorldInspectorContext(
	selected: WorldNodeDTO,
	projection: WorldGraphProjection,
): WorldInspectorContext {
	const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
	const connections: WorldInspectorConnection[] = projection.edges
		.flatMap((edge) => {
			if (edge.source !== selected.id && edge.target !== selected.id) return [];
			const destinationId = edge.source === selected.id ? edge.target : edge.source;
			const destination = nodeById.get(destinationId);
			return destination ? [{ edge, destination }] : [];
		})
		.sort((left, right) =>
			left.destination.label.localeCompare(right.destination.label, "pt-BR"),
		);

	const moments = connections.filter(({ destination }) => destination.kind === "moment");
	const characterConnections = connections.filter(
		({ destination }) =>
			destination.kind === "entity" &&
			(destination.entityType === "pc" || destination.entityType === "npc"),
	);
	const contextualConnections = connections.length - characterConnections.length;
	const familyCountMap = new Map<WorldRelationFamily, number>();
	for (const { edge } of connections) {
		familyCountMap.set(edge.family, (familyCountMap.get(edge.family) ?? 0) + 1);
	}
	const familyCounts = Array.from(familyCountMap, ([family, count]) => ({ family, count })).sort(
		(left, right) => right.count - left.count || left.family.localeCompare(right.family),
	);

	return {
		connections,
		moments,
		characterConnections,
		contextualConnections,
		familyCounts,
		visibleRelationHighlights: connections.slice(0, 6),
	};
}
