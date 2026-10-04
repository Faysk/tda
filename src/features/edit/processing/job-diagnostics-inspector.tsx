"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import type { ActivityBark } from "./activity-barks";
import { ProcessingLiveLog } from "./live-log";
import {
	jobLabels,
	presentJobError,
	stageLabels,
} from "./presentation";
import type {
	Capabilities,
	Health,
	JobEvent,
	LocalJob,
	SystemSnapshot,
} from "./protocol";
import styles from "./processing.module.css";

type Props = Readonly<{
	open: boolean;
	requestedJob: LocalJob | null;
	observedJob: LocalJob | null;
	observedJobId: string | null;
	events: readonly JobEvent[];
	eventsLoading: boolean;
	eventsStale: boolean;
	system: SystemSnapshot | null;
	health: Health | null;
	capabilities: Capabilities | null;
	activityCatalog: readonly ActivityBark[];
	expectedPollMs: number;
	pendingAction: "cancel" | "retry" | "result" | null;
	onClose: () => void;
	onOpenResult: (job: LocalJob) => Promise<string | null>;
	onRetry: (job: LocalJob) => void;
	onCancel: (job: LocalJob) => void;
}>;

const SAFE_EVENT_DATA_KEYS = new Set([
	"stage",
	"track",
	"total_tracks",
	"window",
	"segment",
	"completed",
	"total",
	"percent",
	"failure_class",
	"runtime_version",
	"worker_sha256",
	"downloaded_bytes",
	"device",
]);

function formatDateTime(value: string | null | undefined): string {
	if (!value) return "—";
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return "—";
	return date.toLocaleString("pt-BR", {
		dateStyle: "short",
		timeStyle: "medium",
	});
}

function formatSeconds(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value) || value < 0)
		return "—";
	const rounded = Math.round(value);
	const hours = Math.floor(rounded / 3600);
	const minutes = Math.floor((rounded % 3600) / 60);
	const seconds = rounded % 60;
	if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
	if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	return `${seconds}s`;
}

