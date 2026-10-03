"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorldLayout } from "../constellation-layout";
import { firstWorldGraphDraftValidationIssue } from "../graph-validation";
import type { WorldGraphDraft, WorldLayoutProjection } from "../model";
import {
	acquireWorldGraphDraftAction,
	publishWorldEditStateAction,
	saveWorldGraphDraftAction,
} from "../world-graph-actions";
import { publishWorldEditLayoutAction } from "../world-edit-actions";
import { worldEditLeaseStorageKey } from "../world-campaign";
import { worldPublicationVersionLabel } from "../world-publication";
import {
	acquireWorldLayoutSessionAction,
	discardWorldLayoutSessionAction,
	releaseWorldLayoutSessionAction,
	renewWorldLayoutSessionAction,
	saveWorldLayoutSessionDraftAction,
} from "../world-layout-session-actions";
import {
	worldDraftSaveFailureMessage,
	worldEditFailureMessage,
	worldLayoutPositionsEqual,
	worldPublishFailureMessage,
} from "./world-edit-session-model";

const WORLD_EDIT_HEARTBEAT_MS = 20_000;
const WORLD_EDIT_DRAFT_DEBOUNCE_MS = 500;
const WORLD_EDIT_DRAFT_SAFETY_FLUSH_MS = 10_000;
const WORLD_BUSY_NOTICE_MS = 5_000;

type WorldEditState = "view" | "acquiring" | "editing" | "publishing";
type WorldTerminalAction = "finish" | "discard";
type LayoutDraftResult = Awaited<ReturnType<typeof saveWorldLayoutSessionDraftAction>>;
type GraphDraftResult = Awaited<ReturnType<typeof saveWorldGraphDraftAction>>;

