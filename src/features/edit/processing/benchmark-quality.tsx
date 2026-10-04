"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status";
import type { LocalBridge } from "./bridge";
import type {
	BenchmarkQualityInspection,
	BenchmarkQualitySummary,
	BenchmarkReference,
	BenchmarkReferenceDraft,
	BenchmarkReferenceTrack,
} from "./benchmark-quality-protocol";
import type { BenchmarkResult, TranscriptionProfileId } from "./protocol";
import styles from "./benchmark.module.css";

const PROFILE_LABELS: Record<TranscriptionProfileId, string> = {
	"whisper-turbo": "Whisper Turbo",
	"whisper-detailed": "Whisper Detailed",
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
};

const PROFILE_ORDER: readonly TranscriptionProfileId[] = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
];

type EditableTrack = {
	trackNumber: number;
	speaker: string;
	text: string;
	turns: BenchmarkReferenceTrack["turns"];
};

type DraftState = {
	capabilityLevel: 1 | 2;
	provenanceKind: "manual" | "derived-from-profile";
	seedProfileId: TranscriptionProfileId | null;
	tracks: EditableTrack[];
	glossary: string;
};

function percentage(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	return `${(value * 100).toFixed(value >= 1 ? 1 : 2)}%`;
}

function seconds(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	return `${value.toFixed(value >= 10 ? 1 : 2)} s`;
}

function shortSha(value: string | null): string {
	return value ? `${value.slice(0, 12)}…` : "—";
}

function glossaryTerms(value: string): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of value.split(/\r?\n/u)) {
		const term = raw.trim();
		if (!term) continue;
		const key = term.normalize("NFC").toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(term);
	}
	return result;
}

function draftFromReference(reference: BenchmarkReference): DraftState {
	return {
		capabilityLevel: reference.capabilityLevel,
		provenanceKind: "manual",
		seedProfileId: null,
		tracks: reference.tracks.map((track) => ({
			trackNumber: track.trackNumber,
			speaker: track.speaker,
			text: track.text,
			turns: track.turns,
		})),
		glossary: reference.glossaryTerms.join("\n"),
	};
}

function draftFromProfile(value: BenchmarkReferenceDraft): DraftState {
	return {
		capabilityLevel: 1,
		provenanceKind: "derived-from-profile",
		seedProfileId: value.provenance.seedProfileId,
		tracks: value.tracks.map((track) => ({
			trackNumber: track.trackNumber,
			speaker: track.speaker,
			text: track.text,
			turns: [],
		})),
		glossary: "",
	};
}

