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
import {
	acquireWorldGraphDraftAction,
	publishWorldEditStateAction,
	saveWorldGraphDraftAction,
} from "../world-graph-actions";
import {
	acquireWorldLayoutSessionAction,
	releaseWorldLayoutSessionAction,
	renewWorldLayoutSessionAction,
	saveWorldLayoutSessionDraftAction,
} from "../world-layout-session-actions";
import { publishWorldEditLayoutAction } from "../world-edit-actions";
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
const WORLD_EDIT_LEASE_STORAGE_KEY = "tda.world.edit.lease.yuhara-main";
const WORLD_EDIT_HEARTBEAT_MS = 20_000;
const WORLD_EDIT_DRAFT_DEBOUNCE_MS = 500;
const WORLD_BUSY_NOTICE_MS = 5_000;

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

type WorldEditState = "view" | "acquiring" | "editing" | "publishing";
type LayoutDraftResult = Awaited<ReturnType<typeof saveWorldLayoutSessionDraftAction>>;
type GraphDraftResult = Awaited<ReturnType<typeof saveWorldGraphDraftAction>>;

function clampPanelWidth(value: number) {
	return Math.min(520, Math.max(320, value));
}

function positionsEqual(
	left: Readonly<Record<string, Readonly<{ x: number; y: number }>>>,
	right: Readonly<Record<string, Readonly<{ x: number; y: number }>>>,
) {
	const leftIds = Object.keys(left).sort();
	const rightIds = Object.keys(right).sort();
	if (leftIds.length !== rightIds.length) return false;
	return leftIds.every((id, index) => {
		if (id !== rightIds[index]) return false;
		return left[id]?.x === right[id]?.x && left[id]?.y === right[id]?.y;
	});
}

function publishedLayoutCandidate(projection: WorldGraphProjection): WorldLayoutProjection {
	return {
		schemaVersion: 1,
		view: "overview",
		revision: projection.layout?.revision ?? 0,
		positions: projection.layout?.positions ?? {},
	};
}

