"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@/components/ui";
import type { LocalReview, LocalRunSummary } from "./protocol";
import {
	compareRunPerformanceSemantics,
	compareRunSegments,
	regionOverlapsTimeRange,
	runsShareComparisonSource,
	summarizeRunComparison,
	type RunComparisonRegion,
} from "./run-comparison";
import styles from "./run-comparison-view.module.css";

type Props = Readonly<{
	leftRun: LocalRunSummary;
	rightRun: LocalRunSummary;
	leftReview: LocalReview;
	rightReview: LocalReview;
	onClose: () => void;
	onUseRun: (run: LocalRunSummary) => void | Promise<void>;
}>;

function formatSeconds(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	const seconds = Math.max(0, Math.round(value));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return hours
		? `${hours}h ${String(minutes).padStart(2, "0")}m`
		: minutes
			? `${minutes}m ${String(rest).padStart(2, "0")}s`
			: `${rest}s`;
}

function effectiveProcessingSeconds(run: LocalRunSummary): number | null {
	return (
		run.stats.processingMetrics?.totalProcessingSeconds ??
		run.stats.processingSeconds
	);
}

function effectiveRtf(run: LocalRunSummary): number | null {
	const metrics = run.stats.processingMetrics;
	if (!metrics) return run.stats.rtf;
	const audio = metrics.freshAudioWorkSeconds + metrics.reusedAudioWorkSeconds;
	return audio > 0 ? metrics.totalProcessingSeconds / audio : null;
}

function formatRealtime(rtf: number | null): string {
	return rtf !== null && rtf > 0 ? `${(1 / rtf).toFixed(2)}×` : "—";
}

function reviewStatus(run: LocalRunSummary): string {
	const status = run.review?.status;
	if (status === "approved_local") return "Aprovado localmente";
	if (status === "reviewed") return "Revisado";
	if (status === "draft") return "Draft";
	if (status === "unknown") return "Desconhecido";
	return "Sem revisão";
}

function runFacts(run: LocalRunSummary) {
	const rtf = effectiveRtf(run);
	return [
		["Perfil", run.profileId],
		["Engine", [run.engine, run.model].filter(Boolean).join(" · ") || "—"],
		["Model revision", run.modelRevision ?? "—"],
		["Processamento", formatSeconds(effectiveProcessingSeconds(run))],
		["Duração da sessão", formatSeconds(run.stats.sessionDurationSeconds)],
		["Audio work", formatSeconds(run.stats.audioWorkSeconds)],
		["RTF", rtf === null ? "—" : rtf.toFixed(3)],
		["× realtime", formatRealtime(rtf)],
		["Palavras", run.stats.wordCount ?? "—"],
		["Segmentos", run.stats.segmentCount ?? "—"],
		["Turnos", run.stats.turnCount ?? "—"],
		["Tracks", run.stats.trackCount ?? "—"],
		["Warnings", run.stats.warningCount ?? "—"],
		["Revisão", reviewStatus(run)],
		["Runtime", [run.executionLineage?.runtimeFamily, run.executionLineage?.runtimeVersion].filter(Boolean).join(" ") || "—"],
		["GPU", run.executionLineage?.gpu?.model ?? "—"],
	] as const;
}

