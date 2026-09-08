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
import { Select } from "@/components/ui";
import {
	rerouteWorldEdges,
	toReactFlowGraph,
	type WorldFlowEdge,
	type WorldFlowNode,
} from "../adapters/react-flow";
import type { WorldLayout } from "../constellation-layout";
import type {
	WorldEdgeDTO,
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
import inspectorStyles from "./world-inspector.module.css";
import { WorldRelationEdge } from "./relation-edge";
import styles from "./world-explorer.module.css";
import responsive from "./world-responsive.module.css";

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

type InspectorConnection = {
	edge: WorldEdgeDTO;
	destination: WorldNodeDTO;
};

type InspectorTab = "overview" | "relations" | "moments";

function nodeTypeLabel(node: WorldNodeDTO): string {
	if (node.kind === "moment") return "Momento";
	switch (node.entityType) {
		case "pc":
			return "Herói / personagem";
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
			clampPanelWidth(
				resizeStart.current.width + resizeStart.current.x - event.clientX,
			),
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
			className={`${styles.explorer} ${responsive.layout} ${panelCollapsed ? styles.explorerPanelCollapsed : ""}`}
			style={{ "--world-inspector-width": `${panelWidth}px` } as CSSProperties}
		>
			<section
				className={`${styles.canvasColumn} ${responsive.canvasColumn}`}
				aria-labelledby="world-explorer-title"
			>
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
						{projection.demo ? (
							<span className={styles.demoBadge}>
								Demonstração · relações não canônicas
							</span>
						) : null}
						<fieldset className={styles.viewToggle}>
							<legend className={styles.srOnly}>Modo de visualização</legend>
							<button
								type="button"
								aria-pressed={view === "canvas"}
								onClick={() => setView("canvas")}
							>
								Canvas
							</button>
							<button
								type="button"
								aria-pressed={view === "list"}
								onClick={() => setView("list")}
							>
								Lista
							</button>
						</fieldset>
					</div>
				</header>

				<div className={`${styles.toolbar} ${responsive.toolbar}`}>
					<label className={`${styles.searchField} ${responsive.search}`}>
						<span className={styles.srOnly}>Buscar no mundo</span>
						<span aria-hidden="true">⌕</span>
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Buscar pessoa, lugar ou memória..."
						/>
					</label>
					<div className={`${styles.relationSelect} ${responsive.relation}`}>
						<span>Relação</span>
						<Select
							value={relationFilter}
							options={RELATION_OPTIONS}
							onChange={setRelationFilter}
							ariaLabel="Filtrar por relação"
							embedded
						/>
					</div>
					<button
						className={`${styles.resetButton} ${responsive.reset}`}
						type="button"
						onClick={resetLayout}
					>
						Reorganizar
					</button>
				</div>

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

				<AccessibleRelations
					projection={visibleProjection}
					selectedId={selected?.id ?? null}
					onSelect={setSelectedId}
					compact={view === "canvas"}
				/>
			</section>

			<aside className={`${styles.inspector} ${responsive.inspector}`} aria-live="polite">
				<hr
					className={`${styles.panelResizer} ${responsive.resizer}`}
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
						if (event.key === "ArrowLeft") {
							setPanelWidth((value) => clampPanelWidth(value + 24));
						}
						if (event.key === "ArrowRight") {
							setPanelWidth((value) => clampPanelWidth(value - 24));
						}
					}}
				/>
				<button
					className={`${styles.panelToggle} ${responsive.panelToggle}`}
					type="button"
					onClick={() => setPanelCollapsed((value) => !value)}
					aria-expanded={!panelCollapsed}
					aria-label={
						panelCollapsed ? "Abrir painel de detalhes" : "Recolher painel de detalhes"
					}
				>
					{panelCollapsed ? "‹" : "›"}
				</button>
				{!panelCollapsed ? (
					selected ? (
						<InspectorContent
							key={selected.id}
							selected={selected}
							projection={visibleProjection}
							focus={focus}
							onSelect={setSelectedId}
						/>
					) : (
						<div className={styles.overviewInspector}>
							<p className={styles.eyebrow}>Visão geral</p>
							<h2>A campanha</h2>
							<p>
								Nenhum personagem é o centro permanente. Selecione qualquer nó para
								inspecionar seus laços sem reorganizar o mapa.
							</p>
							<dl className={styles.overviewStats}>
								<div>
									<dt>Heróis visíveis</dt>
									<dd>{visibleProjection.heroIds.length}</dd>
								</div>
								<div>
									<dt>Nós</dt>
									<dd>{visibleProjection.nodes.length}</dd>
								</div>
								<div>
									<dt>Relações</dt>
									<dd>{visibleProjection.edges.length}</dd>
								</div>
							</dl>
						</div>
					)
				) : null}
			</aside>
		</div>
	);
}

