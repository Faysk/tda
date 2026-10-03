"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
	BenchmarkProfileMetrics,
	BenchmarkProfileTelemetry,
	BenchmarkQualitySummary,
	BenchmarkReference,
	BenchmarkReferenceTrack,
	BenchmarkResult,
	BenchmarkTranscript,
	TranscriptionProfileId,
} from "./protocol";
import { LocalBridge } from "./bridge";
import {
	compareRunSegments,
	summarizeRunComparison,
	type RunComparisonRegion,
} from "./run-comparison";
import styles from "./benchmark-evidence.module.css";

const PROFILES = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
] as const satisfies readonly TranscriptionProfileId[];

const LABELS: Record<TranscriptionProfileId, string> = {
	"whisper-turbo": "Whisper Turbo",
	"whisper-detailed": "Whisper Detailed",
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
};

type View = "text" | "timing" | "performance" | "execution";
type ProfileMap<T> = Partial<Record<TranscriptionProfileId, T>>;

function humanBytes(bytes: number | null): string {
	if (bytes === null || !Number.isFinite(bytes)) return "—";
	const units = ["B", "KiB", "MiB", "GiB"];
	let value = bytes;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function percent(value: number | null): string {
	return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(2)}%`;
}

function number(value: number | null, suffix = ""): string {
	return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}${suffix}`;
}

function compactTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const rest = seconds - minutes * 60;
	return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function trackDraft(transcript: BenchmarkTranscript): BenchmarkReferenceTrack[] {
	const tracks = new Map<number, { speaker: string | null; values: string[] }>();
	for (const segment of transcript.segments) {
		const current = tracks.get(segment.trackNumber) ?? {
			speaker: segment.speaker || null,
			values: [],
		};
		current.values.push(segment.text);
		tracks.set(segment.trackNumber, current);
	}
	return [...tracks]
		.sort(([left], [right]) => left - right)
		.map(([trackNumber, value]) => ({
			trackNumber,
			speaker: value.speaker,
			text: value.values.join(" ").replace(/\s+/gu, " ").trim(),
		}));
}