function parseTimeFilter(value: string): number | null {
	if (value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function speakersFor(region: RunComparisonRegion): string[] {
	return [
		...region.left.map((segment) => segment.speaker),
		...region.right.map((segment) => segment.speaker),
	].filter(Boolean);
}

function ComparisonColumn({
	label,
	text,
	speakers,
}: Readonly<{ label: string; text: string; speakers: readonly string[] }>) {
	const speakerLabel = [...new Set(speakers.filter(Boolean))].join(", ");
	return (
		<div className={styles.regionColumn}>
			<span>{label}</span>
			{speakerLabel ? <small>{speakerLabel}</small> : null}
			<p>{text || "—"}</p>
		</div>
	);
}

export function RunComparisonView({
	leftRun,
	rightRun,
	leftReview,
	rightReview,
	onClose,
	onUseRun,
}: Props) {
	if (!runsShareComparisonSource(leftRun, rightRun))
		throw new Error("RUN_COMPARISON_SOURCE_MISMATCH");
	if (
		leftReview.sourceId !== leftRun.sourceId ||
		rightReview.sourceId !== rightRun.sourceId ||
		leftReview.runId !== leftRun.runId ||
		rightReview.runId !== rightRun.runId
	)
		throw new Error("RUN_COMPARISON_SNAPSHOT_MISMATCH");

	const regions = useMemo(
		() => compareRunSegments(leftReview.segments, rightReview.segments),
		[leftReview.segments, rightReview.segments],
	);
	const summary = useMemo(() => summarizeRunComparison(regions), [regions]);
	const performanceComparability = useMemo(
		() => compareRunPerformanceSemantics(leftRun, rightRun),
		[leftRun, rightRun],
	);
	const tracks = useMemo(
		() => [...new Set(regions.map((region) => region.trackNumber))].sort((a, b) => a - b),
		[regions],
	);
	const speakers = useMemo(
		() => [...new Set(regions.flatMap(speakersFor))].sort((a, b) => a.localeCompare(b, "pt-BR")),
		[regions],
	);
	const [differencesOnly, setDifferencesOnly] = useState(true);
	const [trackFilter, setTrackFilter] = useState("all");
	const [speakerFilter, setSpeakerFilter] = useState("all");
	const [timeStartFilter, setTimeStartFilter] = useState("");
	const [timeEndFilter, setTimeEndFilter] = useState("");
	const [activeDifference, setActiveDifference] = useState(0);
	const timeStart = parseTimeFilter(timeStartFilter);
	const timeEnd = parseTimeFilter(timeEndFilter);
	const timeRangeInvalid =
		Number.isNaN(timeStart) ||
		Number.isNaN(timeEnd) ||
		(timeStart !== null && timeEnd !== null && timeStart > timeEnd);

	const visible = useMemo(
		() =>
			regions.filter((region) => {
				if (
					differencesOnly &&
					region.kind === "equal" &&
					!region.speakerChanged
				)
					return false;
				if (
					trackFilter !== "all" &&
					region.trackNumber !== Number(trackFilter)
				)
					return false;
				if (
					speakerFilter !== "all" &&
					!speakersFor(region).includes(speakerFilter)
				)
					return false;
				if (timeRangeInvalid) return false;
				return regionOverlapsTimeRange(region, timeStart, timeEnd);
			}),
		[
			regions,
			differencesOnly,
			speakerFilter,
			trackFilter,
			timeEnd,
			timeRangeInvalid,
			timeStart,
		],
	);
	const differences = useMemo(
		() =>
			visible
				.map((region, index) => ({ region, index }))
				.filter(
					({ region }) =>
						region.kind !== "equal" || region.speakerChanged,
				),
		[visible],
	);

	useEffect(() => {
		if (differences.length === 0) {
			if (activeDifference !== 0) setActiveDifference(0);
			return;
		}
		if (activeDifference >= differences.length)
			setActiveDifference(differences.length - 1);
	}, [activeDifference, differences.length]);

	useEffect(() => {
		const target = differences[activeDifference];
		if (!target) return;
		document
			.getElementById(`run-comparison-region-${target.index}`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeDifference, differences]);

	const activeVisibleIndex = differences[activeDifference]?.index ?? -1;

	return (
		<section className={styles.comparison} aria-labelledby="run-comparison-title">
			<header className={styles.header}>
				<div>
					<span className={styles.eyebrow}>Comparação local A/B</span>
					<h2 id="run-comparison-title">Dois runs da mesma fonte</h2>
					<p>
						Alinhamento por track e tempo. Nenhum run é alterado e nenhum
						resultado é publicado por esta comparação.
					</p>
				</div>
				<Button size="sm" variant="tertiary" onClick={onClose}>
					Voltar aos resultados
				</Button>
			</header>

			<div className={styles.runFacts}>
				{[
					{ label: "Run A", run: leftRun },
					{ label: "Run B", run: rightRun },
				].map(({ label, run }) => (
					<article key={run.runId}>
						<div className={styles.runTitle}>
							<strong>{label}</strong>
							<span>{run.profileId}</span>
						</div>
						<dl>
							{runFacts(run).map(([name, value]) => (
								<div key={name}>
									<dt>{name}</dt>
									<dd>{value}</dd>
								</div>
							))}
						</dl>
						<Button
							size="sm"
							variant="tertiary"
							onClick={() => void onUseRun(run)}
						>
							Usar {label} como base
						</Button>
					</article>
				))}
			</div>

			<fieldset className={styles.summary} aria-label="Resumo das diferenças">
				<span>{summary.totalRegions} regiões alinhadas</span>
				<span>{summary.differentRegions} divergentes</span>
				<span>{summary.speakerChangedRegions} com speaker diferente</span>
				<span>{summary.leftOnlyRegions} somente A</span>
				<span>{summary.rightOnlyRegions} somente B</span>
			</fieldset>

			<div
				className={styles.comparability}
				data-status={performanceComparability.status}
				role="status"
			>
				<strong>
					Comparabilidade de performance:{" "}
					{performanceComparability.status === "comparable"
						? "comparável"
						: "limitada"}
				</strong>
				<span>
					{performanceComparability.status === "comparable"
						? "Mesma identidade física de execução, métricas engine_processing_v1 frescas e semântica de duração equivalente."
						: performanceComparability.reasons.join(" · ")}
				</span>
			</div>

			<div className={styles.toolbar}>
				<label className={styles.checkbox}>
					<input
						type="checkbox"
						checked={differencesOnly}
						onChange={(event) => setDifferencesOnly(event.target.checked)}
					/>
					<span>Somente divergências</span>
				</label>
				<div>
					<span>Track</span>
					<Select
						value={trackFilter}
						options={[
							{ value: "all", label: "Todas" },
							...tracks.map((track) => ({ value: String(track), label: `Track ${track}` })),
						]}
						onChange={setTrackFilter}
						ariaLabel="Filtrar comparação por track"
						compact
					/>
				</div>
				<div>
					<span>Participante</span>
					<Select
						value={speakerFilter}
						options={[
							{ value: "all", label: "Todos" },
							...speakers.map((speaker) => ({ value: speaker, label: speaker })),
						]}
						onChange={setSpeakerFilter}
						ariaLabel="Filtrar comparação por participante"
						compact
					/>
				</div>
				<fieldset className={styles.timeRange}>
					<legend>Faixa na sessão (s)</legend>
					<label>
						<span>De</span>
						<input
							aria-label="Início da faixa da sessão (s)"
							type="number"
							min="0"
							step="0.1"
							inputMode="decimal"
							value={timeStartFilter}
							onChange={(event) => setTimeStartFilter(event.target.value)}
						/>
					</label>
					<label>
						<span>Até</span>
						<input
							aria-label="Fim da faixa da sessão (s)"
							type="number"
							min="0"
							step="0.1"
							inputMode="decimal"
							value={timeEndFilter}
							onChange={(event) => setTimeEndFilter(event.target.value)}
						/>
					</label>
				</fieldset>
				<div className={styles.navigation}>
					<Button
						size="sm"
						variant="tertiary"
						disabled={differences.length === 0}
						onClick={() =>
							setActiveDifference((current) =>
								Math.max(0, current - 1),
							)
						}
					>
						Anterior
					</Button>
					<span>
						{differences.length
							? `${activeDifference + 1} / ${differences.length}`
							: "sem divergências"}
					</span>
					<Button
						size="sm"
						variant="tertiary"
						disabled={differences.length === 0}
						onClick={() =>
							setActiveDifference((current) =>
								Math.min(differences.length - 1, current + 1),
							)
						}
					>
						Próxima
					</Button>
				</div>
			</div>
			{timeRangeInvalid ? (
				<p className={styles.filterError} role="status">
					A faixa temporal precisa usar segundos positivos e o início não pode ser maior que o fim.
				</p>
			) : null}

			<div className={styles.regions}>
				{visible.map((region, index) => (
					<article
						id={`run-comparison-region-${index}`}
						key={region.id}
						className={styles.region}
						data-run-comparison-region="true"
						data-kind={region.kind}
						data-active={index === activeVisibleIndex ? "true" : "false"}
					>
						<header>
							<strong>
								Track {region.trackNumber} · {region.sessionStart.toFixed(2)}–
								{region.sessionEnd.toFixed(2)}s da sessão
								{Math.abs(region.sessionStart - region.start) > 0.001 ||
								Math.abs(region.sessionEnd - region.end) > 0.001
									? ` · ${region.start.toFixed(2)}–${region.end.toFixed(2)}s na track`
									: ""}
							</strong>
							<span>
								{region.kind === "equal"
									? region.speakerChanged
										? "texto igual · speaker diferente"
										: "igual"
									: region.kind === "changed"
										? "texto diferente"
										: region.kind === "left_only"
											? "somente A"
											: "somente B"}
							</span>
						</header>
						<div className={styles.regionGrid}>
							<ComparisonColumn
								label="Run A"
								text={region.leftText}
								speakers={region.left.map((segment) => segment.speaker)}
							/>
							<ComparisonColumn
								label="Run B"
								text={region.rightText}
								speakers={region.right.map((segment) => segment.speaker)}
							/>
						</div>
					</article>
				))}
				{visible.length === 0 ? (
					<p className={styles.empty}>
						Nenhuma região corresponde aos filtros atuais.
					</p>
				) : null}
			</div>
		</section>
	);
}
