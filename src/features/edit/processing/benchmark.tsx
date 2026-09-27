"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import {
	BridgeError,
	type BenchmarkResult,
	type Capabilities,
	type CraigSource,
	type JobEvent,
	type LocalJob,
	type PreparationStatus,
	type TranscriptionProfileId,
} from "./protocol";
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

type PendingBenchmark = {
	key: string;
	signature: string;
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

function formatBytes(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "—";
	const mib = value / 1024 ** 2;
	return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GB` : `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`;
}

function profileReason(reason: string | null): string {
	if (!reason) return "Nenhum motivo adicional informado.";
	return {
		QWEN_PHYSICAL_ACCEPTANCE_REQUIRED:
			"Este Qwen ainda precisa de aceite físico nesta máquina.",
		QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED:
			"O runtime Qwen precisa ser atualizado antes deste perfil.",
		WHISPER_RUNTIME_UNAVAILABLE:
			"O runtime Whisper não está disponível nesta máquina.",
		WHISPER_MODEL_PREPARATION_REQUIRED:
			"O modelo Whisper ainda precisa ser preparado.",
	}[reason] ?? `Motivo do Companion: ${reason}`;
}

function preparationError(status: PreparationStatus): string {
	return status.errorCode
		? `A preparação de ${status.profileId ? LABELS[status.profileId] : "perfil"} falhou · ${status.errorCode}.`
		: `A preparação de ${status.profileId ? LABELS[status.profileId] : "perfil"} não foi concluída.`;
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
	events,
	observedJobId,
	onRefresh,
	onCancel,
	onOpenDiagnostics,
}: Readonly<{
	jobs: readonly LocalJob[];
	capabilities: Capabilities | null;
	connected: boolean;
	events: readonly JobEvent[];
	observedJobId: string | null;
	onRefresh: () => void | Promise<void>;
	onCancel: (jobId: string) => void | Promise<void>;
	onOpenDiagnostics: (jobId: string) => void | Promise<void>;
}>) {
	const [bridge] = useState(() => new LocalBridge());
	const [file, setFile] = useState<File | null>(null);
	const [source, setSource] = useState<CraigSource | null>(null);
	const [localCapabilities, setLocalCapabilities] = useState<Capabilities | null>(capabilities);
	const [busy, setBusy] = useState(false);
	const [preparation, setPreparation] = useState<PreparationStatus | null>(null);
	const [preparationCancelling, setPreparationCancelling] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, BenchmarkResult>>({});
	const fileInput = useRef<HTMLInputElement>(null);
	const request = useRef<AbortController | null>(null);
	const pending = useRef<PendingBenchmark | null>(null);

	useEffect(() => setLocalCapabilities(capabilities), [capabilities]);

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
	const profileStates = PROFILES.map((id) => ({
		id,
		state: localCapabilities?.transcription.catalog.find((item) => item.id === id) ?? null,
	}));
	const allProfilesReady = profileStates.every(({ state }) => state?.ready === true);
	const pendingProfiles = profileStates
		.filter(({ state }) => state && !state.ready && state.preparationRequired)
		.map(({ id }) => id);
	const blockedProfiles = profileStates.filter(
		({ state }) => !state || (!state.ready && !state.preparationRequired),
	);
	const sampleTooShort =
		source?.minimumTrackDurationSeconds !== null &&
		source?.minimumTrackDurationSeconds !== undefined &&
		source.minimumTrackDurationSeconds < 300;
	const canPrepare =
		Boolean(source) &&
		!sampleTooShort &&
		pendingProfiles.length > 0 &&
		blockedProfiles.length === 0 &&
		localCapabilities?.capabilities.includes("transcription.prepare") === true;

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

	function resetSource(nextFile: File | null) {
		request.current?.abort();
		setFile(nextFile);
		setSource(null);
		setPreparation(null);
		setStatus(null);
		setError(null);
		pending.current = null;
	}

	async function preflightSource() {
		if (!file || busy || active || !connected) return;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setBusy(true);
		setError(null);
		setStatus("Analisando o ZIP no Companion local, sem iniciar ASR…");
		try {
			const staged = await bridge.craigSource(file, controller.signal);
			setSource(staged);
			setStatus(
				`Fonte verificada localmente: ${staged.trackCount} track${staged.trackCount === 1 ? "" : "s"}. Nenhum ASR foi iniciado.`,
			);
		} catch (cause) {
			if (!controller.signal.aborted) setError(benchmarkError(cause));
			setStatus(null);
		} finally {
			if (request.current === controller) request.current = null;
			setBusy(false);
		}
	}

	async function preparePendingProfiles() {
		if (!source || busy || active || !canPrepare) return;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setBusy(true);
		setError(null);
		try {
			let snapshot = localCapabilities;
			for (const profileId of PROFILES) {
				if (controller.signal.aborted) return;
				const profile = snapshot?.transcription.catalog.find((item) => item.id === profileId);
				if (profile?.ready) continue;
				if (!profile?.preparationRequired) {
					setError(
						profile
							? `${LABELS[profileId]} está bloqueado. ${profileReason(profile.reason)}`
							: `${LABELS[profileId]} não foi anunciado por este Companion.`,
					);
					return;
				}

				setStatus(`Preparando ${LABELS[profileId]} fora da medição do benchmark…`);
				let observed = await bridge.prepareProfile(source.sourceId, profileId, controller.signal);
				setPreparation(observed);
				const operationId = observed.operationId;
				if (!operationId) {
					setError("O Companion não retornou a identidade da preparação.");
					return;
				}
				while (observed.state === "running") {
					setStatus(
						`${LABELS[profileId]} · ${observed.title}${observed.detail ? ` · ${observed.detail}` : ""} · ${Math.round(observed.elapsedSeconds)} s`,
					);
					await new Promise((resolve) => window.setTimeout(resolve, 1000));
					if (controller.signal.aborted) return;
					const next = await bridge.preparation(controller.signal);
					setPreparation(next);
					if (next.operationId !== operationId) {
						setError("A preparação observada foi substituída por outra operação local.");
						return;
					}
					observed = next;
				}
				if (observed.state !== "completed") {
					setError(preparationError(observed));
					return;
				}
				snapshot = await bridge.capabilities(controller.signal);
				setLocalCapabilities(snapshot);
				if (
					snapshot.transcription.catalog.find((item) => item.id === profileId)?.ready !== true
				) {
					setError(`${LABELS[profileId]} terminou a preparação, mas ainda não foi anunciado como pronto.`);
					return;
				}
			}
			setStatus("Quatro perfis prontos. Downloads e preparação ficaram fora da medição.");
			await onRefresh();
		} catch (cause) {
			if (!controller.signal.aborted)
				setError(cause instanceof BridgeError ? benchmarkError(cause) : "A preparação local falhou.");
		} finally {
			if (request.current === controller) request.current = null;
			setBusy(false);
		}
	}

	async function cancelActivePreparation() {
		if (
			!preparation?.active ||
			!preparation.operationId ||
			preparationCancelling ||
			localCapabilities?.capabilities.includes("transcription.prepare.cancel") !== true
		) return;
		setPreparationCancelling(true);
		setError(null);
		const controller = new AbortController();
		try {
			const next = await bridge.cancelPreparation(preparation.operationId, controller.signal);
			setPreparation(next);
			request.current?.abort();
			setStatus("Cancelamento da preparação solicitado ao Companion local.");
		} catch (cause) {
			setError(cause instanceof BridgeError ? benchmarkError(cause) : "Não foi possível cancelar a preparação.");
		} finally {
			setPreparationCancelling(false);
		}
	}

	async function runBenchmark() {
		if (!source || busy || active || !allProfilesReady || sampleTooShort) return;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setBusy(true);
		setError(null);
		setStatus("Confirmando elegibilidade de 5:00 por track e reservando o worker local…");
		try {
			const signature = JSON.stringify([
				"benchmark-local",
				"benchmark-local",
				source.sourceId,
				"",
				"",
			]);
			if (!pending.current || pending.current.signature !== signature) {
				pending.current = { key: crypto.randomUUID(), signature };
			}
			const job = await bridge.benchmark(
				{
					campaignId: "benchmark-local",
					sessionId: "benchmark-local",
					sourceId: source.sourceId,
					glossary: "",
					context: "",
				},
				pending.current.key,
				controller.signal,
			);
			pending.current = null;
			setStatus(`Benchmark ${job.id.slice(0, 8)}… aceito pelo Companion.`);
			await onRefresh();
		} catch (cause) {
			if (!controller.signal.aborted) setError(benchmarkError(cause));
		} finally {
			if (request.current === controller) request.current = null;
			setBusy(false);
		}
	}

	const latestBenchmark = benchmarkJobs[0] ?? null;
	const latestProblem =
		!active &&
		latestBenchmark &&
		["failed", "cancelled", "interrupted"].includes(latestBenchmark.status)
			? latestBenchmark
			: null;
	const completed = active?.progress?.completed ?? 0;
	const currentProfile =
		active?.status === "running" ? PROFILES[Math.min(completed, 3)] : null;
	const latestActivity =
		active && observedJobId === active.id ? events.at(-1) ?? null : null;

	return (
		<div className={styles.workspace}>
			<section className={styles.launchCard}>
				<div>
					<span className={styles.eyebrow}>Benchmark exploratório local</span>
					<h2>Mesmos 5 minutos · quatro perfis</h2>
					<p>
						Primeiro o Companion valida e stageia o ZIP sem ASR. Só depois, com a fonte
						verificada e os quatro perfis prontos, o benchmark pode reservar o worker.
					</p>
				</div>

				<div className={styles.launchControls}>
					<label>
						<span>ZIP Craig</span>
						<input
							ref={fileInput}
							type="file"
							accept=".zip,application/zip"
							disabled={busy || Boolean(active)}
							onChange={(event) => resetSource(event.target.files?.[0] ?? null)}
						/>
					</label>
					{file ? (
						<Button
							type="button"
							variant="secondary"
							disabled={busy || Boolean(active)}
							onClick={() => {
								resetSource(null);
								if (fileInput.current) fileInput.current.value = "";
							}}
						>
							Remover ZIP
						</Button>
					) : null}
				</div>

				{file ? (
					<section className={styles.sourcePanel} aria-label="Fonte do benchmark">
						<div>
							<strong>{file.name}</strong>
							<small>{formatBytes(file.size)} · arquivo selecionado</small>
						</div>
						{source ? (
							<div className={styles.sourceFacts}>
								<span>{source.trackCount} track{source.trackCount === 1 ? "" : "s"}</span>
								<span>sessão {source.sessionDurationSeconds === null ? "—" : formatSeconds(source.sessionDurationSeconds)}</span>
								<span>trabalho de áudio {source.audioWorkSeconds === null ? "—" : formatSeconds(source.audioWorkSeconds)}</span>
								<span>menor track {source.minimumTrackDurationSeconds === null ? "—" : formatSeconds(source.minimumTrackDurationSeconds)}</span>
								<span>{source.reused ? "staging reutilizado" : "staging verificado agora"}</span>
							</div>
						) : (
							<Button
								type="button"
								variant="secondary"
								disabled={!connected || busy || Boolean(active)}
								onClick={() => void preflightSource()}
							>
								{busy ? "Analisando ZIP…" : "Analisar amostra localmente"}
							</Button>
						)}
						{source ? (
							sampleTooShort ? (
								<small className={styles.error} role="status">
									O benchmark precisa de pelo menos 5:00 reais em todas as tracks desta fonte.
									A menor track possui {formatSeconds(source.minimumTrackDurationSeconds ?? 0)}.
								</small>
							) : (
								<small className={styles.sourceCaveat}>
									O staging não inicia ASR.
									{source.minimumTrackDurationSeconds === null
										? " Este Companion não informou a duração mínima por track; o gate final continua no Agent."
										: " Todas as tracks atendem ao mínimo local de 5:00."}
								</small>
							)
						) : null}
					</section>
				) : null}

				<section className={styles.profileGrid} aria-label="Prontidão dos perfis do benchmark">
					{profileStates.map(({ id, state }) => (
						<div key={id} className={styles.profileRow} data-ready={state?.ready ? "true" : "false"}>
							<div>
								<strong>{LABELS[id]}</strong>
								<small>
									{state?.ready
										? "Disponível"
										: state?.preparationRequired
											? "Preparação necessária"
											: "Bloqueado ou indisponível"}
								</small>
							</div>
							<StatusPill tone={state?.ready ? "success" : state?.preparationRequired ? "warning" : "danger"}>
								{state?.ready ? "Disponível" : state?.preparationRequired ? "Preparar" : "Bloqueado"}
							</StatusPill>
							{!state?.ready ? (
								<small className={styles.profileReason}>
									{state ? profileReason(state.reason) : "Perfil não anunciado por este Companion."}
								</small>
							) : null}
						</div>
					))}
				</section>

				<div className={styles.actions}>
					{canPrepare ? (
						<Button
							type="button"
							variant="secondary"
							disabled={busy || Boolean(active)}
							onClick={() => void preparePendingProfiles()}
						>
							{busy ? "Preparando perfis…" : `Preparar perfis pendentes (${pendingProfiles.length})`}
						</Button>
					) : null}
					{blockedProfiles.length > 0 && source ? (
						<Button
							type="button"
							variant="tertiary"
							onClick={() => {
								const target = active?.id ?? latestBenchmark?.id;
								if (target) void onOpenDiagnostics(target);
							}}
							disabled={!active && !latestBenchmark}
						>
							Abrir Diagnóstico
						</Button>
					) : null}
					<Button
						type="button"
						variant="primary"
						disabled={
							!connected ||
							!source ||
							busy ||
							Boolean(active) ||
							!allProfilesReady ||
							sampleTooShort
						}
						onClick={() => void runBenchmark()}
					>
						{busy ? "Operação local em andamento…" : "Executar benchmark de 5 minutos"}
					</Button>
				</div>

				{source && !allProfilesReady ? (
					<p className={styles.notice}>
						O benchmark ainda não pode iniciar: resolva os perfis acima. Downloads e
						preparação ficam fora do tempo medido.
					</p>
				) : null}
				{preparation?.active ? (
					<div className={styles.preparation} role="status" aria-live="polite">
						<span>
							<strong>{preparation.profileId ? LABELS[preparation.profileId] : "Preparação"}</strong>
							{" · "}{preparation.title}{preparation.detail ? ` · ${preparation.detail}` : ""}
						</span>
						{localCapabilities?.capabilities.includes("transcription.prepare.cancel") ? (
							<Button
								type="button"
								variant="tertiary"
								disabled={preparationCancelling}
								onClick={() => void cancelActivePreparation()}
							>
								{preparationCancelling ? "Cancelando…" : "Cancelar preparação"}
							</Button>
						) : null}
					</div>
				) : null}
				{status ? <p className={styles.status} role="status" aria-live="polite">{status}</p> : null}
				{error ? <p className={styles.error} role="alert">{error}</p> : null}
			</section>
			{active ? (
				<section className={styles.activeCard} role="status" aria-live="polite">
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
							{" · etapa "}{active.stage}
							{active.timing.attemptElapsedSeconds !== null
								? ` · ${formatSeconds(active.timing.attemptElapsedSeconds)}`
								: ""}
						</p>
						{latestActivity ? (
							<small className={styles.lastActivity}>
								Última atividade · {latestActivity.code} · {latestActivity.at}
							</small>
						) : null}
						<details className={styles.jobIdentity}>
							<summary>Identidade local</summary>
							<code>{active.id}</code>
						</details>
					</div>
					<div className={styles.activeActions}>
						<Button type="button" variant="tertiary" onClick={() => void onOpenDiagnostics(active.id)}>
							Ver log / Diagnóstico
						</Button>
						<Button
							type="button"
							variant="tertiary"
							onClick={() => void onCancel(active.id)}
						>
							Cancelar benchmark
						</Button>
					</div>
				</section>
			) : null}

			{latestProblem ? (
				<section className={styles.problemCard} role="status">
					<div>
						<span className={styles.eyebrow}>Último benchmark</span>
						<h3>
							{latestProblem.status === "cancelled"
								? "Benchmark cancelado"
								: latestProblem.status === "interrupted"
									? "Benchmark interrompido"
									: "Benchmark falhou"}
						</h3>
						<p>
							{latestProblem.error?.code
								? `Código ${latestProblem.error.code}`
								: "A execução não produziu um receipt concluído."}
						</p>
					</div>
					<Button type="button" variant="tertiary" onClick={() => void onOpenDiagnostics(latestProblem.id)}>
						Ver log / Diagnóstico
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
