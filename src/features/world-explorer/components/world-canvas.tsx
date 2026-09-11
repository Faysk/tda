"use client";

import { useRef, type ReactNode } from "react";
import {
	Controls,
	MiniMap,
	ReactFlow,
	type EdgeTypes,
	type NodeTypes,
	type OnEdgesChange,
	type OnNodesChange,
	type ReactFlowInstance,
	type XYPosition,
} from "@xyflow/react";
import type { WorldFlowEdge, WorldFlowNode } from "../adapters/react-flow";
import { WorldEntityNode } from "./entity-node";
import { WorldRelationEdge } from "./relation-edge";
import styles from "./world-explorer.module.css";

const NODE_TYPES = { worldEntity: WorldEntityNode } satisfies NodeTypes;
const EDGE_TYPES = { worldRelation: WorldRelationEdge } satisfies EdgeTypes;
const NODE_ORIGIN: [number, number] = [0.5, 0.5];
const FIT_VIEW_OPTIONS = { padding: 0.18, maxZoom: 1.05 } as const;

type WorldCanvasProps = Readonly<{
	nodes: WorldFlowNode[];
	edges: WorldFlowEdge[];
	onNodesChange: OnNodesChange<WorldFlowNode>;
	onEdgesChange: OnEdgesChange<WorldFlowEdge>;
	onNodeSelect: (node: WorldFlowNode) => void;
	onNodeDragStop: (node: WorldFlowNode) => void;
	onPaneClick: (position: XYPosition | null) => void;
	placementActive?: boolean;
	overlay?: ReactNode;
}>;

export function WorldCanvas({
	nodes,
	edges,
	onNodesChange,
	onEdgesChange,
	onNodeSelect,
	onNodeDragStop,
	onPaneClick,
	placementActive = false,
	overlay,
}: WorldCanvasProps) {
	const flowInstance = useRef<ReactFlowInstance<WorldFlowNode, WorldFlowEdge> | null>(null);

	return (
		<div
			className={styles.canvas}
			style={{ position: "relative" }}
			data-testid="world-canvas"
			data-world-placement-active={placementActive ? "true" : "false"}
		>
			<ReactFlow<WorldFlowNode, WorldFlowEdge>
				nodes={nodes}
				edges={edges}
				nodeTypes={NODE_TYPES}
				edgeTypes={EDGE_TYPES}
				nodeOrigin={NODE_ORIGIN}
				nodesConnectable={false}
				nodesDraggable
				elementsSelectable
				selectionOnDrag
				panOnScroll
				panOnDrag={false}
				onlyRenderVisibleElements
				fitView
				fitViewOptions={FIT_VIEW_OPTIONS}
				minZoom={0.28}
				maxZoom={1.8}
				onInit={(instance) => {
					flowInstance.current = instance;
				}}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeClick={(_, node) => onNodeSelect(node)}
				onNodeDragStop={(_, node) => onNodeDragStop(node)}
				onPaneClick={(event) => {
					const instance = flowInstance.current;
					onPaneClick(
						instance
							? instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
							: null,
					);
				}}
			>
				<Controls showInteractive={false} position="bottom-left" />
				<MiniMap position="bottom-right" pannable zoomable />
			</ReactFlow>
			{overlay}
		</div>
	);
}
