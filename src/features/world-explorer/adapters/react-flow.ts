import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type {
	WorldEdgeDTO,
	WorldGraphProjection,
	WorldNodeDTO,
	WorldRelationFamily,
} from "../model";
import { closestCardinalHandles, radialWorldLayout } from "../radial-layout";

export type WorldFlowNodeData = {
	item: WorldNodeDTO;
	isFocus: boolean;
};

export type WorldFlowEdgeData = {
	item: WorldEdgeDTO;
	family: WorldRelationFamily;
};

export type WorldFlowNode = Node<WorldFlowNodeData, "worldEntity">;
export type WorldFlowEdge = Edge<WorldFlowEdgeData, "worldRelation">;

export function toReactFlowGraph(
	projection: WorldGraphProjection,
	selectedId?: string | null,
): {
	nodes: WorldFlowNode[];
	edges: WorldFlowEdge[];
} {
	const layout = radialWorldLayout(projection);
	const nodes: WorldFlowNode[] = projection.nodes.map((item) => ({
		id: item.id,
		type: "worldEntity",
		position: layout[item.id] ?? { x: 0, y: 0 },
		data: { item, isFocus: item.id === projection.focusId },
		draggable: false,
		connectable: false,
		deletable: false,
		selectable: true,
		selected: item.id === selectedId,
		focusable: true,
		ariaLabel: `${item.label}${item.subtitle ? ` — ${item.subtitle}` : ""}`,
		zIndex: item.id === projection.focusId ? 2 : 1,
	}));
	const edges: WorldFlowEdge[] = projection.edges.map((item) => {
		const handles = closestCardinalHandles(
			layout[item.source] ?? { x: 0, y: 0 },
			layout[item.target] ?? { x: 0, y: 0 },
		);
		return {
			id: item.id,
			type: "worldRelation",
			source: item.source,
			target: item.target,
			sourceHandle: handles.sourceHandle,
			targetHandle: handles.targetHandle,
			data: { item, family: item.family },
			deletable: false,
			selectable: true,
			focusable: true,
			ariaLabel: item.label,
			markerEnd:
				item.direction === "directed"
					? { type: MarkerType.ArrowClosed, width: 16, height: 16 }
					: undefined,
		};
	});
	return { nodes, edges };
}