function InspectorContent({
	selected,
	projection,
	focus,
	onSelect,
}: {
	selected: WorldNodeDTO;
	projection: WorldGraphProjection;
	focus?: WorldNodeDTO;
	onSelect: (id: string) => void;
}) {
	const [tab, setTab] = useState<InspectorTab>("overview");
	const relation =
		focus && selected.id !== focus.id
			? relationLabelFor(projection, selected.id, focus.id)
			: null;
	const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
	const connections: InspectorConnection[] = projection.edges
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
	const tabs: Array<{ id: InspectorTab; label: string; count?: number }> = [
		{ id: "overview", label: "Visão geral" },
		{ id: "relations", label: "Laços", count: connections.length },
		...(moments.length ? [{ id: "moments" as const, label: "Momentos", count: moments.length }] : []),
	];

	return (
		<>
			<div className={styles.inspectorHero} aria-hidden="true">
				{selected.imageUrl ? (
					<Image
						className={styles.inspectorImage}
						src={selected.imageUrl}
						alt=""
						fill
							sizes="520px"
					/>
				) : (
					<span className={styles.inspectorInitial}>
						{selected.label.slice(0, 1).toLocaleUpperCase("pt-BR")}
					</span>
				)}
			</div>
			<p className={styles.eyebrow}>{nodeTypeLabel(selected)}</p>
			<h2>{selected.label}</h2>
			{selected.subtitle ? (
				<p className={styles.inspectorSubtitle}>{selected.subtitle}</p>
			) : null}

			<div className={inspectorStyles.tabs} role="tablist" aria-label={`Detalhes de ${selected.label}`}>
				{tabs.map((item) => (
					<button
						key={item.id}
						type="button"
						role="tab"
						aria-selected={tab === item.id}
						aria-controls={`world-inspector-panel-${selected.id}-${item.id}`}
						onClick={() => setTab(item.id)}
					>
						{item.label}
						{typeof item.count === "number" ? <span>{item.count}</span> : null}
					</button>
				))}
			</div>

			{tab === "overview" ? (
				<section
					className={inspectorStyles.tabPanel}
					id={`world-inspector-panel-${selected.id}-overview`}
					role="tabpanel"
					data-inspector-tab="overview"
				>
					{selected.id === projection.focusId ? (
						<p className={styles.focusNote}>Foco exploratório atual.</p>
					) : relation && focus ? (
						<p className={styles.relationSummary}>
							Relação com {focus.label}: {relation}.
						</p>
					) : null}
					<p className={styles.inspectorCopy}>
						Selecionar apenas inspeciona. Você pode percorrer os laços sem reorganizar o mapa
						ou abrir um foco explícito quando quiser estudar só esse núcleo narrativo.
					</p>
					<dl className={inspectorStyles.summaryStats}>
						<div>
							<dt>Laços</dt>
							<dd>{connections.length}</dd>
						</div>
						<div>
							<dt>Personagens</dt>
							<dd>{characterConnections.length}</dd>
						</div>
						<div>
							<dt>Contextos</dt>
							<dd>{contextualConnections}</dd>
						</div>
					</dl>
					{connections.length ? (
						<div className={inspectorStyles.overviewRelations}>
							<h3>Relações em destaque</h3>
							<ConnectionList connections={connections.slice(0, 4)} onSelect={onSelect} />
						</div>
					) : null}
				</section>
			) : null}

			{tab === "relations" ? (
				<section
					className={inspectorStyles.tabPanel}
					id={`world-inspector-panel-${selected.id}-relations`}
					role="tabpanel"
					data-inspector-tab="relations"
				>
					<div className={inspectorStyles.connectionsHeader}>
						<div>
							<p className={inspectorStyles.sectionEyebrow}>Teia visível</p>
							<h3>Conexões de {selected.label}</h3>
						</div>
						<span>{connections.length}</span>
					</div>
					{connections.length ? (
						<ConnectionList connections={connections} onSelect={onSelect} />
					) : (
						<p className={inspectorStyles.connectionsEmpty}>
							Nenhuma conexão permanece visível com os filtros atuais.
						</p>
					)}
				</section>
			) : null}

			{tab === "moments" ? (
				<section
					className={inspectorStyles.tabPanel}
					id={`world-inspector-panel-${selected.id}-moments`}
					role="tabpanel"
					data-inspector-tab="moments"
				>
					<div className={inspectorStyles.connectionsHeader}>
						<div>
							<p className={inspectorStyles.sectionEyebrow}>Memória conectada</p>
							<h3>Momentos visíveis</h3>
						</div>
						<span>{moments.length}</span>
					</div>
					<ConnectionList connections={moments} onSelect={onSelect} />
				</section>
			) : null}

			<div className={inspectorStyles.actions}>
				{selected.slug && selected.id !== projection.focusId ? (
					<PublicLink
						className={styles.focusAction}
						href={`/mundo?foco=${encodeURIComponent(selected.slug)}`}
					>
						Explorar conexões de {selected.label}
					</PublicLink>
				) : projection.mode === "focus" ? (
					<PublicLink className={styles.focusAction} href="/mundo">
						Voltar à visão geral
					</PublicLink>
				) : null}
				{selected.route ? (
					<PublicLink className={styles.profileAction} href={selected.route}>
						Ver perfil completo
					</PublicLink>
				) : null}
			</div>
		</>
	);
}

