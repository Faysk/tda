import type {
	WorldGraphDraft,
	WorldGraphDraftEdge,
	WorldVisibility,
} from "./model";

export type WorldRelationDraftInput = Readonly<{
	id: string;
	sourceId: string;
	targetId: string;
	relationType: string;
	visibility?: WorldVisibility;
}>;

function sameEndpoints(
	edge: WorldGraphDraftEdge,
	sourceId: string,
	targetId: string,
	direction: "directed" | "symmetric",
): boolean {
	if (edge.source === sourceId && edge.target === targetId) return true;
	return direction === "symmetric" && edge.source === targetId && edge.target === sourceId;
}

export function appendWorldDraftRelation(
	draft: WorldGraphDraft,
	input: WorldRelationDraftInput,
): WorldGraphDraft | null {
	if (!input.id || input.sourceId === input.targetId) return null;
	const nodeIds = new Set(draft.nodes.filter((node) => node.status !== "archived").map((node) => node.id));
	if (!nodeIds.has(input.sourceId) || !nodeIds.has(input.targetId)) return null;
	const relationType = draft.relationTypes.find(
		(type) => type.slug === input.relationType && type.isActive,
	);
	if (!relationType) return null;
	const duplicate = draft.edges.some(
		(edge) =>
			edge.status !== "archived" &&
			edge.relationType === relationType.slug &&
			sameEndpoints(edge, input.sourceId, input.targetId, relationType.direction),
	);
	if (duplicate) return null;
	const edge: WorldGraphDraftEdge = {
		id: input.id,
		source: input.sourceId,
		target: input.targetId,
		relationType: relationType.slug,
		labelOverride: null,
		status: "active",
		visibility: input.visibility ?? "private_players",
		colorOverride: null,
		lineStyleOverride: null,
		lineWidthOverride: null,
	};
	return { ...draft, edges: [...draft.edges, edge] };
}

export function reconnectWorldDraftRelation(
	draft: WorldGraphDraft,
	edgeId: string,
	nextSourceId: string,
	nextTargetId: string,
): WorldGraphDraft | null {
	if (nextSourceId === nextTargetId) return null;
	const nodeIds = new Set(draft.nodes.filter((node) => node.status !== "archived").map((node) => node.id));
	if (!nodeIds.has(nextSourceId) || !nodeIds.has(nextTargetId)) return null;
	const current = draft.edges.find((edge) => edge.id === edgeId && edge.status !== "archived");
	if (!current) return null;
	const relationType = draft.relationTypes.find((type) => type.slug === current.relationType);
	if (!relationType) return null;
	const duplicate = draft.edges.some(
		(edge) =>
			edge.id !== edgeId &&
			edge.status !== "archived" &&
			edge.relationType === current.relationType &&
			sameEndpoints(edge, nextSourceId, nextTargetId, relationType.direction),
	);
	if (duplicate) return null;
	return {
		...draft,
		edges: draft.edges.map((edge) =>
			edge.id === edgeId ? { ...edge, source: nextSourceId, target: nextTargetId } : edge,
		),
	};
}
