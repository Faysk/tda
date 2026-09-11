"use client";

import { useRouter } from "next/navigation";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import { useEdgesState, useNodesState } from "@xyflow/react";
import { useWorldWorkspaceControls } from "../../world-shell/world-workspace-context";
import {
	applyWorldFlowSelection,
	rerouteWorldEdges,
	toReactFlowGraph,
	toReactFlowStructure,
	type WorldFlowEdge,
	type WorldFlowNode,
} from "../adapters/react-flow";
import type { WorldLayout } from "../constellation-layout";
import { captureWorldLayoutCandidate } from "../editorial-layout";
import { useWorldAuthoringUi } from "../hooks/use-world-authoring-ui";
import { useWorldEditSession } from "../hooks/use-world-edit-session";
import {
	projectionWithWorldDraft,
	useWorldExplorerView,
} from "../hooks/use-world-explorer-view";
import type { WorldGraphProjection, WorldLayoutProjection } from "../model";
import type { WorldCommandContext } from "../world-commands";
import authoring from "./world-authoring-shell.module.css";
import { WorldCanvas } from "./world-canvas";
import { WorldConductorBar } from "./world-conductor-bar";
import { WorldContentEditor } from "./world-content-editor";
import { WorldFloatingChrome } from "./world-floating-chrome";
import {
	WorldAccessibleRelations,
	WorldInspectorContent,
} from "./world-inspector";
import styles from "./world-explorer.module.css";
import responsive from "./world-responsive.module.css";

