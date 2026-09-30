"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	parseTranscriptMarkdownV1,
	renderTranscriptMarkdownV1,
	type TranscriptMarkdownDocumentV1,
} from "@/features/transcript-review/markdown-v1";
import { countWordsV1 } from "@/features/transcript-review/text-contract";
import { LocalBridge } from "./bridge";
import {
	AssemblyPublicationClientError,
	publishAssemblyReview,
	readCurrentAssemblyPublication,
} from "./session-assembly-publication-client";
import type {
	SessionAssembly,
	SessionAssemblyReviewSegment,
	SessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import styles from "./session-assembly-review.module.css";

type Props = Readonly<{
	bridge: LocalBridge;
	assembly: SessionAssembly;
	initialReview: SessionAssemblyReviewSummary;
	onReviewChange?: (review: SessionAssemblyReviewSummary) => void;
}>;

type PendingPublication = Readonly<{
	operationId: string;
	expectedCurrentRevisionId: string | null;
	expectedActorProfileId: string;
}>;

function elapsed(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const rest = total % 60;
	return [hours, minutes, rest]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}

function wallClock(value: string | null): string | null {
	if (!value) return null;
	const match = value.match(
		/T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/u,
	);
	return match ? match[1] + match[2] : value;
}

function publicationMessage(code: string): string {
	return {
		unauthenticated: "Sua sessão Web expirou. Entre novamente e tente preparar a sessão.",
		forbidden: "Seu acesso não permite preparar esta sessão privada.",
		publish_capability_undefined:
			"O handoff privado ainda não está ativado para esta campanha.",
		invalid_payload:
			"A revisão composta não passou no contrato de publicação. Nada foi publicado.",
		approved_review_required:
			"A revisão precisa estar salva e aprovada localmente antes do handoff.",
		too_large: "A revisão excede o limite do handoff privado.",
		not_found: "A campanha ou sessão de destino não foi encontrada.",
		conflict:
			"A sessão privada mudou desde a última leitura. Confira a revisão atual antes de tentar novamente.",
		stale_current:
			"A revisão privada atual mudou. Recarregue antes de substituir o ponteiro atual.",
		dependency_unavailable:
			"O serviço privado não confirmou a operação. Tentar novamente reutiliza a mesma identidade.",
		unconfirmed:
			"O envio ficou ambíguo. A identidade foi preservada; tente novamente para reconciliar sem criar outra revisão.",
	}[code] ?? \`Publicação não concluída · \${code}\`;
}

function localReviewMessage(code: string): string {
	return {
		SESSION_ASSEMBLY_REVIEW_DRAFT_CONFLICT:
			"A revisão mudou em outra aba ou processo. Reabra a versão atual antes de salvar.",
		SESSION_ASSEMBLY_REVIEW_APPROVAL_BLOCKED:
			"Resolva os participantes ambíguos antes de aprovar a sessão.",
		SESSION_ASSEMBLY_REVIEW_APPROVAL_REQUIRES_SAVED_DRAFT:
			"Salve o draft exato antes da aprovação.",
		SESSION_ASSEMBLY_REVIEW_SEGMENT_PROVENANCE_IMMUTABLE:
			"IDs e horários da transcrição são imutáveis. O texto foi preservado nesta tela.",
		payload_too_large:
			"O draft excede o limite local. Reduza o conteúdo antes de salvar.",
		timeout:
			"O Companion demorou demais. Seu texto continua nesta tela.",
		unreachable:
			"O Companion ficou indisponível. Seu texto continua nesta tela.",
	}[code] ?? \`Não foi possível salvar a revisão · \${code}\`;
}

function publicationStorageKey(assemblyId: string) {
	return \`tda.processing.assembly-publication.v1.\${assemblyId}\`;
}

function loadPendingPublication(assemblyId: string): PendingPublication | null {
	try {
		const raw = window.localStorage.getItem(publicationStorageKey(assemblyId));
		if (!raw) return null;
		const value = JSON.parse(raw) as Record<string, unknown>;
		const uuid =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
		if (
			typeof value.operationId !== "string" ||
			!uuid.test(value.operationId) ||
			!(
				value.expectedCurrentRevisionId === null ||
				(typeof value.expectedCurrentRevisionId === "string" &&
					uuid.test(value.expectedCurrentRevisionId))
			) ||
			typeof value.expectedActorProfileId !== "string" ||
			!uuid.test(value.expectedActorProfileId)
		)
			return null;
		return value as PendingPublication;
	} catch {
		return null;
	}
}

function savePendingPublication(
	assemblyId: string,
	value: PendingPublication,
) {
	window.localStorage.setItem(
		publicationStorageKey(assemblyId),
		JSON.stringify(value),
	);
}

function clearPendingPublication(assemblyId: string) {
	try {
		window.localStorage.removeItem(publicationStorageKey(assemblyId));
	} catch {
		// A confirmed server receipt remains authoritative.
	}
}

function markdownDocument(
	assembly: SessionAssembly,
	segments: readonly SessionAssemblyReviewSegment[],
): TranscriptMarkdownDocumentV1 {
	return {
		sessionId: assembly.sessionId,
		segments: segments.map((segment) => ({
			id: segment.assemblySegmentId,
			trackNumber: segment.trackNumber,
			startMs: Math.round(segment.start * 1000),
			endMs: Math.round(segment.end * 1000),
			absoluteStart: segment.absoluteStart,
			absoluteEnd: segment.absoluteEnd,
			speaker: segment.speaker,
			text: segment.text,
		})),
	};
}

function sameEditorial(
	left: readonly SessionAssemblyReviewSegment[],
	right: readonly SessionAssemblyReviewSegment[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(segment, index) =>
				segment.assemblySegmentId === right[index]?.assemblySegmentId &&
				segment.speaker === right[index]?.speaker &&
				segment.text === right[index]?.text &&
				segment.reviewed === right[index]?.reviewed,
		)
	);
}

export function SessionAssemblyReviewEditor({
	bridge,
	assembly,
	initialReview,
	onReviewChange,
}: Props) {
	const [baseline, setBaseline] = useState(initialReview);
	const [segments, setSegments] = useState<SessionAssemblyReviewSegment[]>(() =>
		initialReview.segments.map((segment) => ({ ...segment })),
	);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [imported, setImported] = useState<{
		segments: SessionAssemblyReviewSegment[];
		changedIds: readonly string[];
	} | null>(null);
	const [receipt, setReceipt] = useState<{
		revisionNumber: number;
		committedAt: string;
	} | null>(null);
	const importInput = useRef<HTMLInputElement>(null);

	const dirty = useMemo(
		() => !sameEditorial(segments, baseline.segments),
		[baseline.segments, segments],
	);
	const reviewed = segments.filter((segment) => segment.reviewed).length;
	const wordCount = segments.reduce(
		(total, segment) => total + countWordsV1(segment.text),
		0,
	);

	function adopt(next: SessionAssemblyReviewSummary) {
		setBaseline(next);
		setSegments(next.segments.map((segment) => ({ ...segment })));
		onReviewChange?.(next);
	}

	async function persist(
		status: "draft" | "reviewed" | "approved_local",
		nextSegments = segments,
	) {
		const controller = new AbortController();
		const next = await bridge.saveSessionAssemblyReview(
			assembly.campaignId,
			assembly.sessionId,
			assembly.assemblyId,
			baseline,
			status,
			nextSegments,
			controller.signal,
		);
		adopt(next);
		return next;
	}

	async function saveReview() {
		if (busy || !dirty) return;
		setBusy(true);
		setError(null);
		setMessage("Salvando revisão local…");
		try {
			await persist("reviewed");
			setMessage("Revisão local salva sem alterar a assembly bruta.");
		} catch (cause) {
			setError(
				localReviewMessage(
					cause instanceof Error && "serverCode" in cause
						? String((cause as { serverCode?: unknown }).serverCode ?? "service_error")
						: cause instanceof Error
							? cause.message
							: "service_error",
				),
			);
		} finally {
			setBusy(false);
		}
	}

	async function approve() {
		if (busy) return;
		setBusy(true);
		setError(null);
		setMessage("Consolidando revisão antes da aprovação…");
		try {
			const fullyReviewed = segments.map((segment) => ({
				...segment,
				reviewed: true,
			}));
			let current = baseline;
			if (
				current.persistence === "ephemeral_base" ||
				!sameEditorial(fullyReviewed, current.segments)
			) {
				current = await bridge.saveSessionAssemblyReview(
					assembly.campaignId,
					assembly.sessionId,
					assembly.assemblyId,
					current,
					"reviewed",
					fullyReviewed,
					new AbortController().signal,
				);
				adopt(current);
			}
			const approved = await bridge.saveSessionAssemblyReview(
				assembly.campaignId,
				assembly.sessionId,
				assembly.assemblyId,
				current,
				"approved_local",
				current.segments,
				new AbortController().signal,
			);
			adopt(approved);
			setMessage("Sessão aprovada localmente. O run e a assembly originais continuam imutáveis.");
		} catch (cause) {
			setError(
				localReviewMessage(
					cause instanceof Error && "serverCode" in cause
						? String((cause as { serverCode?: unknown }).serverCode ?? "service_error")
						: cause instanceof Error
							? cause.message
							: "service_error",
				),
			);
		} finally {
			setBusy(false);
		}
	}

	async function exportMarkdown() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const markdown = await renderTranscriptMarkdownV1(
				markdownDocument(assembly, segments),
			);
			const blob = new Blob([markdown], {
				type: "text/markdown;charset=utf-8",
			});
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = \`\${assembly.sessionId}-tda-transcript.md\`;
			anchor.click();
			URL.revokeObjectURL(url);
			setMessage("Markdown v1 exportado com identidade e horários verificáveis.");
		} catch {
			setError("Não foi possível gerar o Markdown desta revisão.");
		} finally {
			setBusy(false);
		}
	}

	async function importMarkdown(file: File | null) {
		if (!file || busy || dirty) {
			if (dirty)
				setError("Salve ou descarte as alterações atuais antes de importar outro Markdown.");
			return;
		}
		setBusy(true);
		setError(null);
		setImported(null);
		try {
			const raw = await file.text();
			const parsed = await parseTranscriptMarkdownV1(
				raw,
				markdownDocument(assembly, baseline.segments),
			);
			if (!parsed.ok) {
				setError(
					parsed.reason === "structure_mismatch"
						? "O Markdown altera identidade, ordem ou horários. A importação foi bloqueada."
						: "O Markdown não corresponde ao contrato TDA Transcript v1.",
				);
				return;
			}
			if (parsed.changedSegmentIds.length === 0) {
				setMessage("O Markdown é idêntico à revisão atual. Nenhuma nova revisão foi criada.");
				return;
			}
			const byId = new Map(
				parsed.segments.map((segment) => [segment.id, segment]),
			);
			setImported({
				changedIds: parsed.changedSegmentIds,
				segments: baseline.segments.map((segment) => {
					const editable = byId.get(segment.assemblySegmentId);
					return editable
						? {
								...segment,
								speaker: editable.speaker,
								text: editable.text,
								reviewed: parsed.changedSegmentIds.includes(
									segment.assemblySegmentId,
								)
									? true
									: segment.reviewed,
							}
						: segment;
				}),
			});
			setMessage(
				\`Importação pronta para conferir: \${parsed.changedSegmentIds.length} segmento(s) alterado(s).\`,
			);
		} catch {
			setError("Não foi possível ler o Markdown selecionado.");
		} finally {
			setBusy(false);
			if (importInput.current) importInput.current.value = "";
		}
	}

	async function applyImport() {
		if (!imported || busy) return;
		setBusy(true);
		setError(null);
		try {
			const next = await bridge.saveSessionAssemblyReview(
				assembly.campaignId,
				assembly.sessionId,
				assembly.assemblyId,
				baseline,
				"reviewed",
				imported.segments,
				new AbortController().signal,
			);
			adopt(next);
			setImported(null);
			setMessage("Markdown aplicado como nova revisão derivada; a base bruta foi preservada.");
		} catch (cause) {
			setError(
				localReviewMessage(
					cause instanceof Error && "serverCode" in cause
						? String((cause as { serverCode?: unknown }).serverCode ?? "service_error")
						: cause instanceof Error
							? cause.message
							: "service_error",
				),
			);
		} finally {
			setBusy(false);
		}
	}

	async function publish() {
		if (busy || baseline.status !== "approved_local" || !baseline.approvalCurrent)
			return;
		setBusy(true);
		setError(null);
		setMessage("Preparando a revisão privada no Edit…");
		try {
			let pending = loadPendingPublication(assembly.assemblyId);
			if (!pending) {
				const current = await readCurrentAssemblyPublication(assembly);
				pending = {
					operationId: crypto.randomUUID(),
					expectedCurrentRevisionId: current.revisionId,
					expectedActorProfileId: current.actorProfileId,
				};
				savePendingPublication(assembly.assemblyId, pending);
			}
			const confirmed = await publishAssemblyReview(
				assembly,
				baseline,
				pending.operationId,
				pending.expectedCurrentRevisionId,
				pending.expectedActorProfileId,
			);
			clearPendingPublication(assembly.assemblyId);
			setReceipt({
				revisionNumber: confirmed.revisionNumber,
				committedAt: confirmed.committedAt,
			});
			setMessage(
				\`Sessão privada preparada no Edit · revisão r\${confirmed.revisionNumber}.\`,
			);
		} catch (cause) {
			const code =
				cause instanceof AssemblyPublicationClientError
					? cause.code
					: "dependency_unavailable";
			if (code === "conflict" || code === "stale_current")
				clearPendingPublication(assembly.assemblyId);
			setError(publicationMessage(code));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className={styles.review} aria-labelledby="assembly-review-title">
			<header className={styles.header}>
				<div>
					<span>Transcrição da sessão</span>
					<h4 id="assembly-review-title">{assembly.sessionId}</h4>
					<p>
						{segments.length} falas · {reviewed} revisadas · {wordCount} palavras
					</p>
				</div>
				<div className={styles.headerActions}>
					<Button
						type="button"
						size="sm"
						variant="tertiary"
						disabled={busy}
						onClick={() => void exportMarkdown()}
					>
						Exportar Markdown
					</Button>
					<input
						ref={importInput}
						className={styles.hiddenInput}
						type="file"
						accept=".md,text/markdown,text/plain"
						aria-label="Importar TDA Transcript Markdown"
						disabled={busy || dirty}
						onChange={(event) =>
							void importMarkdown(event.currentTarget.files?.[0] ?? null)
						}
					/>
					<Button
						type="button"
						size="sm"
						variant="tertiary"
						disabled={busy || dirty}
						onClick={() => importInput.current?.click()}
					>
						Importar Markdown
					</Button>
				</div>
			</header>

			{baseline.warningCount ? (
				<div className={styles.warning} role="status">
					<strong>{baseline.warningCount} aviso(s) do processamento</strong>
					{baseline.warnings.slice(0, 5).map((warning) => (
						<span key={warning}>{warning}</span>
					))}
					{baseline.warningSummary.truncated ? (
						<span>Há avisos adicionais preservados no resultado local.</span>
					) : null}
				</div>
			) : null}

			{imported ? (
				<div className={styles.importPreview} role="status">
					<div>
						<strong>Prévia da importação</strong>
						<span>
							{imported.changedIds.length} segmento(s) terão speaker ou texto alterados.
							IDs, ordem e horários permaneceram idênticos.
						</span>
					</div>
					<div>
						<Button
							type="button"
							size="sm"
							variant="primary"
							disabled={busy}
							onClick={() => void applyImport()}
						>
							Aplicar revisão importada
						</Button>
						<Button
							type="button"
							size="sm"
							variant="tertiary"
							disabled={busy}
							onClick={() => setImported(null)}
						>
							Cancelar
						</Button>
					</div>
				</div>
			) : null}

			<div className={styles.timeline}>
				{segments.map((segment, index) => {
					const clock = wallClock(segment.absoluteStart);
					return (
						<article
							key={segment.assemblySegmentId}
							className={styles.segment}
							data-reviewed={segment.reviewed ? "true" : "false"}
						>
							<button
								type="button"
								className={styles.time}
								title={
									segment.absoluteStart
										? \`Tempo da sessão \${elapsed(segment.start)} · relógio \${segment.absoluteStart}\`
										: "Tempo desde o início da sessão"
								}
								onClick={() =>
									navigator.clipboard?.writeText(
										clock
											? \`\${elapsed(segment.start)} · \${clock}\`
											: elapsed(segment.start),
									)
								}
							>
								<span>{elapsed(segment.start)}</span>
								{clock ? <small>{clock}</small> : null}
							</button>
							<div className={styles.editor}>
								<label>
									<span>Participante</span>
									<input
										value={segment.speaker}
										maxLength={160}
										disabled={busy}
										onChange={(event) =>
											setSegments((current) =>
												current.map((item, position) =>
													position === index
														? {
																...item,
																speaker: event.target.value,
																reviewed: true,
															}
														: item,
												),
											)
										}
									/>
								</label>
								<label>
									<span>Texto</span>
									<textarea
										rows={3}
										value={segment.text}
										disabled={busy}
										onChange={(event) =>
											setSegments((current) =>
												current.map((item, position) =>
													position === index
														? {
																...item,
																text: event.target.value,
																reviewed: true,
															}
														: item,
												),
											)
										}
									/>
								</label>
							</div>
							<label className={styles.reviewedToggle}>
								<input
									type="checkbox"
									checked={segment.reviewed}
									disabled={busy}
									onChange={(event) =>
										setSegments((current) =>
											current.map((item, position) =>
												position === index
													? { ...item, reviewed: event.target.checked }
													: item,
											),
										)
									}
								/>
								<span>Revisado</span>
							</label>
						</article>
					);
				})}
			</div>

			<footer className={styles.actions}>
				<div>
					<strong>
						{baseline.status === "approved_local" && baseline.approvalCurrent
							? "Aprovada localmente"
							: dirty
								? "Alterações não salvas"
								: "Revisão local"}
					</strong>
					<span>
						A assembly e os runs brutos permanecem imutáveis; esta tela salva somente uma derivação editorial.
					</span>
				</div>
				<div className={styles.actionButtons}>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || !dirty}
						onClick={() => void saveReview()}
					>
						Salvar revisão
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={busy || baseline.approvalBlocked}
						onClick={() => void approve()}
					>
						Aprovar localmente
					</Button>
					<Button
						type="button"
						variant="primary"
						disabled={
							busy ||
							dirty ||
							baseline.status !== "approved_local" ||
							!baseline.approvalCurrent
						}
						onClick={() => void publish()}
					>
						Preparar sessão privada no Edit
					</Button>
				</div>
			</footer>

			{receipt ? (
				<p className={styles.success} role="status">
					Revisão privada r{receipt.revisionNumber} confirmada em{" "}
					{new Date(receipt.committedAt).toLocaleString("pt-BR")}.
				</p>
			) : null}
			{message ? <p className={styles.status} role="status">{message}</p> : null}
			{error ? <p className={styles.error} role="alert">{error}</p> : null}
		</section>
	);
}