type UseWorldEditSessionOptions = Readonly<{
	campaignSlug: string;
	canEditLayout: boolean;
	canEditContent: boolean;
	canStartEditing: boolean;
	publishedPositions: WorldLayout;
	buildLayoutCandidate: (
		graphDraft: WorldGraphDraft | null,
	) => WorldLayoutProjection | null | undefined;
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
	campaignSlug,
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
	const leaseStorageKey = worldEditLeaseStorageKey(campaignSlug);
	const [state, setState] = useState<WorldEditState>("view");
	const [leaseToken, setLeaseToken] = useState<string | null>(null);
	const [layoutDirty, setLayoutDirty] = useState(false);
	const [graphDraft, setGraphDraft] = useState<WorldGraphDraft | null>(null);
	const graphDraftRef = useRef<WorldGraphDraft | null>(null);
	const [graphDirty, setGraphDirty] = useState(false);
	const [feedback, setFeedback] = useState<string | null>(null);
	const [busyNotice, setBusyNotice] = useState<string | null>(null);
	const [terminalAction, setTerminalAction] = useState<WorldTerminalAction | null>(null);
	const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
	const terminalActionRef = useRef<WorldTerminalAction | null>(null);
	const layoutDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const graphDraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const draftSafetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sessionSequence = useRef(0);
	const layoutSaveSequence = useRef(0);
	const graphSaveSequence = useRef(0);
	const saveFailureRef = useRef<{ layout: string | null; graph: string | null }>({
		layout: null,
		graph: null,
	});
	const saveQueue = useRef<Promise<void>>(Promise.resolve());

	const editing = state === "editing" || state === "publishing";
	const busy =
		state === "acquiring" || state === "publishing" || terminalAction !== null;
	const hasChanges = layoutDirty || graphDirty;

	useEffect(() => {
		graphDraftRef.current = graphDraft;
	}, [graphDraft]);

	useEffect(() => {
		if (state !== "editing" || !hasChanges) return;
		const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warnBeforeLeaving);
		return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
	}, [hasChanges, state]);

	const markLeaseLost = useCallback((reason: string) => {
		sessionSequence.current += 1;
		layoutSaveSequence.current += 1;
		graphSaveSequence.current += 1;
		if (layoutDraftTimer.current) clearTimeout(layoutDraftTimer.current);
		if (graphDraftTimer.current) clearTimeout(graphDraftTimer.current);
		if (draftSafetyTimer.current) clearTimeout(draftSafetyTimer.current);
		layoutDraftTimer.current = null;
		graphDraftTimer.current = null;
		draftSafetyTimer.current = null;
		setState("view");
		setLeaseToken(null);
		setDiscardConfirmationOpen(false);
		window.sessionStorage.removeItem(leaseStorageKey);
		setFeedback(worldEditFailureMessage(reason));
	}, [leaseStorageKey]);

	useEffect(() => {
		if (state !== "editing" || !leaseToken) return;
		let cancelled = false;
		const heartbeat = window.setInterval(() => {
			void renewWorldLayoutSessionAction(campaignSlug, leaseToken).then((result) => {
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
	}, [state, leaseToken, campaignSlug, markLeaseLost]);

	useEffect(
		() => () => {
			if (layoutDraftTimer.current) clearTimeout(layoutDraftTimer.current);
			if (graphDraftTimer.current) clearTimeout(graphDraftTimer.current);
			if (draftSafetyTimer.current) clearTimeout(draftSafetyTimer.current);
			if (busyTimer.current) clearTimeout(busyTimer.current);
		},
		[],
	);

	function showBusyNotice(message: string) {
		setBusyNotice(message);
		if (busyTimer.current) clearTimeout(busyTimer.current);
		busyTimer.current = setTimeout(() => setBusyNotice(null), WORLD_BUSY_NOTICE_MS);
	}

	function setDraftSaveFailure(kind: "layout" | "graph", message: string) {
		saveFailureRef.current = { ...saveFailureRef.current, [kind]: message };
		setFeedback(message);
	}

	function clearDraftSaveFailure(kind: "layout" | "graph", successMessage: string) {
		saveFailureRef.current = { ...saveFailureRef.current, [kind]: null };
		setFeedback(
			saveFailureRef.current.graph ??
				saveFailureRef.current.layout ??
				successMessage,
		);
	}

	function graphValidationSaveMessage(draft: WorldGraphDraft): string | null {
		const validationIssue = firstWorldGraphDraftValidationIssue(draft);
		return validationIssue
			? `Não foi possível salvar esta alteração: ${validationIssue.message} O último checkpoint válido continua preservado.`
			: null;
	}

	function graphValidationPublishMessage(draft: WorldGraphDraft): string | null {
		const validationIssue = firstWorldGraphDraftValidationIssue(draft);
		return validationIssue
			? `A publicação não aconteceu: ${validationIssue.message} Corrija esse campo; o último checkpoint válido continua preservado.`
			: null;
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
				return await saveWorldLayoutSessionDraftAction(campaignSlug, token, candidate);
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
				return await saveWorldGraphDraftAction(campaignSlug, token, draft);
			} catch {
				return { ok: false, reason: "dependency_unavailable" } as const;
			}
		});
	}

	function scheduleSafetyDraftFlush() {
		if (state !== "editing" || !leaseToken || draftSafetyTimer.current) return;
		draftSafetyTimer.current = setTimeout(() => {
			draftSafetyTimer.current = null;
			if (state !== "editing") return;
			const latestGraph = graphDraftRef.current;
			const layoutCandidate = buildLayoutCandidate(latestGraph);
			if (!layoutCandidate) {
				setDraftSaveFailure("layout", worldDraftSaveFailureMessage("invalid_payload"));
				return;
			}
			const sequence = sessionSequence.current;
			void queueLayoutDraftRequest(leaseToken, layoutCandidate).then(async (layoutResult) => {
				if (sequence !== sessionSequence.current) return;
				if (!layoutResult.ok) {
					if (layoutResult.reason === "lease_lost" || layoutResult.reason === "forbidden") {
						markLeaseLost(layoutResult.reason);
					} else {
						setDraftSaveFailure("layout", worldDraftSaveFailureMessage(layoutResult.reason));
					}
					return;
				}
				clearDraftSaveFailure("layout", "Checkpoint de segurança do layout confirmado.");

				if (canEditContent && latestGraph) {
					const validationMessage = graphValidationSaveMessage(latestGraph);
					if (validationMessage) {
						setDraftSaveFailure("graph", validationMessage);
						return;
					}
					const graphResult = await queueGraphDraftRequest(leaseToken, latestGraph);
					if (sequence !== sessionSequence.current) return;
					if (!graphResult.ok) {
						if (graphResult.reason === "lease_lost" || graphResult.reason === "forbidden") {
							markLeaseLost(graphResult.reason);
						} else {
							setDraftSaveFailure("graph", worldDraftSaveFailureMessage(graphResult.reason));
						}
						return;
					}
					clearDraftSaveFailure("graph", "Checkpoint de segurança confirmado. Seu rascunho está preservado.");
					return;
				}
				clearDraftSaveFailure("layout", "Checkpoint de segurança confirmado. Seu rascunho está preservado.");
			});
		}, WORLD_EDIT_DRAFT_SAFETY_FLUSH_MS);
	}

	function scheduleLayoutDraftSave(
		candidate: WorldLayoutProjection,
		pendingMessage = "Alterações locais — salvando rascunho…",
	) {
		if (state !== "editing" || !leaseToken) return;
		if (layoutDraftTimer.current) clearTimeout(layoutDraftTimer.current);
		const sequence = ++layoutSaveSequence.current;
		setFeedback(saveFailureRef.current.graph ?? pendingMessage);
		scheduleSafetyDraftFlush();
		layoutDraftTimer.current = setTimeout(() => {
			layoutDraftTimer.current = null;
			void queueLayoutDraftRequest(leaseToken, candidate).then((result) => {
				if (sequence !== layoutSaveSequence.current) return;
				if (result.ok) {
					clearDraftSaveFailure(
						"layout",
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
				setDraftSaveFailure("layout", worldDraftSaveFailureMessage(result.reason));
			});
		}, WORLD_EDIT_DRAFT_DEBOUNCE_MS);
	}

	function scheduleGraphDraftSave(
		draft: WorldGraphDraft,
		pendingMessage = "Alterações no Mundo — salvando rascunho…",
	) {
		if (!canEditContent || state !== "editing" || !leaseToken) return;
		if (graphDraftTimer.current) clearTimeout(graphDraftTimer.current);
		const sequence = ++graphSaveSequence.current;
		setFeedback(saveFailureRef.current.layout ?? pendingMessage);
		scheduleSafetyDraftFlush();
		graphDraftTimer.current = setTimeout(() => {
			graphDraftTimer.current = null;
			const validationMessage = graphValidationSaveMessage(draft);
			if (validationMessage) {
				if (sequence === graphSaveSequence.current) {
					setDraftSaveFailure("graph", validationMessage);
				}
				return;
			}
			void queueGraphDraftRequest(leaseToken, draft).then((result) => {
				if (sequence !== graphSaveSequence.current) return;
				if (result.ok) {
					clearDraftSaveFailure(
						"graph",
						"Rascunho salvo. Só você vê estas alterações até publicar.",
					);
					return;
				}
				if (result.reason === "lease_lost" || result.reason === "forbidden") {
					markLeaseLost(result.reason);
					return;
				}
				setDraftSaveFailure("graph", worldDraftSaveFailureMessage(result.reason));
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
		let token = window.sessionStorage.getItem(leaseStorageKey);
		if (!token) {
			token = crypto.randomUUID();
			window.sessionStorage.setItem(leaseStorageKey, token);
		}

		const result = await acquireWorldLayoutSessionAction(campaignSlug, token);
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
			window.sessionStorage.removeItem(leaseStorageKey);
			setFeedback(worldEditFailureMessage(result.reason));
			return;
		}

		let acquiredGraph: WorldGraphDraft | null = null;
		if (canEditContent) {
			const graphResult = await acquireWorldGraphDraftAction(campaignSlug, token);
			if (!graphResult.ok) {
				await releaseWorldLayoutSessionAction(campaignSlug, token);
				window.sessionStorage.removeItem(leaseStorageKey);
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
			result.previousPublishConfirmed
				? result.previousPublishedGraphRevision !== undefined
					? `A publicação anterior foi confirmada pelo servidor · revisão ${result.previousPublishedGraphRevision}. Esta sessão começou do estado publicado.`
					: `A publicação anterior foi confirmada pelo servidor · revisão de layout ${result.previousPublishedLayoutRevision ?? result.draft.revision}. Esta sessão começou do estado publicado.`
				: result.staleRecovery
					? result.status === "recovered"
						? "Rascunho anterior recuperado, mas o Mundo publicado mudou desde a base dele. O trabalho foi preservado para revisão; a publicação continuará bloqueada por conflito até essa diferença ser reconciliada."
						: "Existe um rascunho anterior preservado, mas o Mundo publicado mudou desde então. Ele não foi aplicado automaticamente; esta sessão começou do estado publicado atual."
					: result.status === "acquired"
						? canEditContent
							? "Edição exclusiva ativa. Crie, conecte, organize e revise o Mundo; cada alteração confirmada fica preservada até publicar."
							: "Edição exclusiva ativa. Cada alteração de posição confirmada fica preservada até publicar."
						: result.recoverySource === "durable"
							? "Rascunho durável recuperado de uma sessão anterior. Revise antes de publicar."
							: "Rascunho de edição recuperado. Revise antes de publicar.",
		);
	}

	function cancelPendingDraftSaves() {
		layoutSaveSequence.current += 1;
		graphSaveSequence.current += 1;
		if (layoutDraftTimer.current) {
			clearTimeout(layoutDraftTimer.current);
			layoutDraftTimer.current = null;
		}
		if (graphDraftTimer.current) {
			clearTimeout(graphDraftTimer.current);
			graphDraftTimer.current = null;
		}
		if (draftSafetyTimer.current) {
			clearTimeout(draftSafetyTimer.current);
			draftSafetyTimer.current = null;
		}
	}

	function completePublishedEdit(message: string) {
		sessionSequence.current += 1;
		saveFailureRef.current = { layout: null, graph: null };
		window.sessionStorage.removeItem(leaseStorageKey);
		setLeaseToken(null);
		setDiscardConfirmationOpen(false);
		setLayoutDirty(false);
		setGraphDirty(false);
		graphDraftRef.current = null;
		setGraphDraft(null);
		setState("view");
		setFeedback(message);
		onPublished();
	}

	async function publish() {
		if (
			state !== "editing" ||
			!leaseToken ||
			!hasChanges ||
			terminalActionRef.current !== null
		)
			return;
		cancelPendingDraftSaves();
		const sequence = sessionSequence.current;
		setState("publishing");
		setFeedback("Validando o rascunho mais recente…");

		if (canEditContent && graphDraftRef.current) {
			const validationMessage = graphValidationPublishMessage(graphDraftRef.current);
			if (validationMessage) {
				setState("editing");
				setDraftSaveFailure("graph", validationMessage);
				return;
			}
		}

		const layoutCandidate = buildLayoutCandidate(graphDraftRef.current);
		if (!layoutCandidate) {
			setState("editing");
			setFeedback(worldPublishFailureMessage("invalid_payload"));
			return;
		}
		const layoutResult = await queueLayoutDraftRequest(leaseToken, layoutCandidate);
		if (sequence !== sessionSequence.current) return;
		if (!layoutResult.ok) {
			if (layoutResult.reason === "lease_lost" || layoutResult.reason === "forbidden") {
				markLeaseLost(layoutResult.reason);
			} else {
				setState("editing");
				setFeedback(worldPublishFailureMessage(layoutResult.reason));
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
			if (sequence !== sessionSequence.current) return;
			if (!graphResult.ok) {
				if (graphResult.reason === "lease_lost" || graphResult.reason === "forbidden") {
					markLeaseLost(graphResult.reason);
				} else {
					setState("editing");
					setFeedback(worldPublishFailureMessage(graphResult.reason));
				}
				return;
			}

			setFeedback("Publicando o Mundo com as visibilidades configuradas…");
			const publishResult = await publishWorldEditStateAction(campaignSlug, leaseToken);
			if (sequence !== sessionSequence.current) return;
			if (!publishResult.ok) {
				if (publishResult.reason === "lease_lost" || publishResult.reason === "forbidden") {
					markLeaseLost(publishResult.reason);
				} else {
					setState("editing");
					setFeedback(worldPublishFailureMessage(publishResult.reason));
				}
				return;
			}
			const publishedVersion =
				publishResult.graphRevision !== undefined && publishResult.layoutRevision !== undefined
					? worldPublicationVersionLabel({
							graphRevision: publishResult.graphRevision,
							layoutRevision: publishResult.layoutRevision,
						})
					: null;
			completePublishedEdit(
				publishResult.status === "unchanged"
					? `Publicação confirmada. Nenhuma alteração nova era necessária${publishedVersion ? ` · ${publishedVersion}` : ""}.`
					: `Mundo publicado com sucesso${publishedVersion ? ` · ${publishedVersion}` : ""}. Cada pessoa vê somente o que sua visibilidade permite.`,
			);
			return;
		}

		setFeedback("Publicando composição para todos…");
		const publishResult = await publishWorldEditLayoutAction(campaignSlug, leaseToken);
		if (sequence !== sessionSequence.current) return;
		if (!publishResult.ok) {
			if (publishResult.reason === "lease_lost" || publishResult.reason === "forbidden") {
				markLeaseLost(publishResult.reason);
			} else {
				setState("editing");
				setFeedback(worldPublishFailureMessage(publishResult.reason));
			}
			return;
		}
		completePublishedEdit(
			publishResult.status === "unchanged"
				? `Publicação confirmada. Nenhuma mudança de layout era necessária · revisão ${publishResult.revision}.`
				: `Composição publicada com sucesso · revisão ${publishResult.revision}.`,
		);
	}

	async function release(message: string) {
		if (!leaseToken || state !== "editing") return;
		cancelPendingDraftSaves();
		const sequence = sessionSequence.current;

		if (hasChanges) {
			setFeedback("Salvando um checkpoint final antes de encerrar a edição…");
			const layoutCandidate = buildLayoutCandidate(graphDraftRef.current);
			if (!layoutCandidate) {
				setFeedback(worldDraftSaveFailureMessage("invalid_payload"));
				return;
			}

			const layoutResult = await queueLayoutDraftRequest(leaseToken, layoutCandidate);
			if (sequence !== sessionSequence.current) return;
			if (!layoutResult.ok) {
				if (layoutResult.reason === "lease_lost" || layoutResult.reason === "forbidden") {
					markLeaseLost(layoutResult.reason);
				} else {
					setFeedback(worldDraftSaveFailureMessage(layoutResult.reason));
				}
				return;
			}

			if (canEditContent && graphDraftRef.current) {
				const validationMessage = graphValidationSaveMessage(graphDraftRef.current);
				if (validationMessage) {
					setDraftSaveFailure("graph", validationMessage);
					return;
				}
				const graphResult = await queueGraphDraftRequest(leaseToken, graphDraftRef.current);
				if (sequence !== sessionSequence.current) return;
				if (!graphResult.ok) {
					if (graphResult.reason === "lease_lost" || graphResult.reason === "forbidden") {
						markLeaseLost(graphResult.reason);
					} else {
						setFeedback(worldDraftSaveFailureMessage(graphResult.reason));
					}
					return;
				}
			}
		}

		await saveQueue.current;
		if (sequence !== sessionSequence.current) return;
		setFeedback("Encerrando a sessão de edição…");
		const result = await releaseWorldLayoutSessionAction(campaignSlug, leaseToken);
		if (!result.ok) {
			setFeedback(worldEditFailureMessage(result.reason));
			return;
		}
		sessionSequence.current += 1;
		saveFailureRef.current = { layout: null, graph: null };
		window.sessionStorage.removeItem(leaseStorageKey);
		setLeaseToken(null);
		setLayoutDirty(false);
		setGraphDirty(false);
		graphDraftRef.current = null;
		setGraphDraft(null);
		setState("view");
		onReleaseLayout();
		setFeedback(message);
	}

	function beginTerminalAction(action: WorldTerminalAction): boolean {
		if (terminalActionRef.current !== null) return false;
		terminalActionRef.current = action;
		setTerminalAction(action);
		return true;
	}

	function endTerminalAction(action: WorldTerminalAction) {
		if (terminalActionRef.current !== action) return;
		terminalActionRef.current = null;
		setTerminalAction(null);
	}

	async function finish() {
		if (!beginTerminalAction("finish")) return;
		try {
			await release("Edição encerrada sem publicar. O rascunho confirmado foi preservado.");
		} finally {
			endTerminalAction("finish");
		}
	}

	function discard() {
		if (!leaseToken || state !== "editing" || terminalActionRef.current !== null) return;
		setDiscardConfirmationOpen(true);
	}

	function cancelDiscard() {
		if (terminalActionRef.current !== null) return;
		setDiscardConfirmationOpen(false);
	}

	async function confirmDiscard() {
		if (!leaseToken || state !== "editing" || terminalActionRef.current !== null) {
			setDiscardConfirmationOpen(false);
			return;
		}
		setDiscardConfirmationOpen(false);
		if (!beginTerminalAction("discard")) return;

		try {
			cancelPendingDraftSaves();
			const sequence = sessionSequence.current;
			setFeedback("Preservando uma cópia final antes de descartar o rascunho…");

			const layoutCandidate = buildLayoutCandidate(graphDraftRef.current);
			if (!layoutCandidate) {
				setFeedback(worldDraftSaveFailureMessage("invalid_payload"));
				return;
			}
			const layoutResult = await queueLayoutDraftRequest(leaseToken, layoutCandidate);
			if (sequence !== sessionSequence.current) return;
			if (!layoutResult.ok) {
				if (
					layoutResult.reason === "lease_lost" ||
					layoutResult.reason === "forbidden"
				) {
					markLeaseLost(layoutResult.reason);
				} else {
					setFeedback(worldDraftSaveFailureMessage(layoutResult.reason));
				}
				return;
			}

			if (canEditContent && graphDraftRef.current) {
				const validationMessage = graphValidationSaveMessage(graphDraftRef.current);
				const graphResult = validationMessage
					? null
					: await queueGraphDraftRequest(leaseToken, graphDraftRef.current);
				if (sequence !== sessionSequence.current) return;
				if (graphResult && !graphResult.ok) {
					if (
						graphResult.reason === "lease_lost" ||
						graphResult.reason === "forbidden"
					) {
						markLeaseLost(graphResult.reason);
					} else {
						setFeedback(worldDraftSaveFailureMessage(graphResult.reason));
					}
					return;
				}
			}

			await saveQueue.current;
			const result = await discardWorldLayoutSessionAction(campaignSlug, leaseToken);
			if (!result.ok) {
				setFeedback(worldEditFailureMessage(result.reason));
				return;
			}
			sessionSequence.current += 1;
			saveFailureRef.current = { layout: null, graph: null };
			window.sessionStorage.removeItem(leaseStorageKey);
			setLeaseToken(null);
			setLayoutDirty(false);
			setGraphDirty(false);
			graphDraftRef.current = null;
			setGraphDraft(null);
			setState("view");
			onReleaseLayout();
			setFeedback(
				"Rascunho descartado. O Mundo publicado foi mantido e uma cópia de recuperação foi preservada.",
			);
		} finally {
			endTerminalAction("discard");
		}
	}

	return {
		state,
		editing,
		busy,
		terminalAction,
		discardConfirmationOpen,
		hasChanges,
		graphDraft,
		feedback,
		busyNotice,
		start,
		publish,
		finish,
		discard,
		cancelDiscard,
		confirmDiscard,
		updateLayoutDraft,
		updateGraphDraft,
		reportFailure: (reason: string) => setFeedback(worldEditFailureMessage(reason)),
	} as const;
}
