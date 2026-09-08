"use client";

import {
	Controls,
	MiniMap,
	ReactFlow,
	useEdgesState,
	useNodesState,
	type EdgeTypes,
	type NodeTypes,
} from "@xyflow/react";
import { useMemo, useState } from "react";
import {
	rerouteWorldEdges,
	toReactFlowGraph,
	type WorldFlowEdge,
	type WorldFlowNode,
} from "../adapters/react-flow";
import {
	captureWorldLayoutCandidate,
	serializeWorldLayoutCandidate,
} from "../editorial-layout";
import type { WorldGraphProjection, WorldPositionHint } from "../model";
import { WorldEntityNode } from "./entity-node";
import { WorldRelationEdge } from "./relation-edge";
import styles from "./world-layout-editor.module.css";

const NODE_TYPES = { worldEntity: WorldEntityNode } satisfies NodeTypes;
const EDGE_TYPES = { worldRelation: WorldRelationEdge } satisfies EdgeTypes;

function positionsFromNodes(nodes: readonly WorldFlowNode[]): Record<string, WorldPositionHint> {
	return Object.fromEntries(
		nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]),
	);
}

export function WorldLayoutEditorClient({ projection }: { projection: WorldGraphProjection }) {
	const baseline = useMemo(() => toReactFlowGraph(projection), [projection]);
	const [nodes, setNodes, onNodesChange] = useNodesState<WorldFlowNode>(baseline.nodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState<WorldFlowEdge>(baseline.edges);
	const [dirty, setDirty] = useState(false);
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
	const [candidate, setCandidate] = useState(() =>
		captureWorldLayoutCandidate(projection, positionsFromNodes(baseline.nodes)),
	);

	const serialized = useMemo(
		() => (candidate ? serializeWorldLayoutCandidate(candidate) : ""),
		[candidate],
	);

	function rememberNodePosition(node: WorldFlowNode) {
		const positionedNodes = nodes.map((item) =>
			item.id === node.id ? { ...item, position: node.position } : item,
		);
		setNodes(positionedNodes);
		setEdges((current) => rerouteWorldEdges(positionedNodes, current));
		setCandidate(captureWorldLayoutCandidate(projection, positionsFromNodes(positionedNodes)));
		setDirty(true);
		setCopyStatus("idle");
	}

	function restoreBaseline() {
		setNodes(baseline.nodes);
		setEdges(baseline.edges);
		setCandidate(captureWorldLayoutCandidate(projection, positionsFromNodes(baseline.nodes)));
		setDirty(false);
		setCopyStatus("idle");
	}

	async function copyCandidate() {
		if (!serialized) return;
		try {
			await navigator.clipboard.writeText(serialized);
			setCopyStatus("copied");
		} catch {
			setCopyStatus("failed");
		}
	}

	return (
		<section className={styles.shell} data-testid="world-layout-editor" data-layout-dirty={dirty}>
			<header className={styles.header}>
				<div>
					<p className={styles.eyebrow}>TDA / EDIT / MUNDO</p>
					<h1>Composição editorial do World Explorer</h1>
					<p className={styles.lead}>
						Arraste os nodes para preparar um snapshot de apresentação. Este rascunho não
						altera canon, relações ou entidades.
					</p>
				</div>
				<div className={styles.statusBox}>
					<span className={dirty ? styles.statusDirty : styles.statusClean}>
						{dirty ? "Alterações locais" : "Sem alterações locais"}
					</span>
					<small>revision observada: {candidate?.revision ?? 0}</small>
				</div>
			</header>

			<div className={styles.notice} role="status">
				<strong>Staging editorial</strong>
				<span>
					O boundary de storage/capability ainda não está ativado. Aqui você organiza e
					exporta o candidato que será usado pela etapa de persistência física.
				</span>
			</div>

			<div className={styles.workspace}>
				<div className={styles.canvas}>
					<ReactFlow<WorldFlowNode, WorldFlowEdge>
						nodes={nodes}
						edges={edges}
						nodeTypes={NODE_TYPES}
						edgeTypes={EDGE_TYPES}
						nodeOrigin={[0.5, 0.5]}
						nodesConnectable={false}
						nodesDraggable
						elementsSelectable
						panOnScroll
						fitView
						fitViewOptions={{ padding: 0.2, maxZoom: 1.05 }}
						minZoom={0.24}
						maxZoom={1.8}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onNodeDragStop={(_, node) => rememberNodePosition(node)}
					>
						<Controls showInteractive={false} position="bottom-left" />
						<MiniMap position="bottom-right" pannable zoomable />
					</ReactFlow>
				</div>

				<aside className={styles.panel}>
					<div className={styles.panelHeader}>
						<div>
							<p className={styles.eyebrow}>Snapshot candidato</p>
							<h2>Layout overview</h2>
						</div>
						<span>{candidate ? Object.keys(candidate.positions).length : 0} posições</span>
					</div>

					<div className={styles.actions}>
						<button type="button" onClick={restoreBaseline}>
							Restaurar composição
						</button>
						<button type="button" onClick={copyCandidate} disabled={!serialized}>
							Copiar snapshot
						</button>
					</div>

					{copyStatus === "copied" ? (
						<p className={styles.feedback}>Snapshot copiado.</p>
					) : copyStatus === "failed" ? (
						<p className={styles.feedback}>Não foi possível acessar a área de transferência.</p>
					) : null}

					<pre className={styles.snapshot} aria-label="Snapshot editorial candidato">
						{serialized || "Nenhum snapshot disponível."}
					</pre>
				</aside>
			</div>
		</section>
	);
}
