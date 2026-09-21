"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import type {
	LocalReview,
	LocalReviewSegment,
	LocalReviewStatus,
	LocalRunSummary,
} from "./protocol";
import styles from "./local-review.module.css";

type Props = Readonly<{
	runs: readonly LocalRunSummary[];
	review: LocalReview | null;
	busy: boolean;
	error: string | null;
	onOpen: (sourceId: string, runId: string) => void | Promise<void>;
	onSave: (
		expectedDraftRevision: number,
		status: LocalReviewStatus,
		segments: readonly LocalReviewSegment[],
	) => void | Promise<void>;
	onClose: () => void;
}>;

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
	if (!value) return "data desconhecida";
	return new Date(value).toLocaleString("pt-BR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatSeconds(value: number | null): string {
	if (value === null) return "—";
	const seconds = Math.round(value);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return hours
		? `${hours}h ${String(minutes).padStart(2, "0")}m`
		: minutes
			? `${minutes}m ${String(rest).padStart(2, "0")}s`
			: `${rest}s`;
}

function formatTimestamp(value: number): string {
	const seconds = Math.max(0, Math.floor(value));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function reviewError(code: string | null): string | null {
	if (!code) return null;
	return {
		LOCAL_REVIEW_DRAFT_CONFLICT:
			"Este draft mudou em outra aba ou processo. Feche sem descartar seu texto, reabra a revisão e reconcilie antes de salvar.",
		LOCAL_REVIEW_BASE_RUN_INVALID:
			"O run bruto não passou na verificação de integridade. Ele não foi alterado.",
		LOCAL_REVIEW_RUN_NOT_VISIBLE:
			"Este run não está mais elegível para revisão.",
		payload_too_large:
			"O draft excede o limite local de 32 MiB.",
		timeout:
			"O Companion demorou demais para responder. Seu draft local nesta tela foi preservado.",
		unreachable:
			"O Companion ficou indisponível. Seu draft nesta tela foi preservado.",
		invalid_response:
			"O Companion respondeu com um contrato de revisão inválido.",
	}[code] ?? `Não foi possível concluir a revisão local · ${code}`;
}

function RunCard({
	run,
	busy,
	onOpen,
}: Readonly<{
	run: LocalRunSummary;
	busy: boolean;
	onOpen: () => void;
}>) {
	const model = [run.engine, run.model].filter(Boolean).join(" · ") || "modelo desconhecido";
	return (
		<article className={styles.runCard}>
			<div className={styles.runHeader}>
				<div>
					<span className={styles.eyebrow}>Resultado local</span>
					<h3>{run.profileId}</h3>
				</div>
				<StatusPill tone="success">Concluído</StatusPill>
			</div>
			<p className={styles.runModel}>
				{model}
				{run.modelRevision ? ` · rev ${run.modelRevision}` : ""}
			</p>
			<dl className={styles.runFacts}>
				<div><dt>Concluído</dt><dd>{formatDate(run.completedAt)}</dd></div>
				<div><dt>Processamento</dt><dd>{formatSeconds(run.stats.processingSeconds)}</dd></div>
				<div><dt>Palavras</dt><dd>{run.stats.wordCount ?? "—"}</dd></div>
				<div><dt>Segmentos</dt><dd>{run.stats.segmentCount ?? "—"}</dd></div>
				<div><dt>Warnings</dt><dd>{run.stats.warningCount ?? "—"}</dd></div>
				<div><dt>RTF</dt><dd>{run.stats.rtf === null ? "—" : run.stats.rtf.toFixed(3)}</dd></div>
			</dl>
			<div className={styles.runIdentity}>
				<span title={run.sourceId}>Fonte {run.sourceId.slice(0, 22)}…</span>
				<span title={run.transcriptSha256}>SHA {run.transcriptSha256.slice(0, 12)}…</span>
			</div>
			<Button size="sm" variant="primary" disabled={busy} onClick={onOpen}>
				Revisar resultado
			</Button>
		</article>
	);
}

function ReviewEditor({
	review,
	busy,
	error,
	onSave,
	onClose,
}: Readonly<{
	review: LocalReview;
	busy: boolean;
	error: string | null;
	onSave: Props["onSave"];
	onClose: () => void;
}>) {
	const [segments, setSegments] = useState<LocalReviewSegment[]>(() =>
		review.segments.map((segment) => ({ ...segment })),
	);
	const [status, setStatus] = useState<LocalReviewStatus>(review.status);
	const [dirty, setDirty] = useState(false);
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty]);

	const filtered = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase("pt-BR");
		return segments
			.map((segment, index) => ({ segment, index }))
			.filter(({ segment }) =>
				!normalized
					? true
					: `${segment.speaker} ${segment.text}`
							.toLocaleLowerCase("pt-BR")
							.includes(normalized),
			);
	}, [query, segments]);
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const safePage = Math.min(page, pageCount - 1);
	const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
	const reviewed = segments.filter((segment) => segment.reviewed).length;
	const words = segments.reduce(
		(total, segment) =>
			total + (segment.text.trim() ? segment.text.trim().split(/\s+/u).length : 0),
		0,
	);
	const participants = new Set(segments.map((segment) => segment.speaker)).size;

	function patch(index: number, value: Partial<LocalReviewSegment>) {
		setSegments((current) =>
			current.map((segment, candidate) =>
				candidate === index ? { ...segment, ...value } : segment,
			),
		);
		setDirty(true);
	}

	function attemptClose() {
		if (
			dirty &&
			!window.confirm(
				"Há alterações locais ainda não salvas. Fechar a revisão e descartá-las desta tela?",
			)
		)
			return;
		onClose();
	}

	return (
		<section className={styles.editor} aria-labelledby="local-review-title">
			<div className={styles.editorHeader}>
				<div>
					<span className={styles.eyebrow}>Revisão local derivada</span>
					<h2 id="local-review-title">{review.lineage.profileId}</h2>
					<p>
						Run bruto imutável · draft r{review.draftRevision} · SHA{" "}
						{review.baseTranscriptSha256.slice(0, 12)}…
					</p>
				</div>
				<div className={styles.headerActions}>
					<Button size="sm" variant="tertiary" disabled={busy} onClick={attemptClose}>
						Voltar aos resultados
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={busy || !dirty}
						onClick={() => void onSave(review.draftRevision, status, segments)}
					>
						{busy ? "Salvando…" : "Salvar revisão"}
					</Button>
				</div>
			</div>

			<div className={styles.reviewNotice}>
				<strong>Nada será publicado.</strong>
				<span>Esta revisão fica somente neste computador até uma ação explícita de publicação.</span>
			</div>

			<div className={styles.summaryGrid}>
				<div><span>Revisão</span><strong>{reviewed} / {segments.length}</strong><small>{segments.length ? Math.round((reviewed / segments.length) * 100) : 100}%</small></div>
				<div><span>Palavras</span><strong>{words}</strong><small>{review.review.editedSegments} segmentos alterados no último save</small></div>
				<div><span>Participantes</span><strong>{participants}</strong><small>{review.stats.trackCount ?? "—"} tracks</small></div>
				<div><span>Duração</span><strong>{formatSeconds(review.stats.sessionDurationSeconds)}</strong><small>Processamento {formatSeconds(review.stats.processingSeconds)}</small></div>
				<div><span>Warnings</span><strong>{review.warnings.length}</strong><small>atalhos de atenção, não veredictos</small></div>
				<div><span>Device</span><strong>{review.lineage.device ?? "—"}</strong><small>{[review.lineage.computeType, review.lineage.alignment].filter(Boolean).join(" · ") || "desconhecido"}</small></div>
			</div>

			{review.warnings.length ? (
				<details className={styles.warnings}>
					<summary>{review.warnings.length} warnings do pipeline</summary>
					<ul>
						{review.warnings.slice(0, 50).map((warning, index) => (
							<li key={`${index}-${warning}`}>{warning}</li>
						))}
					</ul>
				</details>
			) : null}

			<div className={styles.reviewToolbar}>
				<label>
					<span>Estado do draft</span>
					<select
						value={status}
						disabled={busy}
						onChange={(event) => {
							setStatus(event.target.value as LocalReviewStatus);
							setDirty(true);
						}}
					>
						<option value="draft">Draft</option>
						<option value="reviewed">Revisado</option>
						<option value="approved_local">Aprovado localmente</option>
					</select>
				</label>
				<label className={styles.search}>
					<span>Filtrar falas</span>
					<input
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setPage(0);
						}}
						placeholder="Speaker ou texto…"
					/>
				</label>
				<div className={styles.pageControls}>
					<Button
						size="sm"
						variant="tertiary"
						disabled={safePage === 0}
						onClick={() => setPage((current) => Math.max(0, current - 1))}
					>
						Anterior
					</Button>
					<span>{safePage + 1} / {pageCount}</span>
					<Button
						size="sm"
						variant="tertiary"
						disabled={safePage >= pageCount - 1}
						onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
					>
						Próxima
					</Button>
				</div>
			</div>

			{reviewError(error) ? (
				<p className={styles.error} role="alert">{reviewError(error)}</p>
			) : null}
			{dirty ? (
				<p className={styles.unsaved} role="status">Alterações não salvas neste draft.</p>
			) : (
				<p className={styles.saved} role="status">Draft salvo localmente.</p>
			)}

			<div className={styles.segmentList}>
				{visible.map(({ segment, index }) => (
					<article
						className={styles.segment}
						key={`${segment.trackNumber}-${segment.segmentId}`}
					>
						<div className={styles.segmentMeta}>
							<span>Track {segment.trackNumber}</span>
							<span>{formatTimestamp(segment.start)} → {formatTimestamp(segment.end)}</span>
							<label className={styles.reviewed}>
								<input
									type="checkbox"
									checked={segment.reviewed}
									disabled={busy}
									onChange={(event) => patch(index, { reviewed: event.target.checked })}
								/>
								Revisado
							</label>
						</div>
						<label>
							<span>Speaker</span>
							<input
								value={segment.speaker}
								maxLength={160}
								disabled={busy}
								onChange={(event) => patch(index, { speaker: event.target.value })}
							/>
						</label>
						<label>
							<span>Texto</span>
							<textarea
								value={segment.text}
								maxLength={100_000}
								disabled={busy}
								onChange={(event) => patch(index, { text: event.target.value })}
							/>
						</label>
					</article>
				))}
				{visible.length === 0 ? (
					<p className={styles.empty}>Nenhuma fala corresponde ao filtro.</p>
				) : null}
			</div>
		</section>
	);
}

