"use client";

import { useRouter } from "next/navigation";
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
import { Select } from "@/components/ui";
import {
	rerouteWorldEdges,
	toReactFlowGraph,
	type WorldFlowEdge,
	type WorldFlowNode,
} from "../adapters/react-flow";
import type { WorldLayout } from "../constellation-layout";
import { captureWorldLayoutCandidate } from "../editorial-layout";
import { worldDatasetFromDraft } from "../graph-contract";
import { useWorldEditSession } from "../hooks/use-world-edit-session";
import type {
	WorldFilter,
	WorldGraphDraft,
	WorldGraphProjection,
	WorldLayoutProjection,
	WorldRelationFilter,
} from "../model";
import {
	buildWorldProjection,
	filterWorldProjection,
	filterWorldRelations,
	searchWorldProjection,
} from "../projection";
import { WorldContentEditor } from "./world-content-editor";
import { WorldEntityNode } from "./entity-node";
import {
	WorldAccessibleRelations,
	WorldInspectorContent,
} from "./world-inspector";
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
	{ value: "authority", label: "Autoridade" },
	{ value: "faction", label: "Facção" },
	{ value: "mystic", label: "Místico" },
	{ value: "creative", label: "Criativo" },
	{ value: "origin", label: "Origem" },
	{ value: "context", label: "Contexto" },
];

function clampPanelWidth(value: number) {
	return Math.min(520, Math.max(320, value));
}

function publishedLayoutCandidate(projection: WorldGraphProjection): WorldLayoutProjection {
	return {
		schemaVersion: 1,
		view: "overview",
		revision: projection.layout?.revision ?? 0,
		positions: projection.layout?.positions ?? {},
	};
}

function projectionWithDraft(
	projection: WorldGraphProjection,
	draft: WorldGraphDraft | null,
): WorldGraphProjection {
	if (!draft) return projection;
	const next = buildWorldProjection(worldDatasetFromDraft(draft));
	next.layout = projection.layout;
	return next;
}

function layoutCandidateFor(
	projection: WorldGraphProjection,
	overrides: WorldLayout,
): WorldLayoutProjection | null {
	const fullGraph = toReactFlowGraph(projection, null, overrides);
	return (
		captureWorldLayoutCandidate(
			projection,
			Object.fromEntries(
				fullGraph.nodes.map((node) => [
					node.id,
					{ x: node.position.x, y: node.position.y },
				]),
			),
		) ?? null
	);
}