function ComparisonRows({
	regions,
	mode,
	scopeId,
}: Readonly<{
	regions: readonly RunComparisonRegion[];
	mode: "text" | "timing";
	scopeId: string;
}>) {
	const [trackFilter, setTrackFilter] = useState("all");
	const [startFilter, setStartFilter] = useState("");
	const [endFilter, setEndFilter] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const different = regions.filter(
		(region) => region.kind !== "equal" || region.speakerChanged,
	);
	const tracks = [...new Set(different.map((region) => region.trackNumber))].sort(
		(left, right) => left - right,
	);
	const startSeconds =
		startFilter.trim() === "" ? null : Number.parseFloat(startFilter);
	const endSeconds = endFilter.trim() === "" ? null : Number.parseFloat(endFilter);
	const filtered = different.filter((region) => {
		if (trackFilter !== "all" && region.trackNumber !== Number(trackFilter))
			return false;
		if (
			startSeconds !== null &&
			Number.isFinite(startSeconds) &&
			region.sessionEnd < startSeconds
		)
			return false;
		if (
			endSeconds !== null &&
			Number.isFinite(endSeconds) &&
			region.sessionStart > endSeconds
		)
			return false;
		return true;
	});
	const visible = filtered.slice(0, 80);

	useEffect(() => {
		setActiveIndex(0);
	}, [trackFilter, startFilter, endFilter, regions]);

	function jump(delta: number) {
		if (!visible.length) return;
		const next = (activeIndex + delta + visible.length) % visible.length;
		setActiveIndex(next);
		window.requestAnimationFrame(() => {
			document
				.getElementById(`${scopeId}-benchmark-diff-${next}`)
				?.focus({ preventScroll: false });
		});
	}

	if (!different.length)
		return <p className={styles.empty}>Nenhuma diferença detectada com a tolerância temporal atual.</p>;
	return (
		<>
			<div className={styles.actions} aria-label="Filtros e navegação das diferenças">
				<label>
					<span>Track</span>
					<select
						aria-label="Filtrar track"
						value={trackFilter}
						onChange={(event) => setTrackFilter(event.target.value)}
					>
						<option value="all">Todas</option>
						{tracks.map((track) => (
							<option key={track} value={track}>Track {track}</option>
						))}
					</select>
				</label>
				<label>
					<span>De (s)</span>
					<input
						aria-label="Tempo inicial em segundos"
						type="number"
						min="0"
						step="0.1"
						value={startFilter}
						onChange={(event) => setStartFilter(event.target.value)}
					/>
				</label>
				<label>
					<span>Até (s)</span>
					<input
						aria-label="Tempo final em segundos"
						type="number"
						min="0"
						step="0.1"
						value={endFilter}
						onChange={(event) => setEndFilter(event.target.value)}
					/>
				</label>
				<Button
					type="button"
					variant="tertiary"
					disabled={!visible.length}
					onClick={() => jump(-1)}
				>
					Diferença anterior
				</Button>
				<Button
					type="button"
					variant="tertiary"
					disabled={!visible.length}
					onClick={() => jump(1)}
				>
					Próxima diferença
				</Button>
				<span aria-live="polite">
					{visible.length ? `Diferença ${activeIndex + 1} de ${visible.length}` : "Nenhuma diferença neste filtro"}
				</span>
			</div>
			{visible.length ? (
				<div className={styles.diffList}>
					{visible.map((region, index) => (
						<article
							key={region.id}
							id={`${scopeId}-benchmark-diff-${index}`}
							tabIndex={-1}
							className={styles.diffRow}
							data-kind={region.kind}
							data-current={index === activeIndex ? "true" : undefined}
						>
							<header>
								<strong>Track {region.trackNumber}</strong>
								<span>
									{compactTime(region.sessionStart)}–{compactTime(region.sessionEnd)}
								</span>
								<span>{region.kind.replace("_", " ")}</span>
								{region.speakerChanged ? <em>speaker mudou</em> : null}
							</header>
							{mode === "text" ? (
								<div className={styles.diffColumns}>
									<p>{region.leftText || "∅"}</p>
									<p>{region.rightText || "∅"}</p>
								</div>
							) : (
								<div className={styles.timingFacts}>
									<span>Esquerda: {region.left.length} segmento(s)</span>
									<span>Direita: {region.right.length} segmento(s)</span>
									<span>Início: {number(region.sessionStart, " s")}</span>
									<span>Fim: {number(region.sessionEnd, " s")}</span>
								</div>
							)}
						</article>
					))}
					{filtered.length > visible.length ? (
						<p className={styles.notice}>
							Mostrando as primeiras {visible.length} de {filtered.length} regiões neste filtro.
						</p>
					) : null}
				</div>
			) : (
				<p className={styles.empty}>Nenhuma diferença corresponde aos filtros atuais.</p>
			)}
		</>
	);
}

