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
	type QwenRuntimeMaintenanceStatus,
	type TranscriptionProfileState,
} from "./protocol";
import { LocalBridge } from "./bridge";
import { BenchmarkEvidenceWorkspace } from "./benchmark-evidence";
import { BenchmarkQualityLab } from "./benchmark-quality";
import { presentJobEvent, stageLabels } from "./presentation";
import {
	formatSubmissionBytes,
	profileReadinessCopy,
	validateCraigFile,
} from "./submission-model";
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

type BenchmarkStepState = "complete" | "failed" | "current" | "pending" | "stopped" | "not_attempted";

function benchmarkStepLabel(state: BenchmarkStepState): string {
	return {
		complete: "concluído",
		failed: "falhou",
		current: "em execução",
		pending: "pendente",
		stopped: "interrompido",
		not_attempted: "não tentado",
	}[state];
}

function benchmarkProfileFailureCopy(code: string | undefined): string {
	if (code === "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN")
		return "Sinal de áudio detectado, mas o Qwen não reconheceu o trecho com segurança; nenhum texto foi inventado.";
	return code ? `Falha do perfil · ${code}` : "O perfil não concluiu.";
}

const QWEN_RUNTIME_RECOVERY_REASONS = new Set([
	"QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED",
	"QWEN_RUNTIME_REQUIRED",
	"QWEN_GATE_RUNTIME_NOT_READY",
]);

function needsQwenRuntimeRecovery(profile: TranscriptionProfileState | null): boolean {
	return Boolean(
		profile &&
			profile.engine === "qwen3" &&
			!profile.ready &&
			profile.reason &&
			QWEN_RUNTIME_RECOVERY_REASONS.has(profile.reason),
	);
}

function requiresQwenRuntimeUpgrade(profile: TranscriptionProfileState | null): boolean {
	return profile?.reason === "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED";
}

const BENCHMARK_SAMPLE_SECONDS = 300;

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

