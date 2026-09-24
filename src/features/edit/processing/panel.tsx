"use client";

import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/status";
import { supportsTerminalJobDelete } from "./compatibility";
import { ProcessingController } from "./controller";
import { LocalReviewWorkspace } from "./local-review";
import { publishApprovedLocalReview } from "./publication-client";
import { ProcessingSubmission } from "./submission";
import {
	jobLabels,
	presentConnectionError,
	presentJobError,
	presentJobEvent,
	presentJobTitle,
	stageLabels,
} from "./presentation";
import type { JobEvent, LocalJob, SystemGpu } from "./protocol";
import styles from "./processing.module.css";

type Confirmation =
	| { id: string; action: "cancel" | "retry" | "delete" }
	| { action: "resume" };

type ProcessingView = "overview" | "queue" | "results" | "diagnostics";
type QueueFilter =
	| "all"
	| "running"
	| "queued"
	| "attention"
	| "succeeded"
	| "cancelled";
type EventFilter = "all" | "warning" | "error";

const processingViews: readonly { id: ProcessingView; label: string }[] = [
	{ id: "overview", label: "Visão geral" },
	{ id: "queue", label: "Fila" },
	{ id: "results", label: "Resultados" },
	{ id: "diagnostics", label: "Diagnóstico" },
];

const queueFilterLabels: Readonly<Record<QueueFilter, string>> = {
	all: "Todos",
	running: "Processando",
	queued: "Na fila",
	attention: "Atenção",
	succeeded: "Concluídos",
	cancelled: "Cancelados",
};

const eventFilterLabels: Readonly<Record<EventFilter, string>> = {
	all: "Todos",
	warning: "Avisos",
	error: "Erros",
};

function jobTone(status: LocalJob["status"]): StatusTone {
	if (status === "succeeded") return "success";
	if (status === "failed" || status === "interrupted") return "danger";
	if (status === "running" || status === "queued") return "accent";
	return "neutral";
}

function progressPercent(job: LocalJob): number | null {
	if (!job.progress) return null;
	if (job.progress.completed === 0 && job.status !== "succeeded") return null;
	if (
		job.status === "running" &&
		(job.progress.completed >= job.progress.total ||
			consolidationStages.has(job.stage))
	)
		return null;
	return Math.round((job.progress.completed / job.progress.total) * 100);
}

