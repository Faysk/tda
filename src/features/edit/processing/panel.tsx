"use client";

import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { AnimatedProgress } from "@/components/ui/animated-progress";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status";
import { CampaignPicker } from "@/features/campaigns/campaign-picker";
import { ProcessingBenchmark } from "./benchmark";
import { CompanionDownload } from "./companion-download";
import { ActivityPackAdmin } from "./activity-pack-admin";
import { enabledCustomActivityBarks, subscribeActivityPacks } from "./activity-pack-store";
import { ProcessingCommandBar } from "./command-bar";
import { ProcessingLiveLog } from "./live-log";
import {
	activityContext,
	activityEventCanBeHumorous,
	CORE_ACTIVITY_BARKS,
	selectActivityBark,
	type ActivityBark,
} from "./activity-barks";
import {
	supportsCompletedRunDelete,
	supportsTerminalJobDelete,
} from "./compatibility";
import { ProcessingController } from "./controller";
import { JobDiagnosticsInspector } from "./job-diagnostics-inspector";
import { LocalReviewWorkspace } from "./local-review";
import { serializeLocalRunKey } from "./local-run-key";
import { SessionAssemblyResults } from "./session-assembly-results";
import { publishApprovedLocalReview } from "./publication-client";
import type { QueueFilter } from "./queue-model";
import { terminalRecoveryActions } from "./terminal-recovery";
import { ProcessingQueueView } from "./queue-view";
import { ProcessingSubmission } from "./submission";
import {
	PROCESSING_REFRESH_POLICY,
	processingPollMs,
} from "./refresh-policy";
import {
	jobLabels,
	presentConnectionError,
	presentJobError,
	presentJobEvent,
	presentJobTitle,
	stageLabels,
} from "./presentation";
import {
	estimateProfileProcessing,
	estimateRemainingProcessing,
	formatEstimateProvenance,
	formatEstimateRange,
} from "./processing-estimator";
import type { JobEvent, LocalJob, SystemSnapshot } from "./protocol";
import {
	processingCampaignHref,
	type ProcessingCampaignOption,
} from "./campaign-context";
import styles from "./processing.module.css";

type Confirmation =
	| { id: string; action: "cancel" | "retry" | "delete" }
	| { action: "resume" };

type ProcessingView = "overview" | "queue" | "results" | "benchmark" | "diagnostics";

const processingViews: readonly { id: ProcessingView; label: string }[] = [
	{ id: "overview", label: "Visão geral" },
	{ id: "queue", label: "Fila" },
	{ id: "results", label: "Resultados" },
	{ id: "benchmark", label: "Benchmark" },
	{ id: "diagnostics", label: "Diagnóstico" },
];

