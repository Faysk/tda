"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { LocalBridge } from "./bridge";
import { processingStageLabels, type EngineProcessingMetrics } from "./engine-metrics";
import {
	compareRunPerformanceSemantics,
	compareRunSegments,
	regionOverlapsTimeRange,
	summarizeRunComparison,
} from "./run-comparison";
import type {
	BenchmarkEvidenceSummary,
	BenchmarkResult,
	BenchmarkTranscriptSnapshot,
	TranscriptionProfileId,
} from "./protocol";
import styles from "./benchmark-evidence.module.css";

const LABELS: Record<TranscriptionProfileId, string> = {
	"whisper-turbo": "Whisper Turbo",
	"whisper-detailed": "Whisper Detailed",
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
};

type WorkspaceMode = "compare" | "files";
type ComparisonTab = "text" | "timing" | "performance" | "execution";

function formatSeconds(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	const total = Math.max(0, value);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}m ${seconds.toFixed(total < 60 ? 2 : 1)}s`;
}

function formatTime(value: number): string {
	const milliseconds = Math.max(0, Math.round(value * 1000));
	const minutes = Math.floor(milliseconds / 60_000);
	const seconds = Math.floor((milliseconds % 60_000) / 1000);
	const millis = milliseconds % 1000;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatDelta(value: number): string {
	const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
	return `${sign}${Math.abs(value * 1000).toFixed(0)} ms`;
}

function segmentTimelineBounds(
	segments: readonly {
		start: number;
		end: number;
		timelineStart?: number;
		timelineEnd?: number;
	}[],
): { start: number; end: number } | null {
	if (!segments.length) return null;
	return {
		start: Math.min(...segments.map((segment) => segment.timelineStart ?? segment.start)),
		end: Math.max(...segments.map((segment) => segment.timelineEnd ?? segment.end)),
	};
}

function formatBytes(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "—";
	if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
	if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
	if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
	return `${value} B`;
}

function responseFilename(response: Response, fallback: string): string {
	const disposition = response.headers.get("content-disposition") ?? "";
	const match = /filename="([^"]+)"/u.exec(disposition);
	return match?.[1] ?? fallback;
}

async function saveResponse(
	response: Response,
	fallbackName: string,
	preferStreaming = false,
) {
	const filename = responseFilename(response, fallbackName);
	if (preferStreaming && response.body) {
		const picker = (
			window as Window & {
				showSaveFilePicker?: (options: {
					suggestedName: string;
				}) => Promise<{
					createWritable: () => Promise<WritableStream<Uint8Array>>;
				}>;
			}
		).showSaveFilePicker;
		if (picker) {
			const handle = await picker({ suggestedName: filename });
			const writable = await handle.createWritable();
			await response.body.pipeTo(writable);
			return;
		}
	}
	const blob = await response.blob();
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		anchor.rel = "noopener";
		anchor.click();
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}

function asNumber(value: string): number | null | "invalid" {
	if (!value.trim()) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : "invalid";
}

function regionSpeakers(
	region: ReturnType<typeof compareRunSegments>[number],
): readonly string[] {
	return [
		...new Set(
			[...region.left, ...region.right]
				.map((segment) => segment.speaker)
				.filter(Boolean),
		),
	];
}

function precisionFor(
	snapshot: BenchmarkTranscriptSnapshot,
	segmentIds: readonly string[],
): string {
	const relevant = snapshot.segments.filter((segment) =>
		segmentIds.includes(segment.segmentId),
	);
	if (!relevant.length) return "—";
	return relevant.every((segment) => segment.timingPrecision === "word")
		? "palavra"
		: "segmento";
}

export function BenchmarkEvidenceWorkspace({
	bridge,
	result,
	initialMode,
	promptExport = false,
	onClose,
}: Readonly<{
	bridge: LocalBridge;
	result: BenchmarkResult;
	initialMode: WorkspaceMode;
	promptExport?: boolean;
	onClose: () => void;
}>) {
	const evidenceReady = result.profiles.every(
		(profile) => profile.artifactAvailable,
	);
	const artifacts = useMemo(
		() =>
			result.benchmarkId !== null &&
			result.bundleSizeBytes !== null &&
			evidenceReady
				? {
						benchmarkId: result.benchmarkId,
						bundleSizeBytes: result.bundleSizeBytes,
					}
				: null,
		[result.benchmarkId, result.bundleSizeBytes, evidenceReady],
	);
	const [mode, setMode] = useState<WorkspaceMode>(initialMode);
	const [manifest, setManifest] = useState<BenchmarkEvidenceSummary | null>(null);
	const [snapshots, setSnapshots] = useState<
		Partial<Record<TranscriptionProfileId, BenchmarkTranscriptSnapshot>>
	>({});
	const [leftProfile, setLeftProfile] =
		useState<TranscriptionProfileId>("qwen-fast");
	const [rightProfile, setRightProfile] =
		useState<TranscriptionProfileId>("qwen-quality");
	const [tab, setTab] = useState<ComparisonTab>("text");
	const [diffOnly, setDiffOnly] = useState(true);
	const [track, setTrack] = useState("all");
	const [speaker, setSpeaker] = useState("all");
	const [fromTime, setFromTime] = useState("");
	const [toTime, setToTime] = useState("");
	const [activeDifference, setActiveDifference] = useState(0);
	const [exportOpen, setExportOpen] = useState(promptExport);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setMode(initialMode);
		setExportOpen(promptExport);
	}, [initialMode, promptExport]);

	useEffect(() => {
		if (!artifacts) return;
		const controller = new AbortController();
		setError(null);
		bridge
			.benchmarkEvidence(artifacts.benchmarkId, controller.signal)
			.then((value) => {
				if (
					value.sampleIdentitySha256 !== result.sampleIdentitySha256 ||
					value.sourceId !== result.sourceId
				)
					throw new Error("BENCHMARK_EVIDENCE_IDENTITY_MISMATCH");
				setManifest(value);
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Não foi possível validar o bundle deste benchmark.",
					);
			});
		return () => controller.abort();
	}, [artifacts, bridge, result.sampleIdentitySha256, result.sourceId]);

	useEffect(() => {
		if (!artifacts || mode !== "compare" || leftProfile === rightProfile) return;
		const missing = [leftProfile, rightProfile].filter(
			(profile) => !snapshots[profile],
		);
		if (!missing.length) return;
		const controller = new AbortController();
		setBusy("Carregando transcrições selecionadas…");
		setError(null);
		Promise.all(
			missing.map(async (profile) => {
				const snapshot = await bridge.benchmarkTranscript(
					artifacts.benchmarkId,
					profile,
					controller.signal,
				);
				if (
					snapshot.sampleIdentitySha256 !== result.sampleIdentitySha256 ||
					snapshot.sourceId !== result.sourceId
				)
					throw new Error("BENCHMARK_TRANSCRIPT_IDENTITY_MISMATCH");
				return snapshot;
			}),
		)
			.then((loaded) => {
				setSnapshots((current) => {
					const next = { ...current };
					for (const snapshot of loaded) next[snapshot.profileId] = snapshot;
					return next;
				});
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Não foi possível carregar as transcrições selecionadas.",
					);
			})
			.finally(() => {
				if (!controller.signal.aborted) setBusy(null);
			});
		return () => controller.abort();
	}, [
		artifacts,
		bridge,
		leftProfile,
		mode,
		result.sampleIdentitySha256,
		result.sourceId,
		rightProfile,
		snapshots,
	]);

	const left = snapshots[leftProfile] ?? null;
	const right = snapshots[rightProfile] ?? null;
	const allRegions = useMemo(
		() =>
			left && right && leftProfile !== rightProfile
				? compareRunSegments(left.segments, right.segments)
				: [],
		[left, leftProfile, right, rightProfile],
	);
	const summary = useMemo(() => summarizeRunComparison(allRegions), [allRegions]);
	const tracks = useMemo(
		() => [...new Set(allRegions.map((region) => region.trackNumber))].sort((a, b) => a - b),
		[allRegions],
	);
	const speakers = useMemo(
		() => [...new Set(allRegions.flatMap(regionSpeakers))].sort((a, b) => a.localeCompare(b)),
		[allRegions],
	);
	const timeStart = asNumber(fromTime);
	const timeEnd = asNumber(toTime);
	const timeInvalid =
		timeStart === "invalid" ||
		timeEnd === "invalid" ||
		(typeof timeStart === "number" &&
			typeof timeEnd === "number" &&
			timeStart > timeEnd);

	const filteredRegions = useMemo(() => {
		if (timeInvalid) return [];
		return allRegions.filter((region) => {
			if (
				diffOnly &&
				region.kind === "equal" &&
				!region.speakerChanged
			)
				return false;
			if (track !== "all" && region.trackNumber !== Number(track)) return false;
			if (speaker !== "all" && !regionSpeakers(region).includes(speaker))
				return false;
			return regionOverlapsTimeRange(region, timeStart, timeEnd);
		});
	}, [
		allRegions,
		diffOnly,
		speaker,
		timeEnd,
		timeInvalid,
		timeStart,
		track,
	]);

	const differenceIndexes = useMemo(
		() =>
			filteredRegions
				.map((region, index) =>
					region.kind !== "equal" || region.speakerChanged ? index : -1,
				)
				.filter((index) => index >= 0),
		[filteredRegions],
	);
	const activeRegionIndex =
		differenceIndexes.length > 0
			? differenceIndexes[
					Math.min(activeDifference, differenceIndexes.length - 1)
				]!
			: -1;

	function moveDifference(direction: -1 | 1) {
		if (!differenceIndexes.length) return;
		setActiveDifference((current) => {
			const next =
				(current + direction + differenceIndexes.length) %
				differenceIndexes.length;
			const regionIndex = differenceIndexes[next]!;
			requestAnimationFrame(() => {
				const element = document.getElementById(`benchmark-region-${regionIndex}`);
				if (!element) return;
				element.focus({ preventScroll: true });
				const reducedMotion = window.matchMedia(
					"(prefers-reduced-motion: reduce)",
				).matches;
				element.scrollIntoView({
					block: "nearest",
					behavior: reducedMotion ? "auto" : "smooth",
				});
			});
			return next;
		});
	}

	async function downloadArtifact(
		profileId: TranscriptionProfileId,
		format: "json" | "txt" | "txt-plain" | "vtt" | "srt",
	) {
		if (!artifacts) return;
		const key = `${profileId}:${format}`;
		setBusy(key);
		setError(null);
		const controller = new AbortController();
		try {
			const response = await bridge.benchmarkArtifact(
				artifacts.benchmarkId,
				profileId,
				format,
				controller.signal,
			);
			await saveResponse(
				response,
				`TDA-Benchmark-${artifacts.benchmarkId}-${profileId}-transcript.${format}`,
			);
		} catch (cause) {
			if ((cause as DOMException)?.name !== "AbortError")
				setError(
					cause instanceof Error ? cause.message : "Falha ao baixar o artefato.",
				);
		} finally {
			setBusy(null);
		}
	}

	async function exportZip() {
		if (!artifacts) return;
		setExportOpen(false);
		setBusy("zip");
		setError(null);
		const controller = new AbortController();
		try {
			const response = await bridge.benchmarkEvidenceZip(
				artifacts.benchmarkId,
				controller.signal,
			);
			await saveResponse(
				response,
				`TDA-Benchmark-${artifacts.benchmarkId}-private-evidence.zip`,
				true,
			);
		} catch (cause) {
			if ((cause as DOMException)?.name !== "AbortError")
				setError(
					cause instanceof Error
						? cause.message
						: "Falha ao exportar o ZIP privado.",
				);
		} finally {
			setBusy(null);
		}
	}

	if (!artifacts) {
		return (
			<section className={styles.workspace}>
				<div className={styles.header}>
					<div>
						<span className={styles.eyebrow}>Benchmark legado</span>
						<h2>Evidência detalhada indisponível</h2>
						<p>
							Este receipt é anterior ao contrato de artefatos. As métricas continuam
							válidas, mas não há transcript persistido para comparar ou exportar.
						</p>
					</div>
					<Button variant="tertiary" onClick={onClose}>Fechar</Button>
				</div>
			</section>
		);
	}

	const comparability =
		left && right ? compareRunPerformanceSemantics(left, right) : null;

	return (
		<section className={styles.workspace} aria-label="Evidências do Benchmark">
			<div className={styles.sticky}>
				<div className={styles.header}>
					<div>
						<span className={styles.eyebrow}>Benchmark local · evidência privada</span>
						<h2>
							{mode === "compare"
								? "Comparar transcrições"
								: "Arquivos e exportação"}
						</h2>
						<p>
							Mesma amostra {result.sampleIdentitySha256.slice(0, 12)}… ·{" "}
							{formatBytes(manifest?.bundleSizeBytes ?? artifacts.bundleSizeBytes)} ·{" "}
							{manifest?.integrity === "manifest_verified"
								? "manifesto verificado · transcript hash ao abrir"
								: "verificando manifesto"} ·{" "}
							{manifest?.qualityReferenceStatus === "none"
								? "sem referência humana"
								: "referência disponível"}
						</p>
					</div>
					<div className={styles.actions}>
						<Button
							size="sm"
							variant={mode === "compare" ? "secondary" : "tertiary"}
							onClick={() => setMode("compare")}
						>
							Comparar
						</Button>
						<Button
							size="sm"
							variant={mode === "files" ? "secondary" : "tertiary"}
							onClick={() => setMode("files")}
						>
							Arquivos
						</Button>
						<Button size="sm" variant="tertiary" onClick={onClose}>
							Fechar
						</Button>
					</div>
				</div>

				{mode === "compare" ? (
					<>
						<div className={styles.selectors}>
							<label>
								Perfil A
								<Select
									value={leftProfile}
									options={result.profiles.map((profile) => ({
										value: profile.profileId,
										label: LABELS[profile.profileId],
										disabled: profile.profileId === rightProfile,
									}))}
									onChange={(value) => setLeftProfile(value as TranscriptionProfileId)}
									ariaLabel="Perfil A"
									compact
								/>
							</label>
							<label>
								Perfil B
								<Select
									value={rightProfile}
									options={result.profiles.map((profile) => ({
										value: profile.profileId,
										label: LABELS[profile.profileId],
										disabled: profile.profileId === leftProfile,
									}))}
									onChange={(value) => setRightProfile(value as TranscriptionProfileId)}
									ariaLabel="Perfil B"
									compact
								/>
							</label>
							{leftProfile === rightProfile ? (
								<span className={styles.muted}>
									Escolha dois perfis diferentes.
								</span>
							) : null}
						</div>
						<div className={styles.tabs} role="tablist" aria-label="Camada da comparação">
							{([
								["text", "Texto"],
								["timing", "Timing"],
								["performance", "Performance"],
								["execution", "Execução"],
							] as const).map(([value, label]) => (
								<Button
									key={value}
									size="sm"
									variant="tertiary"
									role="tab"
									aria-selected={tab === value}
									onClick={() => setTab(value)}
								>
									{label}
								</Button>
							))}
						</div>
					</>
				) : null}
			</div>

			{error ? <p className={styles.error} role="alert">{error}</p> : null}
			{busy ? <p className={styles.loading} role="status">{busy}</p> : null}

			{mode === "compare" ? (
				<>
					<div className={styles.notice}>
						<strong>Qualidade não medida.</strong>
						<p>
							Sem referência humana, este comparador mostra diferenças factuais de
							texto/timing e métricas. Não calcula WER nem declara um perfil vencedor.
						</p>
					</div>
					{left && right && leftProfile !== rightProfile ? (
						<>
							<div className={styles.summary}>
								<span>{summary.totalRegions} regiões</span>
								<span>{summary.differentRegions} diferenças</span>
								<span>{summary.speakerChangedRegions} speaker changes</span>
								<span>{summary.leftOnlyRegions} só A</span>
								<span>{summary.rightOnlyRegions} só B</span>
							</div>

							{tab === "text" || tab === "timing" ? (
								<>
									<div className={styles.filters}>
										<label>
											Track
											<Select
												value={track}
												options={[
													{ value: "all", label: "Todas" },
													...tracks.map((value) => ({ value: String(value), label: `Track ${value}` })),
												]}
												onChange={setTrack}
												ariaLabel="Filtrar por track"
												compact
											/>
										</label>
										<label>
											Speaker
											<Select
												value={speaker}
												options={[
													{ value: "all", label: "Todos" },
													...speakers.map((value) => ({ value, label: value })),
												]}
												onChange={setSpeaker}
												ariaLabel="Filtrar por speaker"
												compact
											/>
										</label>
										<label>
											De (s)
											<input
												inputMode="decimal"
												value={fromTime}
												onChange={(event) => setFromTime(event.target.value)}
											/>
										</label>
										<label>
											Até (s)
											<input
												inputMode="decimal"
												value={toTime}
												onChange={(event) => setToTime(event.target.value)}
											/>
										</label>
										<label>
											<input
												type="checkbox"
												checked={diffOnly}
												onChange={(event) => setDiffOnly(event.target.checked)}
											/>
											Somente diferenças
										</label>
									</div>
									{timeInvalid ? (
										<p className={styles.error}>Faixa de tempo inválida.</p>
									) : null}
									<div className={styles.nav}>
										<Button
											size="sm"
											variant="tertiary"
											disabled={!differenceIndexes.length}
											onClick={() => moveDifference(-1)}
										>
											← Diferença anterior
										</Button>
										<span className={styles.muted}>
											{differenceIndexes.length
												? `${Math.min(activeDifference + 1, differenceIndexes.length)} / ${differenceIndexes.length}`
												: "Sem diferenças"}
										</span>
										<Button
											size="sm"
											variant="tertiary"
											disabled={!differenceIndexes.length}
											onClick={() => moveDifference(1)}
										>
											Próxima diferença →
										</Button>
									</div>
									<div className={styles.regions}>
										{filteredRegions.length ? (
											filteredRegions.map((region, index) => {
												const leftIds = region.left.map((segment) => segment.segmentId);
												const rightIds = region.right.map((segment) => segment.segmentId);
												return (
													<article
														id={`benchmark-region-${index}`}
														key={region.id}
														className={styles.region}
														data-kind={region.kind}
														data-active={index === activeRegionIndex}
														tabIndex={-1}
													>
														<div className={styles.regionHeader}>
															<strong>
																Track {region.trackNumber} · {region.kind}
																{region.speakerChanged ? " · speaker diferente" : ""}
															</strong>
															<span>
																{formatTime(region.sessionStart)} → {formatTime(region.sessionEnd)}
															</span>
														</div>
														{tab === "timing" ? (() => {
															const leftBounds = segmentTimelineBounds(region.left);
															const rightBounds = segmentTimelineBounds(region.right);
															return (
																<p className={styles.timingDelta}>
																	{leftBounds && rightBounds
																		? `Δ início ${formatDelta(rightBounds.start - leftBounds.start)} · Δ fim ${formatDelta(rightBounds.end - leftBounds.end)}`
																		: "Região presente em apenas um dos lados; delta A/B não é aplicável."}
																</p>
															);
														})() : null}
														<div className={styles.columns}>
															<div className={styles.column}>
																<strong>A · {LABELS[leftProfile]}</strong>
																<small>
																	{region.left.length
																		? region.left.map((segment) => segment.speaker).join(" · ")
																		: "ausente"}
																</small>
																{tab === "timing" ? (() => {
																	const bounds = segmentTimelineBounds(region.left);
																	return (
																		<small>
																			{bounds
																				? `${formatTime(bounds.start)} → ${formatTime(bounds.end)} · `
																				: ""}
																			Precisão {precisionFor(left, leftIds)} · alinhamento {left.alignment} · {left.warnings.length} aviso{left.warnings.length === 1 ? "" : "s"}
																		</small>
																	);
																})() : null}
																<p>{region.leftText || "∅"}</p>
															</div>
															<div className={styles.column}>
																<strong>B · {LABELS[rightProfile]}</strong>
																<small>
																	{region.right.length
																		? region.right.map((segment) => segment.speaker).join(" · ")
																		: "ausente"}
																</small>
																{tab === "timing" ? (() => {
																	const bounds = segmentTimelineBounds(region.right);
																	return (
																		<small>
																			{bounds
																				? `${formatTime(bounds.start)} → ${formatTime(bounds.end)} · `
																				: ""}
																			Precisão {precisionFor(right, rightIds)} · alinhamento {right.alignment} · {right.warnings.length} aviso{right.warnings.length === 1 ? "" : "s"}
																		</small>
																	);
																})() : null}
																<p>{region.rightText || "∅"}</p>
															</div>
														</div>
													</article>
												);
											})
										) : (
											<p className={styles.empty}>Nenhuma região corresponde aos filtros.</p>
										)}
									</div>
								</>
							) : null}

							{tab === "performance" ? (
								<>
									<div className={styles.notice}>
										<strong>
											Comparabilidade: {comparability?.status === "comparable" ? "comprovada" : "limitada"}
										</strong>
										<p>
											{comparability?.reasons.length
												? comparability.reasons.join(" · ")
												: "Mesmo dispositivo físico, runtime identificado e trabalho fresco conforme métricas registradas."}
										</p>
									</div>
									<div className={styles.tableWrap}>
										<table>
											<thead>
												<tr>
													<th>Perfil</th>
													<th>Tempo</th>
													<th>RTF</th>
													<th>Áudio</th>
													<th>Palavras</th>
													<th>Segmentos</th>
													<th>Turnos</th>
													<th>Tracks</th>
													<th>Avisos</th>
												</tr>
											</thead>
											<tbody>
												{[left, right].map((snapshot) => (
													<tr key={snapshot.profileId}>
														<th>{LABELS[snapshot.profileId]}</th>
														<td>{formatSeconds(snapshot.stats.processingSeconds)}</td>
														<td>{snapshot.stats.rtf?.toFixed(3) ?? "—"}</td>
														<td>{formatSeconds(snapshot.stats.audioWorkSeconds)}</td>
														<td>{snapshot.stats.wordCount ?? "—"}</td>
														<td>{snapshot.stats.segmentCount ?? "—"}</td>
														<td>{snapshot.stats.turnCount ?? "—"}</td>
														<td>{snapshot.stats.trackCount ?? "—"}</td>
														<td>{snapshot.stats.warningCount ?? "—"}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									<div className={styles.tableWrap}>
										<table>
											<thead>
												<tr>
													<th>Stage</th>
													<th>{LABELS[leftProfile]}</th>
													<th>{LABELS[rightProfile]}</th>
												</tr>
											</thead>
											<tbody>
												{Object.keys(processingStageLabels).map((stage) => (
													<tr key={stage}>
														<th>{processingStageLabels[stage] ?? stage}</th>
														<td>
															{formatSeconds(
																left.stats.processingMetrics?.stageSeconds[
																	stage as keyof EngineProcessingMetrics["stageSeconds"]
																] ?? null,
															)}
														</td>
														<td>
															{formatSeconds(
																right.stats.processingMetrics?.stageSeconds[
																	stage as keyof EngineProcessingMetrics["stageSeconds"]
																] ?? null,
															)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									<p className={styles.muted}>
										VRAM pico/média: indisponível neste bundle quando a telemetria
										não foi coletada pelo contrato local; nenhum valor é inferido.
									</p>
								</>
							) : null}

							{tab === "execution" ? (
								<div className={styles.tableWrap}>
									<table>
										<thead>
											<tr>
												<th>Perfil</th>
												<th>Modelo / revisão</th>
												<th>Runtime</th>
												<th>Companion</th>
												<th>Compute</th>
												<th>Alinhamento</th>
												<th>GPU / dispositivo</th>
												<th>Archive SHA-256</th>
												<th>Worker SHA-256</th>
											</tr>
										</thead>
										<tbody>
											{[left, right].map((snapshot) => (
												<tr key={snapshot.profileId}>
													<th>{LABELS[snapshot.profileId]}</th>
													<td>
														{snapshot.model}
														{snapshot.modelRevision ? ` · ${snapshot.modelRevision}` : ""}
													</td>
													<td>
														{snapshot.executionLineage?.runtimeFamily ?? "—"}{" "}
														{snapshot.executionLineage?.runtimeVersion ?? ""}
													</td>
													<td>{snapshot.executionLineage?.companionVersion ?? "—"}</td>
													<td>{snapshot.computeType ?? snapshot.device}</td>
													<td>{snapshot.alignment}</td>
													<td>
														{snapshot.executionLineage?.gpu?.model ?? snapshot.device}
														{snapshot.executionLineage?.executionDevice?.physicalUuid
															? ` · ${snapshot.executionLineage.executionDevice.physicalUuid}`
															: ""}
														{snapshot.executionLineage?.executionDevice?.pciBusId
															? ` · PCI ${snapshot.executionLineage.executionDevice.pciBusId}`
															: ""}
													</td>
													<td className={styles.hash}>
														{snapshot.executionLineage?.runtimeArtifact?.archiveSha256 ?? "—"}
													</td>
													<td className={styles.hash}>
														{snapshot.executionLineage?.runtimeArtifact?.workerSha256 ?? "—"}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : null}
						</>
					) : leftProfile !== rightProfile && !busy ? (
						<p className={styles.loading}>Carregando os dois perfis selecionados…</p>
					) : null}
				</>
			) : (
				<div className={styles.files}>
					<div className={styles.notice}>
						<strong>Arquivos privados locais.</strong>
						<p>
							JSON é o transcript canônico hash-verificado. TXT, VTT e SRT são derivados
							determinísticos. O ZIP inclui transcripts, métricas e eventos dos quatro perfis;
							não inclui áudio nem publica nada na nuvem.
						</p>
					</div>
					{(manifest?.profileOrder ?? result.profiles.map((profile) => profile.profileId)).map(
						(profileId) => (
							<div className={styles.fileRow} key={profileId}>
								<strong>{LABELS[profileId]}</strong>
								<div className={styles.fileActions}>
									{(["json", "txt", "txt-plain", "vtt", "srt"] as const).map((format) => (
										<Button
											key={format}
											size="sm"
											variant="tertiary"
											pending={busy === `${profileId}:${format}`}
											onClick={() => void downloadArtifact(profileId, format)}
										>
											{format === "txt-plain" ? "TXT simples" : format.toUpperCase()}
										</Button>
									))}
								</div>
							</div>
						),
					)}
					<div className={styles.actions}>
						<Button
							variant="primary"
							pending={busy === "zip"}
							onClick={() => setExportOpen(true)}
						>
							Exportar evidência privada (.zip)
						</Button>
						<span className={styles.muted}>
							Gerado pelo Companion e transferido como stream quando o navegador permite.
						</span>
					</div>
				</div>
			)}

			<Dialog
				open={exportOpen}
				title="Exportar evidência privada do Benchmark?"
				description={
					<>
						O ZIP contém o transcript completo dos quatro perfis, métricas e eventos
						sanitizados. Não contém áudio e não faz upload para a nuvem.
					</>
				}
				onClose={() => setExportOpen(false)}
				actions={
					<>
						<Button
							variant="tertiary"
							data-dialog-initial-focus
							onClick={() => setExportOpen(false)}
						>
							Cancelar
						</Button>
						<Button variant="primary" onClick={() => void exportZip()}>
							Exportar ZIP privado
						</Button>
					</>
				}
			/>
		</section>
	);
}
