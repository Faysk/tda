"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { actionStyles, Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import { wallClockPresentation } from "../../transcript-review/time-contract";
import { TranscriptMarkdownRoundTrip } from "../../transcript-review/local-review-markdown-roundtrip";
import {
	applySessionAssemblyMarkdownImport,
	sessionAssemblyMarkdownBase,
	sessionAssemblyMarkdownSegments,
} from "../../transcript-review/session-assembly-markdown";
import type { LocalBridge } from "./bridge";
import { BridgeError } from "./protocol";
import type {
	SessionAssembly,
	SessionAssemblyReviewSegment,
	SessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import {
	publishApprovedSessionAssemblyReview,
	readCurrentSessionAssemblyPublication,
} from "./session-assembly-publication-client";
import {
	PublicationClientError,
	type PublicationReceiptView,
} from "./publication-client";
import styles from "./session-assembly-review.module.css";

const PAGE_SIZE = 60;
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type PendingPublication = Readonly<{
	schemaVersion: "tda_session_assembly_publication_recovery_v1";
	assemblyId: string;
	operationId: string;
	expectedCurrentRevisionId: string | null;
	expectedActorProfileId: string;
	createdAt: string;
}>;

type Props = Readonly<{
	bridge: LocalBridge;
	assembly: SessionAssembly;
	review: SessionAssemblyReviewSummary;
	disabled?: boolean;
	onChange: (review: SessionAssemblyReviewSummary) => void;
	onDirtyChange?: (dirty: boolean) => void;
	onStatus?: (message: string) => void;
}>;

function pendingKey(assemblyId: string): string {
	return "tda.processing.sessionAssemblyPublication.v1:" + assemblyId;
}

function loadPending(assemblyId: string): PendingPublication | null {
	try {
		const raw = window.localStorage.getItem(pendingKey(assemblyId));
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<PendingPublication>;
		if (
			value.schemaVersion !== "tda_session_assembly_publication_recovery_v1" ||
			value.assemblyId !== assemblyId ||
			typeof value.operationId !== "string" ||
			!UUID.test(value.operationId) ||
			(value.expectedCurrentRevisionId !== null &&
				(typeof value.expectedCurrentRevisionId !== "string" ||
					!UUID.test(value.expectedCurrentRevisionId))) ||
			typeof value.expectedActorProfileId !== "string" ||
			!UUID.test(value.expectedActorProfileId) ||
			typeof value.createdAt !== "string" ||
			!Number.isFinite(Date.parse(value.createdAt)) ||
			Date.now() - Date.parse(value.createdAt) > PENDING_TTL_MS
		) {
			window.localStorage.removeItem(pendingKey(assemblyId));
			return null;
		}
		return value as PendingPublication;
	} catch {
		return null;
	}
}

function savePending(value: PendingPublication): boolean {
	try {
		window.localStorage.setItem(
			pendingKey(value.assemblyId),
			JSON.stringify(value),
		);
		return true;
	} catch {
		return false;
	}
}

function clearPending(assemblyId: string) {
	try {
		window.localStorage.removeItem(pendingKey(assemblyId));
	} catch {
		// Recovery metadata is best effort; cloud idempotency remains authoritative.
	}
}

function elapsed(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const rest = whole % 60;
	return [hours, minutes, rest]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}

function errorMessage(cause: unknown): string {
	if (cause instanceof BridgeError) {
		const code = cause.serverCode ?? cause.code;
		if (code === "SESSION_ASSEMBLY_REVIEW_DRAFT_CONFLICT")
			return "A revisão mudou em outra aba ou processo. Sua working copy continua nesta tela; recarregue a base antes de salvar novamente.";
		if (code === "SESSION_ASSEMBLY_REVIEW_APPROVAL_BLOCKED")
			return "A aprovação está bloqueada por uma ambiguidade ainda não resolvida na sessão.";
		return "O Companion recusou a revisão local · " + code;
	}
	if (cause instanceof PublicationClientError) {
		return {
			unauthenticated:
				"Sua sessão Web expirou. Entre novamente antes do handoff.",
			forbidden: "Seu acesso não permite preparar esta transcrição privada.",
			publish_capability_undefined:
				"O handoff privado ainda não está ativado para esta campanha.",
			approved_review_required:
				"A revisão precisa estar salva e aprovada localmente antes do handoff.",
			invalid_payload:
				"O contrato da Assembly não passou na validação do handoff.",
			too_large: "A revisão excede o limite aceito pelo handoff privado.",
			not_found: "A sessão de destino não foi localizada no escopo autorizado.",
			conflict: "O recibo retornado não corresponde à Assembly aprovada.",
			stale_current:
				"A revisão privada atual mudou na nuvem. Reconfirme o estado antes de tentar novamente.",
			dependency_unavailable:
				"O serviço de handoff está indisponível e não confirmou alteração.",
			unconfirmed:
				"O serviço não confirmou o envio. A operação foi preservada; tentar novamente reutilizará a mesma identidade.",
		}[cause.code];
	}
	if (cause instanceof Error && cause.message === "STORAGE_UNAVAILABLE")
		return "Não foi possível preservar a identidade do handoff neste navegador.";
	return "Não foi possível concluir esta etapa. A revisão local foi preservada.";
}

function statusTone(review: SessionAssemblyReviewSummary) {
	return review.approvalCurrent
		? ("success" as const)
		: review.status === "reviewed"
			? ("accent" as const)
			: ("neutral" as const);
}

export function SessionAssemblyReview({
	bridge,
	assembly,
	review,
	disabled = false,
	onChange,
	onDirtyChange,
	onStatus,
}: Props) {
	const [baseline, setBaseline] = useState(review);
	const [segments, setSegments] = useState<SessionAssemblyReviewSegment[]>(() =>
		review.segments.map((segment) => ({ ...segment })),
	);
	const [dirty, setDirty] = useState(false);
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);
	const [editingDraft, setEditingDraft] = useState<Readonly<{
		assemblySegmentId: string;
		speaker: string;
		text: string;
	}> | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [receipt, setReceipt] = useState<PublicationReceiptView | null>(null);
	const [pending, setPending] = useState<PendingPublication | null>(null);
	const appliedReviewIdentity = useRef<string | null>(null);

	useEffect(() => {
		const reviewIdentity = [
			review.assemblyId,
			review.baseTranscriptSha256,
			review.persistence,
			review.draftRevision ?? "base",
			review.draftSha256 ?? "base",
			review.status,
			review.approvalCurrent ? "approved" : "current",
		].join(":");
		if (appliedReviewIdentity.current === reviewIdentity) return;
		appliedReviewIdentity.current = reviewIdentity;
		setBaseline(review);
		setSegments(review.segments.map((segment) => ({ ...segment })));
		setDirty(false);
		setPage(0);
		setEditingDraft(null);
		setReceipt(null);
		setPending(loadPending(review.assemblyId));
	}, [review]);

	useEffect(() => {
		onDirtyChange?.(dirty || editingDraft !== null);
	}, [dirty, editingDraft, onDirtyChange]);

	useEffect(
		() => () => {
			onDirtyChange?.(false);
		},
		[onDirtyChange],
	);

	const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
	const matches = useMemo(
		() =>
			segments.filter((segment) => {
				if (!normalizedQuery) return true;
				return (
					segment.speaker
						.toLocaleLowerCase("pt-BR")
						.includes(normalizedQuery) ||
					segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
					segment.sourceId.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
				);
			}),
		[normalizedQuery, segments],
	);
	const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
	const safePage = Math.min(page, pageCount - 1);
	const pageStart = safePage * PAGE_SIZE;
	const visible = matches.slice(pageStart, pageStart + PAGE_SIZE);
	const pageEnd = pageStart + visible.length;

	useEffect(() => {
		if (page !== safePage) setPage(safePage);
	}, [page, safePage]);

	const canApprove =
		!disabled &&
		!busy &&
		!dirty &&
		editingDraft === null &&
		baseline.persistence === "persisted" &&
		baseline.status !== "approved_local" &&
		!baseline.approvalBlocked;
	const canPublish =
		!disabled &&
		!busy &&
		!dirty &&
		editingDraft === null &&
		baseline.persistence === "persisted" &&
		baseline.status === "approved_local" &&
		baseline.approvalCurrent;

	function focusSegmentTrigger(assemblySegmentId: string) {
		window.requestAnimationFrame(() => {
			const trigger = [
				...document.querySelectorAll<HTMLButtonElement>(
					"[data-assembly-segment-trigger]",
				),
			].find(
				(element) =>
					element.dataset.assemblySegmentTrigger === assemblySegmentId,
			);
			trigger?.focus();
		});
	}

	function openSegmentEditor(segment: SessionAssemblyReviewSegment) {
		setEditingDraft({
			assemblySegmentId: segment.assemblySegmentId,
			speaker: segment.speaker,
			text: segment.text,
		});
	}

	function cancelSegmentEditor(assemblySegmentId: string) {
		setEditingDraft(null);
		focusSegmentTrigger(assemblySegmentId);
	}

	function applySegmentEditor(segment: SessionAssemblyReviewSegment) {
		if (
			!editingDraft ||
			editingDraft.assemblySegmentId !== segment.assemblySegmentId
		)
			return;
		const changed =
			editingDraft.speaker !== segment.speaker ||
			editingDraft.text !== segment.text;
		if (changed) {
			setSegments((current) => {
				const index = current.findIndex(
					(item) => item.assemblySegmentId === segment.assemblySegmentId,
				);
				if (index < 0) return current;
				const currentSegment = current[index];
				if (!currentSegment) return current;
				const next = [...current];
				next[index] = {
					...currentSegment,
					speaker: editingDraft.speaker,
					text: editingDraft.text,
					reviewed: true,
				};
				return next;
			});
			setDirty(true);
			setReceipt(null);
		}
		setEditingDraft(null);
		focusSegmentTrigger(segment.assemblySegmentId);
	}

	function changePage(nextPage: number) {
		setEditingDraft(null);
		setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
		window.requestAnimationFrame(() => {
			const viewport = document.querySelector<HTMLElement>(
				"[data-assembly-transcript-viewport='true']",
			);
			if (viewport) viewport.scrollTop = 0;
		});
	}

	function applySaved(next: SessionAssemblyReviewSummary, message: string) {
		setBaseline(next);
		setSegments(next.segments.map((segment) => ({ ...segment })));
		setDirty(false);
		setError(null);
		onChange(next);
		onStatus?.(message);
	}

	async function save(status: "reviewed" | "approved_local") {
		if (busy || disabled) return;
		setBusy(true);
		setError(null);
		const controller = new AbortController();
		try {
			const next = await bridge.saveSessionAssemblyReview(
				assembly.campaignId,
				assembly.sessionId,
				assembly.assemblyId,
				baseline,
				status,
				segments,
				controller.signal,
			);
			applySaved(
				next,
				status === "approved_local"
					? "Revisão da sessão aprovada localmente."
					: "Revisão da sessão salva no Companion.",
			);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	}

	async function publish() {
		if (!canPublish) return;
		setBusy(true);
		setError(null);
		try {
			let recovery = loadPending(assembly.assemblyId);
			if (!recovery) {
				const current = await readCurrentSessionAssemblyPublication(assembly);
				recovery = {
					schemaVersion: "tda_session_assembly_publication_recovery_v1",
					assemblyId: assembly.assemblyId,
					operationId: crypto.randomUUID(),
					expectedCurrentRevisionId: current.revisionId,
					expectedActorProfileId: current.actorProfileId,
					createdAt: new Date().toISOString(),
				};
				if (!savePending(recovery)) throw new Error("STORAGE_UNAVAILABLE");
			}
			setPending(recovery);
			const committed = await publishApprovedSessionAssemblyReview(
				assembly,
				baseline,
				recovery.operationId,
				recovery.expectedCurrentRevisionId,
				fetch,
				recovery.expectedActorProfileId,
			);
			clearPending(assembly.assemblyId);
			setPending(null);
			setReceipt(committed);
			onStatus?.("Transcrição privada preparada no Edit.");
		} catch (cause) {
			if (
				cause instanceof PublicationClientError &&
				cause.code === "stale_current"
			) {
				clearPending(assembly.assemblyId);
				setPending(null);
			}
			setError(errorMessage(cause));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section
			className={styles.review}
			aria-label="Revisão da transcrição da sessão"
		>
			<header className={styles.header}>
				<div>
					<span className={styles.eyebrow}>Revisão contínua</span>
					<h3 data-assembly-review-focus-target="true" tabIndex={-1}>
						Transcrição da sessão
					</h3>
					<p>
						{baseline.segmentCount.toLocaleString("pt-BR")} falas ·{" "}
						{baseline.reviewedSegments.toLocaleString("pt-BR")} revisadas
					</p>
				</div>
				<div className={styles.headerActions}>
					<StatusPill tone={statusTone(baseline)}>
						{baseline.approvalCurrent
							? "Aprovado"
							: baseline.status === "reviewed"
								? "Revisado"
								: "Rascunho"}
					</StatusPill>
					{receipt ? (
						<>
							<a
								className={actionStyles({ size: "sm", variant: "primary" })}
								href={`/edit/${encodeURIComponent(assembly.campaignId)}/sessoes`}
							>
								Ver sessões no Edit
							</a>
							<a
								data-handoff-success-link="true"
								className={actionStyles({ size: "sm", variant: "secondary" })}
								href={`/edit/${encodeURIComponent(assembly.campaignId)}/sessoes/${encodeURIComponent(assembly.sessionId)}`}
							>
								Abrir sessão no Edit
							</a>
						</>
					) : dirty ? (
						<Button
							size="sm"
							variant="primary"
							disabled={busy || disabled || editingDraft !== null}
							onClick={() => void save("reviewed")}
						>
							{busy ? "Salvando…" : "Salvar alterações"}
						</Button>
					) : baseline.persistence !== "persisted" ? (
						<Button
							size="sm"
							variant="primary"
							disabled={busy || disabled || editingDraft !== null}
							onClick={() => void save("reviewed")}
						>
							{busy ? "Salvando…" : "Concluir revisão"}
						</Button>
					) : canApprove ? (
						<Button
							size="sm"
							variant="primary"
							onClick={() => void save("approved_local")}
						>
							Aprovar revisão
						</Button>
					) : canPublish ? (
						<Button
							data-handoff-trigger="prepare"
							size="sm"
							variant="primary"
							onClick={() => void publish()}
						>
							{pending
								? "Confirmar handoff pendente"
								: "Preparar sessão no Edit"}
						</Button>
					) : null}
				</div>
			</header>
			<p className={styles.notice}>
				Clique em uma fala para corrigir o texto ou participante. Ao terminar,
				conclua a revisão e aprove antes de enviar para edição.
			</p>

			<div className={styles.tools}>
				<label>
					<span>Buscar na transcrição</span>
					<input
						type="search"
						value={query}
						onChange={(event) => {
							setQuery(event.currentTarget.value);
							setPage(0);
							setEditingDraft(null);
						}}
						disabled={editingDraft !== null}
						placeholder="Participante, texto ou origem"
					/>
				</label>
				<TranscriptMarkdownRoundTrip
					base={sessionAssemblyMarkdownBase(assembly, baseline)}
					segments={sessionAssemblyMarkdownSegments(segments)}
					title={assembly.sessionId}
					fileIdentity={assembly.sessionId}
					dirty={dirty}
					disabled={disabled || busy || editingDraft !== null}
					onApply={(result) => {
						setSegments((current) => [
							...applySessionAssemblyMarkdownImport(current, result),
						]);
						setDirty(true);
						setReceipt(null);
					}}
				/>
			</div>

			{pending && !receipt ? (
				<p className={styles.notice} role="status">
					Há um handoff com identidade preservada. A próxima tentativa reutiliza
					a mesma operação em vez de criar outra revisão.
				</p>
			) : null}
			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}

			<div className={styles.summary}>
				<strong>
					{matches.length.toLocaleString("pt-BR")} falas encontradas
				</strong>
				<span>
					{matches.length
						? `${(pageStart + 1).toLocaleString("pt-BR")}–${pageEnd.toLocaleString("pt-BR")} de ${matches.length.toLocaleString("pt-BR")}`
						: "Nenhuma fala corresponde à busca."}
				</span>
			</div>

			{pageCount > 1 ? (
				<nav
					className={styles.pagination}
					aria-label="Navegação da transcrição"
				>
					<Button
						type="button"
						size="sm"
						variant="tertiary"
						disabled={safePage === 0 || editingDraft !== null}
						onClick={() => changePage(safePage - 1)}
					>
						Anterior
					</Button>
					<span>
						Página {(safePage + 1).toLocaleString("pt-BR")} de{" "}
						{pageCount.toLocaleString("pt-BR")}
					</span>
					<Button
						type="button"
						size="sm"
						variant="tertiary"
						disabled={safePage >= pageCount - 1 || editingDraft !== null}
						onClick={() => changePage(safePage + 1)}
					>
						Próxima
					</Button>
				</nav>
			) : null}

			<section
				className={styles.transcriptViewport}
				data-assembly-transcript-viewport="true"
				data-page-size={PAGE_SIZE}
				aria-label="Timeline da transcrição"
			>
				{visible.length ? (
					<ol className={styles.segments}>
						{visible.map((segment, index) => {
							const wallClock = segment.absoluteTime
								? wallClockPresentation(segment.absoluteTime.startIso)
								: null;
							const editing =
								editingDraft?.assemblySegmentId === segment.assemblySegmentId;
							return (
								<li
									key={segment.assemblySegmentId}
									data-assembly-segment={segment.assemblySegmentId}
									data-editing={editing ? "true" : "false"}
								>
									<button
										type="button"
										className={styles.segmentRow}
										data-assembly-segment-trigger={segment.assemblySegmentId}
										aria-expanded={editing}
										aria-label={`Editar fala ${pageStart + index + 1} de ${matches.length}: ${segment.speaker}`}
										disabled={
											editingDraft !== null &&
											editingDraft.assemblySegmentId !==
												segment.assemblySegmentId
										}
										onClick={() => {
											if (!editing) openSegmentEditor(segment);
										}}
									>
										<span className={styles.segmentMeta}>
											<span>{elapsed(segment.start)}</span>
											{wallClock ? (
												<time
													dateTime={segment.absoluteTime?.startIso}
													title={wallClock.accessible}
												>
													{wallClock.date} · {wallClock.clock}{" "}
													{wallClock.offset}
												</time>
											) : null}
										</span>
										<strong className={styles.segmentSpeaker}>
											{segment.speaker}
										</strong>
										<span className={styles.segmentText}>{segment.text}</span>
									</button>

									{editing ? (
										<div className={styles.segmentEditor}>
											<div className={styles.editorFields}>
												<label>
													<span>Participante</span>
													<input
														value={editingDraft?.speaker ?? segment.speaker}
														disabled={disabled || busy}
														onChange={(event) => {
															const value = event.currentTarget.value;
															setEditingDraft((current) =>
																current
																	? { ...current, speaker: value }
																	: current,
															);
														}}
													/>
												</label>
												<label>
													<span>Texto</span>
													<textarea
														rows={4}
														value={editingDraft?.text ?? segment.text}
														disabled={disabled || busy}
														onChange={(event) => {
															const value = event.currentTarget.value;
															setEditingDraft((current) =>
																current ? { ...current, text: value } : current,
															);
														}}
													/>
												</label>
											</div>
											<div className={styles.editorFooter}>
												<details>
													<summary>Proveniência</summary>
													<small>
														Part {segment.partId} · source {segment.sourceId} ·
														run {segment.runId} · track {segment.trackNumber} ·
														segmento {segment.sourceSegmentId}
													</small>
												</details>
												<div className={styles.editorActions}>
													<Button
														type="button"
														size="sm"
														variant="tertiary"
														onClick={() =>
															cancelSegmentEditor(segment.assemblySegmentId)
														}
													>
														Cancelar
													</Button>
													<Button
														type="button"
														size="sm"
														variant="secondary"
														onClick={() => applySegmentEditor(segment)}
													>
														Aplicar
													</Button>
												</div>
											</div>
										</div>
									) : null}
								</li>
							);
						})}
					</ol>
				) : (
					<p className={styles.empty}>
						Nenhuma fala corresponde à busca atual.
					</p>
				)}
			</section>
		</section>
	);
}
