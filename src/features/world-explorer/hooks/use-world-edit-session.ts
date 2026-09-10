"use client";

import { useEffect, useRef, useState } from "react";
import type { WorldLayout } from "../constellation-layout";
import type { WorldGraphDraft, WorldLayoutProjection } from "../model";
import {
	acquireWorldGraphDraftAction,
	publishWorldEditStateAction,
	saveWorldGraphDraftAction,
} from "../world-graph-actions";
import { publishWorldEditLayoutAction } from "../world-edit-actions";
import {
	acquireWorldLayoutSessionAction,
	releaseWorldLayoutSessionAction,
	renewWorldLayoutSessionAction,
	saveWorldLayoutSessionDraftAction,
} from "../world-layout-session-actions";

const WORLD_EDIT_LEASE_STORAGE_KEY = "tda.world.edit.lease.yuhara-main";
const WORLD_EDIT_HEARTBEAT_MS = 20_000;
const WORLD_EDIT_DRAFT_DEBOUNCE_MS = 500;
const WORLD_BUSY_NOTICE_MS = 5_000;

type WorldEditState = "view" | "acquiring" | "editing" | "publishing";
type LayoutDraftResult = Awaited<ReturnType<typeof saveWorldLayoutSessionDraftAction>>;
type GraphDraftResult = Awaited<ReturnType<typeof saveWorldGraphDraftAction>>;