function publishedLayoutCandidate(projection: WorldGraphProjection): WorldLayoutProjection {
	return {
		schemaVersion: 1,
		view: "overview",
		revision: projection.layout?.revision ?? 0,
		positions: projection.layout?.positions ?? {},
	};
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
	const workspace = useWorldWorkspaceControls();
	const [positionOverrides, setPositionOverrides] = useState<WorldLayout>({});
	const positionOverridesRef = useRef<WorldLayout>({});
	const authoringUi = useWorldAuthoringUi();

	const edit = useWorldEditSession({
		canEditLayout,
		canEditContent,
		canStartEditing: projection.mode === "overview",
		publishedPositions: projection.layout?.positions ?? {},
		buildLayoutCandidate: (draft) =>
			layoutCandidateFor(
				canEditContent ? projectionWithWorldDraft(projection, draft) : projection,
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
		onEditingStarted: authoringUi.authoringStarted,
		onPublished: () => router.refresh(),
	});

	const {
		filter,
		setFilter,
		relationFilter,
		setRelationFilter,
		query,
		setQuery,
		selectedId,
		setSelectedId,
		view,
		setView,
		workingProjection,
		visibleProjection,
		selected,
		focus,
		activeRelationTypes,
	} = useWorldExplorerView({
		projection,
		canEditContent,
		editing: edit.editing,
		graphDraft: edit.graphDraft,
	});

	const graphStructure = useMemo(
		() => toReactFlowStructure(visibleProjection, positionOverrides),
		[visibleProjection, positionOverrides],
	);
	const graph = useMemo(
		() => applyWorldFlowSelection(graphStructure, selectedId),
		[graphStructure, selectedId],
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
		workspace.setAuthoringActive(edit.editing);
		if (!edit.editing) authoringUi.authoringStopped();
	}, [edit.editing, workspace.setAuthoringActive, authoringUi.authoringStopped]);

	useEffect(
		() => () => {
			workspace.setAuthoringActive(false);
		},
		[workspace.setAuthoringActive],
	);

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

	const authoringActive = edit.editing;
	const authoringPanelVisible =
		canEditContent && edit.state === "editing" && edit.graphDraft !== null;
	const commandContext: WorldCommandContext = {
		mode: workingProjection.mode,
		canEditLayout,
		editState: edit.state,
		hasChanges: edit.hasChanges,
		hasSelection: Boolean(selected),
		selectionIsFocus: Boolean(selected && selected.id === workingProjection.focusId),
		hasProfileRoute: Boolean(selected?.route),
	};

	return (
		<div
			className={`${styles.explorer} ${responsive.layout} ${authoringActive ? authoring.active : ""} ${authoringActive && authoringUi.focusMode ? authoring.focusMode : ""} ${authoringUi.inspectorCollapsed ? styles.explorerPanelCollapsed : ""}`}
			style={
				{
					"--world-inspector-width": `${authoringUi.state.inspectorWidth}px`,
				} as CSSProperties
			}
			data-world-edit-state={edit.state}
			data-world-content-edit={canEditContent ? "enabled" : "disabled"}
			data-world-authoring-active={authoringActive ? "true" : "false"}
			data-world-focus-mode={authoringActive && authoringUi.focusMode ? "true" : "false"}
			data-world-inspector-mode={authoringUi.state.inspectorMode}
			aria-busy={edit.busy}
		>
			<section
				className={`${styles.canvasColumn} ${responsive.canvasColumn} ${authoring.canvasColumn}`}
				aria-labelledby="world-explorer-title"
			>
				<header className={`${styles.explorerHeader} ${authoring.editorialHeader}`}>
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
					</div>
				</header>

				{canEditLayout && projection.mode === "overview" ? (
					<WorldConductorBar
						context={commandContext}
						canEditContent={canEditContent}
						busy={edit.busy}
						busyNotice={edit.busyNotice}
						feedback={edit.feedback}
						focusMode={authoringActive && authoringUi.focusMode}
						inspectorOpen={!authoringUi.inspectorCollapsed}
						onEnter={edit.start}
						onPublish={edit.publish}
						onFinish={edit.finish}
						onDiscard={edit.discard}
						onToggleFocusMode={authoringUi.toggleFocusMode}
						onToggleInspector={() => authoringUi.toggleInspector("overlay")}
						onOpenNavigation={workspace.openNavigation}
					/>
				) : null}

				<div className={authoring.publicChrome}>
					<WorldFloatingChrome
						query={query}
						onQueryChange={setQuery}
						filter={filter}
						onFilterChange={setFilter}
						relationFilter={relationFilter}
						onRelationFilterChange={setRelationFilter}
						view={view}
						onViewChange={setView}
						onReset={resetLayout}
						resetLabel={edit.editing ? "Restaurar posições" : "Reorganizar"}
						resetDisabled={edit.busy}
						demo={workingProjection.demo}
						activeRelationTypes={activeRelationTypes}
					/>
				</div>

				{view === "canvas" ? (
					<WorldCanvas
						nodes={nodes}
						edges={edges}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onNodeSelect={(node) => setSelectedId(node.id)}
						onNodeDragStop={rememberNodePosition}
						onPaneClick={() => setSelectedId(null)}
					/>
				) : null}

				<WorldAccessibleRelations
					projection={visibleProjection}
					selectedId={selected?.id ?? null}
					onSelect={setSelectedId}
					compact={view === "canvas"}
				/>
			</section>

			<aside
				className={`${styles.inspector} ${responsive.inspector} ${authoring.inspector}`}
				aria-live="polite"
			>
				<hr
					className={`${styles.panelResizer} ${responsive.resizer}`}
					aria-label="Ajustar largura do painel"
					aria-orientation="vertical"
					aria-valuemin={authoringUi.inspectorMinWidth}
					aria-valuemax={authoringUi.inspectorMaxWidth}
					aria-valuenow={authoringUi.state.inspectorWidth}
					tabIndex={0}
					onPointerDown={authoringUi.startInspectorResize}
					onPointerMove={authoringUi.resizeInspector}
					onPointerUp={authoringUi.stopInspectorResize}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") {
							authoringUi.adjustInspectorWidth(24);
						}
						if (event.key === "ArrowRight") {
							authoringUi.adjustInspectorWidth(-24);
						}
					}}
				/>
				<button
					className={`${styles.panelToggle} ${responsive.panelToggle}`}
					type="button"
					onClick={() => authoringUi.toggleInspector(authoringActive ? "overlay" : "docked")}
					aria-expanded={!authoringUi.inspectorCollapsed}
					aria-label={
						authoringUi.inspectorCollapsed
							? "Abrir painel de detalhes"
							: "Recolher painel de detalhes"
					}
				>
					{authoringUi.inspectorCollapsed ? "‹" : "›"}
				</button>
				{!authoringUi.inspectorCollapsed ? (
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
									? "Abra Detalhes quando precisar editar propriedades. O canvas continua como superfície principal de trabalho."
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
