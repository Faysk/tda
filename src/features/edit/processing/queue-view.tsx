"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedProgress } from "@/components/ui/animated-progress";
import { Button, Select } from "@/components/ui";
import { StatusPill, type StatusTone } from "@/components/ui/status";
import {
	jobLabels,
	presentJobError,
	presentJobTitle,
	stageLabels,
} from "./presentation";
import type { LocalJob } from "./protocol";
import {
	type QueueFilter,
	type QueueSort,
	compactQueueId,
	queueFilterCount,
	queueFilters,
	queuePrimaryIdentity,
	queueProfileLabel,
	queueRetryAvailable,
	queueSortOptions,
	queueSupportingIdentity,
	selectQueueJobs,
} from "./queue-model";
import styles from "./queue-view.module.css";
import { QueueActions } from "./queue-actions";

const consolidationStages = new Set([
	"energy_analysis",
	"cross_track_dedup",
	"merge_timeline",
	"turn_building",
	"result_prepare",
	"consolidating",
	"complete",
]);

function jobTone(status: LocalJob["status"]): StatusTone {
	if (status === "succeeded") return "success";
	if (status === "failed") return "danger";
	if (status === "interrupted") return "warning";
	if (status === "running") return "accent";
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

function progressCopy(job: LocalJob): string {
	if (!job.progress) return "Sem medida";
	const unit = job.progress.unit === "items" ? "itens" : job.progress.unit;
	return `${job.progress.completed} de ${job.progress.total} ${unit}`;
}

function exactUpdated(value: string): string {
	return new Date(value).toLocaleString("pt-BR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function relativeUpdated(value: string): string {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return "horário indisponível";
	const elapsed = Math.max(0, Date.now() - parsed);
	const seconds = Math.round(elapsed / 1000);
	if (seconds < 5) return "agora";
	if (seconds < 60) return `há ${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `há ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `há ${hours} h`;
	return new Date(value).toLocaleDateString("pt-BR", {
		day: "2-digit",
		month: "short",
	});
}

function pendingFor(
	jobId: string,
	mutation: Readonly<{ kind: string; targetId?: string }> | null,
): "cancel" | "retry" | "result" | "delete" | null {
	if (!mutation || mutation.targetId !== jobId) return null;
	if (["cancel", "retry", "result", "delete"].includes(mutation.kind))
		return mutation.kind as "cancel" | "retry" | "result" | "delete";
	return null;
}

function QueueProgress({ job }: Readonly<{ job: LocalJob }>) {
	const percent = progressPercent(job);
	if (!job.progress || percent === null)
		return (
			<span className={styles.progressFallback}>
				{job.progress?.completed ? progressCopy(job) : "—"}
			</span>
		);
	return (
		<div className={styles.progress}>
			<AnimatedProgress
				key={`${job.id}:${job.attempt}:${job.stage}`}
				ariaLabel={`Progresso do trabalho ${job.id}`}
				value={job.progress.completed}
				max={job.progress.total}
				valueText={progressCopy(job)}
			/>
			<span>{percent}%</span>
		</div>
	);
}

type Props = Readonly<{
	jobs: readonly LocalJob[];
	filter: QueueFilter;
	onFilterChange: (filter: QueueFilter) => void;
	resetSearchKey: number;
	mutation: Readonly<{ kind: string; targetId?: string }> | null;
	canDelete: boolean;
	onCancel: (job: LocalJob) => void;
	onRetry: (job: LocalJob) => void;
	onResult: (job: LocalJob) => void;
	onDelete: (job: LocalJob) => void;
	onDiagnostics: (job: LocalJob) => void;
}>;

export function ProcessingQueueView({
	jobs,
	filter,
	onFilterChange,
	resetSearchKey,
	mutation,
	canDelete,
	onCancel,
	onRetry,
	onResult,
	onDelete,
	onDiagnostics,
}: Props) {
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<QueueSort>("updated");
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [copyFeedback, setCopyFeedback] = useState<
		Readonly<{ kind: "success" | "error"; jobId: string }> | null
	>(null);
	const copyFeedbackTimer = useRef<number | null>(null);
	const copyAttempt = useRef(0);

	useEffect(() => {
		if (resetSearchKey > 0) setQuery("");
	}, [resetSearchKey]);

	useEffect(
		() => () => {
			copyAttempt.current += 1;
			if (copyFeedbackTimer.current !== null)
				window.clearTimeout(copyFeedbackTimer.current);
		},
		[],
	);

	const rows = useMemo(
		() => selectQueueJobs(jobs, filter, query, sort),
		[jobs, filter, query, sort],
	);
	const completedView = filter === "completed";

	function toggleDetails(jobId: string) {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(jobId)) next.delete(jobId);
			else next.add(jobId);
			return next;
		});
	}

	function showCopyFeedback(
		feedback: Readonly<{ kind: "success" | "error"; jobId: string }>,
	) {
		if (copyFeedbackTimer.current !== null)
			window.clearTimeout(copyFeedbackTimer.current);
		setCopyFeedback(feedback);
		copyFeedbackTimer.current = window.setTimeout(() => {
			setCopyFeedback(null);
			copyFeedbackTimer.current = null;
		}, 2400);
	}

	async function copyId(jobId: string) {
		const attempt = ++copyAttempt.current;
		if (copyFeedbackTimer.current !== null) {
			window.clearTimeout(copyFeedbackTimer.current);
			copyFeedbackTimer.current = null;
		}
		setCopyFeedback(null);
		try {
			await navigator.clipboard.writeText(jobId);
			if (copyAttempt.current !== attempt) return;
			showCopyFeedback({ kind: "success", jobId });
		} catch {
			if (copyAttempt.current !== attempt) return;
			showCopyFeedback({ kind: "error", jobId });
		}
	}

	return (
		<div className={styles.queue} data-processing-queue="true">
			<div className={styles.toolbar}>
				<fieldset className={styles.filters}>
					<legend className={styles.filterLegend}>Filtrar fila</legend>
					{queueFilters.map((item) => (
						<Button
							key={item.id}
							size="sm"
							variant="tertiary"
							className={styles.filterButton}
							aria-pressed={filter === item.id}
							onClick={() => onFilterChange(item.id)}
						>
							{item.label}
							<span aria-hidden="true">{queueFilterCount(jobs, item.id)}</span>
						</Button>
					))}
				</fieldset>

				<label className={styles.search}>
					<span>Buscar</span>
					<input
						type="search"
						value={query}
						placeholder="Sessão, profile, source ou ID…"
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>

				<div className={styles.sort}>
					<span>Ordenar</span>
					<Select
						value={sort}
						options={queueSortOptions.map((item) => ({
							value: item.id,
							label: item.label,
						}))}
						onChange={(value) => setSort(value as QueueSort)}
						ariaLabel="Ordenar fila"
						compact
					/>
				</div>

				<span className={styles.count} aria-live="polite">
					{rows.length === jobs.length
						? `${rows.length} jobs`
						: `${rows.length} de ${jobs.length} jobs`}
				</span>
			</div>

			{copyFeedback ? (
				<p
					className={styles.copyFeedback}
					data-tone={copyFeedback.kind}
					role={copyFeedback.kind === "error" ? "alert" : "status"}
				>
					{copyFeedback.kind === "success"
						? `ID ${compactQueueId(copyFeedback.jobId)} copiado.`
						: "Não foi possível copiar o ID. Abra Detalhes e copie manualmente."}
				</p>
			) : null}

			{rows.length ? (
				<div className={styles.tableFrame}>
					<table className={styles.table} data-density={completedView ? "terminal" : "standard"}>
						<thead>
							<tr>
								<th scope="col">Sessão / source</th>
								<th scope="col">Profile</th>
								{!completedView ? <th scope="col">Etapa / progresso</th> : null}
								<th scope="col">{completedView ? "Conclusão" : "Estado"}</th>
								<th scope="col">Atualizado</th>
								{!completedView ? (
									<>
										<th scope="col" className={styles.wideColumn}>Attempt</th>
										<th scope="col" className={styles.wideColumn}>Erro / recuperação</th>
									</>
								) : null}
								<th scope="col" className={styles.actionsHeader}>
									Ações
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((job) => {
								const pending = pendingFor(job.id, mutation);
								const isExpanded = expanded.has(job.id);
								const profile = queueProfileLabel(job.context?.profileId);
								const error = job.error
									? presentJobError(job.error.code)
									: null;
								const detailsId = `queue-job-details-${job.id}`;
								return (
									<Fragment key={job.id}>
										<tr
										className={styles.row}
										data-status={job.status}
										data-job-id={job.id}
									>
											<td
												data-label="Sessão / source"
												className={styles.identityCell}
											>
												<strong>{queuePrimaryIdentity(job)}</strong>
												{queueSupportingIdentity(job) ? (
													<span>{queueSupportingIdentity(job)}</span>
												) : null}
												<small>{presentJobTitle(job)}</small>
											</td>
											<td data-label="Profile" className={styles.profileCell}>
												<strong>{profile}</strong>
												<span className={styles.attemptInline}>
													Attempt {job.attempt}
												</span>
											</td>
											{!completedView ? (
												<td
													data-label="Etapa / progresso"
													className={styles.stageCell}
												>
													<strong>{stageLabels[job.stage] ?? job.stage}</strong>
													<QueueProgress job={job} />
												</td>
											) : null}
											<td
												data-label="Estado"
												className={styles.statusCell}
											>
												<StatusPill tone={jobTone(job.status)}>
													{jobLabels[job.status]}
												</StatusPill>
												{error ? (
													<span className={styles.errorInline}>{error}</span>
												) : null}
											</td>
											<td
												data-label="Atualizado"
												className={styles.updatedCell}
											>
												<time
													dateTime={job.updated_at}
													title={exactUpdated(job.updated_at)}
												>
													{relativeUpdated(job.updated_at)}
												</time>
											</td>
											{!completedView ? (
												<>
													<td data-label="Attempt" className={styles.wideColumn}>
														<span className={styles.attemptWide}>{job.attempt}</span>
													</td>
													<td
														data-label="Erro / recuperação"
														className={styles.wideColumn}
													>
														{error ? (
															<span className={styles.errorWide} title={error}>
																{error}
																{job.error?.recoverable ? " · recuperável" : ""}
															</span>
														) : (
															<span className={styles.muted}>—</span>
														)}
													</td>
												</>
											) : null}
											<td data-label="Ações" className={styles.actionsCell}>
												<div className={styles.actions}>
													{["queued", "running"].includes(job.status) ? (
														<Button
															size="sm"
															disabled={pending === "cancel"}
															onClick={() => onCancel(job)}
														>
															{pending === "cancel"
																? "Cancelando…"
																: "Cancelar trabalho"}
														</Button>
													) : null}
													{queueRetryAvailable(job) ? (
														<Button
															size="sm"
															disabled={pending === "retry"}
															onClick={() => onRetry(job)}
														>
															{pending === "retry"
																? "Repetindo…"
																: "Repetir trabalho"}
														</Button>
													) : null}
													{job.status === "succeeded" &&
													job.result_available ? (
														<Button
															size="sm"
															disabled={pending === "result"}
															onClick={() => onResult(job)}
														>
															{pending === "result"
																? "Abrindo…"
																: "Abrir resultado"}
														</Button>
													) : null}
													<QueueActions
														key={JSON.stringify([job.id, filter, query, sort])}
														label={queuePrimaryIdentity(job)}
													>
														{(close) => (
															<>
																{/* Native buttons retain a simple Tab sequence. */}
																<button
																	type="button"
																	aria-expanded={isExpanded}
																	aria-controls={detailsId}
																	onClick={() => {
																		close();
																		toggleDetails(job.id);
																	}}
																>
																	{isExpanded ? "Ocultar detalhes" : "Detalhes"}
																</button>
																<button
																	type="button"
																	onClick={() => {
																		close();
																		void copyId(job.id);
																	}}
																>
																	Copiar ID
																</button>
																<button
																	type="button"
																	onClick={() => {
																		close();
																		onDiagnostics(job);
																	}}
																>
																	Abrir Diagnóstico
																</button>
																{canDelete &&
																[
																	"succeeded",
																	"failed",
																	"interrupted",
																	"cancelled",
																].includes(job.status) ? (
																	<button
																		type="button"
																		disabled={pending === "delete"}
																		onClick={() => {
																			close();
																			onDelete(job);
																		}}
																	>
																		{pending === "delete"
																			? "Excluindo…"
																			: "Excluir"}
																	</button>
																) : null}
															</>
														)}
													</QueueActions>
												</div>
											</td>
										</tr>
										{isExpanded ? (
											<tr id={detailsId} className={styles.detailsRow}>
												<td colSpan={completedView ? 5 : 8}>
													<dl className={styles.details}>
														<div>
															<dt>Job ID</dt>
															<dd className={styles.mono}>{job.id}</dd>
														</div>
														<div>
															<dt>Source ID</dt>
															<dd className={styles.mono}>
																{job.context?.sourceId ?? "Não informado"}
															</dd>
														</div>
														<div>
															<dt>Sessão</dt>
															<dd>
																{job.context?.sessionId ?? "Não informada"}
															</dd>
														</div>
														<div>
															<dt>Profile</dt>
															<dd>{profile}</dd>
														</div>
														<div>
															<dt>Attempt</dt>
															<dd>{job.attempt}</dd>
														</div>
														<div>
															<dt>Etapa</dt>
															<dd>{stageLabels[job.stage] ?? job.stage}</dd>
														</div>
														<div>
															<dt>Atualizado</dt>
															<dd>{exactUpdated(job.updated_at)}</dd>
														</div>
														<div>
															<dt>Tipo</dt>
															<dd>{job.kind}</dd>
														</div>
														{job.error ? (
															<div className={styles.detailWide}>
																<dt>Erro</dt>
																<dd>
																	{error}{" "}
																	<span className={styles.mono}>
																		({job.error.code})
																	</span>
																	{job.error.recoverable
																		? " · retry disponível"
																		: " · não recuperável"}
																</dd>
															</div>
														) : null}
													</dl>
												</td>
											</tr>
										) : null}
									</Fragment>
								);
							})}
						</tbody>
					</table>
				</div>
			) : (
				<div className={styles.empty} role="status">
					<strong>Nenhum trabalho neste recorte.</strong>
					<span>
						{query
							? "A busca não encontrou sessão, profile, source ou ID neste filtro."
							: filter === "active"
								? "Não há trabalhos processando ou aguardando execução."
								: filter === "attention"
									? "Não há falhas ou interrupções que precisem de atenção."
									: "Escolha outro filtro para consultar o histórico local."}
					</span>
				</div>
			)}
		</div>
	);
}
