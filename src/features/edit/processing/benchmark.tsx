"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import { BridgeError, type BenchmarkResult, type Capabilities, type CraigSource, type LocalJob } from "./protocol";
import { LocalBridge } from "./bridge";
import styles from "./benchmark.module.css";

const PROFILES = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
] as const;

const LABELS: Record<(typeof PROFILES)[number], string> = {
	"whisper-turbo": "Whisper Turbo",
	"whisper-detailed": "Whisper Detailed",
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
};

function formatSeconds(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "—";
	const seconds = Math.round(value);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return hours
		? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(rest).padStart(2, "0")}s`
		: `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function formatRealtime(rtf: number | null): string {
	if (rtf === null || !Number.isFinite(rtf) || rtf <= 0) return "—";
	return `${(1 / rtf).toFixed(2)}×`;
}

function benchmarkError(error: unknown): string {
	if (!(error instanceof BridgeError))
		return "Não foi possível concluir o benchmark local.";
	return {
		BENCHMARK_SAMPLE_TOO_SHORT:
			"O benchmark precisa de pelo menos 5:00 reais em todas as tracks desta fonte.",
		BENCHMARK_PROFILES_NOT_READY:
			"Prepare os quatro perfis antes de iniciar o benchmark.",
		BENCHMARK_RESOURCE_BUSY:
			"Há uma transcrição ou benchmark usando os recursos locais. Aguarde essa execução terminar.",
		unauthorized: "Reconecte o Companion antes de executar o benchmark.",
		unreachable: "O Companion local ficou indisponível.",
		timeout: "O Companion demorou demais para responder.",
	}[error.serverCode ?? error.code] ?? `Benchmark bloqueado · ${error.serverCode ?? error.code}`;
}