function formatBytes(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	const gib = value / 1024 ** 3;
	return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GB`;
}

function jobTone(status: LocalJob["status"]): "neutral" | "accent" | "success" | "warning" | "danger" {
	return ({
		queued: "neutral",
		running: "accent",
		succeeded: "success",
		partial: "warning",
		failed: "danger",
		cancelled: "neutral",
		interrupted: "warning",
	} as const)[status];
}

export function sanitizeJobDiagnosticEvent(event: JobEvent) {
	const data: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(event.data)) {
		if (SAFE_EVENT_DATA_KEYS.has(key)) data[key] = value;
	}
	return {
		seq: event.seq,
		attempt: event.attempt,
		code: event.code,
		at: event.at,
		level: event.level,
		data,
	};
}

export function jobDiagnosticEventsForAttempt(
	events: readonly JobEvent[],
	attempt: number,
): readonly JobEvent[] {
	return events.filter(
		(event) => event.attempt === null || event.attempt === attempt,
	);
}

export function JobDiagnosticsInspector({
	open,
	requestedJob,
	observedJob,
	observedJobId,
	events,
	eventsLoading,
	eventsStale,
	system,
	health,
	capabilities,
	activityCatalog,
	expectedPollMs,
	pendingAction,
	onClose,
	onOpenResult,
	onRetry,
	onCancel,
}: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [copyState, setCopyState] = useState<
		Readonly<{ jobKey: string; status: "copied" | "failed" }> | null
	>(null);
	const [identifierCopyState, setIdentifierCopyState] = useState<
		Readonly<{
			jobKey: string;
			kind: "job" | "source";
			status: "copied" | "failed";
		}> | null
	>(null);
	const [resultActionError, setResultActionError] = useState<
		Readonly<{ jobKey: string; message: string }> | null
	>(null);
	const job =
		requestedJob && observedJob?.id === requestedJob.id ? observedJob : requestedJob;
	const eventsReady = Boolean(
		job && observedJobId === job.id && !eventsLoading,
	);
	const visibleEvents =
		eventsReady && job ? jobDiagnosticEventsForAttempt(events, job.attempt) : [];
	const jobKey = job ? `${job.id}:${job.attempt}` : "";
	const profile = useMemo(
		() =>
			job?.context?.profileId
				? capabilities?.transcription.catalog.find(
						(item) => item.id === job.context?.profileId,
					) ?? null
				: null,
		[capabilities, job?.context?.profileId],
	);
	const gpu =
		job?.executionDevice?.kind === "cuda"
			? system?.gpus.find((item) => {
					if (
						job.executionDevice?.physicalUuid &&
						item.uuid === job.executionDevice.physicalUuid
					)
						return true;
					return (
						job.executionDevice?.logicalIndex !== null &&
						job.executionDevice?.logicalIndex !== undefined &&
						item.index === job.executionDevice.logicalIndex
					);
				}) ?? null
			: null;

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	}, [open]);

	async function copyIdentifier(kind: "job" | "source", value: string) {
		try {
			await navigator.clipboard.writeText(value);
			setIdentifierCopyState({ jobKey, kind, status: "copied" });
		} catch {
			setIdentifierCopyState({ jobKey, kind, status: "failed" });
		}
	}

	async function copyDiagnostic() {
		if (!job) return;
		const payload = {
			schema: "tda_job_diagnostic_clipboard_v1",
			captured_at: new Date().toISOString(),
			job: {
				id: job.id,
				attempt: job.attempt,
				status: job.status,
				stage: job.stage,
				updated_at: job.updated_at,
				result_available: job.result_available,
				error: job.error,
				source_id: job.context?.sourceId ?? null,
				session_id: job.context?.sessionId ?? null,
				profile_id: job.context?.profileId ?? null,
				execution_device: job.executionDevice
					? {
							kind: job.executionDevice.kind,
							logical_index: job.executionDevice.logicalIndex,
						}
					: null,
				timing: {
					attempt_started_at: job.timing.attemptStartedAt,
					attempt_finished_at: job.timing.attemptFinishedAt,
					attempt_elapsed_seconds: job.timing.attemptElapsedSeconds,
					stage_started_at: job.timing.stageStartedAt,
					stage_elapsed_seconds: job.timing.stageElapsedSeconds,
					tracks: job.timing.tracks.map((track) => ({
						track: track.track,
						total_tracks: track.totalTracks,
						started_at: track.startedAt,
						finished_at: track.finishedAt,
						processing_seconds: track.processingSeconds,
					})),
				},
			},
			profile: profile
				? {
						engine: profile.engine,
						model: profile.model ?? null,
						model_revision: profile.modelRevision ?? null,
						runtime_version: profile.runtimeVersion ?? null,
						compute_type: profile.computeType ?? null,
					}
				: null,
			companion: health
				? {
						api_version: health.api_version,
						service_version: health.service_version,
						lifecycle: health.lifecycle,
					}
				: null,
			gpu: gpu
				? {
						index: gpu.index,
						name: gpu.name,
						memory_used_bytes: gpu.memoryUsedBytes,
						memory_total_bytes: gpu.memoryTotalBytes,
					}
				: null,
			events: visibleEvents.map(sanitizeJobDiagnosticEvent),
		};
		try {
			await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
			setCopyState({ jobKey, status: "copied" });
		} catch {
			setCopyState({ jobKey, status: "failed" });
		}
	}

	return (
		<dialog
			ref={dialogRef}
			className={styles.jobDiagnosticsDialog}
			aria-labelledby="job-diagnostics-title"
			aria-describedby="job-diagnostics-description"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			data-job-diagnostics="contextual"
			data-job-id={job?.id ?? undefined}
			onClose={() => {
				if (open) onClose();
			}}
		>
			<div className={styles.jobDiagnosticsShell} data-job-diagnostics-shell="true">
				<header className={styles.jobDiagnosticsHeader}>
					<div>
						<span className={styles.overline}>Diagnóstico do processamento</span>
						<h2 id="job-diagnostics-title">
							Diagnóstico · {job?.context?.sessionId ?? "trabalho local"}
						</h2>
						{job ? (
							<p id="job-diagnostics-description">
								{job.context?.profileId ?? job.kind} · attempt {job.attempt} · job{" "}
								{job.id.slice(0, 12)}
							</p>
						) : (
							<p id="job-diagnostics-description">
								Selecione um processamento para consultar seu diagnóstico.
							</p>
						)}
					</div>
					<Button autoFocus size="sm" variant="tertiary" onClick={onClose}>
						Fechar
					</Button>
				</header>

				{job ? (
					<>
						<div className={styles.jobDiagnosticsStatus}>
							<StatusPill tone={jobTone(job.status)}>{jobLabels[job.status]}</StatusPill>
							<strong>{stageLabels[job.stage] ?? job.stage}</strong>
							{job.error ? (
								<span data-tone="danger">
									{presentJobErrorForJob(job)}
									{" · "}
									<code>{job.error.code}</code>
									{job.error.recoverable ? " · recuperável" : " · não recuperável"}
								</span>
							) : null}
						</div>

						<section className={styles.jobDiagnosticsSummary} aria-label="Resumo do processamento">
							<dl className={styles.jobDetails}>
								<div><dt>Job ID</dt><dd className={styles.mono}>{job.id}</dd></div>
								<div><dt>Source</dt><dd className={styles.mono}>{job.context?.sourceId ?? "—"}</dd></div>
								<div><dt>Attempt</dt><dd>{job.attempt}</dd></div>
								<div><dt>Atualizado</dt><dd>{formatDateTime(job.updated_at)}</dd></div>
								<div><dt>Tempo do attempt</dt><dd>{formatSeconds(job.timing.attemptElapsedSeconds)}</dd></div>
								<div><dt>Resultado</dt><dd>{job.result_available ? "Disponível" : "Não disponível"}</dd></div>
								<div className={styles.detailWide}>
									<dt>Progresso</dt>
									<dd>{job.progress ? `${job.progress.completed}/${job.progress.total} ${job.progress.unit}` : "—"}</dd>
								</div>
							</dl>
						</section>

						<details className={styles.jobDiagnosticsExecution}>
							<summary>Execução e timings</summary>
							<dl className={styles.jobDetails}>
								<div><dt>Attempt iniciado</dt><dd>{formatDateTime(job.timing.attemptStartedAt)}</dd></div>
								<div><dt>Etapa iniciada</dt><dd>{formatDateTime(job.timing.stageStartedAt)}</dd></div>
								<div><dt>Tempo da etapa</dt><dd>{formatSeconds(job.timing.stageElapsedSeconds)}</dd></div>
								<div><dt>Engine</dt><dd>{profile?.engine ?? "—"}</dd></div>
								<div><dt>Modelo</dt><dd>{profile?.model ?? "—"}</dd></div>
								<div><dt>Revisão do modelo</dt><dd>{profile?.modelRevision ?? "—"}</dd></div>
								<div><dt>Runtime</dt><dd>{profile?.runtimeVersion ?? "—"}</dd></div>
								<div><dt>Compute</dt><dd>{profile?.computeType ?? "—"}</dd></div>
								<div><dt>Dispositivo</dt><dd>{job.executionDevice?.kind === "cuda" ? `CUDA ${job.executionDevice.logicalIndex ?? "?"}` : job.executionDevice?.kind ?? "—"}</dd></div>
								{gpu ? (
									<div className={styles.detailWide}>
										<dt>GPU</dt>
										<dd>{gpu.name} · {formatBytes(gpu.memoryUsedBytes)} / {formatBytes(gpu.memoryTotalBytes)} VRAM</dd>
									</div>
								) : null}
							</dl>
						</details>

						<fieldset className={styles.jobDiagnosticsActions}>
							<legend className={styles.jobDiagnosticsActionsLegend}>
								Ações do processamento
							</legend>
							{job.status === "succeeded" && job.result_available ? (
								<Button
									size="sm"
									variant="primary"
									disabled={pendingAction === "result"}
									onClick={() =>
										void (async () => {
											setResultActionError(null);
											const error = await onOpenResult(job);
											if (error) setResultActionError({ jobKey, message: error });
										})()
									}
								>
									{pendingAction === "result" ? "Abrindo…" : "Abrir resultado"}
								</Button>
							) : null}
							{["failed", "interrupted"].includes(job.status) && job.error?.recoverable ? (
								<Button size="sm" disabled={pendingAction === "retry"} onClick={() => onRetry(job)}>
									{pendingAction === "retry" ? "Repetindo…" : "Repetir trabalho"}
								</Button>
							) : null}
							{["queued", "running"].includes(job.status) ? (
								<Button size="sm" variant="tertiary" disabled={pendingAction === "cancel"} onClick={() => onCancel(job)}>
									{pendingAction === "cancel" ? "Cancelando…" : "Cancelar"}
								</Button>
							) : null}
							<Button
								size="sm"
								variant="tertiary"
								onClick={() => void copyIdentifier("job", job.id)}
							>
								Copiar Job ID
							</Button>
							{job.context?.sourceId ? (
								<Button
									size="sm"
									variant="tertiary"
									onClick={() =>
										void copyIdentifier("source", job.context?.sourceId ?? "")
									}
								>
									Copiar Source ID
								</Button>
							) : null}
							<Button size="sm" variant="tertiary" onClick={() => void copyDiagnostic()}>
								Copiar diagnóstico
							</Button>
							{identifierCopyState?.jobKey === jobKey &&
							identifierCopyState.status === "copied" ? (
								<span role="status">
									{identifierCopyState.kind === "job" ? "Job ID" : "Source ID"} copiado.
								</span>
							) : null}
							{identifierCopyState?.jobKey === jobKey &&
							identifierCopyState.status === "failed" ? (
								<span role="alert">
									Não foi possível copiar{" "}
									{identifierCopyState.kind === "job" ? "o Job ID" : "o Source ID"}.
								</span>
							) : null}
							{copyState?.jobKey === jobKey && copyState.status === "copied" ? (
								<span role="status">Diagnóstico copiado.</span>
							) : null}
							{copyState?.jobKey === jobKey && copyState.status === "failed" ? (
								<span role="alert">Não foi possível copiar o diagnóstico.</span>
							) : null}
							{resultActionError?.jobKey === jobKey ? (
								<span role="alert">{resultActionError.message}</span>
							) : null}
						</fieldset>

						<section
							className={styles.jobDiagnosticsLog}
							aria-label="Eventos deste processamento"
							data-job-diagnostics-log="true"
						>
							{eventsReady ? (
								<ProcessingLiveLog
									key={`${job.id}:${job.attempt}`}
									events={visibleEvents}
									job={job}
									system={system}
									live={["queued", "running"].includes(job.status)}
									stale={eventsStale}
									activityCatalog={activityCatalog}
									expectedPollMs={expectedPollMs}
								/>
							) : (
								<p role="status" className={styles.inspectorEmpty}>
									Carregando histórico deste processamento…
								</p>
							)}
						</section>

						<details className={styles.jobDiagnosticsMachine}>
							<summary>Companion e máquina</summary>
							<dl className={styles.jobDetails}>
								<div><dt>API</dt><dd>{health?.api_version ?? "—"}</dd></div>
								<div><dt>Serviço</dt><dd>{health?.service_version ?? "—"}</dd></div>
								<div><dt>Lifecycle</dt><dd>{health?.lifecycle ?? "—"}</dd></div>
								<div><dt>CPU</dt><dd>{system?.host.cpu ?? "—"}</dd></div>
								<div><dt>RAM</dt><dd>{system ? `${formatBytes(system.memory.usedBytes)} / ${formatBytes(system.memory.totalBytes)}` : "—"}</dd></div>
								<div className={styles.detailWide}><dt>Capabilities</dt><dd className={styles.mono}>{capabilities?.capabilities.join(", ") || "—"}</dd></div>
							</dl>
						</details>
					</>
				) : (
					<p className={styles.inspectorEmpty}>Nenhum processamento selecionado.</p>
				)}
			</div>
		</dialog>
	);
}