function formatBytes(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	const gib = value / 1024 ** 3;
	return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GB`;
}

function formatPercent(value: number | null): string {
	return value === null ? "—" : `${Math.round(value)}%`;
}

function formatTime(value: string): string {
	return new Date(value).toLocaleTimeString("pt-BR", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatDateTime(value: string): string {
	return new Date(value).toLocaleString("pt-BR", {
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function progressCopy(job: LocalJob): string {
	if (!job.progress) return "Sem medida de progresso nesta etapa.";
	const unit = job.progress.unit === "items" ? "itens" : job.progress.unit;
	return `${job.progress.completed} de ${job.progress.total} ${unit}`;
}

const preparationStages = new Set([
	"queued",
	"preparing",
	"runtime_validation",
	"source_validation",
	"checking_model",
	"downloading_model",
	"model_prepare",
	"model_load",
	"loading_cpu",
	"loading_cuda",
	"loading_cuda_fallback",
]);
const processingStages = new Set([
	"fixture",
	"transcribing",
	"transcription",
	"diarization",
	"noise_cleanup",
	"resuming",
	"alignment",
]);
const consolidationStages = new Set([
	"energy_analysis",
	"cross_track_dedup",
	"merge_timeline",
	"turn_building",
	"result_prepare",
	"consolidating",
	"complete",
]);

function pipelineState(
	stage: string,
	phase: "preparation" | "processing" | "consolidation",
): "current" | "done" | "pending" {
	if (phase === "preparation") return preparationStages.has(stage) ? "current" : "done";
	if (phase === "processing") {
		if (processingStages.has(stage)) return "current";
		return consolidationStages.has(stage) ? "done" : "pending";
	}
	return consolidationStages.has(stage) ? "current" : "pending";
}

function eventTrackContext(events: readonly JobEvent[]) {
	for (const event of events) {
		const track = event.data.track;
		const total = event.data.total_tracks;
		const speaker = event.data.speaker;
		const window = event.data.window;
		const segment = event.data.segment;
		if (
			typeof track === "number" ||
			typeof speaker === "string" ||
			typeof window === "number" ||
			typeof segment === "number"
		) {
			return {
				track: typeof track === "number" ? track : null,
				total: typeof total === "number" ? total : null,
				speaker: typeof speaker === "string" ? speaker : null,
				window: typeof window === "number" ? window : null,
				segment: typeof segment === "number" ? segment : null,
			};
		}
	}
	return null;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
	return (
		<div className={styles.metric}>
			<span>{label}</span>
			<strong>{value}</strong>
			{detail ? <small>{detail}</small> : null}
		</div>
	);
}

function GpuMetric({ gpu }: { gpu: SystemGpu }) {
	return (
		<div className={styles.metric}>
			<span>GPU</span>
			<strong>{formatPercent(gpu.utilizationPercent)}</strong>
			<small title={gpu.name}>
				{formatBytes(gpu.memoryUsedBytes)} / {formatBytes(gpu.memoryTotalBytes)} VRAM
			</small>
		</div>
	);
}

function JobRow({
	job,
	busy,
	canDelete,
	onCancel,
	onRetry,
	onResult,
	onDelete,
}: {
	job: LocalJob;
	busy: boolean;
	canDelete: boolean;
	onCancel: () => void;
	onRetry: () => void;
	onResult: () => void;
	onDelete: () => void;
}) {
	const percent = progressPercent(job);
	return (
		<li className={styles.jobRow} data-status={job.status}>
			<div className={styles.jobRowMain}>
				<strong>{presentJobTitle(job)}</strong>
				<span>
					{job.context?.sessionId ? `Sessão ${job.context.sessionId} · ` : ""}
					{job.error
						? presentJobError(job.error.code)
						: (stageLabels[job.stage] ?? job.stage)}
				</span>
			</div>
			<div className={styles.jobRowProgress}>
				{job.progress && percent !== null ? (
					<>
						<progress
							aria-label={`Progresso do trabalho ${job.id}`}
							value={job.progress.completed}
							max={job.progress.total}
						/>
						<span>{percent}%</span>
					</>
				) : (
					<span>
						{job.progress && job.progress.completed > 0
							? progressCopy(job)
							: "Sem medida de progresso nesta etapa."}
					</span>
				)}
			</div>
			<StatusPill tone={jobTone(job.status)}>{jobLabels[job.status]}</StatusPill>
			<time dateTime={job.updated_at}>{formatDateTime(job.updated_at)}</time>
			<div className={styles.rowActions}>
				{["queued", "running"].includes(job.status) ? (
					<Button size="sm" disabled={busy} onClick={onCancel}>
						Cancelar trabalho
					</Button>
				) : null}
				{["failed", "interrupted"].includes(job.status) && job.error?.recoverable ? (
					<Button size="sm" disabled={busy} onClick={onRetry}>
						Repetir trabalho
					</Button>
				) : null}
				{job.status === "succeeded" && job.result_available ? (
					<Button size="sm" disabled={busy} onClick={onResult}>
						Consultar resultado local
					</Button>
				) : null}
				{canDelete &&
				["succeeded", "failed", "interrupted", "cancelled"].includes(job.status) ? (
					<Button size="sm" variant="tertiary" disabled={busy} onClick={onDelete}>
						Excluir
					</Button>
				) : null}
			</div>
		</li>
	);
}

export function ProcessingPanel({
	publicationEnabled = false,
}: Readonly<{ publicationEnabled?: boolean }>) {
	const [controller] = useState(() => new ProcessingController());
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.snapshot,
		controller.serverSnapshot,
	);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [view, setView] = useState<ProcessingView>("overview");
	const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
	const [eventFilter, setEventFilter] = useState<EventFilter>("all");
	const dialog = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		void controller.connect();
		return () => controller.disconnect();
	}, [controller]);
	useEffect(() => {
		if (state.connection !== "connected" || state.busy) return;
		const timer = setTimeout(() => {
			if (document.visibilityState === "visible") void controller.refresh();
		}, 3000);
		const visible = () => {
			if (document.visibilityState === "visible") void controller.refresh();
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [controller, state.connection, state.busy]);
	useEffect(() => {
		if (confirmation) dialog.current?.showModal();
		else dialog.current?.close();
	}, [confirmation]);

	const connected = state.connection === "connected";
	const label = connected
		? { preparing: "Em preparação", ready: "Pronto", paused: "Fila pausada" }[
				state.health?.lifecycle ?? "preparing"
			]
		: state.connection === "connecting"
			? "Conectando"
			: state.error === "version_incompatible"
				? "Atualização necessária"
				: state.error === "api_incompatible"
					? "API incompatível"
					: state.error === "session_incompatible" || state.error === "incompatible"
						? "Companion incompatível"
						: "Serviço desconectado";
	const running = state.jobs.filter((job) => job.status === "running");
	const queued = state.jobs
		.filter((job) => job.status === "queued")
		.sort(
			(left, right) =>
				new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime(),
		);
	const succeeded = state.jobs.filter((job) => job.status === "succeeded");
	const cancelled = state.jobs.filter((job) => job.status === "cancelled");
	const attention = state.jobs.filter((job) =>
		["failed", "interrupted"].includes(job.status),
	);
	const finished = state.jobs.filter((job) =>
		["succeeded", "cancelled"].includes(job.status),
	);
	const queueGroups: readonly {
		id: Exclude<QueueFilter, "all">;
		title: string;
		jobs: readonly LocalJob[];
	}[] = [
		{ id: "running", title: "Processando", jobs: running },
		{ id: "queued", title: "Na fila", jobs: queued },
		{ id: "attention", title: "Precisam de atenção", jobs: attention },
		{ id: "succeeded", title: "Concluídos", jobs: succeeded },
		{ id: "cancelled", title: "Cancelados", jobs: cancelled },
	];
	const visibleQueueGroups =
		queueFilter === "all"
			? queueGroups
			: queueGroups.filter((group) => group.id === queueFilter);
	const visibleQueueCount = visibleQueueGroups.reduce(
		(total, group) => total + group.jobs.length,
		0,
	);
	const filteredEvents =
		eventFilter === "all"
			? state.events
			: state.events.filter((event) => event.level === eventFilter);

	const activeJob = running[0] ?? null;
	const activePercent = activeJob ? progressPercent(activeJob) : null;
	const observedJob = state.jobs.find((job) => job.id === state.observedJobId) ?? activeJob;
	const gpu = state.system?.gpus[0] ?? null;
	const trackContext = eventTrackContext(state.events);
	const canDeleteJobs = supportsTerminalJobDelete(state.health?.service_version);

	async function confirm() {
		const choice = confirmation;
		setConfirmation(null);
		if (!choice) return;
		if (choice.action === "resume") await controller.lifecycle("resume");
		else if (choice.action === "delete") await controller.deleteJob(choice.id);
		else await controller.jobAction(choice.id, choice.action);
	}

	function selectViewFromKeyboard(
		event: ReactKeyboardEvent<HTMLButtonElement>,
		index: number,
	) {
		let nextIndex: number | null = null;
		if (event.key === "ArrowRight") {
			nextIndex = (index + 1) % processingViews.length;
		} else if (event.key === "ArrowLeft") {
			nextIndex = (index - 1 + processingViews.length) % processingViews.length;
		} else if (event.key === "Home") {
			nextIndex = 0;
		} else if (event.key === "End") {
			nextIndex = processingViews.length - 1;
		}
		if (nextIndex === null) return;
		event.preventDefault();
		const next = processingViews[nextIndex];
		if (!next) return;
		setView(next.id);
		requestAnimationFrame(() => {
			document.getElementById(`processing-tab-${next.id}`)?.focus();
		});
	}

	const renderRow = (job: LocalJob) => (
		<JobRow
			key={job.id}
			job={job}
			busy={state.busy}
			canDelete={canDeleteJobs}
			onCancel={() => setConfirmation({ id: job.id, action: "cancel" })}
			onRetry={() => setConfirmation({ id: job.id, action: "retry" })}
			onResult={() => void controller.result(job.id)}
			onDelete={() => setConfirmation({ id: job.id, action: "delete" })}
		/>
	);

	return (
		<div className={styles.panel} data-global-loading="off">
			<div
				className={styles.processingTabs}
				aria-label="Áreas do processamento"
				role="tablist"
			>
				{processingViews.map((item, index) => (
					<button
						key={item.id}
						id={`processing-tab-${item.id}`}
						type="button"
						role="tab"
						aria-selected={view === item.id}
						aria-controls={`processing-view-${item.id}`}
						data-active={view === item.id ? "true" : "false"}
						tabIndex={view === item.id ? 0 : -1}
						onClick={() => setView(item.id)}
						onKeyDown={(event) => selectViewFromKeyboard(event, index)}
					>
						{item.label}
					</button>
				))}
			</div>

			<section className={styles.connection} aria-labelledby="local-computer">
				<div className={styles.connectionMain}>
					<div className={styles.computerGlyph} aria-hidden="true" />
					<div>
						<div className={styles.connectionTitle}>
							<h2 id="local-computer">Computador local</h2>
							<StatusPill tone={connected ? "success" : state.error ? "danger" : "neutral"}>
								{label}
							</StatusPill>
						</div>
						{connected ? (
							<p className={styles.connectionMeta}>
								{state.capabilities?.device.label} · API v1 · serviço {state.health?.service_version}
								{state.system?.host.os ? ` · ${state.system.host.os}` : ""}
							</p>
						) : (
							<p className={styles.connectionMeta}>
								O processamento e os áudios permanecem neste computador.
							</p>
						)}
					</div>
				</div>

				{connected ? (
					<>
						<section className={styles.metricsStrip} aria-label="Uso e fila do computador local">
							{gpu ? <GpuMetric gpu={gpu} /> : null}
							<Metric
								label="CPU"
								value={formatPercent(state.system?.cpu.utilizationPercent ?? null)}
								detail={state.system?.host.cpu ?? undefined}
							/>
							<Metric
								label="RAM"
								value={formatPercent(state.system?.memory.percent ?? null)}
								detail={
									state.system
										? `${formatBytes(state.system.memory.usedBytes)} / ${formatBytes(state.system.memory.totalBytes)}`
										: "Telemetria indisponível"
								}
							/>
							<Metric label="Processando" value={String(running.length)} />
							<Metric label="Na fila" value={String(queued.length)} />
							<Metric label="Concluídos" value={String(succeeded.length)} />
							<Metric label="Atenção" value={String(attention.length)} />
						</section>
						<div className={styles.connectionActions}>
							<Button size="sm" disabled={state.busy} onClick={() => void controller.refresh()}>
								Atualizar estado
							</Button>
							{state.health?.lifecycle === "paused" ? (
								<Button size="sm" disabled={state.busy} onClick={() => setConfirmation({ action: "resume" })}>
									Retomar fila
								</Button>
							) : state.health?.lifecycle === "ready" ? (
								<Button size="sm" disabled={state.busy} onClick={() => void controller.lifecycle("pause")}>
									Pausar novas execuções
								</Button>
							) : null}
						</div>
					</>
				) : (
					<div className={styles.pairing}>
						<strong>
							{state.connection === "connecting"
								? "Conectando ao TDA Companion…"
								: state.error === "version_incompatible"
									? "TDA Companion precisa ser atualizado."
									: state.error === "api_incompatible" || state.error === "session_incompatible"
										? "TDA Companion incompatível com esta tela."
										: "TDA Companion não está conectado."}
						</strong>
						<p className={styles.pairingHelp}>
							{state.error === "version_incompatible"
								? "Instale uma versão compatível e tente novamente."
								: state.error === "api_incompatible" || state.error === "session_incompatible"
									? "Atualize o aplicativo local antes de tentar conectar novamente."
									: "Se o aplicativo estiver aberto, esta página conecta automaticamente. Se estiver fechado, abra o Companion e tente novamente."}
						</p>
						<div className={styles.pairingControls}>
							<Button
								type="button"
								size="sm"
								disabled={state.busy}
								onClick={() => {
									window.location.href = "tda-companion://open";
									void (async () => {
										// Cold-starting WebView/Agent can take more than a single
										// fixed delay. Retry a few bounded times; stop as soon as
										// the loopback session is healthy.
										for (const delay of [1200, 2200, 3500]) {
											await new Promise((resolve) => window.setTimeout(resolve, delay));
											await controller.connect();
											if (controller.snapshot().connection === "connected") break;
										}
									})();
								}}
							>
								Abrir TDA Companion
							</Button>
							<Button
								type="button"
								size="sm"
								variant="tertiary"
								disabled={state.busy}
								onClick={() => void controller.connect()}
							>
								Tentar novamente
							</Button>
						</div>
					</div>
				)}
				{state.error ? (
					<p className={styles.connectionError} role="alert">
						{state.serverError
							? presentJobError(state.serverError)
							: presentConnectionError(state.error, state.errorDetails)}{" "}
						<small>Código: {state.serverError ?? state.error}</small>
					</p>
				) : null}
			</section>

			{connected ? (
				<>
					<section
						id="processing-view-overview"
						className={styles.viewPanel}
						role="tabpanel"
						aria-labelledby="processing-tab-overview"
						hidden={view !== "overview"}
					>
						<div className={styles.overviewTop}>
							<section aria-labelledby="processing-now">
								<div className={styles.sectionHeading}>
									<h2 id="processing-now">Processando agora</h2>
									{state.checkedAt ? (
										<span>
											Atualizado às{" "}
											<time dateTime={state.checkedAt}>
												{formatTime(state.checkedAt)}
											</time>
										</span>
									) : null}
								</div>
								{activeJob ? (
									<article className={styles.activeJob}>
										<div className={styles.activeHeader}>
											<div>
												<span className={styles.overline}>
													{activeJob.context?.sessionId
														? `Sessão ${activeJob.context.sessionId}`
														: "Trabalho local"}
												</span>
												<h3>{presentJobTitle(activeJob)}</h3>
											</div>
											<StatusPill tone="accent">Processando</StatusPill>
										</div>
										<div className={styles.activeMeta}>
											<span>
												{stageLabels[activeJob.stage] ?? activeJob.stage}
											</span>
											{trackContext?.track != null &&
											trackContext.total != null ? (
												<span>
													Arquivo {trackContext.track} de {trackContext.total}
												</span>
											) : null}
											{trackContext?.speaker ? (
												<span>Voz: {trackContext.speaker}</span>
											) : null}
											{trackContext?.window != null ? (
												<span>Janela {trackContext.window}</span>
											) : null}
											{trackContext?.segment != null ? (
												<span>Segmento {trackContext.segment}</span>
											) : null}
											{activeJob.attempt > 0 ? (
												<span>Tentativa {activeJob.attempt}</span>
											) : null}
											<span>
												Worker ativo · {formatTime(activeJob.updated_at)}
											</span>
										</div>
										{activeJob.progress && activePercent !== null ? (
											<div className={styles.activeProgress}>
												<progress
													aria-label={`Progresso do trabalho ${activeJob.id}`}
													value={activeJob.progress.completed}
													max={activeJob.progress.total}
												/>
												<strong>{activePercent}%</strong>
												<span>{progressCopy(activeJob)}</span>
											</div>
										) : (
											<p className={styles.noProgress}>
												{activeJob.progress &&
												activeJob.progress.completed > 0
													? `${progressCopy(activeJob)} concluídos · ${stageLabels[activeJob.stage] ?? activeJob.stage}.`
													: "Progresso percentual ainda não disponível. O stage e a atividade do worker continuam sendo atualizados."}
											</p>
										)}
										<section
											className={styles.pipeline}
											aria-label="Etapa atual do processamento"
										>
											<span
												data-state={pipelineState(
													activeJob.stage,
													"preparation",
												)}
											>
												Preparação
											</span>
											<span
												data-state={pipelineState(
													activeJob.stage,
													"processing",
												)}
											>
												Processamento
											</span>
											<span
												data-state={pipelineState(
													activeJob.stage,
													"consolidation",
												)}
											>
												Consolidação
											</span>
										</section>
										<div className={styles.activeActions}>
											<Button
												size="sm"
												className={styles.dangerAction}
												disabled={state.busy}
												onClick={() =>
													setConfirmation({
														id: activeJob.id,
														action: "cancel",
													})
												}
											>
												Cancelar trabalho
											</Button>
										</div>
									</article>
								) : (
									<div className={styles.emptyState}>
										<strong>Nada processando agora.</strong>
										<span>
											{queued.length
												? "Há trabalhos aguardando a próxima execução."
												: "A fila local está livre."}
										</span>
									</div>
								)}
							</section>
							<ProcessingSubmission
								className={styles.submissionCard}
								compact
							/>
						</div>
					</section>

					<section
						id="processing-view-queue"
						className={styles.viewPanel}
						role="tabpanel"
						aria-labelledby="processing-tab-queue"
						hidden={view !== "queue"}
					>
						<div className={styles.queueView}>
							<div
								className={styles.filterBar}
								role="group"
								aria-label="Filtrar trabalhos da fila"
							>
								{(
									Object.keys(queueFilterLabels) as QueueFilter[]
								).map((filter) => {
									const count =
										filter === "all"
											? state.jobs.length
											: queueGroups.find((group) => group.id === filter)?.jobs
													.length ?? 0;
									return (
										<button
											key={filter}
											type="button"
											className={styles.filterButton}
											data-active={queueFilter === filter ? "true" : "false"}
											aria-pressed={queueFilter === filter}
											onClick={() => setQueueFilter(filter)}
										>
											{queueFilterLabels[filter]}
											<span>{count}</span>
										</button>
									);
								})}
							</div>

							{visibleQueueGroups.map((group) =>
								group.jobs.length ? (
									<section key={group.id} aria-labelledby={`queue-${group.id}`}>
										<div className={styles.sectionHeading}>
											<h2 id={`queue-${group.id}`}>{group.title}</h2>
											<span>{group.jobs.length}</span>
										</div>
										<ul className={styles.compactJobs}>
											{group.jobs.map(renderRow)}
										</ul>
									</section>
								) : null,
							)}

							{visibleQueueCount === 0 ? (
								<div className={styles.emptyState}>
									<strong>
										{queueFilter === "all"
											? "A fila local está vazia."
											: `Nenhum trabalho em “${queueFilterLabels[queueFilter]}”.`}
									</strong>
									<span>
										{queueFilter === "all"
											? "Novos trabalhos enviados pela Visão geral aparecem aqui."
											: "Troque o filtro para consultar outros estados locais."}
									</span>
								</div>
							) : null}
						</div>
					</section>

					<section
						id="processing-view-results"
						className={styles.viewPanel}
						role="tabpanel"
						aria-labelledby="processing-tab-results"
						hidden={view !== "results"}
					>
						<LocalReviewWorkspace
							runs={state.localRuns}
							review={state.localReview}
							busy={state.localReviewBusy || state.busy}
							error={state.localReviewError}
							publicationEnabled={publicationEnabled}
							onOpen={(sourceId, runId) =>
								controller.openLocalReview(sourceId, runId)
							}
							onSave={(revision, status, segments) =>
								controller.saveLocalReview(revision, status, segments)
							}
							onClose={controller.closeLocalReview}
							onPublish={(review, operationId) =>
								publishApprovedLocalReview(review, operationId)
							}
						/>

						<section className={styles.syncStrip} aria-labelledby="local-sync">
							<div>
								<h2 id="local-sync">Sincronização com o Edit</h2>
								<p>
									{publicationEnabled ? (
										<>
											<strong>Publicação revisionada disponível.</strong>{" "}
											Somente um draft salvo como Aprovado localmente e uma
											confirmação explícita podem publicar.
										</>
									) : (
										<>
											<strong>Sincronização não configurada.</strong>{" "}
											Concluir localmente não significa enviar ou publicar.
										</>
									)}
								</p>
							</div>
							{state.result ? (
								<div className={styles.resultSummary} role="status">
									<span>Resultado local</span>
									<strong>{state.result.sessionId}</strong>
									<small>
										{state.result.runId
											? `Run ${state.result.runId} · SHA ${state.result.transcriptSha256?.slice(0, 12) ?? "—"}…`
											: `Pacote ${state.result.publicationId.slice(0, 12)}…`}
									</small>
								</div>
							) : null}
						</section>
					</section>

					<section
						id="processing-view-diagnostics"
						className={styles.viewPanel}
						role="tabpanel"
						aria-labelledby="processing-tab-diagnostics"
						hidden={view !== "diagnostics"}
					>
						<aside
							className={`${styles.inspector} ${styles.inspectorFull}`}
							aria-labelledby="processing-details"
						>
							<div className={styles.inspectorHeader}>
								<div>
									<span className={styles.overline}>Trabalho observado</span>
									<h2 id="processing-details">
										Detalhes do processamento
									</h2>
								</div>
							</div>
							<div className={styles.diagnosticGrid}>
								<section>
									<span className={styles.overline}>Companion</span>
									<dl className={styles.jobDetails}>
										<div>
											<dt>Conexão</dt>
											<dd>{label}</dd>
										</div>
										<div>
											<dt>API</dt>
											<dd>{state.health?.api_version ? `v${state.health.api_version}` : "—"}</dd>
										</div>
										<div>
											<dt>Serviço</dt>
											<dd>{state.health?.service_version ?? "—"}</dd>
										</div>
										<div>
											<dt>Lifecycle</dt>
											<dd>{state.health?.lifecycle ?? "—"}</dd>
										</div>
										<div>
											<dt>Dispositivo</dt>
											<dd>{state.capabilities?.device.label ?? "—"}</dd>
										</div>
										<div>
											<dt>Última leitura</dt>
											<dd>{state.checkedAt ? formatTime(state.checkedAt) : "—"}</dd>
										</div>
									</dl>
									<details className={styles.technicalDetails}>
										<summary>Capabilities anunciadas</summary>
										<p className={styles.mono}>
											{state.capabilities?.capabilities.length
												? state.capabilities.capabilities.join(" · ")
												: "Nenhuma capability disponível."}
										</p>
									</details>
								</section>
								<section>
									<span className={styles.overline}>Sistema atual</span>
									<dl className={styles.jobDetails}>
										<div>
											<dt>SO</dt>
											<dd>{state.system?.host.os ?? "—"}</dd>
										</div>
										<div>
											<dt>CPU</dt>
											<dd>{state.system?.host.cpu ?? "—"}</dd>
										</div>
										<div>
											<dt>Uso CPU</dt>
											<dd>{formatPercent(state.system?.cpu.utilizationPercent ?? null)}</dd>
										</div>
										<div>
											<dt>RAM</dt>
											<dd>
												{state.system
													? `${formatBytes(state.system.memory.usedBytes)} / ${formatBytes(state.system.memory.totalBytes)} · ${formatPercent(state.system.memory.percent)}`
													: "—"}
											</dd>
										</div>
										<div className={styles.diagnosticWide}>
											<dt>GPU(s)</dt>
											<dd>
												{state.system?.gpus.length
													? state.system.gpus
															.map(
																(item) =>
																	`#${item.index} ${item.name} · ${formatPercent(item.utilizationPercent)} · ${formatBytes(item.memoryUsedBytes)} / ${formatBytes(item.memoryTotalBytes)}`,
															)
															.join(" | ")
													: "—"}
											</dd>
										</div>
									</dl>
								</section>
							</div>

							{observedJob ? (
								<dl className={styles.jobDetails}>
									<div>
										<dt>Trabalho</dt>
										<dd>{presentJobTitle(observedJob)}</dd>
									</div>
									<div>
										<dt>Estado</dt>
										<dd>{jobLabels[observedJob.status]}</dd>
									</div>
									<div>
										<dt>Etapa</dt>
										<dd>
											{stageLabels[observedJob.stage] ?? observedJob.stage}
										</dd>
									</div>
									{observedJob.context?.sessionId ? (
										<div>
											<dt>Sessão</dt>
											<dd>{observedJob.context.sessionId}</dd>
										</div>
									) : null}
									<div>
										<dt>Tentativa</dt>
										<dd>{observedJob.attempt || "—"}</dd>
									</div>
									{observedJob.context?.profileId ? (
										<div>
											<dt>Perfil</dt>
											<dd>{observedJob.context.profileId}</dd>
										</div>
									) : null}
									{observedJob.context?.sourceId ? (
										<div>
											<dt>Fonte</dt>
											<dd className={styles.mono}>{observedJob.context.sourceId}</dd>
										</div>
									) : null}
									<div>
										<dt>Resultado</dt>
										<dd>{observedJob.result_available ? "Disponível" : "Não disponível"}</dd>
									</div>
									{observedJob.error ? (
										<div className={styles.diagnosticWide}>
											<dt>Erro</dt>
											<dd>
												{presentJobError(observedJob.error.code)} · código{" "}
												<span className={styles.mono}>{observedJob.error.code}</span>
												{observedJob.error.recoverable ? " · recuperável" : ""}
											</dd>
										</div>
									) : null}
									<div>
										<dt>ID local</dt>
										<dd className={styles.mono}>{observedJob.id}</dd>
									</div>
								</dl>
							) : (
								<p className={styles.inspectorEmpty}>
									Nenhum trabalho observado.
								</p>
							)}

							<div className={styles.logHeader}>
								<h3>Log em tempo real</h3>
								<span>
									{state.events.length
										? `${filteredEvents.length} de ${state.events.length} eventos`
										: "sem eventos"}
								</span>
							</div>
							<div
								className={styles.filterBar}
								role="group"
								aria-label="Filtrar eventos do processamento"
							>
								{(
									Object.keys(eventFilterLabels) as EventFilter[]
								).map((filter) => (
									<button
										key={filter}
										type="button"
										className={styles.filterButton}
										data-active={eventFilter === filter ? "true" : "false"}
										aria-pressed={eventFilter === filter}
										onClick={() => setEventFilter(filter)}
									>
										{eventFilterLabels[filter]}
									</button>
								))}
							</div>
							<div
								className={`${styles.log} ${state.events.length ? "" : styles.logEmpty}`}
								role="log"
								aria-label="Eventos do processamento local"
								aria-relevant="additions text"
							>
								{filteredEvents.length ? (
									filteredEvents.slice(0, 100).map((event) => {
										const presented = presentJobEvent(event);
										return (
											<div
												className={styles.logEntry}
												key={event.seq}
												data-level={event.level}
											>
												<time dateTime={event.at}>
													{formatTime(event.at)}
												</time>
												<div>
													<span>{presented.title}</span>
													{presented.detail ? (
														<small>{presented.detail}</small>
													) : null}
													<small className={styles.mono}>{event.code}</small>
												</div>
											</div>
										);
									})
								) : (
									<p>
										{state.events.length
											? "Nenhum evento corresponde a este filtro."
											: "Nenhum evento detalhado recebido para este trabalho."}
									</p>
								)}
							</div>

							{state.capabilities?.capabilities.includes(
								"synthetic.fixture",
							) ? (
								<div className={styles.integrationTool}>
									<div>
										<strong>Ensaio sintético</strong>
										<span>
											Diagnóstico pequeno, sem áudio e sem publicação.
										</span>
									</div>
									<Button
										size="sm"
										disabled={
											state.busy ||
											state.health?.lifecycle !== "ready"
										}
										onClick={() => void controller.synthetic()}
									>
										Executar ensaio sintético
									</Button>
								</div>
							) : null}

							{state.uncertainSubmission ? (
								<p className={styles.connectionError} role="alert">
									A resposta desta tentativa não chegou. Reconecte e
									consulte a fila antes de iniciar outra tentativa; a chave
									desta aba será reutilizada.
								</p>
							) : null}
						</aside>
					</section>
				</>
			) : (
				<section className={styles.disconnectedQueue} aria-labelledby="local-queue">
					<h2 id="local-queue">Fila local</h2>
					<p>
						Conecte o serviço para consultar a fila persistida. A ausência de
						conexão não significa que o processamento parou.
					</p>
				</section>
			)}


			<dialog
				ref={dialog}
				className={styles.dialog}
				onCancel={(event) => {
					event.preventDefault();
					setConfirmation(null);
				}}
			>
				{confirmation ? (
					<>
						<h2>
							{confirmation.action === "resume"
								? "Retomar a fila local?"
								: confirmation.action === "cancel"
									? "Cancelar este trabalho?"
									: confirmation.action === "delete"
										? "Excluir este trabalho?"
										: "Repetir este trabalho?"}
						</h2>
						<p>
							{confirmation.action === "resume"
								? "O serviço poderá iniciar os trabalhos que aguardam na fila."
								: confirmation.action === "cancel"
									? `O cancelamento será enviado ao trabalho ${confirmation.id}.`
									: confirmation.action === "delete"
										? `O trabalho ${confirmation.id}, seus eventos e eventual resultado local serão excluídos do histórico. Modelos, sessão Craig e checkpoints não serão apagados.`
										: `Uma nova tentativa será criada para ${confirmation.id}; repetir não promete retomar do ponto exato.`}
						</p>
						<div className={styles.dialogActions}>
							<Button onClick={() => setConfirmation(null)}>Voltar</Button>
							<Button variant="primary" onClick={() => void confirm()}>
								{confirmation.action === "delete" ? "Excluir" : "Confirmar"}
							</Button>
						</div>
					</>
				) : null}
			</dialog>
		</div>
	);
}