function editFailureMessage(reason: string): string {
	switch (reason) {
		case "unauthenticated":
			return "Sua sessão expirou. Entre novamente antes de editar o Mundo.";
		case "profile_unresolved":
			return "Sua conta ainda não está vinculada a um perfil que possa editar o Mundo.";
		case "forbidden":
			return "Sua conta não possui permissão para esta edição do Mundo.";
		case "conflict":
			return "O Mundo publicado mudou enquanto este rascunho estava aberto. O rascunho foi preservado; recarregue antes de publicar.";
		case "lease_lost":
			return "A sessão exclusiva de edição expirou. Seu rascunho foi preservado para recuperação, mas precisa de uma nova sessão antes de publicar.";
		case "invalid_payload":
			return "Há um campo inválido no rascunho. Corrija-o antes de publicar.";
		case "duplicate":
			return "Já existe um elemento, slug ou ligação incompatível com esta alteração. Ajuste o rascunho e tente novamente.";
		default:
			return "Não foi possível confirmar a edição agora. Nenhuma alteração foi publicada.";
	}
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
	const [editState, setEditState] = useState<WorldEditState>("view");
	const [leaseToken, setLeaseToken] = useState<string | null>(null);
	const [layoutDirty, setLayoutDirty] = useState(false);
	const [graphDraft, setGraphDraft] = useState<WorldGraphDraft | null>(null);
	const graphDraftRef = useRef<WorldGraphDraft | null>(null);
	const [graphDirty, setGraphDirty] = useState(false);
	const [editFeedback, setEditFeedback] = useState<string | null>(null);
	const [busyNotice, setBusyNotice] = useState<string | null>(null);
	const resizeStart = useRef<{ x: number; width: number } | null>(null);
	const layoutDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const graphDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const draftSequence = useRef(0);
	const saveQueue = useRef<Promise<void>>(Promise.resolve());

	const editing = editState === "editing" || editState === "publishing";
	const editBusy = editState === "acquiring" || editState === "publishing";
	const hasEditChanges = layoutDirty || graphDirty;
	const workingWithGraphDraft = Boolean(canEditContent && editing && graphDraft);

	const workingProjection = useMemo(() => {
		if (!workingWithGraphDraft || !graphDraft) return projection;
		const next = buildWorldProjection(worldDatasetFromDraft(graphDraft));
		next.layout = projection.layout;
		return next;
	}, [graphDraft, projection, workingWithGraphDraft]);

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
		graphDraftRef.current = graphDraft;
	}, [graphDraft]);

	useEffect(() => {
		setNodes(graph.nodes);
		setEdges(graph.edges);
	}, [graph, setEdges, setNodes]);

	useEffect(() => {
		if (selectedId && !visibleProjection.nodes.some((node) => node.id === selectedId)) {
			setSelectedId(null);
		}
	}, [selectedId, visibleProjection.nodes]);

	useEffect(() => {
		if (editState !== "editing" || !leaseToken) return;
		let cancelled = false;
		const heartbeat = window.setInterval(() => {
			void renewWorldLayoutSessionAction(leaseToken).then((result) => {
				if (cancelled || result.ok) return;
				if (result.reason === "lease_lost" || result.reason === "forbidden") {
					draftSequence.current += 1;
					setEditState("view");
					setLeaseToken(null);
					window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
				}
				setEditFeedback(editFailureMessage(result.reason));
			});
		}, WORLD_EDIT_HEARTBEAT_MS);
		return () => {
			cancelled = true;
			window.clearInterval(heartbeat);
		};
	}, [editState, leaseToken]);

	useEffect(
		() => () => {
			if (layoutDraftTimer.current) clearTimeout(layoutDraftTimer.current);
			if (graphDraftTimer.current) clearTimeout(graphDraftTimer.current);
			if (busyTimer.current) clearTimeout(busyTimer.current);
		},
		[],
	);

	const selected = selectedId
		? visibleProjection.nodes.find((node) => node.id === selectedId)
		: undefined;
	const focus = workingProjection.focusId
		? workingProjection.nodes.find((node) => node.id === workingProjection.focusId)
		: undefined;
	const activeRelationTypes = workingProjection.relationTypes.filter((type) => type.isActive);

	function candidateFrom(overrides: WorldLayout) {
		const fullGraph = toReactFlowGraph(workingProjection, null, overrides);
		return captureWorldLayoutCandidate(
			workingProjection,
			Object.fromEntries(
				fullGraph.nodes.map((node) => [
					node.id,
					{ x: node.position.x, y: node.position.y },
				]),
			),
		);
	}

	function showBusyNotice(message: string) {
		setBusyNotice(message);
		if (busyTimer.current) clearTimeout(busyTimer.current);
		busyTimer.current = setTimeout(() => setBusyNotice(null), WORLD_BUSY_NOTICE_MS);
	}

	function markLeaseLost(reason: string) {
		draftSequence.current += 1;
		setEditState("view");
		setLeaseToken(null);
		window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		setEditFeedback(editFailureMessage(reason));
	}

	function enqueueSave<T>(operation: () => Promise<T>): Promise<T> {
		const request = saveQueue.current.then(operation);
		saveQueue.current = request.then(
			() => undefined,
			() => undefined,
		);
		return request;
	}

	function queueLayoutDraftRequest(
		token: string,
		candidate: WorldLayoutProjection,
	): Promise<LayoutDraftResult> {
		return enqueueSave(async () => {
			try {
				return await saveWorldLayoutSessionDraftAction(token, candidate);
			} catch {
				return { ok: false, reason: "dependency_unavailable" } as const;
			}
		});
	}

	function queueGraphDraftRequest(
		token: string,
		draft: WorldGraphDraft,
	): Promise<GraphDraftResult> {
		return enqueueSave(async () => {
			try {
				return await saveWorldGraphDraftAction(token, draft);
			} catch {
				return { ok: false, reason: "dependency_unavailable" } as const;
			}
		});
	}

	function scheduleLayoutDraftSave(
		candidate: WorldLayoutProjection,
		pendingMessage = "Alterações locais — salvando rascunho…",
	) {
		if (editState !== "editing" || !leaseToken) return;
		if (layoutDraftTimer.current) clearTimeout(layoutDraftTimer.current);
		const sequence = ++draftSequence.current;
		setEditFeedback(pendingMessage);
		layoutDraftTimer.current = setTimeout(() => {
			layoutDraftTimer.current = null;
			void queueLayoutDraftRequest(leaseToken, candidate).then((result) => {
				if (sequence !== draftSequence.current) return;
				if (result.ok) {
					setEditFeedback(
						canEditContent
							? "Rascunho salvo. Só você vê estas alterações até publicar."
							: "Rascunho salvo. Só você vê estas posições até publicar.",
					);
					return;
				}
				if (result.reason === "lease_lost" || result.reason === "forbidden") {
					markLeaseLost(result.reason);
					return;
				}
				setEditFeedback(editFailureMessage(result.reason));
			});
		}, WORLD_EDIT_DRAFT_DEBOUNCE_MS);
	}

	function scheduleGraphDraftSave(
		draft: WorldGraphDraft,
		pendingMessage = "Alterações no Mundo — salvando rascunho…",
	) {
		if (!canEditContent || editState !== "editing" || !leaseToken) return;
		if (graphDraftTimer.current) clearTimeout(graphDraftTimer.current);
		const sequence = ++draftSequence.current;
		setEditFeedback(pendingMessage);
		graphDraftTimer.current = setTimeout(() => {
			graphDraftTimer.current = null;
			void queueGraphDraftRequest(leaseToken, draft).then((result) => {
				if (sequence !== draftSequence.current) return;
				if (result.ok) {
					setEditFeedback("Rascunho salvo. Só você vê estas alterações até publicar.");
					return;
				}
				if (result.reason === "lease_lost" || result.reason === "forbidden") {
					markLeaseLost(result.reason);
					return;
				}
				setEditFeedback(editFailureMessage(result.reason));
			});
		}, WORLD_EDIT_DRAFT_DEBOUNCE_MS);
	}

	function updateGraphDraft(next: WorldGraphDraft, message?: string) {
		graphDraftRef.current = next;
		setGraphDraft(next);
		setGraphDirty(true);
		scheduleGraphDraftSave(
			next,
			message ? `${message} Salvando rascunho…` : undefined,
		);
	}

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
		if (editState === "editing") {
			const candidate = candidateFrom(nextOverrides);
			if (!candidate) {
				setEditFeedback(editFailureMessage("invalid_payload"));
				return;
			}
			setLayoutDirty(true);
			scheduleLayoutDraftSave(candidate);
		}
	}

	function resetLayout() {
		positionOverridesRef.current = {};
		setPositionOverrides({});
		setSelectedId(workingProjection.focusId);
		if (editState === "editing") {
			setLayoutDirty(false);
			scheduleLayoutDraftSave(
				publishedLayoutCandidate(projection),
				"Restaurando as posições publicadas no rascunho…",
			);
		}
	}

	async function startEditing() {
		if (!canEditLayout || projection.mode !== "overview" || editState !== "view") return;
		setBusyNotice(null);
		setEditState("acquiring");
		setEditFeedback("Obtendo sessão exclusiva de edição…");
		let token = window.sessionStorage.getItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		if (!token) {
			token = crypto.randomUUID();
			window.sessionStorage.setItem(WORLD_EDIT_LEASE_STORAGE_KEY, token);
		}

		const result = await acquireWorldLayoutSessionAction(token);
		if (!result.ok) {
			setEditState("view");
			if (result.reason === "busy") {
				showBusyNotice(
					result.sameActor
						? "Você já está editando o Mundo em outra aba. Finalize aquela sessão ou aguarde a expiração para recuperar o rascunho."
						: `${result.holderLabel} está editando o Mundo neste momento.`,
				);
				setEditFeedback(null);
				return;
			}
			window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
			setEditFeedback(editFailureMessage(result.reason));
			return;
		}

		let acquiredGraph: WorldGraphDraft | null = null;
		if (canEditContent) {
			const graphResult = await acquireWorldGraphDraftAction(token);
			if (!graphResult.ok) {
				await releaseWorldLayoutSessionAction(token);
				window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
				setEditState("view");
				setEditFeedback(editFailureMessage(graphResult.reason));
				return;
			}
			acquiredGraph = graphResult.draft;
		}

		setLeaseToken(token);
		positionOverridesRef.current = result.draft.positions;
		setPositionOverrides(result.draft.positions);
		setLayoutDirty(
			!positionsEqual(result.draft.positions, projection.layout?.positions ?? {}),
		);
		graphDraftRef.current = acquiredGraph;
		setGraphDraft(acquiredGraph);
		setGraphDirty(Boolean(acquiredGraph && result.status !== "acquired"));
		setPanelCollapsed(false);
		setEditState("editing");
		setEditFeedback(
			result.status === "acquired"
				? canEditContent
					? "Edição exclusiva ativa. Crie, conecte, organize e revise o Mundo; só você vê o rascunho até publicar."
					: "Edição exclusiva ativa. Alterações de posição ficam em rascunho até publicar."
				: "Rascunho de edição recuperado. Revise antes de publicar.",
		);
	}

	async function publishEditing() {
		if (editState !== "editing" || !leaseToken || !hasEditChanges) return;
		if (layoutDraftTimer.current) {
			clearTimeout(layoutDraftTimer.current);
			layoutDraftTimer.current = null;
		}
		if (graphDraftTimer.current) {
			clearTimeout(graphDraftTimer.current);
			graphDraftTimer.current = null;
		}
		const sequence = ++draftSequence.current;
		setEditState("publishing");
		setEditFeedback("Validando o rascunho mais recente…");

		const layoutCandidate = candidateFrom(positionOverridesRef.current);
		if (!layoutCandidate) {
			setEditState("editing");
			setEditFeedback(editFailureMessage("invalid_payload"));
			return;
		}
		const layoutResult = await queueLayoutDraftRequest(leaseToken, layoutCandidate);
		if (sequence !== draftSequence.current) return;
		if (!layoutResult.ok) {
			if (layoutResult.reason === "lease_lost" || layoutResult.reason === "forbidden") {
				markLeaseLost(layoutResult.reason);
			} else {
				setEditState("editing");
				setEditFeedback(editFailureMessage(layoutResult.reason));
			}
			return;
		}

		if (canEditContent) {
			const latestGraph = graphDraftRef.current;
			if (!latestGraph) {
				setEditState("editing");
				setEditFeedback("O rascunho factual não está disponível. Reabra a edição antes de publicar.");
				return;
			}
			const graphResult = await queueGraphDraftRequest(leaseToken, latestGraph);
			if (sequence !== draftSequence.current) return;
			if (!graphResult.ok) {
				if (graphResult.reason === "lease_lost" || graphResult.reason === "forbidden") {
					markLeaseLost(graphResult.reason);
				} else {
					setEditState("editing");
					setEditFeedback(editFailureMessage(graphResult.reason));
				}
				return;
			}

			setEditFeedback("Publicando o Mundo com as visibilidades configuradas…");
			const publishResult = await publishWorldEditStateAction(leaseToken);
			if (sequence !== draftSequence.current) return;
			if (!publishResult.ok) {
				if (publishResult.reason === "lease_lost" || publishResult.reason === "forbidden") {
					markLeaseLost(publishResult.reason);
				} else {
					setEditState("editing");
					setEditFeedback(editFailureMessage(publishResult.reason));
				}
				return;
			}
			completePublishedEdit(
				publishResult.status === "unchanged"
					? "Nenhuma alteração precisava ser publicada."
					: "Mundo publicado. Cada pessoa vê somente o que sua visibilidade permite.",
			);
			return;
		}

		setEditFeedback("Publicando composição para todos…");
		const publishResult = await publishWorldEditLayoutAction(leaseToken);
		if (sequence !== draftSequence.current) return;
		if (!publishResult.ok) {
			if (publishResult.reason === "lease_lost" || publishResult.reason === "forbidden") {
				markLeaseLost(publishResult.reason);
			} else {
				setEditState("editing");
				setEditFeedback(editFailureMessage(publishResult.reason));
			}
			return;
		}
		completePublishedEdit(
			publishResult.status === "unchanged"
				? "Nenhuma mudança de layout precisava ser publicada."
				: "Composição publicada para todos.",
		);
	}

	function completePublishedEdit(message: string) {
		window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		setLeaseToken(null);
		setLayoutDirty(false);
		setGraphDirty(false);
		graphDraftRef.current = null;
		setGraphDraft(null);
		setEditState("view");
		setEditFeedback(message);
		router.refresh();
	}

	async function releaseEditing(message: string) {
		if (!leaseToken || editState !== "editing") return;
		if (layoutDraftTimer.current) {
			clearTimeout(layoutDraftTimer.current);
			layoutDraftTimer.current = null;
		}
		if (graphDraftTimer.current) {
			clearTimeout(graphDraftTimer.current);
			graphDraftTimer.current = null;
		}
		draftSequence.current += 1;
		setEditFeedback("Encerrando a sessão de edição…");
		await saveQueue.current;
		const result = await releaseWorldLayoutSessionAction(leaseToken);
		if (!result.ok) {
			setEditFeedback(editFailureMessage(result.reason));
			return;
		}
		window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		setLeaseToken(null);
		setLayoutDirty(false);
		setGraphDirty(false);
		graphDraftRef.current = null;
		setGraphDraft(null);
		setEditState("view");
		positionOverridesRef.current = {};
		setPositionOverrides({});
		setEditFeedback(message);
	}

	async function finishEditing() {
		await releaseEditing("Edição encerrada sem alterações publicadas.");
	}

	async function discardEditing() {
		await releaseEditing("Rascunho descartado. O Mundo publicado foi mantido.");
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
		canEditContent && editState === "editing" && graphDraft !== null;

	return (
		<div
			className={`${styles.explorer} ${responsive.layout} ${panelCollapsed ? styles.explorerPanelCollapsed : ""}`}
			style={{ "--world-inspector-width": `${panelWidth}px` } as CSSProperties}
			data-world-edit-state={editState}
			data-world-content-edit={canEditContent ? "enabled" : "disabled"}
			aria-busy={editBusy}
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
									className={`${styles.editToggle}${editing ? ` ${styles.editToggleActive}` : ""}`}
									aria-pressed={editing}
									aria-label={
										editState === "editing"
											? hasEditChanges
												? canEditContent
													? "Publicar alterações do Mundo"
													: "Publicar alterações do layout"
												: "Concluir edição sem alterações"
											: canEditContent
												? "Editar o Mundo"
												: "Editar layout do Mundo"
									}
									disabled={editBusy}
									onClick={() => {
										if (editState === "editing") {
											void (hasEditChanges ? publishEditing() : finishEditing());
										} else if (editState === "view") {
											void startEditing();
										}
									}}
								>
									<span aria-hidden="true">
										{editing ? "●" : editState === "acquiring" ? "…" : "○"}
									</span>
									{editState === "publishing"
										? "Publicando…"
										: editState === "acquiring"
											? "Abrindo…"
											: editState === "editing"
												? hasEditChanges
													? "Publicar"
													: "Concluir"
												: editButtonLabel}
								</button>
								{editState === "editing" ? (
									<button
										type="button"
										className={styles.discardEdit}
										onClick={() => void discardEditing()}
									>
										Descartar
									</button>
								) : null}
							</div>
						) : null}
					</div>
				</header>

				{busyNotice ? (
					<div className={styles.editNotice} role="status">
						{busyNotice}
					</div>
				) : null}
				{editFeedback ? (
					<div className={styles.editFeedback} role="status" aria-live="polite">
						<span aria-hidden="true">{editing ? "●" : "·"}</span>
						{editFeedback}
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
						disabled={editBusy}
						onClick={resetLayout}
					>
						{editing ? "Restaurar posições" : "Reorganizar"}
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
					authoringPanelVisible && graphDraft ? (
						<WorldContentEditor
							draft={graphDraft}
							selectedId={selectedId}
							onDraftChange={updateGraphDraft}
							onSelect={setSelectedId}
						/>
					) : editState === "publishing" && canEditContent ? (
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
							editing={editing}
						/>
					) : (
						<div className={styles.overviewInspector}>
							<h2>Visão geral</h2>
							<p>
								{canEditContent && editing
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