export function BenchmarkEvidenceLab({
	result,
	bridge,
}: Readonly<{ result: BenchmarkResult; bridge: LocalBridge }>) {
	const benchmarkId = result.benchmarkId;
	const evidenceReady =
		benchmarkId !== null &&
		result.profiles.every((profile) => profile.artifactAvailable);
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>("text");
	const [left, setLeft] = useState<TranscriptionProfileId>("whisper-turbo");
	const [right, setRight] = useState<TranscriptionProfileId>("qwen-quality");
	const [transcripts, setTranscripts] = useState<ProfileMap<BenchmarkTranscript>>({});
	const [metrics, setMetrics] = useState<ProfileMap<BenchmarkProfileMetrics>>({});
	const [telemetry, setTelemetry] = useState<ProfileMap<BenchmarkProfileTelemetry>>({});
	const [quality, setQuality] = useState<BenchmarkQualitySummary | null>(null);
	const [qualityLoaded, setQualityLoaded] = useState(false);
	const [reference, setReference] = useState<BenchmarkReference | null>(null);
	const [draft, setDraft] = useState<BenchmarkReferenceTrack[]>([]);
	const [referenceOpen, setReferenceOpen] = useState(false);
	const [seedProfile, setSeedProfile] = useState<TranscriptionProfileId | null>(null);
	const [terms, setTerms] = useState("");
	const [busy, setBusy] = useState(false);
	const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function loadProfile(profileId: TranscriptionProfileId, signal: AbortSignal) {
		if (!benchmarkId) return;
		const transcript = transcripts[profileId]
			? transcripts[profileId]!
			: await bridge.benchmarkTranscript(benchmarkId, profileId, signal);
		setTranscripts((current) => ({ ...current, [profileId]: transcript }));
		if (!metrics[profileId]) {
			try {
				const profileMetrics = await bridge.benchmarkProfileMetrics(
					benchmarkId,
					profileId,
					signal,
				);
				setMetrics((current) => ({ ...current, [profileId]: profileMetrics }));
			} catch {
				// Bundles created by the merged #1419 baseline have canonical transcripts
				// but no separate metrics.json diagnostic artifact.
			}
		}
		if (!telemetry[profileId]) {
			try {
				const profileTelemetry = await bridge.benchmarkProfileTelemetry(
					benchmarkId,
					profileId,
					signal,
				);
				setTelemetry((current) => ({ ...current, [profileId]: profileTelemetry }));
			} catch {
				// Telemetry is optional. Missing sensors must not make transcript evidence unreadable.
			}
		}
	}

	useEffect(() => {
		if (!benchmarkId || !evidenceReady) {
			setQuality(null);
			setQualityLoaded(true);
			return;
		}
		const controller = new AbortController();
		setQualityLoaded(false);
		void bridge
			.benchmarkQuality(benchmarkId, controller.signal)
			.then((value) => {
				if (!controller.signal.aborted) setQuality(value);
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Não foi possível verificar o status de qualidade deste benchmark.",
					);
			})
			.finally(() => {
				if (!controller.signal.aborted) setQualityLoaded(true);
			});
		return () => controller.abort();
	}, [benchmarkId, evidenceReady, bridge]);

	useEffect(() => {
		if (!open || !benchmarkId || !evidenceReady) return;
		const controller = new AbortController();
		setBusy(true);
		setError(null);
		void (async () => {
			try {
				await Promise.all([
					loadProfile(left, controller.signal),
					loadProfile(right, controller.signal),
				]);
				const qualityValue = await bridge.benchmarkQuality(
					benchmarkId,
					controller.signal,
				);
				if (controller.signal.aborted) return;
				setQuality(qualityValue);
				setQualityLoaded(true);
			} catch (cause) {
				if (!controller.signal.aborted)
					setError(
						cause instanceof Error
							? cause.message
							: "Não foi possível abrir a evidência deste benchmark.",
					);
			} finally {
				if (!controller.signal.aborted) setBusy(false);
			}
		})();
		return () => controller.abort();
		// Keep this effect tied to explicit pair/evidence changes. Cached profiles avoid re-fetches.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, benchmarkId, evidenceReady, left, right, bridge]);

	const comparison = useMemo(() => {
		const leftTranscript = transcripts[left];
		const rightTranscript = transcripts[right];
		if (!leftTranscript || !rightTranscript) return null;
		if (leftTranscript.sourceSha256 !== rightTranscript.sourceSha256)
			return { regions: [] as RunComparisonRegion[], invalid: true };
		return {
			regions: compareRunSegments(leftTranscript.segments, rightTranscript.segments),
			invalid: false,
		};
	}, [left, right, transcripts]);

	const summary = comparison && !comparison.invalid
		? summarizeRunComparison(comparison.regions)
		: null;

	async function seedReferenceFrom(profileId: TranscriptionProfileId) {
		if (!benchmarkId) return;
		const controller = new AbortController();
		setBusy(true);
		setError(null);
		try {
			await loadProfile(profileId, controller.signal);
			const transcript =
				transcripts[profileId] ??
				(await bridge.benchmarkTranscript(benchmarkId, profileId, controller.signal));
			setTranscripts((current) => ({ ...current, [profileId]: transcript }));
			setDraft(trackDraft(transcript));
			setSeedProfile(profileId);
			setReferenceOpen(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Não foi possível criar o rascunho da referência.");
		} finally {
			setBusy(false);
		}
	}

	async function openReferenceEditor() {
		if (!benchmarkId) return;
		if (reference) {
			setDraft(reference.tracks.slice());
			setSeedProfile(reference.seedProfileId);
			setReferenceOpen(true);
			return;
		}
		if (!quality?.reference) {
			await seedReferenceFrom(left);
			return;
		}
		const controller = new AbortController();
		setBusy(true);
		setError(null);
		try {
			const value = await bridge.benchmarkReference(benchmarkId, controller.signal);
			if (!value)
				throw new Error("A referência indicada pelo receipt não está disponível.");
			setReference(value);
			setDraft(value.tracks.slice());
			setSeedProfile(value.seedProfileId);
			setReferenceOpen(true);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Não foi possível abrir a referência humana.",
			);
		} finally {
			setBusy(false);
		}
	}

	async function saveReference() {
		if (!benchmarkId || !draft.length) return;
		const controller = new AbortController();
		setBusy(true);
		setError(null);
		try {
			const qualityValue = await bridge.saveBenchmarkReference(
				benchmarkId,
				{
					expectedRevision: reference?.revision ?? 0,
					provenance: seedProfile && !reference ? "profile_seed" : "manual",
					seedProfileId: seedProfile,
					tracks: draft,
					terms: terms
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean),
				},
				controller.signal,
			);
			const referenceValue = await bridge.benchmarkReference(
				benchmarkId,
				controller.signal,
			);
			setReference(referenceValue);
			setQuality(qualityValue);
			setReferenceOpen(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Não foi possível salvar a referência.");
		} finally {
			setBusy(false);
		}
	}

	async function exportEvidence() {
		if (!benchmarkId) return;
		const controller = new AbortController();
		setBusy(true);
		setError(null);
		try {
			const blob = await bridge.benchmarkExport(benchmarkId, controller.signal);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `TDA-Benchmark-${benchmarkId}.zip`;
			anchor.rel = "noopener";
			anchor.click();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
			setExportConfirmOpen(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Não foi possível exportar a evidência privada.");
		} finally {
			setBusy(false);
		}
	}

	if (!benchmarkId || !evidenceReady) {
		return (
			<div className={styles.legacy}>
				<strong>Evidência detalhada indisponível.</strong>
				<span>
					Este receipt foi criado antes do bundle imutável de Benchmark. Os dados de performance
					continuam válidos; transcripts não serão inventados nem reconstruídos automaticamente.
				</span>
			</div>
		);
	}

	return (
		<section className={styles.lab} aria-label="Laboratório de evidência do benchmark">
			<div className={styles.actions}>
				<Button type="button" variant="tertiary" onClick={() => setOpen((value) => !value)}>
					{open ? "Fechar laboratório" : "Comparar transcripts"}
				</Button>
				<Button
					type="button"
					variant="tertiary"
					disabled={busy}
					onClick={() => setExportConfirmOpen(true)}
				>
					Exportar evidência ZIP
				</Button>
				<Button
					type="button"
					variant="tertiary"
					disabled={busy}
					onClick={() => void openReferenceEditor()}
				>
					{quality?.reference
						? `Editar referência · r${quality.reference.revision}`
						: "Criar referência humana"}
				</Button>
			</div>
			<div className={styles.evidenceFacts}>
				<span title={benchmarkId}>Evidence {benchmarkId.slice(-10)}</span>
				<span title={result.bundleManifestSha256 ?? undefined}>
					Manifest {result.bundleManifestSha256?.slice(0, 12) ?? "—"}…
				</span>
				<span>{humanBytes(result.bundleSizeBytes)}</span>
				<span>Privado · local · sem áudio</span>
			</div>
			<details>
				<summary>Arquivos / evidências</summary>
				<p className={styles.notice}>
					O bundle contém o benchmark.json e, para cada perfil, transcript.json canônico,
					metrics.json, events.jsonl e telemetria quando disponível. O ZIP privado deriva
					TXT/VTT/SRT do JSON verificado e nunca inclui o áudio Craig.
				</p>
				<ul>
					{result.profiles.map((profile) => (
						<li key={profile.profileId}>
							<strong>{LABELS[profile.profileId]}</strong>{" "}
							<code title={profile.transcriptSha256 ?? undefined}>
								transcript {profile.transcriptSha256?.slice(0, 12) ?? "indisponível"}…
							</code>
						</li>
					))}
				</ul>
			</details>
			{exportConfirmOpen ? (
				<div className={styles.notice} role="group" aria-label="Confirmar exportação privada">
					<strong>ZIP privado com conteúdo de transcrição</strong>
					<p>
						O arquivo inclui os quatro transcripts completos, métricas e diagnósticos locais.
						Não inclui áudio, tokens ou caminhos locais. Guarde-o como material privado.
					</p>
					<div className={styles.actions}>
						<Button type="button" variant="primary" disabled={busy} onClick={() => void exportEvidence()}>
							{busy ? "Preparando ZIP…" : "Baixar ZIP privado"}
						</Button>
						<Button type="button" variant="tertiary" disabled={busy} onClick={() => setExportConfirmOpen(false)}>
							Cancelar exportação
						</Button>
					</div>
				</div>
			) : null}
			{error ? <p className={styles.error} role="alert">{error}</p> : null}

			{referenceOpen ? (
				<section className={styles.referenceEditor} aria-labelledby={`reference-${benchmarkId}`}>
					<header>
						<div>
							<strong id={`reference-${benchmarkId}`}>Referência humana</strong>
							<span>
								{reference
									? `Nova revisão a partir de r${reference.revision}`
									: `Rascunho inicial de ${LABELS[seedProfile ?? left]}`}
							</span>
						</div>
						<Button type="button" variant="tertiary" onClick={() => setReferenceOpen(false)}>
							Cancelar
						</Button>
					</header>
					<p>
						O texto abaixo vira ground truth somente quando você salva. Corrija o conteúdo por track;
						o perfil usado como semente não ganha nenhuma vantagem automática.
					</p>
					<div className={styles.referenceTracks}>
						{draft.map((track, index) => (
							<label key={track.trackNumber}>
								<span>
									Track {track.trackNumber}
									{track.speaker ? ` · ${track.speaker}` : ""}
								</span>
								<textarea
									value={track.text}
									rows={6}
									onChange={(event) =>
										setDraft((current) =>
											current.map((item, itemIndex) =>
												itemIndex === index
													? { ...item, text: event.target.value }
													: item,
											),
										)
									}
								/>
							</label>
						))}
					</div>
					<label className={styles.terms}>
						<span>Termos/glossário para medir separadamente (opcional, separados por vírgula)</span>
						<input value={terms} onChange={(event) => setTerms(event.target.value)} />
					</label>
					<div className={styles.actions}>
						<Button type="button" variant="primary" disabled={busy || !draft.length} onClick={() => void saveReference()}>
							{busy ? "Calculando métricas…" : "Salvar como referência"}
						</Button>
						{PROFILES.filter((profile) => profile !== seedProfile).map((profile) => (
							<Button
								key={profile}
								type="button"
								variant="tertiary"
								disabled={busy}
								onClick={() => void seedReferenceFrom(profile)}
							>
								Usar {LABELS[profile]} como semente
							</Button>
						))}
					</div>
				</section>
			) : null}

			{!qualityLoaded ? (
				<p className={styles.notice}>Verificando referência e métricas locais…</p>
			) : quality?.qualityMeasured ? (
				<section className={styles.quality} aria-label="Qualidade contra referência humana">
					<header>
						<strong>Qualidade medida · referência r{quality.reference?.revision}</strong>
						<span>WER/CER micro · sem score composto</span>
					</header>
					<div className={styles.tableWrap}>
						<table>
							<thead>
								<tr>
									<th>Perfil</th>
									<th>WER</th>
									<th>CER</th>
									<th>S / D / I</th>
									<th>Termos</th>
									<th>Timing</th>
								</tr>
							</thead>
							<tbody>
								{quality.profiles.map((profile) => (
									<tr key={profile.profileId}>
										<th scope="row">{LABELS[profile.profileId]}</th>
										<td>{percent(profile.overall.werNormalized)}</td>
										<td>{percent(profile.overall.cerNormalized)}</td>
										<td>
											{profile.overall.substitutions} / {profile.overall.deletions} / {profile.overall.insertions}
										</td>
										<td>{profile.termFidelity ? percent(profile.termFidelity.recall) : "—"}</td>
										<td>{profile.timing ? number(profile.timing.boundaryP95Seconds, " s p95") : "—"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			) : (
				<p className={styles.notice}>
					Qualidade não medida: sem referência humana não há WER, CER, vencedor nem alegação de precisão.
				</p>
			)}

			{open ? (
				<div className={styles.workspace}>
					<div className={styles.pair}>
						<label>
							<span>Esquerda</span>
							<select value={left} onChange={(event) => setLeft(event.target.value as TranscriptionProfileId)}>
								{PROFILES.map((profile) => (
									<option key={profile} value={profile}>{LABELS[profile]}</option>
								))}
							</select>
						</label>
						<label>
							<span>Direita</span>
							<select value={right} onChange={(event) => setRight(event.target.value as TranscriptionProfileId)}>
								{PROFILES.map((profile) => (
									<option key={profile} value={profile}>{LABELS[profile]}</option>
								))}
							</select>
						</label>
						{left === right ? <span className={styles.warning}>Escolha dois perfis diferentes.</span> : null}
					</div>
					<div className={styles.tabs} role="tablist" aria-label="Visões da comparação">
						{(["text", "timing", "performance", "execution"] as const).map((next) => (
							<button
								key={next}
								type="button"
								role="tab"
								aria-selected={view === next}
								onClick={() => setView(next)}
							>
								{{ text: "Texto", timing: "Timing", performance: "Performance", execution: "Execução" }[next]}
							</button>
						))}
					</div>
					{busy ? <p className={styles.empty}>Carregando evidência verificada…</p> : null}
					{comparison?.invalid ? (
						<p className={styles.error}>Comparação bloqueada: as fontes verificadas não coincidem.</p>
					) : null}
					{left !== right && summary && (view === "text" || view === "timing") ? (
						<>
							<div className={styles.summary}>
								<span>{summary.differentRegions} regiões diferentes</span>
								<span>{summary.changedRegions} alteradas</span>
								<span>{summary.leftOnlyRegions} só à esquerda</span>
								<span>{summary.rightOnlyRegions} só à direita</span>
								<span>{summary.speakerChangedRegions} speaker diferente</span>
							</div>
							{view === "timing" ? (
								<div className={styles.summary} aria-label="Semântica de timing dos perfis">
									{[left, right].map((profileId) => {
										const profile = result.profiles.find((item) => item.profileId === profileId);
										return (
											<span key={profileId}>
												{LABELS[profileId]} · alignment {profile?.alignment ?? "—"} · {profile?.warningCount ?? 0} aviso(s)
											</span>
										);
									})}
								</div>
							) : null}
							<ComparisonRows
								regions={comparison?.regions ?? []}
								mode={view}
								scopeId={benchmarkId}
							/>
						</>
					) : null}
					{view === "performance" && left !== right ? (
						<div className={styles.profileColumns}>
							{[left, right].map((profileId) => {
								const profile = result.profiles.find((item) => item.profileId === profileId);
								const profileMetrics = metrics[profileId];
								const profileTelemetry = telemetry[profileId];
								return (
									<section key={profileId}>
										<strong>{LABELS[profileId]}</strong>
										<dl>
											<div><dt>Tempo</dt><dd>{profile ? number(profile.processingSeconds, " s") : "—"}</dd></div>
											<div><dt>RTF</dt><dd>{profile?.rtf?.toFixed(3) ?? "—"}</dd></div>
											<div><dt>Audio fresco</dt><dd>{profileMetrics ? number(profileMetrics.freshAudioWorkSeconds, " s") : "—"}</dd></div>
											<div><dt>Audio reutilizado</dt><dd>{profileMetrics ? number(profileMetrics.reusedAudioWorkSeconds, " s") : "—"}</dd></div>
											<div><dt>GPU média</dt><dd>{profileTelemetry ? number(profileTelemetry.aggregates.gpuUtilizationAvgPercent, "%") : "—"}</dd></div>
											<div><dt>GPU pico</dt><dd>{profileTelemetry ? number(profileTelemetry.aggregates.gpuUtilizationPeakPercent, "%") : "—"}</dd></div>
											<div><dt>VRAM pico</dt><dd>{humanBytes(profileTelemetry?.aggregates.vramPeakBytes ?? null)}</dd></div>
											<div><dt>RAM pico</dt><dd>{humanBytes(profileTelemetry?.aggregates.ramPeakBytes ?? null)}</dd></div>
											<div><dt>Telemetria</dt><dd>{profileTelemetry ? percent(profileTelemetry.coverage) : "não disponível"}</dd></div>
										</dl>
										{profileMetrics ? (
											<details>
												<summary>Stages engine_processing_v1</summary>
												<ul>
													{Object.entries(profileMetrics.stageSeconds).map(([stage, seconds]) => (
														<li key={stage}><span>{stage}</span><strong>{number(seconds, " s")}</strong></li>
													))}
												</ul>
											</details>
										) : null}
									</section>
								);
							})}
						</div>
					) : null}
					{view === "execution" && left !== right ? (
						<div className={styles.profileColumns}>
							{[left, right].map((profileId) => {
								const profile = result.profiles.find((item) => item.profileId === profileId);
								const lineage = profile?.executionLineage;
								return (
									<section key={profileId}>
										<strong>{LABELS[profileId]}</strong>
										<dl>
											<div><dt>Runtime</dt><dd>{lineage?.runtimeVersion ?? "—"}</dd></div>
											<div><dt>Artifact SHA</dt><dd title={lineage?.runtimeArtifact?.archiveSha256 ?? undefined}>{lineage?.runtimeArtifact?.archiveSha256?.slice(0, 16) ?? "—"}…</dd></div>
											<div><dt>Modelo</dt><dd>{profile?.model ?? "—"}</dd></div>
											<div><dt>Revisão</dt><dd>{profile?.modelRevision ?? "—"}</dd></div>
											<div><dt>Device</dt><dd>{lineage?.device ?? profile?.device ?? "—"}</dd></div>
											<div><dt>Compute</dt><dd>{profile?.computeType ?? "—"}</dd></div>
											<div><dt>GPU</dt><dd>{lineage?.gpu?.model ?? "—"}</dd></div>
											<div><dt>Driver</dt><dd>{lineage?.gpu?.driverVersion ?? "—"}</dd></div>
											<div><dt>Transcript SHA</dt><dd title={profile?.transcriptSha256 ?? undefined}>{profile?.transcriptSha256?.slice(0, 16) ?? "—"}…</dd></div>
										</dl>
									</section>
								);
							})}
						</div>
					) : null}
				</div>
			) : null}
		</section>
	);
}
