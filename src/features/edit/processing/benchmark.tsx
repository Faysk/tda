"use client";

import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
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
	type TranscriptionProfileState,
} from "./protocol";
import { LocalBridge } from "./bridge";
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

function formatDateTime(value: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "—";
	return date.toLocaleString("pt-BR", {
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function benchmarkDevice(result: BenchmarkResult): string {
	return (
		result.profiles
			.map((profile) => profile.executionLineage?.gpu?.model)
			.find((model): model is string => Boolean(model)) ?? "GPU local"
	);
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
			BENCHMARK_RESOURCE_BUSY:
				"Há uma transcrição ou benchmark usando os recursos locais. Aguarde essa execução terminar.",
			TRANSCRIPTION_PREPARATION_ALREADY_RUNNING:
				"Já existe outra preparação em andamento neste computador.",
			TRANSCRIPTION_PREPARATION_BLOCKED_BY_ACTIVE_JOB:
				"Há trabalho local ativo. Aguarde a fila ficar livre antes de preparar os perfis.",
			TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB:
				"Espere o trabalho atual terminar antes de preparar outro perfil.",
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

function ResultCard({ result }: Readonly<{ result: BenchmarkResult }>) {
	return (
		<article className={styles.resultCard}>
			<header className={styles.resultHeader}>
				<div>
					<span className={styles.eyebrow}>Receipt detalhado · 5:00</span>
					<h3>Comparação dos quatro perfis</h3>
				</div>
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

function ProfileReadiness({
	profile,
	id,
}: Readonly<{
	profile: TranscriptionProfileState | null;
	id: (typeof PROFILES)[number];
}>) {
	const state = profile?.ready
		? "ready"
		: profile?.preparationRequired
			? "prepare"
			: "blocked";
	const detail =
		profile?.ready
			? "Pronto"
			: profile
				? (profileReadinessCopy(profile) ?? profile.reason ?? "Indisponível")
				: "Não anunciado pelo Companion";
	return (
		<div className={styles.profileRow} data-state={state}>
			<strong>{LABELS[id]}</strong>
			<span>{profile?.ready ? "✓" : profile?.preparationRequired ? "◌" : "!"} {detail}</span>
			{profile?.reason && !profile.ready ? <small>{profile.reason}</small> : null}
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
	onOpenDiagnostics: (jobId: string) => void;
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
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [results, setResults] = useState<Record<string, BenchmarkResult>>({});
	const [acceptedJob, setAcceptedJob] = useState<LocalJob | null>(null);
	const [dragActive, setDragActive] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const request = useRef<AbortController | null>(null);
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
	const latestCompleted = benchmarkJobs.filter(
		(job) => job.status === "succeeded" && job.result_available,
	);
	const latestJob = benchmarkJobs[0];
	const latestProblem =
		latestJob && ["failed", "cancelled", "interrupted"].includes(latestJob.status)
			? latestJob
			: undefined;
	const profileStates = PROFILES.map(
		(id) => catalog.find((item) => item.id === id) ?? null,
	);
	const readyCount = profileStates.filter((item) => item?.ready).length;
	const pendingProfiles = profileStates.filter(
		(item): item is TranscriptionProfileState =>
			Boolean(item && !item.ready && item.preparationRequired),
	);
	const blockedProfiles = profileStates.filter(
		(item) => item === null || (!item.ready && !item.preparationRequired),
	);
	const allProfilesReady = readyCount === PROFILES.length;
	const fileError = file ? validateCraigFile(file) : null;
	const sampleEligible =
		source === null ||
		source.minimumTrackDurationSeconds === null ||
		source.minimumTrackDurationSeconds >= BENCHMARK_SAMPLE_SECONDS;
	const pickerDisabled =
		sourceBusy || busy || preparingProfiles || Boolean(active);

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

	function applyFile(next: File | null) {
		setFile(next);
		setSource(null);
		setPreparation(null);
		setError(null);
		setStatus(null);
		pending.current = null;
		if (!next && fileInput.current) fileInput.current.value = "";
	}

	function handleDrop(event: DragEvent<HTMLButtonElement>) {
		event.preventDefault();
		setDragActive(false);
		if (pickerDisabled) return;
		applyFile(event.dataTransfer.files.item(0));
	}

	async function refreshCatalog(signal: AbortSignal) {
		const refreshed = await bridge.capabilities(signal);
		setCatalog(refreshed.transcription.catalog);
		return refreshed;
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
				(id) => refreshed.transcription.catalog.find((item) => item.id === id)?.ready,
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

	const completed = active?.progress?.completed ?? 0;
	const currentProfile =
		active?.status === "running" && completed < PROFILES.length
			? PROFILES[completed]
			: null;
	const activeEvents =
		active && observedJobId === active.id
			? events.filter(
					(event) => event.attempt === null || event.attempt === active.attempt,
				)
			: [];
	const latestEvent = activeEvents.at(-1) ?? null;
	const latestActivity = latestEvent ? presentJobEvent(latestEvent) : null;

	const preparationLabel =
		preparation?.active && preparation.profileId
			? `${LABELS[preparation.profileId]} · ${preparation.title}`
			: null;

	const actionTitle = active
		? "Acompanhar a execução atual"
		: !file
			? "Selecionar o ZIP Craig"
			: fileError
				? "Escolher outro ZIP válido"
			: !source
				? "Analisar a amostra localmente"
				: !sampleEligible
					? "Escolher uma fonte com 5:00 por track"
					: pendingProfiles.length > 0
						? `Preparar ${pendingProfiles.length} perfil${pendingProfiles.length === 1 ? "" : "s"} pendente${pendingProfiles.length === 1 ? "" : "s"}`
						: allProfilesReady
							? "Executar benchmark"
							: "Resolver os perfis bloqueados";
	const actionDetail = active
		? "Progresso, perfil atual e última atividade aparecem logo abaixo."
		: !file
			? "O ZIP fica neste computador e é validado pelo Companion antes de qualquer execução."
		: fileError
			? "O arquivo selecionado não atende ao contrato Craig."
			: !source
				? "Confirme tracks, duração mínima e identidade local da fonte."
				: !sampleEligible
					? "Todas as tracks precisam oferecer pelo menos cinco minutos úteis."
					: pendingProfiles.length > 0
						? "A preparação acontece antes da medição e não entra no tempo do benchmark."
						: allProfilesReady
							? "Os quatro perfis estão prontos para usar exatamente a mesma amostra."
							: "Leia o motivo em Prontidão antes de continuar.";

	return (
		<div className={styles.workspace} data-benchmark-workspace="true">
			<header className={styles.workspaceHeader}>
				<div>
					<span className={styles.eyebrow}>Benchmark local</span>
					<h2>Performance dos quatro perfis</h2>
					<p>
						Whisper Turbo, Whisper Detailed, Qwen Fast e Qwen Quality sobre os
						mesmos cinco minutos, em sequência.
					</p>
				</div>
				<span className={styles.workspaceMeta}>5:00 por perfil · execução local</span>
			</header>

			<section className={styles.preflight} aria-label="Preparação do benchmark">
				<div className={styles.sourceRegion}>
					<div className={styles.sectionHeading}>
						<div>
							<span className={styles.eyebrow}>Source</span>
							<strong>ZIP Craig</strong>
						</div>
						{source && sampleEligible ? <StatusPill tone="success">Amostra apta</StatusPill> : null}
					</div>

					<div
						className={styles.dropZone}
						data-active={dragActive ? "true" : "false"}
						data-selected={file ? "true" : "false"}
					>
						<input
							ref={fileInput}
							className={styles.fileInput}
							type="file"
							accept=".zip,application/zip"
							aria-label="ZIP Craig"
							disabled={pickerDisabled}
							onChange={(event) => applyFile(event.target.files?.[0] ?? null)}
						/>
						<button
							type="button"
							className={styles.dropAction}
							disabled={pickerDisabled}
							onClick={() => fileInput.current?.click()}
							onDragEnter={(event) => {
								event.preventDefault();
								if (!pickerDisabled) setDragActive(true);
							}}
							onDragOver={(event) => {
								event.preventDefault();
								if (!pickerDisabled) setDragActive(true);
							}}
							onDragLeave={(event) => {
								if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
								setDragActive(false);
							}}
							onDrop={handleDrop}
						>
							<span className={styles.dropGlyph} aria-hidden="true">{file ? "✓" : "ZIP"}</span>
							<span className={styles.dropCopy}>
								<strong title={file?.name}>
									{file ? file.name : "Arraste o ZIP do Craig aqui"}
								</strong>
								<span>
									{file
										? `${formatSubmissionBytes(file.size)} · clique para trocar`
										: "ou escolher arquivo"}
								</span>
							</span>
						</button>
					</div>

					{file ? (
						<dl className={styles.sourceFacts}>
							<div><dt>Arquivo</dt><dd title={file.name}>{file.name}</dd></div>
							<div><dt>Tamanho</dt><dd>{formatSubmissionBytes(file.size)}</dd></div>
							{source ? (
								<>
									<div><dt>Tracks</dt><dd>{source.trackCount}</dd></div>
									<div>
										<dt>Menor track</dt>
										<dd>
											{source.minimumTrackDurationSeconds === null
												? "Não informado"
												: formatSeconds(source.minimumTrackDurationSeconds)}
										</dd>
									</div>
								</>
							) : null}
						</dl>
					) : null}
				</div>

				<div className={styles.readinessRegion}>
					<div className={styles.sectionHeading}>
						<div>
							<span className={styles.eyebrow}>Readiness</span>
							<strong>Perfis locais</strong>
						</div>
						<span className={styles.readinessCount}>{readyCount} / {PROFILES.length} perfis prontos</span>
					</div>
					<div className={styles.readinessList}>
						{PROFILES.map((id, index) => (
							<ProfileReadiness key={id} id={id} profile={profileStates[index] ?? null} />
						))}
					</div>
				</div>
			</section>

			<section className={styles.nextAction} aria-label="Próxima ação">
				<div className={styles.actionCopy}>
					<span className={styles.eyebrow}>Próxima ação</span>
					<strong>{actionTitle}</strong>
					<span>{actionDetail}</span>
				</div>
				<div className={styles.primaryActions}>
					{active ? null : !file ? (
						<Button
							type="button"
							variant="primary"
							disabled={!connected || pickerDisabled}
							onClick={() => fileInput.current?.click()}
						>
							Selecionar ZIP
						</Button>
					) : fileError || (source && !sampleEligible) ? (
						<Button
							type="button"
							variant="primary"
							disabled={pickerDisabled}
							onClick={() => fileInput.current?.click()}
						>
							Trocar ZIP
						</Button>
					) : !source ? (
						<Button
							type="button"
							variant="primary"
							disabled={!connected || sourceBusy || pickerDisabled}
							onClick={() => void analyzeSource()}
						>
							{sourceBusy ? "Analisando amostra…" : "Analisar amostra localmente"}
						</Button>
					) : pendingProfiles.length > 0 ? (
						<Button
							type="button"
							variant="primary"
							disabled={preparingProfiles || busy || Boolean(active)}
							onClick={() => void preparePending()}
						>
							{preparingProfiles
								? "Preparando perfis…"
								: pendingProfiles.length === 1
									? "Preparar 1 perfil pendente"
									: `Preparar ${pendingProfiles.length} perfis pendentes`}
						</Button>
					) : allProfilesReady ? (
						<Button
							type="button"
							variant="primary"
							disabled={!connected || busy || preparingProfiles || Boolean(active)}
							onClick={() => void runBenchmark()}
						>
							{busy ? "Enviando benchmark…" : "Executar benchmark de 5 minutos"}
						</Button>
					) : null}
					{file && !pickerDisabled ? (
						<Button type="button" variant="tertiary" onClick={() => applyFile(null)}>
							Remover arquivo
						</Button>
					) : null}
				</div>
			</section>

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

			{source && blockedProfiles.length > 0 && !allProfilesReady ? (
				<p className={styles.notice}>
					Existem perfis não preparáveis neste estado. Veja o motivo em cada linha e
					atualize o Companion/runtime quando necessário.
				</p>
			) : null}
			{status ? <p className={styles.status} role="status">{status}</p> : null}
			{error || fileError ? (
				<p className={styles.error} role="alert">{error ?? fileError}</p>
			) : null}

			{active ? (
				<section className={styles.activeRegion} aria-live="polite">
					<div className={styles.activeTop}>
						<div className={styles.activeCopy}>
							<span className={styles.eyebrow}>Benchmark em andamento</span>
							<h3>
								{active.status === "queued"
									? "Aguardando worker local"
									: currentProfile
										? LABELS[currentProfile]
										: "Finalizando"}
							</h3>
						</div>
						<div className={styles.activeActions}>
							<Button type="button" variant="tertiary" onClick={() => onOpenDiagnostics(active.id)}>
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
					</div>

					<div className={styles.progressBlock}>
						<div className={styles.progressMeta}>
							<span>
								{active.progress
									? `${active.progress.completed} de ${active.progress.total} perfis concluídos`
									: "Preparando execução"}
								{active.stage ? ` · ${stageLabels[active.stage] ?? active.stage}` : ""}
							</span>
							<span>
								{active.timing.attemptElapsedSeconds === null
									? "tempo ainda indisponível"
									: `${formatSeconds(active.timing.attemptElapsedSeconds)} decorridos`}
							</span>
						</div>
						<progress
							className={styles.progress}
							max={PROFILES.length}
							value={Math.min(completed, PROFILES.length)}
							aria-label="Progresso dos perfis do benchmark"
						/>
						<ol className={styles.profileProgress}>
							{PROFILES.map((id, index) => {
								const state =
									index < completed
										? "complete"
										: active.status === "running" && index === completed
											? "current"
											: "pending";
								return (
									<li key={id} data-state={state}>
										<span aria-hidden="true">{state === "complete" ? "✓" : index + 1}</span>
										{LABELS[id]}
									</li>
								);
							})}
						</ol>
					</div>

					<p className={styles.latestActivity}>
						{latestActivity && latestEvent ? (
							<>
								<strong>{latestActivity.title}</strong>
								{latestActivity.detail ? ` · ${latestActivity.detail}` : ""}
								{" · "}
								{formatClock(latestEvent.at)}
							</>
						) : (
							<>Job {active.id.slice(0, 12)}… · atualizado {formatClock(active.updated_at)}</>
						)}
					</p>
				</section>
			) : latestProblem ? (
				<section className={styles.problemRegion} role="status">
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
					<Button type="button" variant="tertiary" onClick={() => onOpenDiagnostics(latestProblem.id)}>
						Ver log / Diagnóstico
					</Button>
				</section>
			) : null}

			<section
				className={styles.historySection}
				data-benchmark-history={latestCompleted.length ? "populated" : "empty"}
			>
				<div className={styles.historyHeader}>
					<div>
						<span className={styles.eyebrow}>Histórico local</span>
						<h2>Receipts comparáveis</h2>
					</div>
					<span>{latestCompleted.length} concluído{latestCompleted.length === 1 ? "" : "s"}</span>
				</div>
				{latestCompleted.length ? (
					<div className={styles.historyList}>
						{latestCompleted.slice(0, 10).map((job) => {
							const result = results[job.id];
							return result ? (
								<details className={styles.historyItem} key={job.id}>
									<summary>
										<span className={styles.historyWhen}>{formatDateTime(job.updated_at)}</span>
										<span className={styles.historySummary}>
											<strong>Quatro perfis · mesma amostra</strong>
											<small title={result.sampleIdentitySha256}>
												{result.trackCount} tracks · sample {result.sampleIdentitySha256.slice(0, 8)}…
											</small>
										</span>
										<span className={styles.historyDevice}>{benchmarkDevice(result)}</span>
										<StatusPill tone="success">Concluído</StatusPill>
									</summary>
									<div className={styles.historyDetail}>
										<ResultCard result={result} />
									</div>
								</details>
							) : (
								<p key={job.id} className={styles.loading}>
									Carregando receipt {job.id.slice(0, 8)}…
								</p>
							);
						})}
					</div>
				) : (
					<p className={styles.empty}>Nenhum benchmark concluído neste Companion.</p>
				)}
			</section>
		</div>
	);
}
