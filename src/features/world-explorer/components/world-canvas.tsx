"use client";

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	Controls,
	MiniMap,
	ReactFlow,
	type AriaLabelConfig,
	type EdgeTypes,
	type NodeTypes,
	type OnEdgesChange,
	type OnNodesChange,
	type ReactFlowInstance,
	type XYPosition,
} from "@xyflow/react";
import type { WorldFlowEdge, WorldFlowNode } from "../adapters/react-flow";
import { worldOffscreenCuePoint, worldPointInsideRect } from "../offscreen-relation-cues";
import {
	WORLD_CANVAS_MAX_ZOOM,
	WORLD_CANVAS_MIN_ZOOM,
	worldLabelCounterScale,
	worldSemanticZoomTier,
	type WorldSemanticZoomTier,
} from "../world-semantic-zoom";
import { WorldEntityNode } from "./entity-node";
import { WorldRelationEdge } from "./relation-edge";
import { WorldNeighborhoodOverlay } from "./world-neighborhood-overlay";
import {
	WorldOffscreenRelationCues,
	type WorldOffscreenRelationCue,
} from "./world-offscreen-relation-cues";
import { WorldSemanticZoomProvider } from "./world-semantic-zoom-context";
import styles from "./world-explorer.module.css";

const NODE_TYPES = { worldEntity: WorldEntityNode } satisfies NodeTypes;
const EDGE_TYPES = { worldRelation: WorldRelationEdge } satisfies EdgeTypes;
const NODE_ORIGIN: [number, number] = [0.5, 0.5];
const FIT_VIEW_OPTIONS = {
	padding: 0.16,
	minZoom: WORLD_CANVAS_MIN_ZOOM,
	maxZoom: 1.05,
} as const;
const WORLD_ARIA_LABELS: Partial<AriaLabelConfig> = {
	"node.a11yDescription.default":
		"Pressione Enter ou Espaço para selecionar este elemento. Pressione Escape para limpar a seleção.",
	"node.a11yDescription.keyboardDisabled":
		"Pressione Enter ou Espaço para selecionar este elemento. Use as setas quando o movimento por teclado estiver disponível.",
	"node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) =>
		`Elemento movido para ${direction}. Nova posição: x ${Math.round(x)}, y ${Math.round(y)}.`,
	"edge.a11yDescription.default":
		"Pressione Enter ou Espaço para selecionar esta ligação. Pressione Escape para limpar a seleção.",
	"controls.ariaLabel": "Controles do mapa",
	"controls.zoomIn.ariaLabel": "Aumentar zoom",
	"controls.zoomOut.ariaLabel": "Diminuir zoom",
	"controls.fitView.ariaLabel": "Enquadrar o Mundo",
	"controls.interactive.ariaLabel": "Alternar interação do mapa",
	"minimap.ariaLabel": "Minimapa do Mundo",
	"handle.ariaLabel": "Ponto de conexão",
};