export function worldEditFailureMessage(reason: string): string {
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

export function worldLayoutPositionsEqual(
	left: Readonly<Record<string, Readonly<{ x: number; y: number }>>>,
	right: Readonly<Record<string, Readonly<{ x: number; y: number }>>>,
): boolean {
	const leftIds = Object.keys(left).sort();
	const rightIds = Object.keys(right).sort();
	if (leftIds.length !== rightIds.length) return false;
	return leftIds.every((id, index) => {
		if (id !== rightIds[index]) return false;
		return left[id]?.x === right[id]?.x && left[id]?.y === right[id]?.y;
	});
}

type UseWorldEditSessionOptions = Readonly<{
	canEditLayout: boolean;
	canEditContent: boolean;
	canStartEditing: boolean;
	publishedPositions: WorldLayout;
	buildLayoutCandidate: () => WorldLayoutProjection | null;
	onApplyLayoutDraft: (positions: WorldLayout) => void;
	onReleaseLayout: () => void;
	onEditingStarted?: () => void;
	onPublished: () => void;
}>;

type UpdateLayoutDraftOptions = Readonly<{
	dirty?: boolean;
	pendingMessage?: string;
}>;

export function useWorldEditSession({
	canEditLayout,
	canEditContent,
	canStartEditing,
	publishedPositions,
	buildLayoutCandidate,
	onApplyLayoutDraft,
	onReleaseLayout,
	onEditingStarted,
	onPublished,
}: UseWorldEditSessionOptions) {
	const [state, setState] = useState<WorldEditState>("view");
	const [leaseToken, setLeaseToken] = useState<string | null>(null);
	const [layoutDirty, setLayoutDirty] = useState(false);
	const [graphDraft, setGraphDraft] = useState<WorldGraphDraft | null>(null);
	const graphDraftRef = useRef<WorldGraphDraft | null>(null);
	const [graphDirty, setGraphDirty] = useState(false);
	const [feedback, setFeedback] = useState<string | null>(null);
	const [busyNotice, setBusyNotice] = useState<string | null>(null);
	const layoutDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const graphDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const draftSequence = useRef(0);
	const saveQueue = useRef<Promise<void>>(Promise.resolve());

	const editing = state === "editing" || state === "publishing";
	const busy = state === "acquiring" || state === "publishing";
	const hasChanges = layoutDirty || graphDirty;

	useEffect(() => {
		graphDraftRef.current = graphDraft;
	}, [graphDraft]);

	useEffect(() => {
		if (state !== "editing" || !leaseToken) return;
		let cancelled = false;
		const heartbeat = window.setInterval(() => {
			void renewWorldLayoutSessionAction(leaseToken).then((result) => {
				if (cancelled || result.ok) return;
				if (result.reason === "lease_lost" || result.reason === "forbidden") {
					markLeaseLost(result.reason);
					return;
				}
				setFeedback(worldEditFailureMessage(result.reason));
			});
		}, WORLD_EDIT_HEARTBEAT_MS);
		return () => {
			cancelled = true;
			window.clearInterval(heartbeat);
		};
	}, [state, leaseToken]);

	useEffect(
		() => () => {
			if (layoutDraftTimer.current) clearTimeout(layoutDraftTimer.current);
			if (graphDraftTimer.current) clearTimeout(graphDraftTimer.current);
			if (busyTimer.current) clearTimeout(busyTimer.current);
		},
		[],
	);

	function showBusyNotice(message: string) {
		setBusyNotice(message);
		if (busyTimer.current) clearTimeout(busyTimer.current);
		busyTimer.current = setTimeout(() => setBusyNotice(null), WORLD_BUSY_NOTICE_MS);
	}

	function markLeaseLost(reason: string) {
		draftSequence.current += 1;
		setState("view");
		setLeaseToken(null);
		window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		setFeedback(worldEditFailureMessage(reason));
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
		if (state !== "editing" || !leaseToken) return;
		if (layoutDraftTimer.current) clearTimeout(layoutDraftTimer.current);
		const sequence = ++draftSequence.current;
		setFeedback(pendingMessage);
		layoutDraftTimer.current = setTimeout(() => {
			layoutDraftTimer.current = null;
			void queueLayoutDraftRequest(leaseToken, candidate).then((result) => {
				if (sequence !== draftSequence.current) return;
				if (result.ok) {
					setFeedback(
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
				setFeedback(worldEditFailureMessage(result.reason));
			});
		}, WORLD_EDIT_DRAFT_DEBOUNCE_MS);
	}

	function scheduleGraphDraftSave(
		draft: WorldGraphDraft,
		pendingMessage = "Alterações no Mundo — salvando rascunho…",
	) {
		if (!canEditContent || state !== "editing" || !leaseToken) return;
		if (graphDraftTimer.current) clearTimeout(graphDraftTimer.current);
		const sequence = ++draftSequence.current;
		setFeedback(pendingMessage);
		graphDraftTimer.current = setTimeout(() => {
			graphDraftTimer.current = null;
			void queueGraphDraftRequest(leaseToken, draft).then((result) => {
				if (sequence !== draftSequence.current) return;
				if (result.ok) {
					setFeedback("Rascunho salvo. Só você vê estas alterações até publicar.");
					return;
				}
				if (result.reason === "lease_lost" || result.reason === "forbidden") {
					markLeaseLost(result.reason);
					return;
				}
				setFeedback(worldEditFailureMessage(result.reason));
			});
		}, WORLD_EDIT_DRAFT_DEBOUNCE_MS);
	}

	function updateLayoutDraft(
		candidate: WorldLayoutProjection,
		{ dirty = true, pendingMessage }: UpdateLayoutDraftOptions = {},
	) {
		if (state !== "editing") return;
		setLayoutDirty(dirty);
		scheduleLayoutDraftSave(candidate, pendingMessage);
	}

	function updateGraphDraft(next: WorldGraphDraft, message?: string) {
		graphDraftRef.current = next;
		setGraphDraft(next);
		setGraphDirty(true);
		scheduleGraphDraftSave(next, message ? `${message} Salvando rascunho…` : undefined);
	}

	async function start() {
		if (!canEditLayout || !canStartEditing || state !== "view") return;
		setBusyNotice(null);
		setState("acquiring");
		setFeedback("Obtendo sessão exclusiva de edição…");
		let token = window.sessionStorage.getItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		if (!token) {
			token = crypto.randomUUID();
			window.sessionStorage.setItem(WORLD_EDIT_LEASE_STORAGE_KEY, token);
		}

		const result = await acquireWorldLayoutSessionAction(token);
		if (!result.ok) {
			setState("view");
			if (result.reason === "busy") {
				showBusyNotice(
					result.sameActor
						? "Você já está editando o Mundo em outra aba. Finalize aquela sessão ou aguarde a expiração para recuperar o rascunho."
						: `${result.holderLabel} está editando o Mundo neste momento.`,
				);
				setFeedback(null);
				return;
			}
			window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
			setFeedback(worldEditFailureMessage(result.reason));
			return;
		}

		let acquiredGraph: WorldGraphDraft | null = null;
		if (canEditContent) {
			const graphResult = await acquireWorldGraphDraftAction(token);
			if (!graphResult.ok) {
				await releaseWorldLayoutSessionAction(token);
				window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
				setState("view");
				setFeedback(worldEditFailureMessage(graphResult.reason));
				return;
			}
			acquiredGraph = graphResult.draft;
		}

		setLeaseToken(token);
		onApplyLayoutDraft(result.draft.positions);
		setLayoutDirty(!worldLayoutPositionsEqual(result.draft.positions, publishedPositions));
		graphDraftRef.current = acquiredGraph;
		setGraphDraft(acquiredGraph);
		setGraphDirty(Boolean(acquiredGraph && result.status !== "acquired"));
		onEditingStarted?.();
		setState("editing");
		setFeedback(
			result.status === "acquired"
				? canEditContent
					? "Edição exclusiva ativa. Crie, conecte, organize e revise o Mundo; só você vê o rascunho até publicar."
					: "Edição exclusiva ativa. Alterações de posição ficam em rascunho até publicar."
				: "Rascunho de edição recuperado. Revise antes de publicar.",
		);
	}

	function cancelPendingDraftSaves() {
		if (layoutDraftTimer.current) {
			clearTimeout(layoutDraftTimer.current);
			layoutDraftTimer.current = null;
		}
		if (graphDraftTimer.current) {
			clearTimeout(graphDraftTimer.current);
			graphDraftTimer.current = null;
		}
	}

	function completePublishedEdit(message: string) {
		window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		setLeaseToken(null);
		setLayoutDirty(false);
		setGraphDirty(false);
		graphDraftRef.current = null;
		setGraphDraft(null);
		setState("view");
		setFeedback(message);
		onPublished();
	}

	async function publish() {
		if (state !== "editing" || !leaseToken || !hasChanges) return;
		cancelPendingDraftSaves();
		const sequence = ++draftSequence.current;
		setState("publishing");
		setFeedback("Validando o rascunho mais recente…");

		const layoutCandidate = buildLayoutCandidate();
		if (!layoutCandidate) {
			setState("editing");
			setFeedback(worldEditFailureMessage("invalid_payload"));
			return;
		}
		const layoutResult = await queueLayoutDraftRequest(leaseToken, layoutCandidate);
		if (sequence !== draftSequence.current) return;
		if (!layoutResult.ok) {
			if (layoutResult.reason === "lease_lost" || layoutResult.reason === "forbidden") {
				markLeaseLost(layoutResult.reason);
			} else {
				setState("editing");
				setFeedback(worldEditFailureMessage(layoutResult.reason));
			}
			return;
		}

		if (canEditContent) {
			const latestGraph = graphDraftRef.current;
			if (!latestGraph) {
				setState("editing");
				setFeedback("O rascunho factual não está disponível. Reabra a edição antes de publicar.");
				return;
			}
			const graphResult = await queueGraphDraftRequest(leaseToken, latestGraph);
			if (sequence !== draftSequence.current) return;
			if (!graphResult.ok) {
				if (graphResult.reason === "lease_lost" || graphResult.reason === "forbidden") {
					markLeaseLost(graphResult.reason);
				} else {
					setState("editing");
					setFeedback(worldEditFailureMessage(graphResult.reason));
				}
				return;
			}

			setFeedback("Publicando o Mundo com as visibilidades configuradas…");
			const publishResult = await publishWorldEditStateAction(leaseToken);
			if (sequence !== draftSequence.current) return;
			if (!publishResult.ok) {
				if (publishResult.reason === "lease_lost" || publishResult.reason === "forbidden") {
					markLeaseLost(publishResult.reason);
				} else {
					setState("editing");
					setFeedback(worldEditFailureMessage(publishResult.reason));
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

		setFeedback("Publicando composição para todos…");
		const publishResult = await publishWorldEditLayoutAction(leaseToken);
		if (sequence !== draftSequence.current) return;
		if (!publishResult.ok) {
			if (publishResult.reason === "lease_lost" || publishResult.reason === "forbidden") {
				markLeaseLost(publishResult.reason);
			} else {
				setState("editing");
				setFeedback(worldEditFailureMessage(publishResult.reason));
			}
			return;
		}
		completePublishedEdit(
			publishResult.status === "unchanged"
				? "Nenhuma mudança de layout precisava ser publicada."
				: "Composição publicada para todos.",
		);
	}

	async function release(message: string) {
		if (!leaseToken || state !== "editing") return;
		cancelPendingDraftSaves();
		draftSequence.current += 1;
		setFeedback("Encerrando a sessão de edição…");
		await saveQueue.current;
		const result = await releaseWorldLayoutSessionAction(leaseToken);
		if (!result.ok) {
			setFeedback(worldEditFailureMessage(result.reason));
			return;
		}
		window.sessionStorage.removeItem(WORLD_EDIT_LEASE_STORAGE_KEY);
		setLeaseToken(null);
		setLayoutDirty(false);
		setGraphDirty(false);
		graphDraftRef.current = null;
		setGraphDraft(null);
		setState("view");
		onReleaseLayout();
		setFeedback(message);
	}

	async function finish() {
		await release("Edição encerrada sem alterações publicadas.");
	}

	async function discard() {
		await release("Rascunho descartado. O Mundo publicado foi mantido.");
	}

	return {
		state,
		editing,
		busy,
		hasChanges,
		graphDraft,
		feedback,
		busyNotice,
		start,
		publish,
		finish,
		discard,
		updateLayoutDraft,
		updateGraphDraft,
		reportFailure: (reason: string) => setFeedback(worldEditFailureMessage(reason)),
	} as const;
}
