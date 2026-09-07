"use client";

import { useMemo, useState } from "react";
import {
	Controls,
	ReactFlow,
	type EdgeTypes,
	type NodeTypes,
} from "@xyflow/react";
import { PublicLink } from "@/components/public-link";
import {
	toReactFlowGraph,
	type WorldFlowEdge,
	type WorldFlowNode,
} from "../adapters/react-flow";
import type { WorldFilter, WorldGraphProjection, WorldNodeDTO } from "../model";
import { filterWorldProjection, relationLabelFor } from "../projection";
import { WorldEntityNode } from "./entity-node";
import { WorldRelationEdge } from "./relation-edge";
import styles from "./world-explorer.module.css";

const NODE_TYPES = { worldEntity: WorldEntityNode } satisfies NodeTypes;
const EDGE_TYPES = { worldRelation: WorldRelationEdge } satisfies EdgeTypes;

const FILTER_OPTIONS: { value: WorldFilter; label: string }[] = [
	{ value: "all", label: "Todos" },
	{ value: "characters", label: "Personagens" },
	{ value: "npcs", label: "NPCs" },
	{ value: "locations", label: "Lugares" },
	{ value: "factions", label: "Facções" },
	{ value: "songs", label: "Músicas" },
	{ value: "moments", label: "Momentos" },
];

function nodeTypeLabel(node: WorldNodeDTO): string {
	if (node.kind === "moment") return "Momento";
	switch (node.entityType) {
		case "pc":
			return "Personagem";
		case "npc":
			return "NPC";
		case "location":
			return "Lugar";
		case "faction":
		case "organization":
			return "Facção / organização";
		case "song":
			return "Música";
		default:
			return "Entidade";
	}
}

export function WorldExplorerClient({
	projection,
}: {
	projection: WorldGraphProjection;
}) {
	const [filter, setFilter] = useState<WorldFilter>("all");
	const [selectedId, setSelectedId] = useState(projection.focusId);
	const visibleProjection = useMemo(
		() => filterWorldProjection(projection, filter),
		[projection, filter],
	);
	const graph = useMemo(
		() => toReactFlowGraph(visibleProjection, selectedId),
		[visibleProjection, selectedId],
	);
	const selected =
		visibleProjection.nodes.find((node) => node.id === selectedId) ??
		visibleProjection.nodes.find((node) => node.id === projection.focusId) ??
		visibleProjection.nodes[0];
	const focus = projection.nodes.find((node) => node.id === projection.focusId);

	return (
		<div className={styles.explorer}>
			<section className={styles.canvasColumn} aria-labelledby="world-explorer-title">
				<header className={styles.explorerHeader}>
					<div>
						<p className={styles.eyebrow}>Mapa de memória</p>
						<h1 id="world-explorer-title">Ecos da Jornada</h1>
						<p>
							Pessoas, lugares e histórias que se entrelaçam ao redor de {focus?.label ?? "uma memória"}.
						</p>
					</div>
					{projection.demo ? (
						<span className={styles.demoBadge}>Demonstração · relações não canônicas</span>
					) : null}
				</header>

				<fieldset className={styles.filters} aria-label="Filtrar o grafo">
					{FILTER_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							className={filter === option.value ? styles.filterActive : undefined}
							aria-pressed={filter === option.value}
							onClick={() => setFilter(option.value)}
						>
							{option.label}
						</button>
					))}
				</fieldset>

				<div className={styles.canvas} data-testid="world-canvas">
					<ReactFlow<WorldFlowNode, WorldFlowEdge>
						nodes={graph.nodes}
						edges={graph.edges}
						nodeTypes={NODE_TYPES}
						edgeTypes={EDGE_TYPES}
						nodeOrigin={[0.5, 0.5]}
						nodesConnectable={false}
						nodesDraggable={false}
						elementsSelectable
						fitView
						fitViewOptions={{ padding: 0.22, maxZoom: 1.08 }}
						minZoom={0.42}
						maxZoom={1.45}
						onNodeClick={(_, node) => setSelectedId(node.id)}
						onPaneClick={() => setSelectedId(projection.focusId)}
					>
						<Controls showInteractive={false} position="bottom-left" />
					</ReactFlow>
				</div>

				<AccessibleRelations
					projection={visibleProjection}
					selectedId={selected?.id ?? null}
					onSelect={setSelectedId}
				/>
			</section>

			<aside className={styles.inspector} aria-live="polite">
				{selected ? (
					<>
						<div className={styles.inspectorHero} aria-hidden="true">
							<span>{selected.label.slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
						</div>
						<p className={styles.eyebrow}>{nodeTypeLabel(selected)}</p>
						<h2>{selected.label}</h2>
						{selected.subtitle ? (
							<p className={styles.inspectorSubtitle}>{selected.subtitle}</p>
						) : null}
						{selected.id === projection.focusId ? (
							<p className={styles.focusNote}>Entidade focal atual.</p>
						) : (
							<p className={styles.relationSummary}>
								Relação com {focus?.label}: {relationLabelFor(projection, selected.id) ?? "contexto conectado"}.
							</p>
						)}
						<p className={styles.inspectorCopy}>
							Este primeiro recorte valida seleção, foco e leitura do grafo. Biografia e canon permanecem fora da fixture visual.
						</p>
						{selected.id !== projection.focusId && selected.slug ? (
							<PublicLink
								className={styles.focusAction}
								href={`/mundo?foco=${encodeURIComponent(selected.slug)}`}
							>
								Explorar conexões de {selected.label}
							</PublicLink>
						) : null}
						{selected.route ? (
							<PublicLink className={styles.profileAction} href={selected.route}>
								Ver perfil completo
							</PublicLink>
						) : (
							<p className={styles.profilePending}>
								Perfil editorial será ligado ao resolver canônico de Lore, sem duplicar rotas.
							</p>
						)}
					</>
				) : (
					<p>Nenhuma memória selecionada.</p>
				)}
			</aside>
		</div>
	);
}

function AccessibleRelations({
	projection,
	selectedId,
	onSelect,
}: {
	projection: WorldGraphProjection;
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const focus = projection.nodes.find((node) => node.id === projection.focusId);
	const related = projection.nodes.filter((node) => node.id !== projection.focusId);
	return (
		<section className={styles.relationList} aria-labelledby="world-relations-title">
			<h2 id="world-relations-title">Relações em lista</h2>
			<p>
				Alternativa textual ao canvas para navegar pelas conexões visíveis de {focus?.label ?? "esta memória"}.
			</p>
			{related.length > 0 ? (
				<ul>
					{related.map((node) => (
						<li key={node.id}>
							<button
								type="button"
								aria-pressed={selectedId === node.id}
								onClick={() => onSelect(node.id)}
							>
								<strong>{node.label}</strong>
								<span>{relationLabelFor(projection, node.id) ?? "Conexão"}</span>
							</button>
						</li>
					))}
				</ul>
			) : (
				<p>Nenhuma relação visível para este filtro.</p>
			)}
		</section>
	);
}