function QualityTable({
	quality,
	bridge,
	benchmarkId,
}: Readonly<{
	quality: BenchmarkQualitySummary;
	bridge: LocalBridge;
	benchmarkId: string;
}>) {
	const [detailProfile, setDetailProfile] =
		useState<TranscriptionProfileId | null>(null);
	const [inspection, setInspection] =
		useState<BenchmarkQualityInspection | null>(null);
	const [inspectionLoading, setInspectionLoading] = useState(false);
	const [inspectionError, setInspectionError] = useState<string | null>(null);

	if (!quality.qualityMeasured) return null;

	async function toggleInspection(profileId: TranscriptionProfileId) {
		if (detailProfile === profileId) {
			setDetailProfile(null);
			setInspection(null);
			setInspectionError(null);
			return;
		}
		const controller = new AbortController();
		setDetailProfile(profileId);
		setInspection(null);
		setInspectionError(null);
		setInspectionLoading(true);
		try {
			const value = await bridge.benchmarkQualityInspection(
				benchmarkId,
				profileId,
				controller.signal,
			);
			setInspection(value);
		} catch (cause) {
			setInspectionError(
				cause instanceof Error
					? cause.message
					: "Não foi possível abrir as regiões privadas de erro.",
			);
		} finally {
			setInspectionLoading(false);
		}
	}

	return (
		<div className={styles.qualityResults}>
			<div className={styles.tableWrap}>
				<table>
					<thead>
						<tr>
							<th>Perfil</th>
							<th>WER</th>
							<th>CER</th>
							<th>S / D / I</th>
							<th>Glossário</th>
							<th>Timing / speaker</th>
						</tr>
					</thead>
					<tbody>
						{quality.profiles.map((profile) => {
							const metrics = profile.metrics;
							const glossary = metrics.glossary;
							const timing = metrics.timing;
							return (
								<tr key={profile.profileId}>
									<th scope="row">{PROFILE_LABELS[profile.profileId]}</th>
									<td>
										<button
											type="button"
											className={styles.metricButton}
											disabled={inspectionLoading}
											onClick={() => void toggleInspection(profile.profileId)}
											aria-expanded={detailProfile === profile.profileId}
										>
											{percentage(metrics.micro.werNormalized)}
										</button>
									</td>
									<td>{percentage(metrics.micro.cerNormalized)}</td>
									<td>
										{metrics.micro.substitutions} / {metrics.micro.deletions} /{" "}
										{metrics.micro.insertions}
									</td>
									<td>
										{glossary.available
											? `${glossary.correctOccurrences}/${glossary.referenceOccurrences} · recall ${percentage(glossary.recall)}`
											: "—"}
									</td>
									<td>
										{timing.available
											? `p95 ${seconds(timing.boundaryP95Seconds)} · speaker ${percentage(timing.speakerAccuracy)}`
											: `— · ${timing.timingPrecision}`}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{detailProfile ? (
				<div className={styles.qualityDrilldown}>
					<div className={styles.qualityDrilldownHeader}>
						<div>
							<span className={styles.eyebrow}>Erros por track</span>
							<strong>{PROFILE_LABELS[detailProfile]}</strong>
						</div>
						<Button
							type="button"
							variant="tertiary"
							onClick={() => setDetailProfile(null)}
						>
							Fechar detalhe
						</Button>
					</div>
					<p>
						<strong>Conteúdo privado local:</strong> os trechos abaixo são
						carregados diretamente dos artefatos do Companion e não fazem parte do
						receipt compartilhável.
					</p>
					<div className={styles.tableWrap}>
						<table>
							<thead>
								<tr>
									<th>Track</th>
									<th>Estado</th>
									<th>WER</th>
									<th>CER</th>
									<th>S</th>
									<th>D</th>
									<th>I</th>
								</tr>
							</thead>
							<tbody>
								{quality.profiles
									.find((profile) => profile.profileId === detailProfile)
									?.metrics.perTrack.map((track) => (
										<tr key={track.trackNumber}>
											<th scope="row">#{track.trackNumber}</th>
											<td>{track.state}</td>
											<td>{percentage(track.werNormalized)}</td>
											<td>{percentage(track.cerNormalized)}</td>
											<td>{track.substitutions}</td>
											<td>{track.deletions}</td>
											<td>{track.insertions}</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
					{inspectionLoading ? (
						<p className={styles.loading}>Alinhando regiões privadas de erro…</p>
					) : null}
					{inspectionError ? (
						<p className={styles.error} role="alert">
							{inspectionError}
						</p>
					) : null}
					{inspection ? (
						<div className={styles.errorRegions}>
							{inspection.regions.length ? (
								inspection.regions.map((region) => (
									<article
										key={`${region.trackNumber}-${region.kind}-${region.referenceWordRange.join("-")}-${region.hypothesisWordRange.join("-")}`}
										className={styles.errorRegion}
									>
										<header>
											<strong>
												Track #{region.trackNumber} · {region.kind}
											</strong>
											<span>
												ref {region.referenceWordRange[0]}–
												{region.referenceWordRange[1]} · hyp{" "}
												{region.hypothesisWordRange[0]}–
												{region.hypothesisWordRange[1]}
											</span>
										</header>
										<div className={styles.errorRegionColumns}>
											<div>
												<span>Referência</span>
												<p>{region.referenceContext || "∅"}</p>
											</div>
											<div>
												<span>Hypothesis</span>
												<p>{region.hypothesisContext || "∅"}</p>
											</div>
										</div>
									</article>
								))
							) : (
								<p>Nenhuma região textual divergente neste perfil.</p>
							)}
							{inspection.truncated ? (
								<p>
									Lista truncada no limite local de inspeção; as métricas
									continuam calculadas sobre o conteúdo completo.
								</p>
							) : null}
							{inspection.glossaryFindings.length ? (
								<div className={styles.glossaryFindings}>
									<strong>Termos com divergência</strong>
									{inspection.glossaryFindings.map((finding) => (
										<span key={finding.term}>
											{finding.term}: {finding.correctOccurrences}/
											{finding.referenceOccurrences} corretos ·{" "}
											{finding.missedOccurrences} ausentes ·{" "}
											{finding.extraOccurrences} extras
										</span>
									))}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function BenchmarkQualityLab({
	result,
	bridge,
	connected,
	enabled,
}: Readonly<{
	result: BenchmarkResult;
	bridge: LocalBridge;
	connected: boolean;
	enabled: boolean;
}>) {
	const benchmarkId = result.benchmarkId;
	const [reference, setReference] = useState<BenchmarkReference | null>(null);
	const [latestRevision, setLatestRevision] = useState(0);
	const [activeSha256, setActiveSha256] = useState<string | null>(null);
	const [quality, setQuality] = useState<BenchmarkQualitySummary | null>(null);
	const [seedProfile, setSeedProfile] =
		useState<TranscriptionProfileId>("whisper-turbo");
	const [draft, setDraft] = useState<DraftState | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const evidenceReady =
		Boolean(benchmarkId && result.bundleManifestSha256 && result.bundleSizeBytes) &&
		result.profiles.every(
			(profile) => profile.artifactAvailable && profile.transcriptSha256,
		);

	useEffect(() => {
		if (!connected || !enabled || !benchmarkId || !evidenceReady) return;
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		void Promise.all([
			bridge.benchmarkReference(benchmarkId, controller.signal),
			bridge.benchmarkQuality(benchmarkId, controller.signal),
		])
			.then(([referenceResponse, qualityResponse]) => {
				if (controller.signal.aborted) return;
				setReference(referenceResponse.reference);
				setLatestRevision(referenceResponse.status.latestRevision);
				setActiveSha256(referenceResponse.status.activeSha256);
				setQuality(qualityResponse);
			})
			.catch((cause) => {
				if (controller.signal.aborted) return;
				setError(
					cause instanceof Error
						? cause.message
						: "Não foi possível carregar a referência local.",
				);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [benchmarkId, bridge, connected, enabled, evidenceReady]);

	const normalization = quality?.reference.normalizationPolicy;
	const activeQuality = quality?.qualityMeasured === true;
	const referenceLabel = useMemo(
		() =>
			reference
				? `Referência r${reference.revision} · ${shortSha(reference.canonicalPayloadSha256)}`
				: "Sem referência humana ativa",
		[reference],
	);

	async function seedDraft() {
		if (!benchmarkId || !connected || loading) return;
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		try {
			const next = await bridge.benchmarkReferenceDraft(
				benchmarkId,
				seedProfile,
				controller.signal,
			);
			setDraft(draftFromProfile(next));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Não foi possível abrir o transcript preservado.",
			);
		} finally {
			setLoading(false);
		}
	}

	async function saveDraft() {
		if (!benchmarkId || !draft || saving) return;
		const controller = new AbortController();
		setSaving(true);
		setError(null);
		try {
			const saved = await bridge.saveBenchmarkReference(
				benchmarkId,
				{
					expectedRevision: latestRevision,
					capabilityLevel: draft.capabilityLevel,
					provenanceKind: draft.provenanceKind,
					seedProfileId: draft.seedProfileId,
					glossaryTerms: glossaryTerms(draft.glossary),
					tracks: draft.tracks,
					activate: true,
				},
				controller.signal,
			);
			setReference(saved.reference);
			setLatestRevision(saved.status.latestRevision);
			setActiveSha256(saved.status.activeSha256);
			setQuality(
				saved.quality ??
					(await bridge.benchmarkQuality(benchmarkId, controller.signal)),
			);
			setDraft(null);
		} catch (cause) {
			const message =
				cause instanceof Error
					? cause.message
					: "Não foi possível salvar a referência.";
			setError(
				message.includes("BENCHMARK_REFERENCE_STALE_REVISION")
					? "A referência mudou em outra ação. Recarregue antes de salvar novamente."
					: message,
			);
		} finally {
			setSaving(false);
		}
	}

	if (!enabled || !benchmarkId || !evidenceReady) {
		return (
			<div className={styles.qualityNotice}>
				<strong>Qualidade não medida.</strong>
				<span>
					{benchmarkId
						? "Este receipt não possui os quatro artefatos de transcript verificáveis necessários para criar a referência."
						: "Benchmark histórico: ele continua legível, mas foi criado antes do contrato de evidência por perfil. Nenhum WER foi inventado retroativamente."}
				</span>
			</div>
		);
	}

	return (
		<section className={styles.qualityLab} aria-labelledby={`quality-${benchmarkId}`}>
			<header className={styles.qualityHeader}>
				<div>
					<span className={styles.eyebrow}>Qualidade objetiva · local</span>
					<h4 id={`quality-${benchmarkId}`}>Referência humana e métricas ASR</h4>
					<p>
						{referenceLabel}. O transcript de referência permanece no Companion; o
						receipt exportável carrega apenas hashes, contagens e métricas.
					</p>
				</div>
				<StatusPill tone={activeQuality ? "success" : "neutral"}>
					{activeQuality ? "Medida" : "Não medida"}
				</StatusPill>
			</header>

			<div className={styles.qualityMeta}>
				<span>Benchmark {shortSha(benchmarkId)}</span>
				<span>Bundle {shortSha(result.bundleManifestSha256)}</span>
				<span>Referência {shortSha(activeSha256)}</span>
				<span>
					Normalização{" "}
					{normalization?.schemaVersion ?? "tda_asr_text_normalization_v1"}
				</span>
				<span>NFC · casefold · diacríticos preservados</span>
			</div>

			{loading ? (
				<p className={styles.loading}>Carregando laboratório de qualidade…</p>
			) : null}
			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}

			{!draft && !reference && !loading ? (
				<div className={styles.referenceStart}>
					<div>
						<strong>Criar referência Level 1</strong>
						<p>
							Escolha um dos quatro outputs só como ponto de partida. Você corrige o
							texto antes de salvar; o perfil escolhido não ganha vantagem nem vira
							“verdade” automaticamente.
						</p>
					</div>
					<div className={styles.referenceActions}>
						<div>
							<span>Transcript-base</span>
							<Select
								value={seedProfile}
								options={PROFILE_ORDER.map((profile) => ({
									value: profile,
									label: PROFILE_LABELS[profile],
								}))}
								onChange={(value) => setSeedProfile(value as TranscriptionProfileId)}
								ariaLabel="Transcript-base"
								compact
								disabled={!connected || loading}
							/>
						</div>
						<Button
							type="button"
							variant="tertiary"
							disabled={!connected || loading}
							onClick={() => void seedDraft()}
						>
							Abrir para correção humana
						</Button>
					</div>
				</div>
			) : null}

			{!draft && reference ? (
				<div className={styles.referenceSummary}>
					<div>
						<strong>
							r{reference.revision} · Level {reference.capabilityLevel}
						</strong>
						<p>
							{reference.tracks.length} track
							{reference.tracks.length === 1 ? "" : "s"} ·{" "}
							{reference.glossaryTerms.length} termo
							{reference.glossaryTerms.length === 1 ? "" : "s"} de glossário
						</p>
					</div>
					<Button
						type="button"
						variant="tertiary"
						disabled={!connected || saving}
						onClick={() => setDraft(draftFromReference(reference))}
					>
						Nova revisão humana
					</Button>
				</div>
			) : null}

			{draft ? (
				<div className={styles.referenceEditor}>
					<div className={styles.referenceEditorHeader}>
						<div>
							<strong>Referência humana · Level {draft.capabilityLevel}</strong>
							<p>
								Revise cada track. Salvar cria uma nova revisão imutável e a ativa
								explicitamente; não publica nada na cloud.
							</p>
						</div>
						<Button
							type="button"
							variant="tertiary"
							disabled={saving}
							onClick={() => setDraft(null)}
						>
							Cancelar edição
						</Button>
					</div>
					<div className={styles.referenceTracks}>
						{draft.tracks.map((track, index) => (
							<label
								key={track.trackNumber}
								className={styles.referenceTrack}
							>
								<span>
									Track #{track.trackNumber} · {track.speaker}
								</span>
								<textarea
									value={track.text}
									rows={8}
									onChange={(event) =>
										setDraft((current) =>
											current
												? {
														...current,
														tracks: current.tracks.map((candidate, candidateIndex) =>
															candidateIndex === index
																? { ...candidate, text: event.target.value }
																: candidate,
														),
													}
												: current,
										)
									}
								/>
							</label>
						))}
					</div>
					<label className={styles.glossaryEditor}>
						<span>Termos de glossário avaliáveis · um por linha</span>
						<textarea
							value={draft.glossary}
							rows={4}
							onChange={(event) =>
								setDraft((current) =>
									current ? { ...current, glossary: event.target.value } : current,
								)
							}
							placeholder={"Strahd\nBarovia\nMordenkainen"}
						/>
					</label>
					<div className={styles.referenceSave}>
						<span>
							Próxima revisão: r{latestRevision + 1}. O hash muda com qualquer
							correção.
						</span>
						<Button
							type="button"
							variant="primary"
							disabled={saving || !connected}
							onClick={() => void saveDraft()}
						>
							{saving
								? "Salvando e calculando…"
								: "Salvar revisão e usar como referência"}
						</Button>
					</div>
				</div>
			) : null}

			{quality?.qualityMeasured ? (
				<>
					<div className={styles.qualityNotice}>
						<strong>Nenhum vencedor automático.</strong>
						<span>
							WER/CER e contagens S/D/I são evidência. Velocidade, glossário e
							timing continuam dimensões separadas; não existe score composto
							escondido.
						</span>
					</div>
					<QualityTable
						key={quality.reference.activeSha256 ?? "unmeasured"}
						quality={quality}
						bridge={bridge}
						benchmarkId={benchmarkId}
					/>
				</>
			) : !draft && reference ? (
				<div className={styles.qualityNotice}>
					<strong>Referência ativa, métricas pendentes.</strong>
					<span>
						Recarregue o laboratório se a medição local não aparecer
						automaticamente.
					</span>
				</div>
			) : null}
		</section>
	);
}
