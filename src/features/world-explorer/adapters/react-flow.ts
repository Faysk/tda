import { MarkerType, type Edge, type Node } from "@xyflow/react";
import {
	constellationWorldLayout,
	type WorldLayout,
} from "../constellation-layout";
import { routeWorldEdgePorts } from "../edge-routing";
import { worldLayoutOverrides } from "../layout-contract";
import type {
	WorldEdgeDTO,
	WorldGraphProjection,
	WorldNodeDTO,
	WorldNodeProminence,
	WorldRelationFamily,
} from "../model";
import { connectedNodeIds } from "../projection";

export type WorldFlowNodeData = {
	item: WorldNodeDTO;
	isFocus: boolean;
	isHero: boolean;
	prominence: WorldNodeProminence;
	isDimmed: boolean;
};

export type WorldFlowEdgeData = {
	item: WorldEdgeDTO;
	family: WorldRelationFamily;
	isHighlighted: boolean;
	isDimmed: boolean;
	routeOffset: number;
	labelOffset: { x: number; y: number };
};

export type WorldFlowNode = Node<WorldFlowNodeData, "worldEntity">;
export type WorldFlowEdge = Edge<WorldFlowEdgeData, "worldRelation">;

function prominenceFor(
	projection: WorldGraphProjection,
	item: WorldNodeDTO,
): WorldNodeProminence {
	if (item.prominence) return item.prominence;
	if (projection.heroIds.includes(item.id)) return "hero";
	if (item.kind === "entity" && item.entityType === "npc") return "primary";
	if (item.kind === "moment") return "context";
	return "supporting";
}

function layoutWithOverrides(
	projection: WorldGraphProjection,
	positionOverrides?: Readonly<WorldLayout>,
): WorldLayout {
	const layout = constellationWorldLayout(projection);

	for (const [id, position] of Object.entries(worldLayoutOverrides(projection))) {
		layout[id] = position;
	}

	if (!positionOverrides) return layout;
	for (const [id, position] of Object.entries(positionOverrides)) {
		if (projection.nodes.some((node) => node.id === id)) layout[id] = position;
	}
	return layout;
}

export function toReactFlowGraph(
	projection: WorldGraphProjection,
	selectedId?: string | null,
	positionOverrides?: Readonly<WorldLayout>,
): {
	nodes: WorldFlowNode[];
	edges: WorldFlowEdge[];
} {
	const layout = layoutWithOverrides(projection, positionOverrides);
	const routes = routeWorldEdgePorts(layout, projection.edges);
	const connected = connectedNodeIds(projection, selectedId ?? null);
	const hasSelection = Boolean(selectedId);
	const nodes: WorldFlowNode[] = projection.nodes.map((item) => {
		const isHero = projection.heroIds.includes(item.id);
		return {
			id: item.id,
			type: "worldEntity",
			position: layout[item.id] ?? { x: 0, y: 0 },
			data: {
				item,
				isFocus: item.id === projection.focusId,
				isHero,
				prominence: prominenceFor(projection, item),
				isDimmed: hasSelection && !connected.has(item.id),
			},
			draggable: true,
			connectable: false,
			deletable: false,
			selectable: true,
			selected: item.id === selectedId,
			focusable: true,
			ariaLabel: `${item.label}${item.subtitle ? ` — ${item.subtitle}` : ""}`,
			zIndex: item.id === selectedId ? 5 : isHero ? 3 : item.id === projection.focusId ? 4 : 1,
		};
	});

	const edges: WorldFlowEdge[] = projection.edges.map((item) => {
		const route = routes[item.id];
		const isHighlighted = Boolean(
			selectedId && (item.source === selectedId || item.target === selectedId),
		);
		return {
			id: item.id,
			type: "worldRelation",
			source: item.source,
			target: item.target,
			sourceHandle: route?.sourceHandle,
			targetHandle: route?.targetHandle,
			data: {
				item,
				family: item.family,
				isHighlighted,
				isDimmed: hasSelection && !isHighlighted,
				routeOffset: route?.offset ?? 28,
				labelOffset: route?.labelOffset ?? { x: 0, y: 0 },
			},
			deletable: false,
			selectable: true,
			focusable: true,
			ariaLabel: `${item.label}: ${item.source} → ${item.target}`,
			markerEnd:
				item.direction === "directed"
					? { type: MarkerType.ArrowClosed, width: 17, height: 17 }
					: undefined,
		};
	});
	return { nodes, edges };
}

export function rerouteWorldEdges(
	nodes: readonly WorldFlowNode[],
	edges: readonly WorldFlowEdge[],
): WorldFlowEdge[] {
	const layout: WorldLayout = Object.fromEntries(
		nodes.map((node) => [node.id, node.position]),
	);
	const relationItems = edges
		.map((edge) => edge.data?.item)
		.filter((item): item is WorldEdgeDTO => Boolean(item));
	const routes = routeWorldEdgePorts(layout, relationItems);
	return edges.map((edge) => {
		const route = routes[edge.id];
		if (!route) return edge;
		return {
			...edge,
			sourceHandle: route.sourceHandle,
			targetHandle: route.targetHandle,
			data: edge.data
				? {
					...edge.data,
					routeOffset: route.offset,
					labelOffset: route.labelOffset,
				}
				: edge.data,
		};
	});
}