function ConnectionList({
	connections,
	onSelect,
}: {
	connections: InspectorConnection[];
	onSelect: (id: string) => void;
}) {
	return (
		<ul className={inspectorStyles.connectionList}>
			{connections.map(({ edge, destination }) => (
				<li key={edge.id}>
					<button
						type="button"
						data-family={edge.family}
						onClick={() => onSelect(destination.id)}
						aria-label={`Selecionar ${destination.label}; relação ${edge.label}`}
					>
						<span className={inspectorStyles.connectionCopy}>
							<strong>{destination.label}</strong>
							<small>{nodeTypeLabel(destination)}</small>
						</span>
						<span className={inspectorStyles.relationBadge} data-family={edge.family}>
							{edge.label}
						</span>
						<span className={inspectorStyles.connectionArrow} aria-hidden="true">
							›
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function AccessibleRelations({
	projection,
	selectedId,
	onSelect,
	compact,
}: {
	projection: WorldGraphProjection;
	selectedId: string | null;
	onSelect: (id: string) => void;
	compact: boolean;
}) {
	const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
	const relations = selectedId
		? projection.edges.filter(
				(edge) => edge.source === selectedId || edge.target === selectedId,
			)
		: projection.edges;
	return (
		<section
			className={`${styles.relationList} ${compact ? styles.relationListCompact : ""}`}
			aria-labelledby="world-relations-title"
		>
			<h2 id="world-relations-title">Relações em lista</h2>
			<p>
				{selectedId
					? "Laços visíveis da seleção atual."
					: "Alternativa textual ao canvas completo."}
			</p>
			{relations.length > 0 ? (
				<ul>
					{relations.map((edge) => {
						const source = nodeById.get(edge.source);
						const target = nodeById.get(edge.target);
						const destination = selectedId === edge.source ? target : source;
						return (
							<li key={edge.id}>
								<button
									type="button"
									onClick={() => destination && onSelect(destination.id)}
								>
									<strong>
										{source?.label ?? edge.source} ↔ {target?.label ?? edge.target}
									</strong>
									<span className={styles.relationLabelText}>{edge.label}</span>
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<p>Nenhuma relação visível para os filtros atuais.</p>
			)}
		</section>
	);
}