export function WorldExplorerClient({
	projection,
	canEditLayout = false,
	canEditContent = false,
}: {
	projection: WorldGraphProjection;
	canEditLayout?: boolean;
	canEditContent?: boolean;
}) {
	const router = useRouter();
	const [filter, setFilter] = useState<WorldFilter>("all");
	const [relationFilter, setRelationFilter] = useState<WorldRelationFilter>("all");
	const [query, setQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(projection.focusId);
	const [view, setView] = useState<"canvas" | "list">("canvas");
	const [positionOverrides, setPositionOverrides] = useState<WorldLayout>({});
	const positionOverridesRef = useRef<WorldLayout>({});
	const [panelWidth, setPanelWidth] = useState(370);
	const [panelCollapsed, setPanelCollapsed] = useState(false);
	const resizeStart = useRef<{ x: number; width: number } | null>(null);

	const edit = useWorldEditSession({
		canEditLayout,
		canEditContent,
		canStartEditing: projection.mode === "overview",
		publishedPositions: projection.layout?.positions ?? {},
		buildLayoutCandidate: (draft) =>
			layoutCandidateFor(
				canEditContent ? projectionWithDraft(projection, draft) : projection,
				positionOverridesRef.current,
			),
		onApplyLayoutDraft: (positions) => {
			positionOverridesRef.current = positions;
			setPositionOverrides(positions);
		},
		onReleaseLayout: () => {
			positionOverridesRef.current = {};
			setPositionOverrides({});
		},
		onEditingStarted: () => setPanelCollapsed(false),
		onPublished: () => router.refresh(),
	});

	const workingProjection = useMemo(() => {
		if (!canEditContent || !edit.editing || !edit.graphDraft) return projection;
		return projectionWithDraft(projection, edit.graphDraft);
	}, [canEditContent, edit.editing, edit.graphDraft, projection]);

	const visibleProjection = useMemo(() => {
		const byType = filterWorldProjection(workingProjection, filter);
		const byRelation = filterWorldRelations(byType, relationFilter);
		return searchWorldProjection(byRelation, query);
	}, [workingProjection, filter, relationFilter, query]);

	const graph = useMemo(
		() => toReactFlowGraph(visibleProjection, selectedId, positionOverrides),
		[visibleProjection, selectedId, positionOverrides],
	);
	const [nodes, setNodes, onNodesChange] = useNodesState<WorldFlowNode>(graph.nodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState<WorldFlowEdge>(graph.edges);

	useEffect(() => {
		positionOverridesRef.current = positionOverrides;
	}, [positionOverrides]);

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
	const focus = workingProjection.focusId
		? workingProjection.nodes.find((node) => node.id === workingProjection.focusId)
		: undefined;
	const activeRelationTypes = workingProjection.relationTypes.filter((type) => type.isActive);

	function rememberNodePosition(node: WorldFlowNode) {
		const nextOverrides: WorldLayout = {
			...positionOverridesRef.current,
			[node.id]: { x: node.position.x, y: node.position.y },
		};
		positionOverridesRef.current = nextOverrides;
		setPositionOverrides(nextOverrides);
		const positionedNodes = nodes.map((item) =>
			item.id === node.id ? { ...item, position: node.position } : item,
		);
		setEdges((current) => rerouteWorldEdges(positionedNodes, current));
		if (edit.state === "editing") {
			const candidate = layoutCandidateFor(workingProjection, nextOverrides);
			if (!candidate) {
				edit.reportFailure("invalid_payload");
				return;
			}
			edit.updateLayoutDraft(candidate);
		}
	}

	function resetLayout() {
		positionOverridesRef.current = {};
		setPositionOverrides({});
		setSelectedId(workingProjection.focusId);
		if (edit.state === "editing") {
			edit.updateLayoutDraft(publishedLayoutCandidate(projection), {
				dirty: false,
				pendingMessage: "Restaurando as posições publicadas no rascunho…",
			});
		}
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

	const editButtonLabel = canEditContent ? "Editar" : "Editar layout";
	const authoringPanelVisible =
		canEditContent && edit.state === "editing" && edit.graphDraft !== null;

	return (
		<div
			className={`${styles.explorer} ${responsive.layout} ${panelCollapsed ? styles.explorerPanelCollapsed : ""}`}
			style={{ "--world-inspector-width": `${panelWidth}px` } as CSSProperties}
			data-world-edit-state={edit.state}
			data-world-content-edit={canEditContent ? "enabled" : "disabled"}
			aria-busy={edit.busy}
		>
			<section
				className={`${styles.canvasColumn} ${responsive.canvasColumn}`}
				aria-labelledby="world-explorer-title"
			>
				<header className={styles.explorerHeader}>
					<div className={styles.titleCluster}>
						<p className={styles.eyebrow}>Mapa da campanha</p>
						<div className={styles.titleLine}>
							<h1 id="world-explorer-title">Ecos da Jornada</h1>
							{workingProjection.mode === "focus" && focus ? (
								<span className={styles.focusContext}>Conexões de {focus.label}</span>
							) : null}
						</div>
					</div>
					<div className={styles.headerActions}>
						{workingProjection.demo ? (
							<span className={styles.demoBadge}>Demo · não canônico</span>
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
						{canEditLayout && projection.mode === "overview" ? (
							<div className={styles.editGroup}>
								<button
									type="button"
									className={`${styles.editToggle}${edit.editing ? ` ${styles.editToggleActive}` : ""}`}
									aria-pressed={edit.editing}
									aria-label={
										edit.state === "editing"
											? edit.hasChanges
												? canEditContent
													? "Publicar alterações do Mundo"
													: "Publicar alterações do layout"
												: "Concluir edição sem alterações"
											: canEditContent
												? "Editar o Mundo"
												: "Editar layout do Mundo"
									}
									disabled={edit.busy}
									onClick={() => {
										if (edit.state === "editing") {
											void (edit.hasChanges ? edit.publish() : edit.finish());
										} else if (edit.state === "view") {
											void edit.start();
										}
									}}
								>
									<span aria-hidden="true">
										{edit.editing ? "●" : edit.state === "acquiring" ? "…" : "○"}
									</span>
									{edit.state === "publishing"
										? "Publicando…"
										: edit.state === "acquiring"
											? "Abrindo…"
											: edit.state === "editing"
												? edit.hasChanges
													? "Publicar"
													: "Concluir"
												: editButtonLabel}
								</button>
								{edit.state === "editing" ? (
									<button
										type="button"
										className={styles.discardEdit}
										onClick={() => void edit.discard()}
									>
										Descartar
									</button>
								) : null}
							</div>
						) : null}
					</div>
				</header>

				{edit.busyNotice ? (
					<div className={styles.editNotice} role="status">
						{edit.busyNotice}
					</div>
				) : null}
				{edit.feedback ? (
					<div className={styles.editFeedback} role="status" aria-live="polite">
						<span aria-hidden="true">{edit.editing ? "●" : "·"}</span>
						{edit.feedback}
					</div>
				) : null}

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
						disabled={edit.busy}
						onClick={resetLayout}
					>
						{edit.editing ? "Restaurar posições" : "Reorganizar"}
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

				{workingProjection.demo ? (
					<fieldset className={styles.relationLegend}>
						<legend className={styles.srOnly}>Legenda de relações</legend>
						<span data-family="affinity">Afinidade</span>
						<span data-family="conflict">Conflito</span>
						<span data-family="family">Família</span>
						<span data-family="mystic">Místico</span>
						<span data-family="creative">Criativo</span>
					</fieldset>
				) : activeRelationTypes.length ? (
					<fieldset className={styles.relationLegend}>
						<legend className={styles.srOnly}>Legenda de tipos de ligação</legend>
						{activeRelationTypes.map((type) => (
							<span
								key={type.slug}
								style={{ "--world-relation-color": type.style.color } as CSSProperties}
							>
								{type.label}
							</span>
						))}
					</fieldset>
				) : null}

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

				<WorldAccessibleRelations
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
					authoringPanelVisible && edit.graphDraft ? (
						<WorldContentEditor
							draft={edit.graphDraft}
							selectedId={selectedId}
							onDraftChange={edit.updateGraphDraft}
							onSelect={setSelectedId}
						/>
					) : edit.state === "publishing" && canEditContent ? (
						<div className={styles.overviewInspector}>
							<h2>Publicando…</h2>
							<p>Validando o rascunho e registrando as alterações do Mundo.</p>
						</div>
					) : selected ? (
						<WorldInspectorContent
							key={selected.id}
							selected={selected}
							projection={visibleProjection}
							focus={focus}
							onSelect={setSelectedId}
							editing={edit.editing}
						/>
					) : (
						<div className={styles.overviewInspector}>
							<h2>Visão geral</h2>
							<p>
								{canEditContent && edit.editing
									? "Use o painel de edição para criar ou alterar elementos e ligações."
									: "Selecione qualquer nó para inspecionar seus laços sem reorganizar o mapa."}
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