export function LocalReviewWorkspace({
	runs,
	review,
	busy,
	error,
	onOpen,
	onSave,
	onClose,
}: Props) {
	if (review) {
		return (
			<ReviewEditor
				key={review.draftSha256}
				review={review}
				busy={busy}
				error={error}
				onSave={onSave}
				onClose={onClose}
			/>
		);
	}

	return (
		<section className={styles.library} aria-labelledby="local-results-title">
			<div className={styles.libraryHeader}>
				<div>
					<span className={styles.eyebrow}>Biblioteca local</span>
					<h2 id="local-results-title">Resultados locais</h2>
				</div>
				<span>{runs.length} {runs.length === 1 ? "resultado" : "resultados"}</span>
			</div>
			<p className={styles.libraryIntro}>
				Runs concluídos ficam separados da fila operacional. O transcript só é carregado quando você abre uma revisão.
			</p>
			{runs.length ? (
				<div className={styles.runGrid}>
					{runs.map((run) => (
						<RunCard
							key={`${run.sourceId}-${run.runId}`}
							run={run}
							busy={busy}
							onOpen={() => void onOpen(run.sourceId, run.runId)}
						/>
					))}
				</div>
			) : (
				<div className={styles.empty}>
					<strong>Nenhum resultado local concluído ainda.</strong>
					<span>Quando um run terminar, ele aparecerá aqui sem virar publicação automaticamente.</span>
				</div>
			)}
		</section>
	);
}
