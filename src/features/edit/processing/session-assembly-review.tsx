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
import { PublicationClientError, type PublicationReceiptView } from "./publication-client";
import styles from "./session-assembly-review.module.css";

const PAGE_SIZE = 60;
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type PendingPublication = Readonly<{
	schemaVersion: "tda_session_assembly_publication_recovery_v1";
	assemblyId: string;
	operationId: string;
	expectedCurrentRevisionId: string | null;
	expectedActorProfileId: string;
	createdAt: string;
}>;

type SegmentDraft = Readonly<{
	speaker: string;
	text: string;
}>;

type Props = Readonly<{
	bridge: LocalBridge;
	assembly: SessionAssembly;
	review: SessionAssemblyReviewSummary;
	disabled?: boolean;
	onChange: (review: SessionAssemblyReviewSummary) => void;
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
		window.localStorage.setItem(pendingKey(value.assemblyId), JSON.stringify(value));
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
			unauthenticated: "Sua sessão Web expirou. Entre novamente antes do handoff.",
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
				"A resposta se perdeu após o envio. A operação foi preservada; tentar novamente reutilizará a mesma identidade.",
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
	onStatus,
}: Props) {
	const [baseline, setBaseline] = useState(review);
	const [segments, setSegments] = useState<SessionAssemblyReviewSegment[]>(() =>
		review.segments.map((segment) => ({ ...segment })),
	);
	const [dirty, setDirty] = useState(false);
	const [query, setQuery] = useState("");
	const [pageIndex, setPageIndex] = useState(0);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [segmentDraft, setSegmentDraft] = useState<SegmentDraft | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [receipt, setReceipt] = useState<PublicationReceiptView | null>(null);
	const [pending, setPending] = useState<PendingPublication | null>(null);
	const timelineRef = useRef<HTMLOListElement>(null);

	useEffect(() => {
		setBaseline(review);
		setSegments(review.segments.map((segment) => ({ ...segment })));
		setDirty(false);
		setPageIndex(0);
		setEditingId(null);
		setSegmentDraft(null);
		setReceipt(null);
		setPending(loadPending(review.assemblyId));
	}, [review]);

	const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
	const matches = useMemo(
		() =>
			segments.filter((segment) => {
				if (!normalizedQuery) return true;
				return (
					segment.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
					segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
					segment.sourceId.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
				);
			}),
		[normalizedQuery, segments],
	);
	const reviewedCount = useMemo(
		() => segments.filter((segment) => segment.reviewed).length,
		[segments],
	);
	const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
	const page = Math.min(pageIndex, pageCount - 1);
	const visibleStart = page * PAGE_SIZE;
	const visible = matches.slice(visibleStart, visibleStart + PAGE_SIZE);
	const visibleEnd = visibleStart + visible.length;
	const hasOpenSegmentEditor = editingId !== null;
	const canApprove =
		!disabled &&
		!busy &&
		!dirty &&
		!hasOpenSegmentEditor &&
		baseline.persistence === "persisted" &&
		baseline.status !== "approved_local" &&
		!baseline.approvalBlocked;
	const canPublish =
		!disabled &&
		!busy &&
		!dirty &&
		!hasOpenSegmentEditor &&
		baseline.persistence === "persisted" &&
		baseline.status === "approved_local" &&
		baseline.approvalCurrent;

	useEffect(() => {
		setPageIndex(0);
		timelineRef.current?.scrollTo({ top: 0 });
	}, [normalizedQuery]);

	useEffect(() => {
		if (pageIndex >= pageCount) setPageIndex(pageCount - 1);
	}, [pageCount, pageIndex]);

	function focusSegmentTrigger(assemblySegmentId: string) {
		window.requestAnimationFrame(() => {
			document
				.querySelector<HTMLElement>(
					`[data-assembly-edit-trigger="${assemblySegmentId}"]`,
				)
				?.focus();
		});
	}

	function beginEdit(segment: SessionAssemblyReviewSegment) {
		if (disabled || busy) return;
		setEditingId(segment.assemblySegmentId);
		setSegmentDraft({ speaker: segment.speaker, text: segment.text });
		setError(null);
		window.requestAnimationFrame(() => {
			document
				.querySelector<HTMLInputElement>(
					`[data-assembly-speaker-input="${segment.assemblySegmentId}"]`,
				)
				?.focus();
		});
	}

	function cancelEdit() {
		const current = editingId;
		setEditingId(null);
		setSegmentDraft(null);
		if (current) focusSegmentTrigger(current);
	}

	function applyEdit(segment: SessionAssemblyReviewSegment) {
		if (!segmentDraft || disabled || busy) return;
		const changed =
			segmentDraft.speaker !== segment.speaker || segmentDraft.text !== segment.text;
		if (changed) {
			setSegments((current) =>
				current.map((item) =>
					item.assemblySegmentId === segment.assemblySegmentId
						? {
								...item,
								speaker: segmentDraft.speaker,
								text: segmentDraft.text,
								reviewed: true,
							}
						: item,
				),
			);
			setDirty(true);
			setReceipt(null);
		}
		setEditingId(null);
		setSegmentDraft(null);
		focusSegmentTrigger(segment.assemblySegmentId);
	}

	function changePage(next: number) {
		if (hasOpenSegmentEditor) return;
		setPageIndex(Math.max(0, Math.min(next, pageCount - 1)));
		window.requestAnimationFrame(() => timelineRef.current?.scrollTo({ top: 0 }));
	}

	function applySaved(next: SessionAssemblyReviewSummary, message: string) {
		setBaseline(next);
		setSegments(next.segments.map((segment) => ({ ...segment })));
		setDirty(false);
		setEditingId(null);
		setSegmentDraft(null);
		setError(null);
		onChange(next);
		onStatus?.(message);
	}

	async function save(status: "reviewed" | "approved_local") {
		if (busy || disabled || hasOpenSegmentEditor) return;
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
			data-session-assembly-review="true"
			data-review-page-size={PAGE_SIZE}
		>
			<header className={styles.header}>
				<div>
					<span className={styles.eyebrow}>Revisão contínua</span>
					<h3 tabIndex={-1}>Transcrição da sessão</h3>
					<p>
						{baseline.segmentCount.toLocaleString("pt-BR")} falas ·{" "}
						{reviewedCount.toLocaleString("pt-BR")} revisadas · Assembly{" "}
						{assembly.assemblyId.slice(0, 12)}…
					</p>
				</div>
				<div className={styles.headerActions}>
					<StatusPill tone={statusTone(baseline)}>
						{baseline.approvalCurrent
							? "Aprovado"
							: baseline.status === "reviewed"
								? "Revisado"
								: "Draft"}
					</StatusPill>
					{hasOpenSegmentEditor && dirty ? (
						<span className={styles.editHint}>Conclua a edição da fala atual antes de salvar.</span>
					) : null}
					{receipt ? (
						<a
							data-handoff-success-link="true"
							className={actionStyles({ size: "sm", variant: "primary" })}
							href={"/edit/sessoes/" + encodeURIComponent(assembly.sessionId)}
						>
							Abrir sessão no Edit
						</a>
					) : dirty && !hasOpenSegmentEditor ? (
						<Button
							size="sm"
							variant="primary"
							disabled={busy || disabled}
							onClick={() => void save("reviewed")}
						>
							{busy ? "Salvando…" : "Salvar alterações"}
						</Button>
					) : canApprove ? (
						<Button size="sm" variant="primary" onClick={() => void save("approved_local")}>
							Aprovar revisão
						</Button>
					) : canPublish ? (
						<Button
							data-handoff-trigger="prepare"
							size="sm"
							variant="primary"
							onClick={() => void publish()}
						>
							{pending ? "Confirmar handoff pendente" : "Preparar sessão no Edit"}
						</Button>
					) : null}
				</div>
			</header>

			<div className={styles.tools}>
				<label>
					<span>Buscar na transcrição</span>
					<input
						type="search"
						value={query}
						disabled={hasOpenSegmentEditor}
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Participante, texto ou origem"
					/>
				</label>
				<TranscriptMarkdownRoundTrip
					base={sessionAssemblyMarkdownBase(assembly, baseline)}
					segments={sessionAssemblyMarkdownSegments(segments)}
					title={assembly.sessionId}
					fileIdentity={assembly.sessionId}
					dirty={dirty}
					disabled={disabled || busy || hasOpenSegmentEditor}
					onApply={(result) => {
						setSegments((current) => [
							...applySessionAssemblyMarkdownImport(current, result),
						]);
						setDirty(true);
						setReceipt(null);
						setPageIndex(0);
					}}
				/>
			</div>

			{pending && !receipt ? (
				<p className={styles.notice} role="status">
					Há um handoff com identidade preservada. A próxima tentativa reutiliza a mesma operação em vez de criar outra revisão.
				</p>
			) : null}
			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}

			<div className={styles.summary}>
				<div>
					<strong>{matches.length.toLocaleString("pt-BR")} falas encontradas</strong>
					<span>
						{matches.length
							? `${(visibleStart + 1).toLocaleString("pt-BR")}–${visibleEnd.toLocaleString("pt-BR")} de ${matches.length.toLocaleString("pt-BR")}`
							: "Nenhuma fala corresponde à busca."}
					</span>
				</div>
				<nav className={styles.pagination} aria-label="Paginação da transcrição">
					<Button
						type="button"
						size="sm"
						variant="tertiary"
						disabled={page === 0 || hasOpenSegmentEditor}
						onClick={() => changePage(page - 1)}
					>
						Página anterior
					</Button>
					<span>
						Página {page + 1} de {pageCount}
					</span>
					<Button
						type="button"
						size="sm"
						variant="tertiary"
						disabled={page >= pageCount - 1 || hasOpenSegmentEditor}
						onClick={() => changePage(page + 1)}
					>
						Próxima página
					</Button>
				</nav>
			</div>

			<ol
				ref={timelineRef}
				className={styles.timeline}
				data-transcript-timeline="true"
				aria-label="Timeline da transcrição"
			>
				{visible.map((segment) => {
					const wallClock = segment.absoluteTime
						? wallClockPresentation(segment.absoluteTime.startIso)
						: null;
					const editing = editingId === segment.assemblySegmentId;
					return (
						<li
							key={segment.assemblySegmentId}
							className={styles.segment}
							data-assembly-segment={segment.assemblySegmentId}
							data-editing={editing ? "true" : "false"}
						>
							{editing && segmentDraft ? (
								<form
									className={styles.segmentEditor}
									onSubmit={(event) => {
										event.preventDefault();
										applyEdit(segment);
									}}
									onKeyDown={(event) => {
										if (event.key === "Escape") {
											event.preventDefault();
											cancelEdit();
										}
									}}
								>
									<div className={styles.segmentMeta}>
										<span>{elapsed(segment.start)}</span>
										{wallClock ? (
											<time
												dateTime={segment.absoluteTime?.startIso}
												title={wallClock.accessible}
											>
												{wallClock.date} · {wallClock.clock} {wallClock.offset}
											</time>
										) : null}
									</div>
									<div className={styles.editGrid}>
										<label>
											<span>Participante</span>
											<input
												data-assembly-speaker-input={segment.assemblySegmentId}
												value={segmentDraft.speaker}
												disabled={disabled || busy}
												onChange={(event) =>
													setSegmentDraft((current) =>
														current
															? { ...current, speaker: event.currentTarget.value }
															: current,
													)
												}
											/>
										</label>
										<label className={styles.textEditor}>
											<span>Texto</span>
											<textarea
												rows={4}
												value={segmentDraft.text}
												disabled={disabled || busy}
												onChange={(event) =>
													setSegmentDraft((current) =>
														current
															? { ...current, text: event.currentTarget.value }
															: current,
													)
												}
											/>
										</label>
									</div>
									<div className={styles.editorFooter}>
										<details>
											<summary>Proveniência</summary>
											<small>
												Part {segment.partId} · source {segment.sourceId} · run{" "}
												{segment.runId} · track {segment.trackNumber} · segmento{" "}
												{segment.sourceSegmentId}
											</small>
										</details>
										<div className={styles.editorActions}>
											<Button
												type="button"
												size="sm"
												variant="tertiary"
												onClick={cancelEdit}
											>
												Cancelar
											</Button>
											<Button type="submit" size="sm" variant="primary">
												Aplicar
											</Button>
										</div>
									</div>
								</form>
							) : (
								<button
									type="button"
									className={styles.segmentRow}
									data-assembly-edit-trigger={segment.assemblySegmentId}
									disabled={disabled || busy || hasOpenSegmentEditor}
									onClick={() => beginEdit(segment)}
									aria-label={`Editar fala de ${segment.speaker} em ${elapsed(segment.start)}`}
								>
									<div className={styles.segmentMeta}>
										<span>{elapsed(segment.start)}</span>
										{wallClock ? (
											<time
												dateTime={segment.absoluteTime?.startIso}
												title={wallClock.accessible}
											>
												{wallClock.clock}
											</time>
										) : null}
									</div>
									<strong className={styles.speaker}>{segment.speaker}</strong>
									<span className={styles.segmentText}>{segment.text}</span>
									{segment.reviewed ? (
										<small className={styles.reviewed}>Revisada</small>
									) : (
										<span aria-hidden="true" />
									)}
								</button>
							)}
						</li>
					);
				})}
			</ol>
		</section>
	);
}