function formatClock(value: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "—";
	return date.toLocaleTimeString("pt-BR", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function bridgeMessage(error: unknown, fallback: string): string {
	if (!(error instanceof BridgeError)) return fallback;
	const code = error.serverCode ?? error.code;
	return (
		{
			BENCHMARK_SAMPLE_TOO_SHORT:
				"O benchmark precisa de pelo menos 5:00 reais em todas as tracks desta fonte.",
			BENCHMARK_PROFILES_NOT_READY:
				"Um ou mais perfis deixaram de estar prontos. Atualize a prontidão antes de tentar novamente.",
			BENCHMARK_PROFILE_EVIDENCE_INVALID:
				"Um perfil terminou sem provar o runtime e a GPU usados. O resultado não foi aceito; execute o diagnóstico antes de tentar novamente.",
			WHISPER_BENCHMARK_RUNTIME_REQUIRED:
				"O Whisper Runtime instalado transcreve normalmente, mas precisa ser atualizado para executar benchmark.",
			QWEN_BENCHMARK_RUNTIME_REQUIRED:
				"O Qwen Runtime instalado transcreve normalmente, mas precisa ser atualizado para executar benchmark.",
			BENCHMARK_RESOURCE_BUSY:
				"Há uma transcrição ou benchmark usando os recursos locais. Aguarde essa execução terminar.",
			TRANSCRIPTION_PREPARATION_ALREADY_RUNNING:
				"Já existe outra preparação em andamento neste computador.",
			TRANSCRIPTION_PREPARATION_BLOCKED_BY_ACTIVE_JOB:
				"Há trabalho local ativo. Aguarde a fila ficar livre antes de preparar os perfis.",
			TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB:
				"Espere o trabalho atual terminar antes de preparar outro perfil.",
			RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB:
				"Há trabalho local na fila ou em execução. Aguarde terminar antes de atualizar o Qwen Runtime.",
			QWEN_RUNTIME_UPDATE_BLOCKED_BY_PREPARATION:
				"Há uma preparação de perfil em andamento. Aguarde terminar antes de atualizar o Qwen Runtime.",
			QWEN_RUNTIME_MAINTENANCE_BUSY:
				"Já existe uma manutenção do Qwen Runtime em andamento.",
			CRAIG_ZIP_REQUIRED: "Escolha um arquivo .zip exportado pelo Craig.",
			CRAIG_UPLOAD_EMPTY: "O ZIP selecionado está vazio.",
			CRAIG_ARCHIVE_INVALID: "O ZIP não pôde ser validado como export Craig.",
			CRAIG_MANIFEST_NOT_FOUND:
				"O ZIP não contém o manifesto esperado do Craig.",
			unauthorized: "Reconecte o Companion antes de continuar.",
			unreachable: "O Companion local ficou indisponível.",
			timeout: "O Companion demorou demais para responder.",
		}[code] ?? `${fallback} · ${code}`
	);
}

function formatBenchmarkHistoryDate(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return "data indisponível";
	return new Intl.DateTimeFormat("pt-PT", {
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(parsed);
}

function ResultCard({
	result,
	updatedAt,
	bridge,
	connected,
	qualityEnabled,
	onCompare,
	onFiles,
	onExport,
	onDiagnostics,
}: Readonly<{
	result: BenchmarkResult;
	updatedAt: string;
	bridge: LocalBridge;
	connected: boolean;
	qualityEnabled: boolean;
	onCompare: () => void;
	onFiles: () => void;
	onExport: () => void;
	onDiagnostics: () => void;
}>) {
	const partial = result.outcome === "partial";
	const gpu = result.profiles
		.map((profile) => profile.executionLineage?.gpu?.model)
		.find(Boolean);
	const hasEvidence =
		!partial &&
		result.benchmarkId !== null &&
		result.bundleSizeBytes !== null &&
		result.profiles.length === PROFILES.length &&
		result.profiles.every((profile) => profile.artifactAvailable);
	return (
		<article className={styles.resultCard} data-outcome={result.outcome}>
			<header className={styles.resultHeader}>
				<div>
					<span className={styles.eyebrow}>Benchmark local · 5:00</span>
					<h3>{partial ? "Benchmark parcial · mesma amostra" : "Quatro perfis · mesma amostra"}</h3>
				</div>
				<StatusPill tone={partial ? "warning" : "success"}>
					{partial ? "Parcial" : "Concluído"}
				</StatusPill>
			</header>
			<div className={styles.receiptFacts}>
				<span>{formatBenchmarkHistoryDate(updatedAt)}</span>
				<span title={result.sampleIdentitySha256}>
					Sample SHA {result.sampleIdentitySha256.slice(0, 12)}…
				</span>
				<span>{result.trackCount} tracks</span>
				<span>{gpu ?? "GPU não registrada"}</span>
				<span>
					{partial
						? `${result.completedCount}/4 concluídos · ${result.failedCount} falhou${result.failedCount === 1 ? "" : "ram"}`
						: "4/4 perfis"}
				</span>
				<span>
					{hasEvidence
						? `bundle ${formatSubmissionBytes(result.bundleSizeBytes ?? 0)} · evidência preservada`
						: partial
							? "sem bundle 4/4 · evidências válidas permanecem por perfil"
							: "receipt performance-only · transcrições não preservadas"}
				</span>
			</div>

			{partial ? (
				<>
					<ol className={styles.runSteps} aria-label="Resultado dos quatro perfis">
						{result.profileOutcomes.map((outcome, index) => {
							const state: BenchmarkStepState =
								outcome.status === "completed" ? "complete" : "failed";
							return (
								<li
									key={outcome.profileId}
									className={styles.runStep}
									data-state={state}
									aria-label={`${LABELS[outcome.profileId]} · ${benchmarkStepLabel(state)}`}
								>
									<i aria-hidden="true">{state === "complete" ? "✓" : "×"}</i>
									<span>
										{LABELS[outcome.profileId]}
										<small>{benchmarkStepLabel(state)}</small>
									</span>
								</li>
							);
						})}
					</ol>
					<div className={styles.partialNotice} role="status">
						<strong>
							{result.completedCount} de 4 perfis concluíram; este attempt não é uma comparação 4/4.
						</strong>
						{result.profileOutcomes
							.filter((outcome) => outcome.status === "failed")
							.map((outcome) => (
								<span key={outcome.profileId}>
									{LABELS[outcome.profileId]}: {benchmarkProfileFailureCopy(outcome.error?.code)}
								</span>
							))}
						<span>
							Os perfis restantes foram tentados automaticamente; execute um novo benchmark para obter uma comparação completa.
						</span>
					</div>
					<div className={styles.activeActions}>
						<Button size="sm" variant="tertiary" onClick={onDiagnostics}>
							Abrir Diagnóstico
						</Button>
					</div>
				</>
			) : (
				<>
					{hasEvidence ? (
						<div className={styles.activeActions}>
							<Button size="sm" variant="secondary" onClick={onCompare}>
								Comparar transcrições
							</Button>
							<Button size="sm" variant="tertiary" onClick={onFiles}>
								Arquivos / evidências
							</Button>
							<Button size="sm" variant="tertiary" onClick={onExport}>
								Exportar ZIP
							</Button>
						</div>
					) : (
						<p className={styles.loading}>
							Artefatos de transcrição não preservados nesta execução. As métricas do
							receipt continuam disponíveis abaixo.
						</p>
					)}
					<details className={styles.resultDetails}>
						<summary>Métricas dos quatro perfis</summary>
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
						<div className={styles.receiptFacts}>
							<span>
								Integridade: {hasEvidence
									? "hashes validados sob demanda ao abrir ou exportar"
									: "sem artefatos preservados para validar"}
							</span>
							<span>
								Formatos: {hasEvidence
									? "JSON · TXT · TXT simples · WebVTT · SRT"
									: "indisponíveis nesta execução"}
							</span>
							<span>
								Bundle: {hasEvidence
									? formatSubmissionBytes(result.bundleSizeBytes ?? 0)
									: "não preservado"}
							</span>
							<span>
								Referência de qualidade: {qualityEnabled ? "gerida localmente abaixo" : "contrato indisponível"}
							</span>
						</div>
						<div className={styles.activeActions}>
							<Button size="sm" variant="tertiary" onClick={onDiagnostics}>
								Abrir Diagnóstico
							</Button>
						</div>
					</details>
					<BenchmarkQualityLab
						result={result}
						bridge={bridge}
						connected={connected}
						enabled={qualityEnabled}
					/>
				</>
			)}
		</article>
	);
}

function ProfileReadiness({
	profile,
	id,
	benchmarkContractSupported,
}: Readonly<{
	profile: TranscriptionProfileState | null;
	id: (typeof PROFILES)[number];
	benchmarkContractSupported: boolean;
}>) {
	const qwenRuntimeRecovery = needsQwenRuntimeRecovery(profile);
	const qwenRuntimeUpgrade = requiresQwenRuntimeUpgrade(profile);
	const benchmarkReason = profile?.benchmarkReason ?? null;
	const state = !benchmarkContractSupported
		? "blocked"
		: profile?.benchmarkReady
			? "ready"
			: qwenRuntimeRecovery
				? "blocked"
				: profile?.benchmarkPreparationRequired
					? "prepare"
					: "blocked";
	const detail = !benchmarkContractSupported
		? "Atualize o Companion para validar a prontidão de benchmark."
		: profile?.benchmarkReady
			? "Pronto"
			: benchmarkReason === "WHISPER_BENCHMARK_RUNTIME_REQUIRED"
				? "Whisper Runtime precisa ser atualizado para benchmark."
				: benchmarkReason === "QWEN_BENCHMARK_RUNTIME_REQUIRED"
					? "Qwen Runtime precisa ser atualizado para benchmark."
					: qwenRuntimeUpgrade
					? "Runtime Qwen precisa ser atualizado."
					: qwenRuntimeRecovery
						? "Runtime Qwen precisa ser verificado."
						: profile
							? (benchmarkReason ?? profileReadinessCopy(profile) ?? profile.reason ?? "Indisponível")
							: "Não anunciado pelo Companion";
	return (
		<div className={styles.profileRow} data-state={state}>
			<strong>{LABELS[id]}</strong>
			<span>
				{benchmarkContractSupported && profile?.benchmarkReady
					? "✓"
					: benchmarkContractSupported && profile?.benchmarkPreparationRequired
						? "◌"
						: "!"}{" "}
				{detail}
			</span>
			{benchmarkContractSupported && benchmarkReason && !profile?.benchmarkReady ? (
				<details className={styles.technicalDetail}>
					<summary>Detalhe técnico</summary>
					<code>{benchmarkReason}</code>
				</details>
			) : null}
		</div>
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
	onObserve,
	onOpenDiagnostics,
}: Readonly<{
	jobs: readonly LocalJob[];
	capabilities: Capabilities | null;
	connected: boolean;
	events: readonly JobEvent[];
	observedJobId: string | null;
	onRefresh: () => void;
	onCancel: (jobId: string) => void | Promise<void>;
	onObserve: (jobId: string) => void | Promise<void>;
	onOpenDiagnostics: (job: LocalJob) => void;
}>) {
	const [bridge] = useState(() => new LocalBridge());
	const [file, setFile] = useState<File | null>(null);
	const [source, setSource] = useState<CraigSource | null>(null);
	const [catalog, setCatalog] = useState<readonly TranscriptionProfileState[]>(
		() => capabilities?.transcription.catalog ?? [],
	);
	const [sourceBusy, setSourceBusy] = useState(false);
	const [busy, setBusy] = useState(false);
	const [preparingProfiles, setPreparingProfiles] = useState(false);
	const [preparationCancelling, setPreparationCancelling] = useState(false);
	const [preparation, setPreparation] = useState<PreparationStatus | null>(null);
	const [qwenRuntime, setQwenRuntime] = useState<QwenRuntimeMaintenanceStatus | null>(null);
	const [qwenRuntimeBusy, setQwenRuntimeBusy] = useState(false);
	const [qwenRuntimeError, setQwenRuntimeError] = useState<string | null>(null);
	const qwenRuntimeCheckKey = useRef<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, BenchmarkResult>>({});
	const [evidenceView, setEvidenceView] = useState<{
		result: BenchmarkResult;
		mode: "compare" | "files";
		promptExport: boolean;
	} | null>(null);
	const [acceptedJob, setAcceptedJob] = useState<LocalJob | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const request = useRef<AbortController | null>(null);
	const onRefreshRef = useRef(onRefresh);
	const pending = useRef<PendingBenchmark | null>(null);

	useEffect(() => {
		setCatalog(capabilities?.transcription.catalog ?? []);
	}, [capabilities]);

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
	const activeFromJobs = benchmarkJobs.find((job) =>
		["queued", "running"].includes(job.status),
	);
	const active =
		activeFromJobs ??
		(acceptedJob && ["queued", "running"].includes(acceptedJob.status)
			? acceptedJob
			: undefined);
	const resultJobs = benchmarkJobs.filter(
		(job) =>
			job.result_available &&
			(job.status === "succeeded" ||
				(job.status === "failed" && job.error?.code === "BENCHMARK_PARTIAL")),
	);
	const latestJob = benchmarkJobs[0];
	const latestProblem =
		latestJob &&
		["failed", "cancelled", "interrupted"].includes(latestJob.status) &&
		!(latestJob.status === "failed" && latestJob.error?.code === "BENCHMARK_PARTIAL")
			? latestJob
			: undefined;
	const profileStates = PROFILES.map(
		(id) => catalog.find((item) => item.id === id) ?? null,
	);
	const benchmarkContractSupported =
		capabilities?.capabilities.includes("processing.benchmark.runtime-readiness-v2") ??
		false;
	const benchmarkQualitySupported = Boolean(
		capabilities?.capabilities.includes("processing.benchmark.evidence-v1") &&
			capabilities.capabilities.includes("processing.benchmark.reference-v1") &&
			capabilities.capabilities.includes("processing.benchmark.quality-v1"),
	);
	const readyCount = benchmarkContractSupported
		? profileStates.filter((item) => item?.benchmarkReady).length
		: 0;
	const pendingProfiles = profileStates.filter(
		(item): item is TranscriptionProfileState =>
			Boolean(
				benchmarkContractSupported &&
					item &&
					!item.benchmarkReady &&
					item.benchmarkPreparationRequired &&
					!needsQwenRuntimeRecovery(item),
			),
	);
	const blockedProfiles = benchmarkContractSupported
		? profileStates.filter(
				(item) =>
					item === null ||
					(!item.benchmarkReady && !item.benchmarkPreparationRequired),
			)
		: profileStates;
	const qwenRuntimeBlocked =
		benchmarkContractSupported && profileStates.some(needsQwenRuntimeRecovery);
	const qwenInstalledVersionFromProfiles =
		profileStates.find(
			(item) => needsQwenRuntimeRecovery(item) && item?.runtimeVersion,
		)?.runtimeVersion ?? null;
	const qwenRuntimeCheckSupported =
		capabilities?.capabilities.includes("runtime.qwen.check") ?? false;
	const qwenRuntimeUpdateSupported =
		capabilities?.capabilities.includes("runtime.qwen.update") ?? false;
	const allProfilesReady =
		benchmarkContractSupported && readyCount === PROFILES.length;
	const fileError = file ? validateCraigFile(file) : null;
	const sampleEligible =
		source === null ||
		source.minimumTrackDurationSeconds === null ||
		source.minimumTrackDurationSeconds >= BENCHMARK_SAMPLE_SECONDS;

	useEffect(() => {
		if (!acceptedJob) return;
		const authoritative = benchmarkJobs.find((job) => job.id === acceptedJob.id);
		if (
			authoritative &&
			!["queued", "running"].includes(authoritative.status)
		)
			setAcceptedJob(null);
	}, [acceptedJob, benchmarkJobs]);

	useEffect(() => {
		const missing = resultJobs
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
	}, [bridge, connected, resultJobs, results]);

	useEffect(() => () => request.current?.abort(), []);

	useEffect(() => {
		onRefreshRef.current = onRefresh;
	}, [onRefresh]);

	useEffect(() => {
		if (!connected || !qwenRuntimeBlocked || !qwenRuntimeCheckSupported) {
			if (!qwenRuntimeBlocked) {
				qwenRuntimeCheckKey.current = null;
				setQwenRuntime(null);
				setQwenRuntimeError(null);
			}
			return;
		}
		const key = qwenInstalledVersionFromProfiles ?? "unknown";
		if (qwenRuntimeCheckKey.current === key) return;
		qwenRuntimeCheckKey.current = key;

		const controller = new AbortController();
		let disposed = false;
		setQwenRuntimeBusy(true);
		setQwenRuntimeError(null);
		void (async () => {
			try {
				const refreshAfterCompletedUpdate = async (
					observed: QwenRuntimeMaintenanceStatus,
				) => {
					if (observed.mode !== "update" || observed.state !== "completed")
						return false;
					setQwenRuntime(observed);
					setStatus("Qwen Runtime atualizado. Recalculando prontidão…");
					const refreshed = await bridge.capabilities(controller.signal);
					if (disposed || controller.signal.aborted) return true;
					setCatalog(refreshed.transcription.catalog);
					onRefreshRef.current();
					const qwenReady = ["qwen-fast", "qwen-quality"].every(
						(id) => refreshed.transcription.catalog.find((item) => item.id === id)?.ready,
					);
					setStatus(
						qwenReady
							? "Qwen Runtime atualizado. Qwen Fast e Qwen Quality estão prontos."
							: "Qwen Runtime atualizado. A prontidão foi recalculada; conclua os gates restantes se houver.",
					);
					return true;
				};

				let observed = await bridge.qwenRuntimeStatus(controller.signal);
				if (disposed || controller.signal.aborted) return;
				setQwenRuntime(observed);

				if (observed.active) {
					while (observed.active && !controller.signal.aborted) {
						await new Promise((resolve) => window.setTimeout(resolve, 650));
						if (disposed || controller.signal.aborted) return;
						observed = await bridge.qwenRuntimeStatus(controller.signal);
						if (disposed || controller.signal.aborted) return;
						setQwenRuntime(observed);
					}
				}

				// The update may finish between the parent's capabilities snapshot and
				// this status read (or during a Strict Mode remount). Treat an already
				// terminal update exactly like one we personally observed finishing.
				if (await refreshAfterCompletedUpdate(observed)) return;
				if (disposed || controller.signal.aborted) return;

				observed = await bridge.checkQwenRuntime(controller.signal);
				if (disposed || controller.signal.aborted) return;
				setQwenRuntime(observed);
				while (observed.active && !controller.signal.aborted) {
					await new Promise((resolve) => window.setTimeout(resolve, 650));
					if (disposed || controller.signal.aborted) return;
					observed = await bridge.qwenRuntimeStatus(controller.signal);
					if (disposed || controller.signal.aborted) return;
					setQwenRuntime(observed);
				}
				if (observed.state === "failed") {
					setQwenRuntimeError(
						observed.errorCode
							? `Não foi possível verificar a Stable do Qwen Runtime · ${observed.errorCode}`
							: "Não foi possível verificar a Stable do Qwen Runtime.",
					);
				}
			} catch (cause) {
				if (disposed || controller.signal.aborted) return;
				setQwenRuntimeError(
					bridgeMessage(cause, "Não foi possível verificar o Qwen Runtime."),
				);
			} finally {
				if (!disposed) setQwenRuntimeBusy(false);
			}
		})();

		return () => {
			disposed = true;
			controller.abort();
			// React Strict Mode intentionally mounts, cleans up and remounts effects
			// in development. Relinquish this attempt's dedupe key so the remount can
			// resume the Companion operation instead of leaving an active update
			// without a poller. The next attempt always GETs status before POSTing,
			// so an already-running maintenance operation is safely reattached.
			if (qwenRuntimeCheckKey.current === key) {
				qwenRuntimeCheckKey.current = null;
			}
		};
	}, [
		bridge,
		connected,
		qwenRuntimeBlocked,
		qwenRuntimeCheckSupported,
		qwenInstalledVersionFromProfiles,
	]);

	async function refreshCatalog(signal: AbortSignal) {
		const refreshed = await bridge.capabilities(signal);
		setCatalog(refreshed.transcription.catalog);
		return refreshed;
	}

	async function pollQwenRuntime(
		initial: QwenRuntimeMaintenanceStatus,
		controller: AbortController,
	) {
		let observed = initial;
		setQwenRuntime(observed);
		while (observed.active && !controller.signal.aborted) {
			await new Promise((resolve) => window.setTimeout(resolve, 650));
			if (controller.signal.aborted) return observed;
			observed = await bridge.qwenRuntimeStatus(controller.signal);
			setQwenRuntime(observed);
		}
		return observed;
	}

	async function checkQwenRuntime(manual = false) {
		if (!connected || !qwenRuntimeCheckSupported || qwenRuntimeBusy) return;
		const controller = new AbortController();
		setQwenRuntimeBusy(true);
		setQwenRuntimeError(null);
		try {
			const observed = await pollQwenRuntime(
				await bridge.checkQwenRuntime(controller.signal),
				controller,
			);
			if (observed.state === "failed") {
				setQwenRuntimeError(
					observed.errorCode
						? `Não foi possível verificar a Stable do Qwen Runtime · ${observed.errorCode}`
						: "Não foi possível verificar a Stable do Qwen Runtime.",
				);
			} else if (manual) {
				setStatus("Estado do Qwen Runtime atualizado.");
			}
		} catch (cause) {
			setQwenRuntimeError(
				bridgeMessage(cause, "Não foi possível verificar o Qwen Runtime."),
			);
		} finally {
			setQwenRuntimeBusy(false);
		}
	}

	async function updateQwenRuntime() {
		if (!connected || !qwenRuntimeUpdateSupported || qwenRuntimeBusy) return;
		const controller = new AbortController();
		setQwenRuntimeBusy(true);
		setQwenRuntimeError(null);
		setError(null);
		try {
			const observed = await pollQwenRuntime(
				await bridge.updateQwenRuntime(controller.signal),
				controller,
			);
			if (observed.state === "failed") {
				setQwenRuntimeError(
					observed.errorCode
						? `A atualização do Qwen Runtime falhou · ${observed.errorCode}. Tente novamente ou abra Diagnóstico.`
						: "A atualização do Qwen Runtime falhou. Tente novamente ou abra Diagnóstico.",
				);
				return;
			}
			if (observed.state !== "completed") return;
			setStatus("Qwen Runtime atualizado. Recalculando prontidão…");
			const refreshed = await refreshCatalog(controller.signal);
			onRefresh();
			const qwenReady = ["qwen-fast", "qwen-quality"].every(
				(id) => refreshed.transcription.catalog.find((item) => item.id === id)?.ready,
			);
			setStatus(
				qwenReady
					? "Qwen Runtime atualizado. Qwen Fast e Qwen Quality estão prontos."
					: "Qwen Runtime atualizado. A prontidão foi recalculada; conclua os gates restantes se houver.",
			);
		} catch (cause) {
			setQwenRuntimeError(
				bridgeMessage(cause, "Não foi possível atualizar o Qwen Runtime."),
			);
		} finally {
			setQwenRuntimeBusy(false);
		}
	}

	async function analyzeSource() {
		if (!file || fileError || sourceBusy || busy || preparingProfiles || active) return;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setSourceBusy(true);
		setSource(null);
		setPreparation(null);
		setError(null);
		setStatus("Analisando o ZIP no Companion local…");
		try {
			const staged = await bridge.craigSource(file, controller.signal);
			setSource(staged);
			await refreshCatalog(controller.signal);
			if (
				staged.minimumTrackDurationSeconds !== null &&
				staged.minimumTrackDurationSeconds < BENCHMARK_SAMPLE_SECONDS
			) {
				setError(
					`A menor track tem ${formatSeconds(staged.minimumTrackDurationSeconds)}. O benchmark exige pelo menos 5:00 em todas as tracks.`,
				);
				setStatus(null);
			} else {
				setStatus(
					`Fonte validada · ${staged.trackCount} tracks · ${staged.reused ? "já estava staged" : "staged agora"}.`,
				);
			}
		} catch (cause) {
			setError(bridgeMessage(cause, "Não foi possível analisar o ZIP Craig."));
			setStatus(null);
		} finally {
			setSourceBusy(false);
		}
	}

	async function preparePending() {
		if (
			!source ||
			preparingProfiles ||
			sourceBusy ||
			busy ||
			active ||
			pendingProfiles.length === 0
		)
			return;
		if (!capabilities?.capabilities.includes("transcription.prepare")) {
			setError("Este Companion não anunciou suporte à preparação de perfis.");
			return;
		}
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setPreparingProfiles(true);
		setError(null);
		try {
			for (const profile of pendingProfiles) {
				if (controller.signal.aborted) return;
				setStatus(`Preparando ${LABELS[profile.id]}…`);
				let observed = await bridge.prepareProfile(
					source.sourceId,
					profile.id,
					controller.signal,
					"benchmark",
				);
				setPreparation(observed);
				while (observed.active && !controller.signal.aborted) {
					await new Promise((resolve) => window.setTimeout(resolve, 750));
					if (controller.signal.aborted) return;
					observed = await bridge.preparation(controller.signal);
					setPreparation(observed);
				}
				if (observed.state !== "completed") {
					setError(
						observed.errorCode
							? `A preparação de ${LABELS[profile.id]} terminou em ${observed.state} · ${observed.errorCode}.`
							: `A preparação de ${LABELS[profile.id]} terminou em ${observed.state}.`,
					);
					return;
				}
				await refreshCatalog(controller.signal);
			}
			setStatus("Preparação concluída. Confirmando os quatro perfis…");
			const refreshed = await refreshCatalog(controller.signal);
			const ready = PROFILES.every(
				(id) =>
					refreshed.transcription.catalog.find((item) => item.id === id)
						?.benchmarkReady,
			);
			if (ready) setStatus("Quatro perfis prontos para o benchmark.");
			else
				setError(
					"A preparação terminou, mas um ou mais perfis ainda não foram anunciados como prontos.",
				);
		} catch (cause) {
			setError(bridgeMessage(cause, "Não foi possível preparar os perfis pendentes."));
		} finally {
			setPreparingProfiles(false);
		}
	}

	async function cancelActivePreparation() {
		const operationId = preparation?.operationId;
		if (
			!operationId ||
			!preparation.active ||
			preparationCancelling ||
			!capabilities?.capabilities.includes("transcription.prepare.cancel")
		)
			return;
		const controller = new AbortController();
		setPreparationCancelling(true);
		try {
			const next = await bridge.cancelPreparation(operationId, controller.signal);
			setPreparation(next);
			setStatus("Preparação cancelada.");
			await refreshCatalog(controller.signal);
		} catch (cause) {
			setError(bridgeMessage(cause, "Não foi possível cancelar a preparação."));
		} finally {
			setPreparationCancelling(false);
		}
	}

	async function runBenchmark() {
		if (
			!file ||
			!source ||
			busy ||
			active ||
			!allProfilesReady ||
			!sampleEligible
		)
			return;
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setBusy(true);
		setError(null);
		setStatus("Enviando benchmark para a fila local…");
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
			setAcceptedJob(job);
			setStatus("Benchmark aceito pelo Companion.");
			await onObserve(job.id);
			onRefresh();
		} catch (cause) {
			setError(bridgeMessage(cause, "Não foi possível iniciar o benchmark local."));
			setStatus(null);
		} finally {
			setBusy(false);
		}
	}

	const activeEvents =
		active && observedJobId === active.id
			? events.filter(
					(event) => event.attempt === null || event.attempt === active.attempt,
				)
			: [];
	const activeProfileOutcomes = new Map<
		(typeof PROFILES)[number],
		{ status: "completed" | "failed"; errorCode: string | null }
	>();
	for (const event of activeEvents) {
		if (event.code !== "BENCHMARK_PROFILE_OUTCOME") continue;
		const profileId = event.data.profile_id;
		const profileStatus = event.data.status;
		if (
			(typeof profileId !== "string" ||
				!PROFILES.includes(profileId as (typeof PROFILES)[number])) ||
			(profileStatus !== "completed" && profileStatus !== "failed")
		)
			continue;
		activeProfileOutcomes.set(profileId as (typeof PROFILES)[number], {
			status: profileStatus,
			errorCode:
				typeof event.data.error_code === "string" ? event.data.error_code : null,
		});
	}
	const attemptedCount = active?.progress?.completed ?? activeProfileOutcomes.size;
	const failedCount = [...activeProfileOutcomes.values()].filter(
		(item) => item.status === "failed",
	).length;
	const successfulCount = activeProfileOutcomes.size
		? [...activeProfileOutcomes.values()].filter((item) => item.status === "completed").length
		: Math.max(0, attemptedCount - failedCount);
	const currentProfile =
		active?.status === "running" && attemptedCount < PROFILES.length
			? PROFILES[attemptedCount] ?? null
			: null;
	const latestEvent = activeEvents.at(-1) ?? null;
	const latestActivity = latestEvent ? presentJobEvent(latestEvent) : null;

	const problemEvents =
		latestProblem && observedJobId === latestProblem.id
			? events.filter(
					(event) =>
						event.attempt === null || event.attempt === latestProblem.attempt,
				)
			: [];
	const problemProfileOutcomes = new Map<
		(typeof PROFILES)[number],
		{ status: "completed" | "failed"; errorCode: string | null }
	>();
	for (const event of problemEvents) {
		if (event.code !== "BENCHMARK_PROFILE_OUTCOME") continue;
		const profileId = event.data.profile_id;
		const profileStatus = event.data.status;
		if (
			typeof profileId !== "string" ||
			!PROFILES.includes(profileId as (typeof PROFILES)[number]) ||
			(profileStatus !== "completed" && profileStatus !== "failed")
		)
			continue;
		problemProfileOutcomes.set(profileId as (typeof PROFILES)[number], {
			status: profileStatus,
			errorCode:
				typeof event.data.error_code === "string" ? event.data.error_code : null,
		});
	}
	const problemStoppedIndex =
		latestProblem &&
		latestProblem.status !== "cancelled" &&
		problemEvents.length > 0 &&
		problemProfileOutcomes.size < PROFILES.length
			? problemProfileOutcomes.size
			: null;

	const preparationLabel =
		preparation?.active && preparation.profileId
			? `${LABELS[preparation.profileId]} · ${preparation.title}`
			: null;

	const nextActionCopy = !benchmarkContractSupported
		? "Atualize o Companion para habilitar o contrato de prontidão do benchmark."
		: qwenRuntimeBlocked
		? !qwenRuntimeCheckSupported
			? "Atualize o Companion para habilitar a recuperação do Qwen Runtime."
			: qwenRuntime?.canUpdate
				? "Atualize o Qwen Runtime para liberar Qwen Fast e Qwen Quality."
				: qwenRuntime?.stableStatus === "below_minimum"
					? "A Stable publicada ainda não atende ao mínimo exigido."
					: qwenRuntime?.stableStatus === "unavailable"
						? "Verifique novamente a disponibilidade da Stable do Qwen Runtime."
						: qwenRuntime?.updateAvailable === false
							? "O runtime não oferece update; abra Diagnóstico para investigar o blocker."
							: "Verifique o Qwen Runtime para determinar a próxima ação."
		: !file
			? "Selecione um ZIP Craig para começar."
		: fileError
			? "Troque o arquivo antes de continuar."
			: !source
				? "Valide a amostra no Companion local."
				: !sampleEligible
					? "Esta fonte não possui 5:00 válidos em todas as tracks."
					: pendingProfiles.length > 0
						? `Prepare ${pendingProfiles.length} ${pendingProfiles.length === 1 ? "perfil pendente" : "perfis pendentes"}.`
						: blockedProfiles.length > 0
							? "Resolva os perfis bloqueados antes de executar."
							: allProfilesReady
								? "Fonte e quatro perfis prontos para executar."
								: "Atualizando a prontidão local.";

	return (
		<div className={styles.workspace}>
			<section className={styles.launchCard} aria-labelledby="benchmark-title">
				<header className={styles.launchHeader}>
					<div>
						<span className={styles.eyebrow}>Benchmark exploratório local</span>
						<h2 id="benchmark-title">Mesmos 5 minutos · quatro perfis</h2>
					</div>
					<p>
						Whisper Turbo, Whisper Detailed, Qwen Fast e Qwen Quality sobre a
						mesma fonte e o mesmo corte temporal.
					</p>
				</header>

				<div className={styles.preflightGrid}>
					<section className={styles.sourcePane} aria-labelledby="benchmark-source-title">
						<div className={styles.sectionHeading}>
							<div>
								<span className={styles.eyebrow}>Source</span>
								<h3 id="benchmark-source-title">Amostra Craig</h3>
							</div>
							{source ? <StatusPill tone={sampleEligible ? "success" : "danger"}>{sampleEligible ? "Apta" : "Curta"}</StatusPill> : null}
						</div>

						<label
							className={styles.sourcePicker}
							data-benchmark-source-picker="true"
							data-selected={file ? "true" : "false"}
							data-disabled={
								sourceBusy || busy || preparingProfiles || Boolean(active)
									? "true"
									: "false"
							}
						>
							<input
								ref={fileInput}
								className={styles.sourceInput}
								type="file"
								aria-label="ZIP Craig"
								accept=".zip,application/zip"
								disabled={
									sourceBusy ||
									busy ||
									preparingProfiles ||
									Boolean(active)
								}
								onChange={(event) => {
									const next = event.target.files?.[0] ?? null;
									setFile(next);
									setSource(null);
									setPreparation(null);
									setError(next ? validateCraigFile(next) : null);
									setStatus(null);
									pending.current = null;
								}}
							/>
							<span className={styles.sourceBadge} aria-hidden="true">ZIP</span>
							<span className={styles.sourcePickerCopy}>
								<strong title={file?.name}>
									{file?.name ?? "Selecionar ZIP Craig"}
								</strong>
								<small>
									{file
										? `${formatSubmissionBytes(file.size)}${source ? ` · ${source.trackCount} tracks` : ""}`
										: "Export do Craig · validação e upload ficam no Companion local"}
								</small>
							</span>
							<span className={styles.sourcePickerAction}>
								{file ? "Trocar" : "Escolher"}
							</span>
						</label>

						{file ? (
							<div className={styles.sourceMeta}>
								<span>{source ? (source.reused ? "Fonte já verificada" : "Verificada agora") : "Aguardando análise"}</span>
								{source?.minimumTrackDurationSeconds !== null &&
								source?.minimumTrackDurationSeconds !== undefined ? (
									<span>Menor track {formatSeconds(source.minimumTrackDurationSeconds)}</span>
								) : null}
								<Button
									type="button"
									variant="tertiary"
									disabled={sourceBusy || busy || preparingProfiles || Boolean(active)}
									onClick={() => {
										if (fileInput.current) fileInput.current.value = "";
										setFile(null);
										setSource(null);
										setPreparation(null);
										setError(null);
										setStatus(null);
										pending.current = null;
									}}
								>
									Remover arquivo
								</Button>
							</div>
						) : null}
					</section>

					<section className={styles.readinessPane} aria-labelledby="benchmark-readiness-title">
						<div className={styles.readinessHeader}>
							<div>
								<span className={styles.eyebrow}>Readiness</span>
								<h3 id="benchmark-readiness-title">Perfis locais</h3>
							</div>
							<strong>{readyCount} / {PROFILES.length} perfis prontos para benchmark</strong>
						</div>
						<div className={styles.profileReadiness}>
							{PROFILES.map((id, index) => (
								<ProfileReadiness
									key={id}
									id={id}
									profile={profileStates[index] ?? null}
									benchmarkContractSupported={benchmarkContractSupported}
								/>
							))}
						</div>
					</section>
				</div>

				{qwenRuntimeBlocked ? (
					<section
						className={styles.runtimeRecovery}
						aria-labelledby="benchmark-qwen-runtime-title"
						data-qwen-runtime-recovery="true"
					>
						<div className={styles.runtimeRecoveryHeader}>
							<div>
								<span className={styles.eyebrow}>Recuperação do Qwen</span>
								<h3 id="benchmark-qwen-runtime-title">Runtime incompatível</h3>
							</div>
							<StatusPill tone={qwenRuntime?.canUpdate ? "warning" : "neutral"}>
								{!qwenRuntimeCheckSupported
									? "Companion antigo"
									: qwenRuntime?.active
										? qwenRuntime.mode === "update"
											? "Atualizando"
											: "Verificando"
										: qwenRuntime?.canUpdate
											? "Atualização disponível"
											: "Bloqueado"}
							</StatusPill>
						</div>
						<p>
							Qwen Fast e Qwen Quality compartilham o mesmo runtime. Uma única atualização corrige a base dos dois perfis.
						</p>
						<dl className={styles.runtimeFacts}>
							<div>
								<dt>Instalado</dt>
								<dd>{qwenRuntime?.installedVersion ?? qwenInstalledVersionFromProfiles ?? "Não identificado"}</dd>
							</div>
							<div>
								<dt>Necessário</dt>
								<dd>{qwenRuntime?.minimumVersion ? `≥ ${qwenRuntime.minimumVersion}` : "Verificando…"}</dd>
							</div>
							<div>
								<dt>Stable disponível</dt>
								<dd>
									{!qwenRuntimeCheckSupported
										? "Atualize o Companion"
										: qwenRuntime?.stableStatus === "compatible"
											? qwenRuntime.stableVersion
										: qwenRuntime?.stableStatus === "below_minimum"
											? `${qwenRuntime.stableVersion ?? "Stable"} · abaixo do mínimo`
											: qwenRuntime?.stableStatus === "unavailable"
												? "Não foi possível confirmar"
												: "Verificando…"}
								</dd>
							</div>
						</dl>
						{qwenRuntime?.active ? (
							<p className={styles.runtimeProgress} role="status" aria-live="polite">
								<strong>{qwenRuntime.title}</strong>
								<span>{qwenRuntime.detail}</span>
							</p>
						) : null}
						{!qwenRuntimeCheckSupported ? (
							<p className={styles.notice}>
								Este Companion detectou o runtime incompatível, mas não anuncia a manutenção segura pela Web. Atualize o Companion antes de tentar reparar o Qwen.
							</p>
						) : null}
						{qwenRuntime?.stableStatus === "below_minimum" ? (
							<p className={styles.notice}>
								A Stable publicada ainda não atende ao mínimo exigido. A atualização permanece bloqueada para não instalar um runtime incompatível.
							</p>
						) : null}
						{qwenRuntime?.stableStatus === "compatible" &&
						qwenRuntime.updateAvailable === false &&
						!qwenRuntime.active ? (
							<p className={styles.notice}>
								O runtime instalado já não está abaixo da Stable compatível. Não há update de versão a aplicar; abra Diagnóstico para investigar o blocker restante.
							</p>
						) : null}
						{qwenRuntimeError ? (
							<p className={styles.error} role="alert">{qwenRuntimeError}</p>
						) : null}
						{qwenRuntimeCheckSupported ? (
						<div className={styles.runtimeActions}>
							{qwenRuntime?.canUpdate && qwenRuntimeUpdateSupported ? (
								<Button
									type="button"
									variant="primary"
									disabled={qwenRuntimeBusy || Boolean(active) || preparingProfiles}
									onClick={() => void updateQwenRuntime()}
								>
									{qwenRuntime?.active && qwenRuntime.mode === "update"
										? "Atualizando Qwen Runtime…"
										: "Atualizar Qwen Runtime"}
								</Button>
							) : (
								<Button
									type="button"
									variant="tertiary"
									disabled={!qwenRuntimeCheckSupported || qwenRuntimeBusy}
									onClick={() => void checkQwenRuntime(true)}
								>
									{qwenRuntimeBusy ? "Verificando Stable…" : "Verificar novamente"}
								</Button>
							)}
						</div>
						) : null}
					</section>
				) : null}

				<div className={styles.actionBand}>
					<div className={styles.actionCopy}>
						<span className={styles.eyebrow}>Próxima ação</span>
						<strong>{active ? "Benchmark já está em andamento." : nextActionCopy}</strong>
					</div>
					{!active ? (
						<div className={styles.primaryActions}>
							{!source && file && !fileError ? (
								<Button
									type="button"
									variant="primary"
									disabled={!connected || sourceBusy || busy || preparingProfiles}
									onClick={() => void analyzeSource()}
								>
									{sourceBusy ? "Analisando amostra…" : "Analisar amostra localmente"}
								</Button>
							) : null}

							{source && sampleEligible && pendingProfiles.length > 0 ? (
								<Button
									type="button"
									variant="primary"
									disabled={preparingProfiles || busy}
									onClick={() => void preparePending()}
								>
									{preparingProfiles
										? "Preparando perfis…"
										: pendingProfiles.length === 1
											? "Preparar 1 perfil pendente"
											: `Preparar ${pendingProfiles.length} perfis pendentes`}
								</Button>
							) : null}

							{source && sampleEligible && allProfilesReady ? (
								<Button
									type="button"
									variant="primary"
									disabled={!connected || busy || preparingProfiles}
									onClick={() => void runBenchmark()}
								>
									{busy ? "Enviando benchmark…" : "Executar benchmark de 5 minutos"}
								</Button>
							) : null}
						</div>
					) : null}
				</div>

				{preparation?.active ? (
					<div className={styles.preparationStatus} role="status">
						<div>
							<strong>{preparationLabel ?? preparation.title}</strong>
							<span>
								{preparation.detail || preparation.stage} · {Math.round(preparation.elapsedSeconds)} s
							</span>
						</div>
						{preparation.operationId &&
						capabilities?.capabilities.includes("transcription.prepare.cancel") ? (
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

				{source && blockedProfiles.length > 0 && !allProfilesReady && !qwenRuntimeBlocked ? (
					<p className={styles.notice}>
						Existem perfis não preparáveis neste estado. Veja o motivo em cada linha e
						atualize o Companion/runtime quando necessário.
					</p>
				) : null}
				{status ? <p className={styles.status} role="status">{status}</p> : null}
				{error || fileError ? (
					<p className={styles.error} role="alert">{error ?? fileError}</p>
				) : null}
			</section>

			{active ? (
				<section className={styles.activeCard} aria-live="polite">
					<div className={styles.activeCopy}>
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
								? `Tentados ${attemptedCount}/${active.progress.total} · Concluídos ${successfulCount} · Falharam ${failedCount}`
								: "Preparando execução"}
							{active.stage ? ` · ${stageLabels[active.stage] ?? active.stage}` : ""}
						</p>
						{latestActivity && latestEvent ? (
							<small>
								{latestActivity.title}
								{latestActivity.detail ? ` · ${latestActivity.detail}` : ""}
								{" · "}
								{formatClock(latestEvent.at)}
							</small>
						) : (
							<small>Job {active.id.slice(0, 12)}… · atualizado {formatClock(active.updated_at)}</small>
						)}
					</div>
					<ol className={styles.runSteps} aria-label="Progresso dos quatro perfis">
						{PROFILES.map((id, index) => {
							const outcome = activeProfileOutcomes.get(id);
							const stepState: BenchmarkStepState = outcome
								? outcome.status === "completed"
									? "complete"
									: "failed"
								: index < attemptedCount
									? "complete"
									: currentProfile === id
										? "current"
										: "pending";
							return (
								<li
									key={id}
									className={styles.runStep}
									data-state={stepState}
									aria-current={stepState === "current" ? "step" : undefined}
									aria-label={`${LABELS[id]} · ${benchmarkStepLabel(stepState)}`}
								>
									<i aria-hidden="true">
										{stepState === "complete" ? "✓" : stepState === "failed" ? "×" : index + 1}
									</i>
									<span>
										{LABELS[id]}
										<small>{benchmarkStepLabel(stepState)}</small>
									</span>
								</li>
							);
						})}
					</ol>
					<div className={styles.activeActions}>
						<Button
							type="button"
							variant="tertiary"
							onClick={() => onOpenDiagnostics(active)}
						>
							Ver log / Diagnóstico
						</Button>
						<Button
							type="button"
							variant="tertiary"
							onClick={async () => {
								await onCancel(active.id);
								onRefresh();
							}}
						>
							Cancelar benchmark
						</Button>
					</div>
				</section>
			) : latestProblem ? (
				<section className={styles.problemCard} role="status">
					<div>
						<span className={styles.eyebrow}>Última execução</span>
						<h3>
							{latestProblem.status === "cancelled"
								? "Benchmark cancelado"
								: latestProblem.status === "interrupted"
									? "Benchmark interrompido"
									: "Benchmark falhou"}
						</h3>
						<p>
							{latestProblem.error?.code
								? `${latestProblem.error.code} · tentativa ${latestProblem.attempt}`
								: `Tentativa ${latestProblem.attempt}`}
						</p>
					</div>
					{problemEvents.length > 0 ? (
						<ol
							className={styles.runSteps}
							aria-label="Estado dos quatro perfis na execução interrompida"
						>
							{PROFILES.map((id, index) => {
								const outcome = problemProfileOutcomes.get(id);
								const state: BenchmarkStepState = outcome
									? outcome.status === "completed"
										? "complete"
										: "failed"
									: index === problemStoppedIndex
										? "stopped"
										: "not_attempted";
								const icon =
									state === "complete"
										? "✓"
										: state === "failed"
											? "×"
											: state === "stopped"
												? "!"
												: index + 1;
								return (
									<li
										key={id}
										className={styles.runStep}
										data-state={state}
										aria-label={`${LABELS[id]} · ${benchmarkStepLabel(state)}`}
									>
										<i aria-hidden="true">{icon}</i>
										<span>
											{LABELS[id]}
											<small>{benchmarkStepLabel(state)}</small>
										</span>
									</li>
								);
							})}
						</ol>
					) : null}
					<Button
						type="button"
						variant="tertiary"
						onClick={() => onOpenDiagnostics(latestProblem)}
					>
						Ver log / Diagnóstico
					</Button>
				</section>
			) : null}

			{evidenceView ? (
				<BenchmarkEvidenceWorkspace
					key={`${evidenceView.result.jobId}:${evidenceView.mode}:${evidenceView.promptExport ? "export" : "browse"}`}
					bridge={bridge}
					result={evidenceView.result}
					initialMode={evidenceView.mode}
					promptExport={evidenceView.promptExport}
					onClose={() => setEvidenceView(null)}
				/>
			) : null}

			<section className={styles.history}>
				<div className={styles.historyHeader}>
					<div>
						<span className={styles.eyebrow}>Histórico local</span>
						<h2>Receipts comparáveis</h2>
					</div>
					<span>{resultJobs.length} execução{resultJobs.length === 1 ? "" : "ões"}</span>
				</div>
				{resultJobs.length ? (
					resultJobs.slice(0, 10).map((job) =>
						results[job.id] ? (
							<ResultCard
								key={job.id}
								result={results[job.id]!}
								updatedAt={job.updated_at}
								bridge={bridge}
								connected={connected}
								qualityEnabled={benchmarkQualitySupported}
								onCompare={() =>
									setEvidenceView({
										result: results[job.id]!,
										mode: "compare",
										promptExport: false,
									})
								}
								onFiles={() =>
									setEvidenceView({
										result: results[job.id]!,
										mode: "files",
										promptExport: false,
									})
								}
								onExport={() =>
									setEvidenceView({
										result: results[job.id]!,
										mode: "files",
										promptExport: true,
									})
								}
								onDiagnostics={() => onOpenDiagnostics(job)}
							/>
						) : (
							<p key={job.id} className={styles.loading}>Carregando receipt {job.id.slice(0, 8)}…</p>
						),
					)
				) : (
					<p className={styles.empty}>
						Nenhum benchmark concluído ou parcial neste Companion.
					</p>
				)}
			</section>
		</div>
	);
}