function progressPercent(job: LocalJob): number | null {
	if (!job.progress) return null;
	if (
		job.progress.total <= 0 ||
		job.progress.completed < 0 ||
		job.progress.completed > job.progress.total
	)
		return null;
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

function formatTime(value: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "—";
	return date.toLocaleTimeString("pt-BR", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatDuration(seconds: number | null): string {
	if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
	const rounded = Math.round(seconds);
	const hours = Math.floor(rounded / 3600);
	const minutes = Math.floor((rounded % 3600) / 60);
	const remainder = rounded % 60;
	return hours
		? `${hours}h ${String(minutes).padStart(2, "0")}m`
		: minutes
			? `${minutes}m ${String(remainder).padStart(2, "0")}s`
			: `${remainder}s`;
}

function liveElapsed(
	startedAt: string | null,
	fallback: number | null,
	now: number,
): number | null {
	if (!startedAt) return fallback;
	const started = Date.parse(startedAt);
	if (!Number.isFinite(started) || started > now + 5_000) return fallback;
	return Math.max(0, (now - started) / 1000);
}

function formatRealtime(rtf: number | null): string {
	if (rtf === null || !Number.isFinite(rtf) || rtf <= 0) return "—";
	return `${(1 / rtf).toFixed(2)}×`;
}

function progressUnitLabel(job: LocalJob): string {
	if (!job.progress) return "unidades";
	return job.progress.unit === "items" ? "itens" : job.progress.unit;
}

function progressCopy(job: LocalJob): string {
	if (!job.progress) return "Sem medida de progresso nesta etapa.";
	return `${job.progress.completed} de ${job.progress.total} ${progressUnitLabel(job)}`;
}

function OverviewMetric({
	label,
	value,
}: Readonly<{ label: string; value: number | string }>) {
	return (
		<div className={styles.metric}>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

const consolidationStages = new Set([
	"energy_analysis",
	"cross_track_dedup",
	"merge_timeline",
	"turn_building",
	"result_prepare",
	"consolidating",
	"complete",
]);

const pipelineSteps = [
	{
		id: "source",
		label: "Fonte",
		stages: new Set(["queued", "preparing", "source_validation"]),
	},
	{
		id: "model",
		label: "Modelo",
		stages: new Set([
			"runtime_validation",
			"runtime_bootstrap",
			"runtime_fingerprint",
			"checkpoint_scan",
			"checking_model",
			"downloading_model",
			"model_prepare",
			"model_load",
			"loading_cpu",
			"loading_cuda",
			"loading_cuda_fallback",
		]),
	},
	{
		id: "transcription",
		label: "Transcrição",
		stages: new Set([
			"fixture",
			"transcribing",
			"transcription",
			"diarization",
			"noise_cleanup",
			"resuming",
		]),
	},
	{ id: "alignment", label: "Alignment", stages: new Set(["alignment"]) },
	{
		id: "consolidation",
		label: "Consolidação",
		stages: consolidationStages,
	},
] as const;

function pipelineState(
	stage: string,
	stepIndex: number,
): "current" | "done" | "pending" | "unknown" {
	const currentIndex = pipelineSteps.findIndex((step) => step.stages.has(stage));
	if (currentIndex < 0) return "unknown";
	if (stepIndex < currentIndex) return "done";
	if (stepIndex === currentIndex) return "current";
	return "pending";
}

function latestActivity(
	events: readonly JobEvent[],
	job: LocalJob,
	system: SystemSnapshot | null,
	catalog: readonly ActivityBark[],
) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (!event) continue;
		// Current cockpit activity must never borrow routine work from an older
		// retry attempt. Legacy/job-level warnings can still surface factually,
		// but attempt-scoped info requires authoritative provenance.
		if (
			event.attempt !== job.attempt &&
			!(event.attempt === null && (event.level === "warning" || event.level === "error"))
		)
			continue;
		if (event.level === "warning" || event.level === "error") {
			const factual = presentJobEvent(event);
			return {
				title: factual.title,
				detail: factual.detail ?? null,
				at: event.at,
			};
		}
		const speaker =
			typeof event.data.speaker === "string" ? event.data.speaker : null;
		if (
			event.code === "QWEN_WINDOW_TRANSCRIBED" ||
			event.code === "WHISPER_SEGMENT_TRANSCRIBED"
		) {
			const factual = presentJobEvent(event);
			const bark = activityEventCanBeHumorous(event)
				? selectActivityBark(activityContext(event, job, system), { level: "tda", catalog })
				: null;
			return {
				title: bark?.text ?? factual.title,
				detail: factual.detail ?? null,
				at: event.at,
			};
		}
		if (event.code === "TRACK_STARTED" || event.code === "TRACK_COMPLETED") {
			return {
				title:
					event.code === "TRACK_STARTED"
						? speaker
							? `Iniciando ${speaker}`
							: "Iniciando próxima track"
						: speaker
							? `${speaker} concluído`
							: "Track concluída",
				detail: null,
				at: event.at,
			};
		}
	}
	return null;
}

function eventTrackContext(
	events: readonly JobEvent[],
	activeAttempt: number,
) {
	for (const event of events) {
		// Current cockpit context is attempt-scoped. A retry starts with no
		// track/window context until that attempt emits its own event; never
		// borrow stale or legacy routine facts into the active cockpit.
		if (event.attempt !== activeAttempt) continue;
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

export function ProcessingPanel({
	campaignId,
	campaignName,
	campaignOptions,
	publicationEnabled = false,
	activityBarksManage = false,
	activityPackScope = null,
	canManageCampaigns = false,
}: Readonly<{
	campaignId: string;
	campaignName: string;
	campaignOptions: readonly ProcessingCampaignOption[];
	publicationEnabled?: boolean;
	activityBarksManage?: boolean;
	activityPackScope?: string | null;
	canManageCampaigns?: boolean;
}>) {
	const [controller] = useState(() => new ProcessingController());
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.snapshot,
		controller.serverSnapshot,
	);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [view, setView] = useState<ProcessingView>("overview");
	const [queueFilter, setQueueFilter] = useState<QueueFilter>("active");
	const [queueSearchReset, setQueueSearchReset] = useState(0);
	const [clockNow, setClockNow] = useState(() => Date.now());
	const [customActivityBarks, setCustomActivityBarks] = useState<readonly ActivityBark[]>([]);
	const [resultFocus, setResultFocus] = useState<Readonly<{ key: string; requestId: number }> | null>(null);
	const [assemblyReviewFocus, setAssemblyReviewFocus] = useState<
		Readonly<{
			sessionId: string;
			assembly: import("./session-composer-protocol").SessionAssembly;
			requestId: number;
		}> | null
	>(null);
	const [resultOpenError, setResultOpenError] = useState<string | null>(null);
	const [diagnosticInspectorJobId, setDiagnosticInspectorJobId] = useState<string | null>(null);
	const [submissionDraftActive, setSubmissionDraftActive] = useState(false);
	const [campaignSelection, setCampaignSelection] = useState(campaignId);
	const [campaignSwitchTarget, setCampaignSwitchTarget] = useState<string | null>(null);
	const [campaignNavigationPending, setCampaignNavigationPending] = useState(false);
	const diagnosticOpener = useRef<HTMLElement | null>(null);
	const dialog = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		void controller.connect();
		return () => controller.disconnect();
	}, [controller]);
	useEffect(() => {
		const reload = () => setCustomActivityBarks(enabledCustomActivityBarks(activityPackScope));
		reload();
		return subscribeActivityPacks(activityPackScope, reload);
	}, [activityPackScope]);
	useEffect(() => {
		if (state.connection !== "connected" || state.mutation) return;
		const hasActiveWork = state.jobs.some((job) => job.status === "running");
		const delay = processingPollMs(hasActiveWork);
		const timer = window.setTimeout(() => {
			if (document.visibilityState === "visible")
				void controller.refresh("background");
		}, delay);
		const visible = () => {
			if (document.visibilityState === "visible")
				void controller.refresh("background");
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", visible);
		};
	}, [controller, state.connection, state.jobs, state.mutation]);
	useEffect(() => {
		if (confirmation) dialog.current?.showModal();
		else dialog.current?.close();
	}, [confirmation]);

	const connected = state.connection === "connected";
	const campaignJobs = state.jobs.filter(
		(job) =>
			job.kind === "synthetic.fixture" || job.context?.campaignId === campaignId,
	);
	const diagnosticJobs = state.jobs.filter(
		(job) =>
			job.kind === "benchmark.craig" || job.context?.campaignId === campaignId,
	);
	const campaignRuns = state.localRuns.filter(
		(run) => run.publicationTarget?.campaignSlug === campaignId,
	);
	const unboundRuns = state.localRuns.filter(
		(run) => run.publicationTarget === null,
	);
	const resultJob =
		state.result === null
			? null
			: (state.jobs.find((job) => job.id === state.result?.jobId) ?? null);
	const resultVisibleInCampaign =
		state.result !== null &&
		(state.result.campaignId === campaignId ||
			resultJob?.kind === "synthetic.fixture");
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
	const running = campaignJobs.filter((job) => job.status === "running");
	const queued = campaignJobs
		.filter((job) => job.status === "queued")
		.sort(
			(left, right) =>
				new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime(),
		);
	const attention = campaignJobs.filter((job) =>
		["failed", "interrupted"].includes(job.status),
	);
	const activeJob = running[0] ?? null;
	const activePercent = activeJob ? progressPercent(activeJob) : null;
	const activeProfile =
		activeJob?.context?.profileId
			? (state.capabilities?.transcription.catalog.find(
					(item) => item.id === activeJob.context?.profileId,
				) ?? null)
			: null;
	const activeEstimate = estimateProfileProcessing({
		audioWorkSeconds: activeJob?.context?.audioWorkSeconds ?? null,
		profile: activeProfile,
		runs: state.localRuns,
		benchmarks: state.benchmarkResults,
		system: state.system,
	});
	const activeRemaining =
		activeJob?.progress?.unit === "tracks" &&
		activeJob.context?.trackDurationsSeconds
			? estimateRemainingProcessing(
					activeEstimate,
					activeJob.context.trackDurationsSeconds,
					activeJob.progress.completed,
				)
			: null;
	const activeTrackTiming =
		activeJob?.timing.tracks.find((item) => item.finishedAt === null) ?? null;
	const completedTrackTimings =
		activeJob?.timing.tracks.filter(
			(item) => item.finishedAt !== null && item.processingSeconds !== null,
		) ?? [];
	const attemptElapsed = activeJob
		? liveElapsed(
				activeJob.timing.attemptStartedAt,
				activeJob.timing.attemptElapsedSeconds,
				clockNow,
			)
		: null;
	const stageElapsed = activeJob
		? liveElapsed(
				activeJob.timing.stageStartedAt,
				activeJob.timing.stageElapsedSeconds,
				clockNow,
			)
		: null;
	const trackElapsed = activeTrackTiming
		? liveElapsed(
				activeTrackTiming.startedAt,
				activeTrackTiming.processingSeconds,
				clockNow,
			)
		: null;
	const latestCompletedRun = activeJob
		? null
		: (campaignRuns[0] ?? null);
	const observedJobExact =
		diagnosticJobs.find((job) => job.id === state.observedJobId) ?? null;
	const observedJob = observedJobExact ?? activeJob;
	const diagnosticInspectorJob =
		diagnosticInspectorJobId === null
			? null
			: (diagnosticJobs.find((job) => job.id === diagnosticInspectorJobId) ?? null);
	const observedJobLive =
		observedJob !== null &&
		["queued", "running"].includes(observedJob.status);
	const trackContext =
		activeJob && state.observedJobId === activeJob.id
			? eventTrackContext(state.events, activeJob.attempt)
			: null;
	const activityCatalog = customActivityBarks.length
		? [...CORE_ACTIVITY_BARKS, ...customActivityBarks]
		: CORE_ACTIVITY_BARKS;
	const activeActivity =
		activeJob && state.observedJobId === activeJob.id
			? latestActivity(state.events, activeJob, state.system, activityCatalog)
			: null;
	const canDeleteJobs = supportsTerminalJobDelete(state.health?.service_version);
	const canDeleteRuns = supportsCompletedRunDelete(state.health?.service_version);
	const activeJobClockKey = activeJob ? `${activeJob.id}:${activeJob.attempt}` : null;

	useEffect(() => {
		if (activeJobClockKey === null) return;
		const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [activeJobClockKey]);

	async function confirm() {
		const choice = confirmation;
		setConfirmation(null);
		if (!choice) return;
		if (choice.action === "resume") await controller.lifecycle("resume");
		else if (choice.action === "delete") {
			await controller.deleteJob(choice.id);
			if (diagnosticInspectorJobId === choice.id) closeJobDiagnostics(false);
		} else {
			await controller.jobAction(choice.id, choice.action);
			if (choice.action === "retry") {
				const retried = controller
					.snapshot()
					.jobs.find((job) => job.id === choice.id);
				if (retried && ["queued", "running"].includes(retried.status))
					setQueueFilter("active");
			}
		}
	}

	function activateView(next: ProcessingView) {
		const leavingDiagnostics = view === "diagnostics" && next !== "diagnostics";
		setResultOpenError(null);
		setView(next);
		if (leavingDiagnostics) void controller.observeJob(null);
		if (next === "results") void controller.refresh("results");
	}

	function openSessionAssemblyReview(
		assembly: import("./session-composer-protocol").SessionAssembly,
	) {
		setAssemblyReviewFocus((current) => ({
			sessionId: assembly.sessionId,
			assembly,
			requestId: (current?.requestId ?? 0) + 1,
		}));
		activateView("results");
	}

	async function openJobResult(job: LocalJob): Promise<string | null> {
		setResultOpenError(null);
		const result = await controller.result(job.id);
		if (!result?.runId) {
			const message =
				"Não foi possível abrir este resultado local. O trabalho foi preservado; tente novamente ou consulte o diagnóstico.";
			setResultOpenError(message);
			return message;
		}

		if (job.kind !== "synthetic.fixture" && result.campaignId !== campaignId) {
			const message =
				"O Companion retornou um resultado de outra campanha. O resultado foi preservado, mas esta tela não vai abri-lo neste contexto.";
			setResultOpenError(message);
			return message;
		}
		const found = controller
			.snapshot()
			.localRuns.some(
				(run) =>
					(run.publicationTarget === null ||
						run.publicationTarget.campaignSlug === campaignId) &&
					run.sourceId === result.sourceId &&
					run.runId === result.runId &&
					(!result.transcriptSha256 ||
						run.transcriptSha256 === result.transcriptSha256),
			);
		if (!found) {
			const message =
				"O resultado foi validado, mas o run correspondente não pôde ser confirmado na biblioteca local. Atualize os resultados ou consulte o diagnóstico.";
			setResultOpenError(message);
			return message;
		}

		const key = serializeLocalRunKey({
			sourceId: result.sourceId,
			runId: result.runId,
		});
		setResultFocus((current) => ({
			key,
			requestId: (current?.requestId ?? 0) + 1,
		}));
		// result() resolves the authoritative catalog entry before returning.
		// Avoid a generic first-page refresh that could immediately hide it.
		setView("results");
		return null;
	}

	function openJobDiagnostics(job: LocalJob) {
		const active =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const queueRow = [...document.querySelectorAll<HTMLElement>("[data-job-id]")].find(
			(element) => element.dataset.jobId === job.id,
		);
		const stableQueueTrigger = queueRow?.querySelector<HTMLElement>(
			"button[aria-label^='Mais ações para']",
		);
		diagnosticOpener.current = view === "queue" ? (stableQueueTrigger ?? active) : active;
		setDiagnosticInspectorJobId(job.id);
		void controller.observeJob(job.id);
	}

	function closeJobDiagnostics(restoreFocus = true) {
		setDiagnosticInspectorJobId(null);
		void controller.observeJob(null);
		const opener = diagnosticOpener.current;
		diagnosticOpener.current = null;
		if (restoreFocus && opener) requestAnimationFrame(() => opener.focus());
	}

	function startNewWork(job: LocalJob) {
		closeJobDiagnostics(false);
		const destination = job.kind === "benchmark.craig" ? "benchmark" : "overview";
		activateView(destination);
		requestAnimationFrame(() => {
			document
				.querySelector(
					destination === "benchmark"
						? "[data-benchmark-source-picker='true']"
						: "[data-craig-composer='true']",
				)
				?.scrollIntoView({ block: "nearest" });
		});
	}

	function openAttentionQueue() {
		if (view === "diagnostics") void controller.observeJob(null);
		setResultOpenError(null);
		setQueueFilter("attention");
		setQueueSearchReset((value) => value + 1);
		setView("queue");
		requestAnimationFrame(() => {
			document.querySelector("[data-processing-queue='true']")?.scrollIntoView({
				block: "nearest",
			});
		});
	}

	function switchCampaign(nextCampaignId: string) {
		if (nextCampaignId === campaignId) {
			setCampaignSelection(campaignId);
			return;
		}
		if (!campaignOptions.some((campaign) => campaign.technicalSlug === nextCampaignId)) {
			setCampaignSelection(campaignId);
			return;
		}
		const authoritativeWork = campaignJobs.some((job) =>
			["queued", "running"].includes(job.status),
		);
		const needsConfirmation =
			submissionDraftActive ||
			authoritativeWork ||
			Boolean(state.mutation) ||
			Boolean(state.uncertainSubmission);
		if (needsConfirmation) {
			setCampaignSwitchTarget(nextCampaignId);
			return;
		}
		setCampaignNavigationPending(true);
		requestAnimationFrame(() => {
			window.location.assign(processingCampaignHref(nextCampaignId));
		});
	}

	function cancelCampaignSwitch() {
		setCampaignSwitchTarget(null);
		setCampaignSelection(campaignId);
	}

	function confirmCampaignSwitch() {
		const target = campaignSwitchTarget;
		if (!target) return;
		setCampaignSwitchTarget(null);
		setCampaignNavigationPending(true);
		requestAnimationFrame(() => {
			window.location.assign(processingCampaignHref(target));
		});
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
		activateView(next.id);
		requestAnimationFrame(() => {
			document.getElementById(`processing-tab-${next.id}`)?.focus();
		});
	}

	return (
		<div className={styles.panel} data-global-loading="off">
			<section className={styles.campaignContext} aria-label="Campanha do processamento">
				<div>
					<span>Contexto atual</span>
					<strong>{campaignName}</strong>
				</div>
				<CampaignPicker
					value={campaignSelection}
					options={campaignOptions.map((campaign) => ({
						value: campaign.technicalSlug,
						label: campaign.name,
						lifecycle: "active" as const,
					}))}
					onChange={(next) => {
						setCampaignSelection(next);
						switchCampaign(next);
					}}
					ariaLabel="Trocar campanha do processamento"
					pending={campaignNavigationPending}
					pendingLabel="Trocando campanha…"
					status={
						campaignNavigationPending
							? undefined
							: "Campanha aplicada ao workspace atual."
					}
					canManage={
						canManageCampaigns &&
						!submissionDraftActive &&
						!state.mutation &&
						!state.uncertainSubmission
					}
					manageHref={`/edit/campanhas?next=${encodeURIComponent(
						processingCampaignHref(campaignId),
					)}`}
				/>
			</section>
			<div className={styles.processingHeader}>
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
							onClick={() => activateView(item.id)}
							onKeyDown={(event) => selectViewFromKeyboard(event, index)}
						>
							{item.label}
						</button>
					))}
				</div>
				<CompanionDownload className={styles.processingDownloadAction} />
			</div>

			<ProcessingCommandBar
				connection={state.connection}
				connected={connected}
				connectionLabel={label}
				health={state.health}
				system={state.system}
				executionDevice={running.length === 1 ? running[0].executionDevice : null}
				refreshError={state.refreshError ?? state.telemetryRefreshError}
				checkedAt={state.telemetryCheckedAt ?? state.checkedAt}
				runningCount={running.length}
				queuedCount={queued.length}
				attentionCount={attention.length}
				refreshing={state.refreshing}
				expectedSampleMs={processingPollMs(running.length > 0)}
				pendingLifecycle={
					state.mutation?.kind === "pause" || state.mutation?.kind === "resume"
						? state.mutation.kind
						: null
				}
				onRefresh={() => void controller.refresh("manual")}
				onToggleLifecycle={() => {
					if (state.health?.lifecycle === "paused")
						setConfirmation({ action: "resume" });
					else if (state.health?.lifecycle === "ready")
						void controller.lifecycle("pause");
				}}
				onAttention={openAttentionQueue}
				onDiagnostics={() => activateView("diagnostics")}
			/>

			{!connected ? (
				<section className={styles.connection} aria-label="Conexão com o TDA Companion">
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
								disabled={state.connection === "connecting"}
								onClick={() => {
									window.location.href = "tda-companion://open";
									void (async () => {
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
								disabled={state.connection === "connecting"}
								onClick={() => void controller.connect()}
							>
								Tentar novamente
							</Button>
						</div>
					</div>
				</section>
			) : null}

			{resultOpenError ? (
				<p className={styles.connectionError} role="alert">
					{resultOpenError}
				</p>
			) : null}

			{state.error ? (
				<p className={styles.connectionError} role="alert">
					{state.serverError
						? presentJobError(state.serverError)
						: presentConnectionError(state.error, state.errorDetails)}{" "}
					<small>Código: {state.serverError ?? state.error}</small>
				</p>
			) : null}

			{connected ? (
				<>
					<section
						id="processing-view-overview"
						className={styles.viewPanel}
						role="tabpanel"
						aria-labelledby="processing-tab-overview"
						hidden={view !== "overview"}
					>
						<div
							className={styles.overviewTop}
							data-processing-overview-top="true"
							data-mode={activeJob ? "running" : queued.length ? "queued" : "idle"}
						>
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
												<span>
													Tentativa {activeJob.attempt} ·{" "}
													{formatDuration(attemptElapsed)}
												</span>
											) : null}
											{activeTrackTiming ? (
												<span>
													Track {activeTrackTiming.track}
													{activeTrackTiming.totalTracks
														? `/${activeTrackTiming.totalTracks}`
														: ""}{" "}
													· {formatDuration(trackElapsed)}
												</span>
											) : null}
											{activeJob.context?.profileId ? (
												<span>Perfil {activeJob.context.profileId}</span>
											) : null}
											<span>
												Etapa há {formatDuration(stageElapsed)} · atualizado às{" "}
												<time dateTime={activeJob.updated_at}>
													{formatTime(activeJob.updated_at)}
												</time>
											</span>
										</div>
										{activeEstimate.available ? (
											<div className={styles.estimateHint}>
												<strong>
													{activeRemaining
														? `Restante calibrado · ${formatEstimateRange(
																activeRemaining.lowerSeconds,
																activeRemaining.upperSeconds,
															)}`
														: `Processamento calibrado · ${formatEstimateRange(
																activeEstimate.lowerSeconds,
																activeEstimate.upperSeconds,
															)}`}
												</strong>
												<span>
													Confiança{" "}
													{{
														high: "alta",
														medium: "média",
														low: "baixa",
													}[activeEstimate.confidence]}{" "}
													· {formatEstimateProvenance(activeEstimate)}
												</span>
											</div>
										) : null}
										{activeJob.progress && activePercent !== null ? (
											<div className={styles.activeProgress}>
												<AnimatedProgress
													key={`${activeJob.id}:${activeJob.attempt}:${activeJob.stage}`}
													ariaLabel={`Progresso por ${progressUnitLabel(activeJob)} do trabalho ${activeJob.id}: ${progressCopy(activeJob)}`}
													value={activeJob.progress.completed}
													max={activeJob.progress.total}
													expectedSampleMs={processingPollMs(true)}
													valueText={progressCopy(activeJob)}
												/>
												<strong>Progresso por {progressUnitLabel(activeJob)} · {activePercent}%</strong>
												<span>{progressCopy(activeJob)}</span>
											</div>
										) : (
											activeJob.progress ? (
												<p className={styles.noProgress}>
													{progressCopy(activeJob)} ·{" "}
													{stageLabels[activeJob.stage] ?? activeJob.stage}.
												</p>
											) : null
										)}
						{activeTrackTiming || completedTrackTimings.length ? (
							<div className={styles.trackTimingSummary}>
								{activeTrackTiming ? (
									<span>
										Track {activeTrackTiming.track}
										{activeTrackTiming.speaker
											? ` · ${activeTrackTiming.speaker}`
											: ""}{" "}
										· ativa há {formatDuration(trackElapsed)}
									</span>
								) : null}
								{completedTrackTimings.slice(-3).map((item) => (
									<span key={item.track}>
										Track {item.track}
										{item.speaker ? ` · ${item.speaker}` : ""} ·{" "}
										{formatDuration(item.processingSeconds)}
									</span>
								))}
							</div>
						) : null}
						{activeActivity ? (
							<div className={styles.activeActivity} aria-live="polite">
								<strong>{activeActivity.title}</strong>
								<span>
									{activeActivity.detail ? `${activeActivity.detail} · ` : ""}
									última atividade às {formatTime(activeActivity.at)}
								</span>
							</div>
						) : null}
						<section
							className={styles.pipeline}
							aria-label="Etapa atual do processamento"
						>
							{pipelineSteps.map((step, index) => (
								<span key={step.id} data-state={pipelineState(activeJob.stage, index)}>
									{step.label}
									{pipelineState(activeJob.stage, index) === "current" &&
									stageElapsed !== null
										? ` · ${formatDuration(stageElapsed)}`
										: ""}
								</span>
							))}
						</section>
										<div className={styles.activeActions}>
											<Button
												size="sm"
												variant="tertiary"
												onClick={() => openJobDiagnostics(activeJob)}
											>
												Abrir diagnóstico
											</Button>
											<Button
												size="sm"
												className={styles.dangerAction}
												disabled={
													state.mutation?.kind === "cancel" &&
													state.mutation.targetId === activeJob.id
												}
												onClick={() =>
													setConfirmation({
														id: activeJob.id,
														action: "cancel",
													})
												}
											>
												{state.mutation?.kind === "cancel" &&
												state.mutation.targetId === activeJob.id
													? "Cancelando…"
													: "Cancelar trabalho"}
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
							<fieldset
								className={styles.campaignNavigationGuard}
								disabled={campaignNavigationPending}
								aria-busy={campaignNavigationPending || undefined}
							>
								<ProcessingSubmission
									campaignId={campaignId}
									className={styles.submissionCard}
									compact={Boolean(activeJob || queued.length)}
									onOpenDiagnostics={() => activateView("diagnostics")}
									runs={state.localRuns}
									benchmarks={state.benchmarkResults}
									system={state.system}
									recoveryScope={activityPackScope}
									onDraftStateChange={setSubmissionDraftActive}
									onReviewSessionAssembly={openSessionAssemblyReview}
								/>
							</fieldset>
						</div>
						{attention.length ? (
							<section
								className={styles.overviewAttention}
								aria-labelledby="processing-attention-title"
							>
								<div className={styles.sectionHeading}>
									<div>
										<h2 id="processing-attention-title">Precisa de atenção</h2>
										<span>
											{attention.length} {attention.length === 1 ? "trabalho" : "trabalhos"} com falha ou interrupção
										</span>
									</div>
									<Button size="sm" variant="tertiary" onClick={openAttentionQueue}>
										Ver todos
									</Button>
								</div>
								<div className={styles.overviewAttentionList}>
									{attention.slice(0, 3).map((job) => {
										const recovery = terminalRecoveryActions(job, canDeleteJobs);
										const pending =
											state.mutation?.targetId === job.id
												? state.mutation.kind
												: null;
										return (
											<article
												key={job.id}
												className={styles.overviewAttentionItem}
												data-job-id={job.id}
											>
												<div>
													<strong>{presentJobTitle(job)}</strong>
													<span>
														{job.error
															? `${presentJobError(job.error.code)} · ${job.error.code}`
															: jobLabels[job.status]}
														{" · "}tentativa {job.attempt}
													</span>
												</div>
												<div className={styles.overviewAttentionActions}>
													{recovery.canStartNew ? (
														<Button
															size="sm"
															variant={recovery.canRetry ? "tertiary" : "primary"}
															onClick={() => startNewWork(job)}
														>
															{job.kind === "benchmark.craig"
																? "Executar novo benchmark"
																: "Nova transcrição"}
														</Button>
													) : null}
													{recovery.canRetry ? (
														<Button
															size="sm"
															variant="tertiary"
															disabled={pending === "retry"}
															onClick={() =>
																setConfirmation({ id: job.id, action: "retry" })
															}
														>
															{pending === "retry"
																? "Repetindo…"
																: job.kind === "benchmark.craig"
																	? "Repetir tentativa"
																	: "Repetir trabalho"}
														</Button>
													) : null}
													<Button
														size="sm"
														variant="tertiary"
														onClick={() => openJobDiagnostics(job)}
													>
														Diagnóstico
													</Button>
													{recovery.canDiscard ? (
														<Button
															size="sm"
															variant="tertiary"
															className={styles.dangerAction}
															disabled={pending === "delete"}
															onClick={() =>
																setConfirmation({ id: job.id, action: "delete" })
															}
														>
															{pending === "delete"
																? "Descartando…"
																: "Descartar trabalho"}
														</Button>
													) : null}
												</div>
											</article>
										);
									})}
								</div>
							</section>
						) : null}
						{latestCompletedRun ? (
							<section
								className={styles.overviewMetrics}
								aria-label="Métricas do último resultado concluído"
							>
								<div className={styles.sectionHeading}>
									<h2>Último resultado concluído</h2>
									<span>
										{[latestCompletedRun.profileId, latestCompletedRun.engine]
											.filter(Boolean)
											.join(" · ")}{" "}
										·{" "}
										{latestCompletedRun.completedAt
											? formatTime(latestCompletedRun.completedAt)
											: "data indisponível"}
									</span>
								</div>
								<div className={styles.metricsStrip} data-result-summary="compact">
									<OverviewMetric
										label="Processamento"
										value={formatDuration(latestCompletedRun.stats.processingSeconds)}
									/>
									<OverviewMetric
										label="RTF"
										value={
											latestCompletedRun.stats.rtf === null
												? "—"
												: latestCompletedRun.stats.rtf.toFixed(3)
										}
									/>
									<OverviewMetric
										label="× realtime"
										value={formatRealtime(latestCompletedRun.stats.rtf)}
									/>
									<OverviewMetric
										label="Palavras"
										value={latestCompletedRun.stats.wordCount ?? "—"}
									/>
									<OverviewMetric
										label="Warnings"
										value={latestCompletedRun.stats.warningCount ?? "—"}
									/>
								</div>
								<details className={styles.overviewMetricDetails}>
									<summary>Ver detalhes do resultado</summary>
									<div className={styles.detailMetrics}>
										<OverviewMetric
											label="Duração da sessão"
											value={
												latestCompletedRun.stats.durationSemantics ===
												"session_extent_v1"
													? formatDuration(
															latestCompletedRun.stats.sessionDurationSeconds,
														)
													: "—"
											}
										/>
										<OverviewMetric
											label="Segmentos"
											value={latestCompletedRun.stats.segmentCount ?? "—"}
										/>
										<OverviewMetric
											label="Turnos"
											value={latestCompletedRun.stats.turnCount ?? "—"}
										/>
										<OverviewMetric
											label="Tracks"
											value={latestCompletedRun.stats.trackCount ?? "—"}
										/>
										<OverviewMetric
											label="Engine · hardware"
											value={
												[
													latestCompletedRun.engine,
													latestCompletedRun.model,
													latestCompletedRun.executionLineage?.gpu?.model ??
														latestCompletedRun.executionLineage?.device ??
														latestCompletedRun.device,
												]
													.filter(Boolean)
													.join(" · ") || "—"
											}
										/>
									</div>
								</details>
							</section>
						) : null}
					</section>

					<section
						id="processing-view-queue"
						className={styles.viewPanel}
						role="tabpanel"
						aria-labelledby="processing-tab-queue"
						hidden={view !== "queue"}
					>
						<ProcessingQueueView
							jobs={campaignJobs}
							filter={queueFilter}
							onFilterChange={setQueueFilter}
							resetSearchKey={queueSearchReset}
							mutation={state.mutation}
							canDelete={canDeleteJobs}
							onCancel={(job) =>
								setConfirmation({ id: job.id, action: "cancel" })
							}
							onRetry={(job) =>
								setConfirmation({ id: job.id, action: "retry" })
							}
							onResult={(job) => void openJobResult(job)}
							onStartNew={startNewWork}
							onDelete={(job) =>
								setConfirmation({ id: job.id, action: "delete" })
							}
							onDiagnostics={openJobDiagnostics}
						/>
					</section>

					<section
						id="processing-view-results"
						className={`${styles.viewPanel} ${styles.resultsView}`}
						role="tabpanel"
						aria-labelledby="processing-tab-results"
						hidden={view !== "results"}
					>
						{state.libraryRefreshError ? <p role="status">Resultados desatualizados. A última leitura foi preservada; tente atualizar.</p> : null}
						{state.capabilities ? (
							<SessionAssemblyResults
								campaignId={campaignId}
								capabilities={state.capabilities.capabilities}
								focus={assemblyReviewFocus}
							/>
						) : null}
						{unboundRuns.length ? (
							<section
								className={styles.unboundRecovery}
								aria-labelledby="unbound-local-runs-title"
								data-unbound-local-runs="true"
							>
								<div className={styles.sectionHeading}>
									<div>
										<h2 id="unbound-local-runs-title">
											Resultados locais sem campanha confirmada
										</h2>
										<p>
											Estes runs antigos continuam preservados, mas não contam como
											resultados de {campaignName}. Confirme a origem antes de reparar o
											destino; a campanha aberta nunca é usada como fallback.
										</p>
									</div>
									<span>{unboundRuns.length}</span>
								</div>
								<LocalReviewWorkspace
									runs={unboundRuns}
									hasMore={false}
									onLoadMore={controller.loadMoreRuns}
									focusRunKey={resultFocus?.key ?? null}
									focusRunRequestId={resultFocus?.requestId ?? 0}
									review={state.localReview}
									busy={state.localReviewBusy}
									error={state.localReviewError}
									publicationEnabled={publicationEnabled}
									comparisonEnabled={state.capabilities?.capabilities.includes("transcription.review.base") === true}
									onOpen={(sourceId, runId) =>
										controller.openLocalReview(sourceId, runId)
									}
									onLoadSnapshot={(sourceId, runId) =>
										controller.loadLocalReviewSnapshot(sourceId, runId)
									}
									onDeleteRun={canDeleteRuns ? controller.deleteLocalRun : undefined}
									onLoadLatest={controller.loadLatestLocalReview}
									onRepairTarget={state.capabilities?.capabilities.includes("transcription.target.repair") ? controller.repairPublicationTarget : undefined}
									onSave={(revision, status, segments) =>
										controller.saveLocalReview(revision, status, segments)
									}
									onClose={controller.closeLocalReview}
									onPublish={(review, operationId, expectedCurrentRevisionId, profileScope) =>
										publishApprovedLocalReview(review, operationId, expectedCurrentRevisionId, fetch, profileScope)
									}
								/>
							</section>
						) : null}
						<LocalReviewWorkspace
							runs={campaignRuns}
							hasMore={state.localRunsHasMore}
							onLoadMore={controller.loadMoreRuns}
							focusRunKey={resultFocus?.key ?? null}
							focusRunRequestId={resultFocus?.requestId ?? 0}
							review={state.localReview}
							busy={state.localReviewBusy}
							error={state.localReviewError}
							publicationEnabled={publicationEnabled}
							comparisonEnabled={state.capabilities?.capabilities.includes("transcription.review.base") === true}
							onOpen={(sourceId, runId) =>
								controller.openLocalReview(sourceId, runId)
							}
							onLoadSnapshot={(sourceId, runId) =>
								controller.loadLocalReviewSnapshot(sourceId, runId)
							}
							onDeleteRun={canDeleteRuns ? controller.deleteLocalRun : undefined}
							onLoadLatest={controller.loadLatestLocalReview}
							onRepairTarget={state.capabilities?.capabilities.includes("transcription.target.repair") ? controller.repairPublicationTarget : undefined}
							onSave={(revision, status, segments) =>
								controller.saveLocalReview(revision, status, segments)
							}
							onClose={controller.closeLocalReview}
							onPublish={(review, operationId, expectedCurrentRevisionId, profileScope) =>
								publishApprovedLocalReview(review, operationId, expectedCurrentRevisionId, fetch, profileScope)
							}
						/>

						<section
							className={`${styles.syncStrip} ${styles.resultsSync}`}
							aria-labelledby="local-sync"
							data-results-sync="true"
							data-state={publicationEnabled ? "ready" : "unconfigured"}
						>
							<div>
								<h2 id="local-sync">Sincronização com o Edit</h2>
								<p>
									{publicationEnabled ? (
										<>
											<strong>Handoff privado para o Edit disponível.</strong>{" "}
											Uma revisão aprovada e uma confirmação explícita preparam a sessão
											no Edit. A publicação pública acontece depois, no editor da sessão.
										</>
									) : (
										<>
											<strong>Sincronização não configurada.</strong>{" "}
											Concluir localmente não significa enviar ou publicar.
										</>
									)}
								</p>
							</div>
							{resultVisibleInCampaign && state.result ? (
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
						id="processing-view-benchmark"
						className={styles.viewPanel}
						role="tabpanel"
						aria-labelledby="processing-tab-benchmark"
						hidden={view !== "benchmark"}
					>
						<ProcessingBenchmark
							jobs={state.jobs}
							capabilities={state.capabilities}
							connected={connected}
							events={state.events}
							observedJobId={state.observedJobId}
							onRefresh={() => void controller.refresh("manual")}
							onCancel={(jobId) => controller.jobAction(jobId, "cancel")}
							onRetry={(job) =>
								setConfirmation({ id: job.id, action: "retry" })
							}
							onDelete={(job) =>
								setConfirmation({ id: job.id, action: "delete" })
							}
							canDelete={canDeleteJobs}
							onObserve={(jobId) => controller.observeJob(jobId)}
							onOpenDiagnostics={openJobDiagnostics}
						/>
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
							<div className={styles.diagnosticsCore} data-diagnostics-core="true">
								<div className={styles.diagnosticsSummaryRail} data-diagnostics-summary="true">
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
												<dd>{observedJob.attempt}</dd>
											</div>
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


									<details className={styles.systemDetails}>
										<summary>Companion e máquina</summary>
										<dl className={styles.jobDetails}>
											<div>
												<dt>API</dt>
												<dd>{state.health?.api_version ?? "—"}</dd>
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
												<dt>Sistema</dt>
												<dd>{state.system?.host.os ?? "—"}</dd>
											</div>
											<div>
												<dt>CPU</dt>
												<dd>{state.system?.host.cpu ?? "—"}</dd>
											</div>
											<div>
												<dt>RAM</dt>
												<dd>
													{state.system
														? `${formatBytes(state.system.memory.usedBytes)} / ${formatBytes(state.system.memory.totalBytes)} · ${state.system.memory.percent === null ? "—" : `${Math.round(state.system.memory.percent)}%`}`
														: "—"}
												</dd>
											</div>
											{state.system?.gpus.map((item) => (
												<div key={item.index}>
													<dt>GPU {item.index}</dt>
													<dd>
														{item.name} · {item.utilizationPercent === null ? "—" : `${Math.round(item.utilizationPercent)}%`} · {formatBytes(item.memoryUsedBytes)} / {formatBytes(item.memoryTotalBytes)} VRAM
													</dd>
												</div>
											))}
											<div className={styles.detailWide}>
												<dt>Capabilities</dt>
												<dd className={styles.mono}>
													{state.capabilities?.capabilities.join(", ") || "—"}
												</dd>
											</div>
										</dl>
									</details>
								</div>
								<div className={styles.diagnosticsEventPane} data-diagnostics-events="true">
									{observedJob ? (
										<ProcessingLiveLog
											key={`${observedJob.id}:${observedJob.attempt}`}
											events={state.events}
											job={observedJob}
											system={state.system}
											live={observedJobLive}
											stale={Boolean(state.eventsRefreshError)}
											activityCatalog={activityCatalog}
											expectedPollMs={processingPollMs(observedJobLive)}
										/>
									) : null}

								</div>
							</div>

							{state.uncertainSubmission ? (
								<p className={styles.connectionError} role="alert">
									A resposta desta tentativa não chegou. Reconecte e
									consulte a fila antes de iniciar outra tentativa; a chave
									desta aba será reutilizada.
								</p>
							) : null}

							{(activityBarksManage && activityPackScope) ||
							state.capabilities?.capabilities.includes("synthetic.fixture") ? (
								<details className={styles.advancedTools}>
									<summary>
										<span>
											<strong>Ferramentas avançadas</strong>
											<small>Customização do log e ensaios de manutenção</small>
										</span>
									</summary>
									<div className={styles.advancedToolsBody}>
										{activityBarksManage && activityPackScope ? (
											<ActivityPackAdmin scope={activityPackScope} />
										) : null}

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
														state.mutation?.kind === "synthetic" ||
														state.health?.lifecycle !== "ready"
													}
													onClick={() => void controller.synthetic()}
												>
													{state.mutation?.kind === "synthetic"
														? "Executando…"
														: "Executar ensaio sintético"}
												</Button>
											</div>
										) : null}
									</div>
								</details>
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


			<Dialog
				open={campaignSwitchTarget !== null}
				title="Trocar de campanha?"
				description={
					<p>
						Você está saindo de <strong>{campaignName}</strong> para{" "}
						<strong>
							{campaignOptions.find(
								(campaign) => campaign.technicalSlug === campaignSwitchTarget,
							)?.name ?? campaignSwitchTarget}
						</strong>.
					</p>
				}
				onClose={cancelCampaignSwitch}
				actions={
					<>
						<Button
							data-dialog-initial-focus
							variant="secondary"
							onClick={cancelCampaignSwitch}
						>
							Continuar nesta campanha
						</Button>
						<Button variant="primary" onClick={confirmCampaignSwitch}>
							Trocar campanha
						</Button>
					</>
				}
			>
				<p>
					Somente o formulário local ainda não enviado desta tela será descartado.
					Trabalhos já enfileirados ou em execução continuam associados à campanha
					original. Nenhum job será reatribuído.
				</p>
				{state.uncertainSubmission ? (
					<p>
						Há uma submissão sem confirmação final. Confira a fila da campanha atual
						antes de repetir qualquer envio.
					</p>
				) : null}
			</Dialog>

			<JobDiagnosticsInspector
				open={diagnosticInspectorJobId !== null}
				requestedJob={diagnosticInspectorJob}
				observedJob={observedJobExact}
				observedJobId={state.observedJobId}
				events={state.events}
				eventsLoading={state.eventsLoading}
				eventsStale={Boolean(state.eventsRefreshError)}
				system={state.system}
				health={state.health}
				capabilities={state.capabilities}
				activityCatalog={activityCatalog}
				expectedPollMs={processingPollMs(
					Boolean(
						diagnosticInspectorJob &&
							["queued", "running"].includes(diagnosticInspectorJob.status),
					),
				)}
				pendingAction={
					state.mutation?.targetId === diagnosticInspectorJobId &&
					["cancel", "retry", "result", "delete"].includes(state.mutation.kind)
						? (state.mutation.kind as "cancel" | "retry" | "result" | "delete")
						: null
				}
				canDelete={canDeleteJobs}
				onClose={() => closeJobDiagnostics(true)}
				onOpenResult={async (job) => {
					const error = await openJobResult(job);
					if (!error) closeJobDiagnostics(false);
					return error;
				}}
				onStartNew={startNewWork}
				onRetry={(job) =>
					setConfirmation({ id: job.id, action: "retry" })
				}
				onDelete={(job) => {
					closeJobDiagnostics(false);
					setConfirmation({ id: job.id, action: "delete" });
				}}
				onCancel={(job) =>
					setConfirmation({ id: job.id, action: "cancel" })
				}
			/>

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
										? "Descartar este trabalho?"
										: "Repetir este trabalho?"}
						</h2>
						<p>
							{confirmation.action === "resume"
								? "O serviço poderá iniciar os trabalhos que aguardam na fila."
								: confirmation.action === "cancel"
									? `O cancelamento será enviado ao trabalho ${confirmation.id}.`
									: confirmation.action === "delete"
										? `O trabalho ${confirmation.id}, seus eventos e a referência de resultado na fila serão excluídos. As transcrições em Resultados, revisões, evidências de Benchmark, modelos, sessão Craig e checkpoints serão preservados.`
										: `Uma nova tentativa será criada para ${confirmation.id}; checkpoints compatíveis serão reutilizados quando disponíveis, sem prometer retomada exata de toda etapa.`}
						</p>
						<div className={styles.dialogActions}>
							<Button onClick={() => setConfirmation(null)}>Voltar</Button>
							<Button
								variant={confirmation.action === "delete" ? "tertiary" : "primary"}
								className={confirmation.action === "delete" ? styles.dangerAction : undefined}
								onClick={() => void confirm()}
							>
								{confirmation.action === "delete" ? "Descartar trabalho" : "Confirmar"}
							</Button>
						</div>
					</>
				) : null}
			</dialog>
		</div>
	);
}
