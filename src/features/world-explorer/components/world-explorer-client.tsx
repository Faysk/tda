"use client";

import Image from "next/image";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
} from "react";
import {
	Controls,
	MiniMap,
	ReactFlow,
	useEdgesState,
	useNodesState,
	type EdgeTypes,
	type NodeTypes,
} from "@xyflow/react";
import { PublicLink } from "@/components/public-link";
import {
	rerouteWorldEdges,
	toReactFlowGraph,
	type WorldFlowEdge,
	type WorldFlowNode,
} from "../adapters/react-flow";
import type { WorldLayout } from "../constellation-layout";
import type {
	WorldFilter,
	WorldGraphProjection,
	WorldNodeDTO,
	WorldRelationFilter,
} from "../model";
import {
	filterWorldProjection,
	filterWorldRelations,
	relationLabelFor,
	searchWorldProjection,
} from "../projection";
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

const RELATION_OPTIONS: { value: WorldRelationFilter; label: string }[] = [
	{ value: "all", label: "Todas as relações" },
	{ value: "affinity", label: "Afinidade" },
	{ value: "conflict", label: "Conflito" },
	{ value: "family", label: "Família" },
	{ value: "mystic", label: "Místico" },
	{ value: "creative", label: "Criativo" },
	{ value: "origin", label: "Origem" },
	{ value: "context", label: "Contexto" },
];

function nodeTypeLabel(node: WorldNodeDTO): string {
	if (node.kind === "moment") return "Momento";
	switch (node.entityType) {
		case "pc": return "Herói / personagem";
		case "npc": return "NPC";
		case "location": return "Lugar";
		case "faction":
		case "organization": return "Facção / organização";
		case "song": return "Música";
		default: return "Entidade";
	}
}

function clampPanelWidth(value: number) {
	return Math.min(520, Math.max(320, value));
}