function ResultCard({ result }: Readonly<{ result: BenchmarkResult }>) {
	return (
		<article className={styles.resultCard}>
			<header className={styles.resultHeader}>
				<div>
					<span className={styles.eyebrow}>Benchmark local · 5:00</span>
					<h3>Quatro perfis · mesma amostra</h3>
				</div>
				<StatusPill tone="success">Concluído</StatusPill>
			</header>
			<div className={styles.receiptFacts}>
				<span title={result.sampleIdentitySha256}>
					Sample SHA {result.sampleIdentitySha256.slice(0, 12)}…
				</span>
				<span>{result.trackCount} tracks</span>
				<span>{formatSeconds(result.audioWorkSeconds)} de trabalho de áudio</span>
				<span>{result.prepared ? "Artefatos preparados" : "Preparação desconhecida"}</span>
				<span>Worker novo por perfil · model load incluído</span>
			</div>
			<div className={styles.tableWrap}>
				<table>
					<thead>
						<tr>
							<th>Perfil</th>
							<th>Tempo</th>
							<th>RTF</th>
							<th>× realtime</th>
							<th>Palavras</th>
							<th>Segmentos</th>
							<th>Avisos</th>
							<th>Runtime / compute</th>
						</tr>
					</thead>
					<tbody>
						{result.profiles.map((profile) => (
							<tr key={profile.profileId}>
								<th scope="row">{LABELS[profile.profileId]}</th>
								<td>{formatSeconds(profile.processingSeconds)}</td>
								<td>{profile.rtf === null ? "—" : profile.rtf.toFixed(3)}</td>
								<td>{formatRealtime(profile.rtf)}</td>
								<td>{profile.wordCount}</td>
								<td>{profile.segmentCount}</td>
								<td>{profile.warningCount}</td>
								<td>
									{[
										profile.executionLineage?.runtimeVersion,
										profile.computeType,
										profile.executionLineage?.gpu?.model,
									]
										.filter(Boolean)
										.join(" · ") || "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className={styles.qualityNotice}>
				<strong>Qualidade não medida.</strong>
				<span>
					Este benchmark compara performance. Sem transcrição humana de referência,
					WER/omissões/inserções não são calculados e nenhum perfil recebe vencedor automático.
				</span>
			</div>
		</article>
	);
}

export function ProcessingBenchmark({
	jobs,
	capabilities,
	connected,
	onRefresh,
	onCancel,
}: Readonly<{
	jobs: readonly LocalJob[];
	capabilities: Capabilities | null;
	connected: boolean;
	onRefresh: () => void;
	onCancel: (jobId: string) => void | Promise<void>;
}>) {
	const [bridge] = useState(() => new LocalBridge());
	const [file, setFile] = useState<File | null>(null);
	const [source, setSource] = useState<CraigSource | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, BenchmarkResult>>({});
	const request = useRef<AbortController | null>(null);

	const benchmarkJobs = useMemo(
		() =>
			jobs
				.filter((job) => job.kind === "benchmark.craig")
				.sort(
					(left, right) =>
						Date.parse(right.updated_at) - Date.parse(left.updated_at),
				),
		[jobs],
	);
	const active = benchmarkJobs.find((job) =>
		["queued", "running"].includes(job.status),
	);
	const latestCompleted = benchmarkJobs.filter(
		(job) => job.status === "succeeded" && job.result_available,
	);
	const allProfilesReady =
		capabilities?.transcription.catalog.length === 4 &&
		PROFILES.every(
			(id) =>
				capabilities.transcription.catalog.find((item) => item.id === id)?.ready ===
				true,
		);

	useEffect(() => {
		const missing = latestCompleted
			.slice(0, 10)
			.filter((job) => results[job.id] === undefined);
		if (!connected || missing.length === 0) return;
		const controller = new AbortController();
		void Promise.all(
			missing.map(async (job) => {
				try {
					return [job.id, await bridge.benchmarkResult(job.id, controller.signal)] as const;
				} catch {
					return null;
				}
			}),
		).then((loaded) => {
			if (controller.signal.aborted) return;
			setResults((current) => ({
				...current,
				...Object.fromEntries(
					loaded.filter((item): item is readonly [string, BenchmarkResult] => item !== null),
				),
			}));
		});
		return () => controller.abort();
	}, [bridge, connected, latestCompleted, results]);

	useEffect(() => () => request.current?.abort(), []);

	async function runBenchmark() {
		if (!file || busy || active) return;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setBusy(true);
		setError(null);
		try {
			const staged = source ?? (await bridge.craigSource(file, controller.signal));
			setSource(staged);
			await bridge.benchmark(
				{
					campaignId: "benchmark-local",
					sessionId: "benchmark-local",
					sourceId: staged.sourceId,
					glossary: "",
					context: "",
				},
				`benchmark-${staged.sourceSha256.slice(0, 48)}`,
				controller.signal,
			);
			onRefresh();
		} catch (cause) {
			setError(benchmarkError(cause));
		} finally {
			setBusy(false);
		}
	}

	const completed = active?.progress?.completed ?? 0;
	const currentProfile =
		active?.status === "running" ? PROFILES[Math.min(completed, 3)] : null;

	return (
		<div className={styles.workspace}>
			<section className={styles.launchCard}>
				<div>
					<span className={styles.eyebrow}>Benchmark exploratório local</span>
					<h2>Mesmos 5 minutos · quatro perfis</h2>
					<p>
						Executa Whisper Turbo, Whisper Detailed, Qwen Fast e Qwen Quality em
						sequência sobre exatamente a mesma fonte e o mesmo corte temporal.
					</p>
				</div>
				<div className={styles.launchControls}>
					<label>
						<span>ZIP Craig</span>
						<input
							type="file"
							accept=".zip,application/zip"
							disabled={busy || Boolean(active)}
							onChange={(event) => {
								setFile(event.target.files?.[0] ?? null);
								setSource(null);
								setError(null);
							}}
						/>
					</label>
					<Button
						type="button"
						variant="primary"
						disabled={
							!connected ||
							!file ||
							busy ||
							Boolean(active) ||
							!allProfilesReady
						}
						onClick={() => void runBenchmark()}
					>
						{busy ? "Preparando benchmark…" : "Executar benchmark de 5 minutos"}
					</Button>
				</div>
				{!allProfilesReady ? (
					<p className={styles.notice}>
						Prepare os quatro perfis antes do benchmark. Downloads/preparação não
						são misturados com o tempo de inferência.
					</p>
				) : null}
				{error ? <p className={styles.error} role="alert">{error}</p> : null}
			</section>

			{active ? (
				<section className={styles.activeCard}>
					<div>
						<span className={styles.eyebrow}>Benchmark em andamento</span>
						<h3>
							{active.status === "queued"
								? "Aguardando worker local"
								: currentProfile
									? LABELS[currentProfile]
									: "Finalizando"}
						</h3>
						<p>
							{active.progress
								? `${active.progress.completed} de ${active.progress.total} perfis concluídos`
								: "Preparando execução"}
						</p>
					</div>
					<Button
						type="button"
						variant="tertiary"
						onClick={() => void onCancel(active.id)}
					>
						Cancelar benchmark
					</Button>
				</section>
			) : null}

			<section className={styles.history}>
				<div className={styles.historyHeader}>
					<div>
						<span className={styles.eyebrow}>Histórico local</span>
						<h2>Receipts comparáveis</h2>
					</div>
					<span>{latestCompleted.length} concluído{latestCompleted.length === 1 ? "" : "s"}</span>
				</div>
				{latestCompleted.length ? (
					latestCompleted.slice(0, 10).map((job) =>
						results[job.id] ? (
							<ResultCard key={job.id} result={results[job.id]!} />
						) : (
							<p key={job.id} className={styles.loading}>Carregando receipt {job.id.slice(0, 8)}…</p>
						),
					)
				) : (
					<p className={styles.empty}>
						Nenhum benchmark concluído neste Companion.
					</p>
				)}
			</section>
		</div>
	);
}