type WorldCanvasProps = Readonly<{
	nodes: WorldFlowNode[];
	edges: WorldFlowEdge[];
	onNodesChange: OnNodesChange<WorldFlowNode>;
	onEdgesChange: OnEdgesChange<WorldFlowEdge>;
	onNodeSelect: (node: WorldFlowNode) => void;
	onNodeDragStop: (node: WorldFlowNode) => void;
	onPaneClick: (position: XYPosition | null) => void;
	placementActive?: boolean;
	connectionActive?: boolean;
	onConnectNodes?: (sourceId: string, targetId: string) => void;
	onReconnectEdge?: (edgeId: string, sourceId: string, targetId: string) => void;
	isConnectionValid?: (sourceId: string, targetId: string, edgeId?: string) => boolean;
	cameraScopeKey?: string;
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
	connectionActive = false,
	onConnectNodes,
	onReconnectEdge,
	isConnectionValid,
	cameraScopeKey = "",
	overlay,
}: WorldCanvasProps) {
	const flowInstance = useRef<ReactFlowInstance<WorldFlowNode, WorldFlowEdge> | null>(null);
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const [semanticZoom, setSemanticZoom] = useState<WorldSemanticZoomTier>("detail");
	const [offscreenCues, setOffscreenCues] = useState<WorldOffscreenRelationCue[]>([]);

	const syncSemanticZoom = useCallback((zoom: number) => {
		const nextTier = worldSemanticZoomTier(zoom);
		setSemanticZoom((current) => (current === nextTier ? current : nextTier));
		canvasRef.current?.style.setProperty(
			"--world-label-counter-scale",
			String(worldLabelCounterScale(zoom)),
		);
	}, []);

	const refreshOffscreenCues = useCallback(() => {
		const instance = flowInstance.current;
		const canvas = canvasRef.current;
		if (!instance || !canvas) {
			setOffscreenCues([]);
			return;
		}

		const canvasRect = canvas.getBoundingClientRect();
		const usableRect = {
			left: canvasRect.left + 18,
			top: canvasRect.top + 76,
			right: canvasRect.right - 18,
			bottom: canvasRect.bottom - 96,
		};
		if (usableRect.right <= usableRect.left || usableRect.bottom <= usableRect.top) {
			setOffscreenCues([]);
			return;
		}

		const currentNodes = instance.getNodes();
		const nodeById = new Map(currentNodes.map((node) => [node.id, node]));
		const candidates: WorldOffscreenRelationCue[] = [];
		for (const edge of instance.getEdges()) {
			if (!edge.selected && !edge.data?.isHighlighted) continue;
			const source = nodeById.get(edge.source);
			const target = nodeById.get(edge.target);
			if (!source || !target) continue;
			const sourcePoint = instance.flowToScreenPosition(source.position);
			const targetPoint = instance.flowToScreenPosition(target.position);
			const sourceInside = worldPointInsideRect(sourcePoint, usableRect);
			const targetInside = worldPointInsideRect(targetPoint, usableRect);
			if (sourceInside === targetInside) continue;

			const insidePoint = sourceInside ? sourcePoint : targetPoint;
			const outsidePoint = sourceInside ? targetPoint : sourcePoint;
			const outsideNode = sourceInside ? target : source;
			const cuePoint = worldOffscreenCuePoint(insidePoint, outsidePoint, usableRect);
			if (!cuePoint) continue;
			candidates.push({
				edgeId: edge.id,
				targetId: outsideNode.id,
				targetLabel: outsideNode.data.item.label,
				relationLabel: edge.data?.item.label ?? "Relação",
				x: cuePoint.x - canvasRect.left,
				y: cuePoint.y - canvasRect.top,
				boundary: cuePoint.boundary,
			});
		}

		const limit = canvasRect.width <= 700 ? 4 : 8;
		setOffscreenCues(candidates.slice(0, limit));
	}, []);

	const navigateToOffscreenTarget = useCallback((targetId: string) => {
		const instance = flowInstance.current;
		if (!instance) return;
		void instance.fitView({
			nodes: [{ id: targetId }],
			padding: 0.66,
			minZoom: 0.72,
			maxZoom: 0.95,
			duration: 260,
		});
		window.setTimeout(refreshOffscreenCues, 300);
	}, [refreshOffscreenCues]);

	useEffect(() => {
		const frame = window.requestAnimationFrame(refreshOffscreenCues);
		window.addEventListener("resize", refreshOffscreenCues);
		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", refreshOffscreenCues);
		};
	}, [nodes, edges, refreshOffscreenCues]);

	const lastCameraScopeKey = useRef(cameraScopeKey);
	useEffect(() => {
		if (lastCameraScopeKey.current === cameraScopeKey) return;
		lastCameraScopeKey.current = cameraScopeKey;
		if (!flowInstance.current) return;

		// Scope changes arrive before the controlled React Flow node state is
		// reconciled in the parent. Read the instance at execution time instead
		// of closing over the previous node array, otherwise search/filter could
		// "refit" to the graph that was visible one render ago.
		const timer = window.setTimeout(() => {
			const instance = flowInstance.current;
			const currentNodes = instance?.getNodes() ?? [];
			if (!instance || currentNodes.length === 0) return;
			void instance.fitView({
				nodes: currentNodes.map((node) => ({ id: node.id })),
				padding: 0.22,
				minZoom: WORLD_CANVAS_MIN_ZOOM,
				maxZoom: 1.05,
				duration: 220,
			});
		}, 120);
		return () => window.clearTimeout(timer);
	}, [cameraScopeKey]);

	return (
		<div
			ref={canvasRef}
			className={styles.canvas}
			style={{ position: "relative" }}
			data-testid="world-canvas"
			data-world-placement-active={placementActive ? "true" : "false"}
			data-world-connection-active={connectionActive ? "true" : "false"}
			data-world-semantic-zoom={semanticZoom}
		>
			<WorldSemanticZoomProvider tier={semanticZoom}>
			<ReactFlow<WorldFlowNode, WorldFlowEdge>
				nodes={nodes}
				edges={edges}
				nodeTypes={NODE_TYPES}
				edgeTypes={EDGE_TYPES}
				nodeOrigin={NODE_ORIGIN}
				ariaLabelConfig={WORLD_ARIA_LABELS}
				nodesFocusable
				edgesFocusable
				nodesConnectable={connectionActive}
				edgesReconnectable={connectionActive}
				connectionRadius={28}
				reconnectRadius={28}
				nodesDraggable
				elementsSelectable
				selectionOnDrag={false}
				panOnDrag
				panOnScroll={false}
				zoomOnScroll
				zoomOnPinch
				preventScrolling
				onlyRenderVisibleElements
				fitView
				fitViewOptions={FIT_VIEW_OPTIONS}
				minZoom={WORLD_CANVAS_MIN_ZOOM}
				maxZoom={WORLD_CANVAS_MAX_ZOOM}
				onInit={(instance) => {
					flowInstance.current = instance;
					syncSemanticZoom(instance.getViewport().zoom);
				}}
				onMove={(_, viewport) => syncSemanticZoom(viewport.zoom)}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeClick={(_, node) => {
					onNodeSelect(node);
					if (
						semanticZoom === "atlas" &&
						!placementActive &&
						!connectionActive
					) {
						void flowInstance.current?.fitView({
							nodes: [{ id: node.id }],
							padding: 0.64,
							minZoom: 0.72,
							maxZoom: 0.9,
							duration: 280,
						});
					}
				}}
				onNodeDragStop={(_, node) => {
					onNodeDragStop(node);
					window.requestAnimationFrame(refreshOffscreenCues);
				}}
				onConnect={(connection) => {
					if (!connection.source || !connection.target) return;
					onConnectNodes?.(connection.source, connection.target);
				}}
				onReconnect={(oldEdge, connection) => {
					if (!connection.source || !connection.target) return;
					onReconnectEdge?.(oldEdge.id, connection.source, connection.target);
				}}
				isValidConnection={(connection) => {
					if (!connection.source || !connection.target) return false;
					return isConnectionValid?.(connection.source, connection.target) ?? true;
				}}
				onPaneClick={(event) => {
					const instance = flowInstance.current;
					onPaneClick(
						instance
							? instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
							: null,
					);
				}}
			>
				<WorldNeighborhoodOverlay nodes={nodes} />
				<Controls
					showInteractive={false}
					position="bottom-left"
					fitViewOptions={FIT_VIEW_OPTIONS}
				/>
				<MiniMap position="bottom-right" pannable zoomable />
			</ReactFlow>
			</WorldSemanticZoomProvider>
			{overlay}
			<WorldOffscreenRelationCues
				cues={offscreenCues}
				onNavigate={navigateToOffscreenTarget}
			/>
		</div>
	);
}