export function WorldExplorerClient({ projection }: { projection: WorldGraphProjection }) {
	const [filter, setFilter] = useState<WorldFilter>("all");
	const [relationFilter, setRelationFilter] = useState<WorldRelationFilter>("all");
	const [query, setQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(projection.focusId);
	const [view, setView] = useState<"canvas" | "list">("canvas");
	const [positionOverrides, setPositionOverrides] = useState<WorldLayout>({});
	const [panelWidth, setPanelWidth] = useState(370);
	const [panelCollapsed, setPanelCollapsed] = useState(false);
	const resizeStart = useRef<{ x: number; width: number } | null>(null);

	const visibleProjection = useMemo(() => {
		const byType = filterWorldProjection(projection, filter);
		const byRelation = filterWorldRelations(byType, relationFilter);
		return searchWorldProjection(byRelation, query);
	}, [projection, filter, relationFilter, query]);

	const graph = useMemo(
		() => toReactFlowGraph(visibleProjection, selectedId, positionOverrides),
		[visibleProjection, selectedId, positionOverrides],
	);
	const [nodes, setNodes, onNodesChange] = useNodesState<WorldFlowNode>(graph.nodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState<WorldFlowEdge>(graph.edges);

	useEffect(() => {
		setNodes(graph.nodes);
		setEdges(graph.edges);
	}, [graph, setEdges, setNodes]);

	useEffect(() => {
		if (selectedId && !visibleProjection.nodes.some((node) => node.id === selectedId)) {
			setSelectedId(null);
		}
	}, [selectedId, visibleProjection.nodes]);

	const selected = selectedId
		? visibleProjection.nodes.find((node) => node.id === selectedId)
		: undefined;
	const focus = projection.focusId
		? projection.nodes.find((node) => node.id === projection.focusId)
		: undefined;

	function rememberNodePosition(node: WorldFlowNode) {
		setPositionOverrides((current) => ({
			...current,
			[node.id]: { x: node.position.x, y: node.position.y },
		}));
		const positionedNodes = nodes.map((item) =>
			item.id === node.id ? { ...item, position: node.position } : item,
		);
		setEdges((current) => rerouteWorldEdges(positionedNodes, current));
	}

	function resetLayout() {
		setPositionOverrides({});
		setSelectedId(projection.focusId);
	}

	function startResize(event: ReactPointerEvent<HTMLElement>) {
		resizeStart.current = { x: event.clientX, width: panelWidth };
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function resizePanel(event: ReactPointerEvent<HTMLElement>) {
		if (!resizeStart.current) return;
		setPanelWidth(
			clampPanelWidth(resizeStart.current.width + resizeStart.current.x - event.clientX),
		);
	}

	function stopResize(event: ReactPointerEvent<HTMLElement>) {
		resizeStart.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	return (
		<div
			className={`${styles.explorer} ${panelCollapsed ? styles.explorerPanelCollapsed : ""}`}
			style={{ "--world-inspector-width": `${panelWidth}px` } as CSSProperties}
		>
			<section className={styles.canvasColumn} aria-labelledby="world-explorer-title">
				<header className={styles.explorerHeader}>
					<div>
						<p className={styles.eyebrow}>Mapa da campanha</p>
						<h1 id="world-explorer-title">Ecos da Jornada</h1>
						<p>
							{projection.mode === "focus" && focus
								? `Conexões diretas visíveis ao redor de ${focus.label}.`
								: "Heróis, pessoas, lugares e memórias formando uma constelação da campanha."}
						</p>
					</div>
					<div className={styles.headerActions}>
						{projection.demo ? <span className={styles.demoBadge}>Demonstração · relações não canônicas</span> : null}
						<fieldset className={styles.viewToggle}>
							<legend className={styles.srOnly}>Modo de visualização</legend>
							<button type="button" aria-pressed={view === "canvas"} onClick={() => setView("canvas")}>Canvas</button>
							<button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>Lista</button>
						</fieldset>
					</div>
				</header>

				<div className={styles.toolbar}>
					<label className={styles.searchField}>
						<span className={styles.srOnly}>Buscar no mundo</span>
						<span aria-hidden="true">⌕</span>
						<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa, lugar ou memória..." />
					</label>
					<label className={styles.relationSelect}>
						<span>Relação</span>
						<select value={relationFilter} onChange={(event) => setRelationFilter(event.target.value as WorldRelationFilter)}>
							{RELATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
						</select>
					</label>
					<button className={styles.resetButton} type="button" onClick={resetLayout}>Reorganizar</button>
				</div>

				<fieldset className={styles.filters} aria-label="Filtrar o grafo">
					{FILTER_OPTIONS.map((option) => (
						<button key={option.value} type="button" className={filter === option.value ? styles.filterActive : undefined} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
							{option.label}
						</button>
					))}
				</fieldset>

				<fieldset className={styles.relationLegend}>
					<legend className={styles.srOnly}>Legenda de relações</legend>
					<span data-family="affinity">Afinidade</span>
					<span data-family="conflict">Conflito</span>
					<span data-family="family">Família</span>
					<span data-family="mystic">Místico</span>
					<span data-family="creative">Criativo</span>
				</fieldset>

				{view === "canvas" ? (
					<div className={styles.canvas} data-testid="world-canvas">
						<ReactFlow<WorldFlowNode, WorldFlowEdge>
							nodes={nodes}
							edges={edges}
							nodeTypes={NODE_TYPES}
							edgeTypes={EDGE_TYPES}
							nodeOrigin={[0.5, 0.5]}
							nodesConnectable={false}
							nodesDraggable
							elementsSelectable
							selectionOnDrag
							panOnScroll
							panOnDrag={false}
							fitView
							fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
							minZoom={0.28}
							maxZoom={1.8}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onNodeClick={(_, node) => setSelectedId(node.id)}
							onNodeDragStop={(_, node) => rememberNodePosition(node)}
							onPaneClick={() => setSelectedId(null)}
						>
							<Controls showInteractive={false} position="bottom-left" />
							<MiniMap position="bottom-right" pannable zoomable />
						</ReactFlow>
					</div>
				) : null}

				<AccessibleRelations projection={visibleProjection} selectedId={selected?.id ?? null} onSelect={setSelectedId} compact={view === "canvas"} />
			</section>

			<aside className={styles.inspector} aria-live="polite">
				<hr
					className={styles.panelResizer}
					aria-label="Ajustar largura do painel"
					aria-orientation="vertical"
					aria-valuemin={320}
					aria-valuemax={520}
					aria-valuenow={panelWidth}
					tabIndex={0}
					onPointerDown={startResize}
					onPointerMove={resizePanel}
					onPointerUp={stopResize}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") setPanelWidth((value) => clampPanelWidth(value + 24));
						if (event.key === "ArrowRight") setPanelWidth((value) => clampPanelWidth(value - 24));
					}}
				/>
				<button className={styles.panelToggle} type="button" onClick={() => setPanelCollapsed((value) => !value)} aria-expanded={!panelCollapsed} aria-label={panelCollapsed ? "Abrir painel de detalhes" : "Recolher painel de detalhes"}>
					{panelCollapsed ? "‹" : "›"}
				</button>
				{!panelCollapsed ? (
					selected ? (
						<InspectorContent selected={selected} projection={projection} focus={focus} />
					) : (
						<div className={styles.overviewInspector}>
							<p className={styles.eyebrow}>Visão geral</p>
							<h2>A campanha</h2>
							<p>Nenhum personagem é o centro permanente. Selecione qualquer nó para inspecionar seus laços sem reorganizar o mapa.</p>
							<dl className={styles.overviewStats}>
								<div><dt>Heróis visíveis</dt><dd>{visibleProjection.heroIds.length}</dd></div>
								<div><dt>Nós</dt><dd>{visibleProjection.nodes.length}</dd></div>
								<div><dt>Relações</dt><dd>{visibleProjection.edges.length}</dd></div>
							</dl>
						</div>
					)
				) : null}
			</aside>
		</div>
	);
}

function InspectorContent({ selected, projection, focus }: { selected: WorldNodeDTO; projection: WorldGraphProjection; focus?: WorldNodeDTO }) {
	const relation = focus && selected.id !== focus.id ? relationLabelFor(projection, selected.id, focus.id) : null;
	return (
		<>
			<div className={styles.inspectorHero} aria-hidden="true">
				{selected.imageUrl ? <Image className={styles.inspectorImage} src={selected.imageUrl} alt="" fill sizes="520px" /> : <span className={styles.inspectorInitial}>{selected.label.slice(0, 1).toLocaleUpperCase("pt-BR")}</span>}
			</div>
			<p className={styles.eyebrow}>{nodeTypeLabel(selected)}</p>
			<h2>{selected.label}</h2>
			{selected.subtitle ? <p className={styles.inspectorSubtitle}>{selected.subtitle}</p> : null}
			{selected.id === projection.focusId ? <p className={styles.focusNote}>Foco exploratório atual.</p> : relation && focus ? <p className={styles.relationSummary}>Relação com {focus.label}: {relation}.</p> : null}
			<p className={styles.inspectorCopy}>Selecionar apenas inspeciona. A ação de explorar cria uma visão focada das conexões diretas sem transformar essa entity no centro permanente da campanha.</p>
			{selected.slug && selected.id !== projection.focusId ? (
				<PublicLink className={styles.focusAction} href={`/mundo?foco=${encodeURIComponent(selected.slug)}`}>Explorar conexões de {selected.label}</PublicLink>
			) : projection.mode === "focus" ? (
				<PublicLink className={styles.focusAction} href="/mundo">Voltar à visão geral</PublicLink>
			) : null}
			{selected.route ? <PublicLink className={styles.profileAction} href={selected.route}>Ver perfil completo</PublicLink> : null}
		</>
	);
}

function AccessibleRelations({ projection, selectedId, onSelect, compact }: { projection: WorldGraphProjection; selectedId: string | null; onSelect: (id: string) => void; compact: boolean }) {
	const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
	const relations = selectedId ? projection.edges.filter((edge) => edge.source === selectedId || edge.target === selectedId) : projection.edges;
	return (
		<section className={`${styles.relationList} ${compact ? styles.relationListCompact : ""}`} aria-labelledby="world-relations-title">
			<h2 id="world-relations-title">Relações em lista</h2>
			<p>{selectedId ? "Laços visíveis da seleção atual." : "Alternativa textual ao canvas completo."}</p>
			{relations.length > 0 ? (
				<ul>
					{relations.map((edge) => {
						const source = nodeById.get(edge.source);
						const target = nodeById.get(edge.target);
						const destination = selectedId === edge.source ? target : source;
						return (
							<li key={edge.id}>
								<button type="button" onClick={() => destination && onSelect(destination.id)}>
									<strong>{source?.label ?? edge.source} ↔ {target?.label ?? edge.target}</strong>
									<span className={styles.relationLabelText}>{edge.label}</span>
								</button>
							</li>
						);
					})}
				</ul>
			) : <p>Nenhuma relação visível para os filtros atuais.</p>}
		</section>
	);
}
