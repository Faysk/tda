"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	LocalRunComparisonProjection,
	LocalRunSummary,
} from "./protocol";
import {
	compareRunSegments,
	runsShareComparisonSource,
	summarizeRunComparison,
} from "./run-comparison";
import {
	comparisonSpeakers,
	filterComparisonRegions,
} from "./run-comparison-view";
import { localRunKey, serializeLocalRunKey } from "./local-run-key";
import styles from "./run-comparison-workspace.module.css";

type Props = Readonly<{
	anchorRun: LocalRunSummary;
	runs: readonly LocalRunSummary[];
	busy: boolean;
	onLoad: (
		sourceId: string,
		runId: string,
	) => Promise<LocalRunComparisonProjection>;
	onChooseBase: (sourceId: string, runId: string) => void | Promise<void>;
}>;

type LoadedComparison = Readonly<{
	leftRun: LocalRunSummary;
	rightRun: LocalRunSummary;
	regions: ReturnType<typeof compareRunSegments>;
}>;

const PAGE_SIZE = 80;

function runKey(run: Pick<LocalRunSummary, "sourceId" | "runId">): string {
	return serializeLocalRunKey(localRunKey(run));
}

function formatSeconds(value: number | null): string {
	if (value === null) return "—";
	const seconds = Math.round(value);
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return minutes ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function formatTimestamp(value: number): string {
	const seconds = Math.max(0, Math.floor(value));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return [hours, minutes, rest]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
}

function factualProcessingSeconds(run: LocalRunSummary): number | null {
	return (
		run.stats.processingMetrics?.totalProcessingSeconds ??
		run.stats.processingSeconds
	);
}

function projectionMatches(
	projection: LocalRunComparisonProjection,
	run: LocalRunSummary,
): boolean {
	return (
		projection.sourceId === run.sourceId &&
		projection.runId === run.runId &&
		projection.transcriptSha256 === run.transcriptSha256
	);
}

function optionalSeconds(value: string): number | null {
	if (!value.trim()) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function differenceLabel(kind: LoadedComparison["regions"][number]["kind"]): string {
	return {
		equal: "Texto igual",
		changed: "Texto diferente",
		left_only: "Somente A",
		right_only: "Somente B",
	}[kind];
}

function RunColumn({
	label,
	run,
}: Readonly<{ label: "A" | "B"; run: LocalRunSummary }>) {
	return (
		<article className={styles.runColumn}>
			<span className={styles.eyebrow}>Run {label}</span>
			<h4>{run.profileId}</h4>
			<p>{[run.engine, run.model].filter(Boolean).join(" · ") || "modelo desconhecido"}</p>
			<dl>
				<div><dt>Processamento</dt><dd>{formatSeconds(factualProcessingSeconds(run))}</dd></div>
				<div><dt>RTF registrado</dt><dd>{run.stats.rtf === null ? "—" : run.stats.rtf.toFixed(3)}</dd></div>
				<div><dt>Segmentos</dt><dd>{run.stats.segmentCount ?? "—"}</dd></div>
				<div><dt>Warnings</dt><dd>{run.stats.warningCount ?? "—"}</dd></div>
			</dl>
			<code title={run.transcriptSha256}>SHA {run.transcriptSha256.slice(0, 12)}…</code>
		</article>
	);
}

function SegmentSide({
	label,
	segments,
}: Readonly<{
	label: "A" | "B";
	segments: LoadedComparison["regions"][number]["left"];
}>) {
	return (
		<div className={styles.regionSide}>
			<strong>Run {label}</strong>
			{segments.length ? (
				segments.map((segment) => (
					<div key={JSON.stringify([segment.trackNumber, segment.segmentId])}>
						<span>{segment.speaker}</span>
						<p>{segment.text}</p>
					</div>
				))
			) : (
				<p className={styles.missing}>Sem trecho alinhado neste run.</p>
			)}
		</div>
	);
}

export function RunComparisonWorkspace({
	anchorRun,
	runs,
	busy,
	onLoad,
	onChooseBase,
}: Props) {
	const compatibleRuns = useMemo(
		() => runs.filter((run) => runsShareComparisonSource(anchorRun, run)),
		[anchorRun, runs],
	);
	const defaultCandidate = compatibleRuns[0] ?? null;
	const [candidateKey, setCandidateKey] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState<LoadedComparison | null>(null);
	const [onlyDifferences, setOnlyDifferences] = useState(true);
	const [speaker, setSpeaker] = useState("");
	const [startInput, setStartInput] = useState("");
	const [endInput, setEndInput] = useState("");
	const [page, setPage] = useState(0);
	const [activeDifferenceId, setActiveDifferenceId] = useState<string | null>(null);
	const requestSequence = useRef(0);

	useEffect(() => {
		requestSequence.current += 1;
		setCandidateKey(defaultCandidate ? runKey(defaultCandidate) : "");
		setLoaded(null);
		setError(null);
		setPage(0);
		setActiveDifferenceId(null);
	}, [defaultCandidate]);

	const candidate =
		compatibleRuns.find((run) => runKey(run) === candidateKey) ??
		compatibleRuns[0] ??
		null;

	async function loadComparison() {
		if (!candidate || loading || busy) return;
		const sequence = ++requestSequence.current;
		setLoading(true);
		setError(null);
		try {
			const [left, right] = await Promise.all([
				onLoad(anchorRun.sourceId, anchorRun.runId),
				onLoad(candidate.sourceId, candidate.runId),
			]);
			if (sequence !== requestSequence.current) return;
			if (!projectionMatches(left, anchorRun) || !projectionMatches(right, candidate))
				throw new Error("RUN_COMPARISON_PROJECTION_IDENTITY_MISMATCH");
			setLoaded({
				leftRun: anchorRun,
				rightRun: candidate,
				regions: compareRunSegments(left.segments, right.segments),
			});
			setOnlyDifferences(true);
			setSpeaker("");
			setStartInput("");
			setEndInput("");
			setPage(0);
			setActiveDifferenceId(null);
		} catch {
			if (sequence === requestSequence.current)
				setError(
					"Não foi possível ler e verificar os dois runs brutos. Nenhuma revisão foi criada ou alterada.",
				);
		} finally {
			if (sequence === requestSequence.current) setLoading(false);
		}
	}

	const speakers = useMemo(
		() => (loaded ? comparisonSpeakers(loaded.regions) : []),
		[loaded],
	);
	const startSeconds = optionalSeconds(startInput);
	const endSeconds = optionalSeconds(endInput);
	const invalidRange =
		startSeconds !== null && endSeconds !== null && startSeconds > endSeconds;
	const filtered = useMemo(
		() =>
			loaded
				? filterComparisonRegions(loaded.regions, {
					onlyDifferences,
					speaker: speaker || null,
					startSeconds,
					endSeconds,
				})
				: [],
		[loaded, onlyDifferences, speaker, startSeconds, endSeconds],
	);
	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const safePage = Math.min(page, totalPages - 1);
	const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
	const differences = filtered.filter((item) => item.isDifferent);
	const summary = loaded ? summarizeRunComparison(loaded.regions) : null;

	useEffect(() => {
		if (page !== safePage) setPage(safePage);
	}, [page, safePage]);

	useEffect(() => {
		if (!activeDifferenceId) return;
		if (!differences.some((item) => item.region.id === activeDifferenceId))
			setActiveDifferenceId(differences[0]?.region.id ?? null);
	}, [activeDifferenceId, differences]);

	function moveDifference(delta: -1 | 1) {
		if (!differences.length) return;
		const currentIndex = activeDifferenceId
			? differences.findIndex((item) => item.region.id === activeDifferenceId)
			: -1;
		const nextIndex =
			currentIndex < 0
				? delta > 0 ? 0 : differences.length - 1
				: Math.max(0, Math.min(differences.length - 1, currentIndex + delta));
		const next = differences[nextIndex];
		if (!next) return;
		setActiveDifferenceId(next.region.id);
		const filteredIndex = filtered.findIndex(
			(item) => item.region.id === next.region.id,
		);
		if (filteredIndex >= 0) setPage(Math.floor(filteredIndex / PAGE_SIZE));
	}

	return (
		<section className={styles.root} aria-label="Comparação A/B de resultados">
			<div className={styles.launcher}>
				<div>
					<span className={styles.eyebrow}>Comparação A/B</span>
					<strong>Comparar o run selecionado com outro da mesma fonte</strong>
					<small>
						A leitura usa os transcripts brutos imutáveis. Abrir ou salvar revisão só acontece após uma escolha explícita de base.
					</small>
				</div>
				{compatibleRuns.length ? (
					<div className={styles.launcherActions}>
						<label>
							<span>Run B</span>
							<select
								value={candidate ? runKey(candidate) : ""}
								onChange={(event) => {
									setCandidateKey(event.target.value);
									setLoaded(null);
									setError(null);
								}}
							>
								{compatibleRuns.map((run) => (
									<option key={runKey(run)} value={runKey(run)}>
										{run.profileId} · {run.completedAt ? new Date(run.completedAt).toLocaleString("pt-BR") : run.runId}
									</option>
								))}
							</select>
						</label>
						<Button
							size="sm"
							variant="secondary"
							disabled={loading || busy || !candidate}
							onClick={() => void loadComparison()}
						>
							{loading ? "Verificando runs…" : "Comparar resultados"}
						</Button>
					</div>
				) : (
					<p className={styles.noCandidate}>
						É preciso ter pelo menos dois runs concluídos da mesma fonte para comparar.
					</p>
				)}
			</div>

			{error ? <p className={styles.error} role="alert">{error}</p> : null}

			{loaded && summary ? (
				<div className={styles.comparison}>
					<div className={styles.runColumns}>
						<RunColumn label="A" run={loaded.leftRun} />
						<RunColumn label="B" run={loaded.rightRun} />
					</div>
					<p className={styles.factualNote}>
						Métricas exibidas são fatos registrados de cada run, não nota nem ranking de qualidade.
					</p>
					<div className={styles.summary}>
						<div><span>Regiões</span><strong>{summary.totalRegions}</strong></div>
						<div><span>Divergentes</span><strong>{summary.differentRegions}</strong></div>
						<div><span>Texto alterado</span><strong>{summary.changedRegions}</strong></div>
						<div><span>Somente A/B</span><strong>{summary.leftOnlyRegions + summary.rightOnlyRegions}</strong></div>
						<div><span>Speaker alterado</span><strong>{summary.speakerChangedRegions}</strong></div>
					</div>

					<div className={styles.baseActions}>
						<span>Escolha editorial explícita:</span>
						<Button size="sm" variant="secondary" disabled={busy} onClick={() => void onChooseBase(loaded.leftRun.sourceId, loaded.leftRun.runId)}>
							Usar A como base de revisão
						</Button>
						<Button size="sm" variant="secondary" disabled={busy} onClick={() => void onChooseBase(loaded.rightRun.sourceId, loaded.rightRun.runId)}>
							Usar B como base de revisão
						</Button>
					</div>

					<div className={styles.filters}>
						<label className={styles.check}>
							<input
								type="checkbox"
								checked={onlyDifferences}
								onChange={(event) => {
									setOnlyDifferences(event.target.checked);
									setPage(0);
									setActiveDifferenceId(null);
								}}
							/>
							<span>Somente divergências</span>
						</label>
						<label>
							<span>Participante</span>
							<select value={speaker} onChange={(event) => { setSpeaker(event.target.value); setPage(0); }}>
								<option value="">Todos</option>
								{speakers.map((value) => <option key={value} value={value}>{value}</option>)}
							</select>
						</label>
						<label>
							<span>Início global (s)</span>
							<input type="number" min="0" step="0.1" value={startInput} onChange={(event) => { setStartInput(event.target.value); setPage(0); }} />
						</label>
						<label>
							<span>Fim global (s)</span>
							<input type="number" min="0" step="0.1" value={endInput} onChange={(event) => { setEndInput(event.target.value); setPage(0); }} />
						</label>
					</div>
					{invalidRange ? <p className={styles.error} role="alert">O início da faixa temporal precisa ser menor ou igual ao fim.</p> : null}

					<div className={styles.navigation}>
						<div>
							<strong>{filtered.length}</strong> regiões após filtros · <strong>{differences.length}</strong> divergências navegáveis
						</div>
						<div>
							<Button size="sm" variant="tertiary" disabled={!differences.length} onClick={() => moveDifference(-1)}>Diferença anterior</Button>
							<Button size="sm" variant="tertiary" disabled={!differences.length} onClick={() => moveDifference(1)}>Próxima diferença</Button>
						</div>
					</div>

					<div className={styles.regionList}>
						{visible.map((item) => (
							<article
								key={item.region.id}
								className={styles.region}
								data-active={activeDifferenceId === item.region.id ? "true" : "false"}
							>
								<header>
									<span>Track {item.region.trackNumber} · {formatTimestamp(item.sessionStart)}–{formatTimestamp(item.sessionEnd)}</span>
									<strong>{differenceLabel(item.region.kind)}{item.region.speakerChanged ? " · speaker diferente" : ""}</strong>
								</header>
								<div className={styles.regionColumns}>
									<SegmentSide label="A" segments={item.region.left} />
									<SegmentSide label="B" segments={item.region.right} />
								</div>
							</article>
						))}
						{visible.length === 0 ? (
							<p className={styles.empty}>Nenhuma região corresponde aos filtros atuais.</p>
						) : null}
					</div>

					{totalPages > 1 ? (
						<div className={styles.pages}>
							<Button size="sm" variant="tertiary" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Anterior</Button>
							<span>Página {safePage + 1} de {totalPages}</span>
							<Button size="sm" variant="tertiary" disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Próxima</Button>
						</div>
					) : null}
				</div>
			) : null}
		</section>
	);
}
