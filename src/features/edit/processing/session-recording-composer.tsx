"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalBridge } from "./bridge";
import {
	BridgeError,
	type Capabilities,
	type LocalJob,
	type LocalRunSummary,
	type SessionParticipantMapping,
	type SessionWorkspace,
	type SessionWorkspacePart,
	type TranscriptionProfileId,
} from "./protocol";
import styles from "./session-recording-composer.module.css";

type Props = Readonly<{
	bridge: LocalBridge;
	capabilities: Capabilities | null;
	workspace: SessionWorkspace | null;
	profileId: TranscriptionProfileId | "";
	jobs: readonly LocalJob[];
	runs: readonly LocalRunSummary[];
	busy?: boolean;
	onWorkspaceChange: (workspace: SessionWorkspace) => void;
	onQueueSource: (sourceId: string) => Promise<void>;
	onAssemblyBuilt: (sessionId: string, assemblyId: string) => void;
}>;

function formatSeconds(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "—";
	const total = Math.round(value);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	return hours
		? `${hours}h ${String(minutes).padStart(2, "0")}m`
		: minutes
			? `${minutes}m ${String(seconds).padStart(2, "0")}s`
			: `${seconds}s`;
}

function formatOffset(value: number | null): string {
	if (value === null) return "sem posição";
	return `+${formatSeconds(value)}`;
}

function relationLabel(part: SessionWorkspacePart): string {
	if (part.relationToPrevious === "first") return "início da sessão";
	if (part.relationToPrevious === "contiguous") return "contínua";
	if (part.relationToPrevious === "gap")
		return `gap ${formatSeconds(part.relationSeconds)}`;
	if (part.relationToPrevious === "overlap")
		return `overlap ${formatSeconds(part.relationSeconds)}`;
	if (part.relationToPrevious === "order_conflict") return "ordem em conflito";
	return "relação ainda desconhecida";
}

function timelineCopy(workspace: SessionWorkspace): string {
	const state = workspace.timeline.state;
	if (state === "ready") return "Cronologia pronta para assembly.";
	if (state === "needs_timing")
		return workspace.timeline.automaticOrderAvailable
			? "Os timestamps permitem derivar ordem e posição automaticamente."
			: "Defina a ordem e o início das gravações na sessão.";
	if (state === "gap_unconfirmed")
		return "Há um intervalo real entre gravações. Confirme o gap para preservar o silêncio.";
	if (state === "overlap_unresolved")
		return "Há gravações sobrepostas. Escolha explicitamente qual lado possui cada trecho.";
	if (state === "order_conflict")
		return "A ordem atual contradiz a cronologia. Reordene antes de montar a sessão.";
	return "Uma fonte da sessão está inválida e precisa ser reparada.";
}

function operationMessage(cause: unknown): string {
	if (!(cause instanceof BridgeError))
		return "O Companion não concluiu a operação da sessão.";
	const code = cause.serverCode;
	return {
		SESSION_WORKSPACE_REVISION_CONFLICT:
			"A sessão mudou em outra ação. O estado foi recarregado; repita a operação.",
		SESSION_WORKSPACE_SOURCE_ALREADY_ATTACHED:
			"Esta gravação já faz parte da sessão.",
		SESSION_WORKSPACE_TIMELINE_NOT_READY:
			"A cronologia ainda precisa ser resolvida.",
		SESSION_ASSEMBLY_PART_INVALID:
			"Escolha um resultado concluído para cada gravação antes de montar.",
		SESSION_ASSEMBLY_TIMELINE_NOT_READY:
			"Resolva a cronologia antes de montar a transcrição.",
		SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INCOMPLETE:
			"Resolva os participantes ambíguos antes de montar a sessão.",
		SESSION_ASSEMBLY_RUN_INVALID:
			"Um resultado selecionado não está mais íntegro. Escolha outro run.",
	}[code ?? ""] ?? (code ? `Operação bloqueada · ${code}` : "Falha ao conversar com o Companion.");
}

function latestJobFor(
	jobs: readonly LocalJob[],
	sessionId: string,
	sourceId: string,
): LocalJob | null {
	return (
		jobs
			.filter(
				(job) =>
					job.context?.sessionId === sessionId &&
					job.context?.sourceId === sourceId &&
					job.kind === "transcription.craig",
			)
			.sort(
				(left, right) =>
					Date.parse(right.updated_at) - Date.parse(left.updated_at),
			)[0] ?? null
	);
}

function jobLabel(job: LocalJob | null): string {
	if (!job) return "sem trabalho recente";
	return {
		queued: "na fila",
		running: "processando",
		succeeded: "processado",
		failed: job.error?.recoverable ? "falhou · pode repetir" : "falhou",
		cancelled: "cancelado",
		interrupted: "interrompido · pode repetir",
	}[job.status];
}

function participantForObservation(
	mapping: SessionParticipantMapping,
	observationId: string,
): string | null {
	return (
		mapping.participants.find((participant) =>
			participant.observationIds.includes(observationId),
		)?.participantId ?? null
	);
}

export function SessionRecordingComposer({
	bridge,
	capabilities,
	workspace,
	profileId,
	jobs,
	runs,
	busy = false,
	onWorkspaceChange,
	onQueueSource,
	onAssemblyBuilt,
}: Props) {
	const [participants, setParticipants] =
		useState<SessionParticipantMapping | null>(null);
	const [participantDraft, setParticipantDraft] = useState<Record<string, string>>({});
	const [timingDraft, setTimingDraft] = useState<Record<string, string>>({});
	const [working, setWorking] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const supportsWorkspace =
		capabilities?.capabilities.includes("transcription.session-workspace") === true;
	const supportsTimeline =
		capabilities?.capabilities.includes("transcription.session-timeline") === true;
	const supportsParticipants =
		capabilities?.capabilities.includes("transcription.session-participants") === true;
	const supportsAssembly =
		capabilities?.capabilities.includes("transcription.session-assembly") === true;

	useEffect(() => {
		if (!workspace || !supportsParticipants || workspace.parts.length === 0) {
			setParticipants(null);
			setParticipantDraft({});
			return;
		}
		const controller = new AbortController();
		void bridge
			.sessionParticipants(
				workspace.campaignId,
				workspace.sessionId,
				controller.signal,
			)
			.then((value) => {
				if (controller.signal.aborted) return;
				setParticipants(value);
				const next: Record<string, string> = {};
				for (const conflict of value.conflicts.filter(
					(item) => item.requiresResolution,
				)) {
					for (const observationId of conflict.observationIds) {
						const participantId = participantForObservation(value, observationId);
						if (participantId) next[observationId] = participantId;
					}
				}
				setParticipantDraft(next);
				setError(null);
			})
			.catch((cause) => {
				if (!controller.signal.aborted) setError(operationMessage(cause));
			});
		return () => controller.abort();
	}, [
		bridge,
		supportsParticipants,
		workspace?.campaignId,
		workspace?.sessionId,
		workspace?.revision,
	]);

	const runsBySource = useMemo(() => {
		const map = new Map<string, LocalRunSummary[]>();
		for (const run of runs) {
			const values = map.get(run.sourceId) ?? [];
			values.push(run);
			map.set(run.sourceId, values);
		}
		for (const values of map.values())
			values.sort(
				(left, right) =>
					Date.parse(right.completedAt ?? "1970-01-01") -
					Date.parse(left.completedAt ?? "1970-01-01"),
			);
		return map;
	}, [runs]);

	if (!supportsWorkspace || !workspace || workspace.parts.length === 0) return null;

	const blockingConflicts =
		participants?.conflicts.filter((conflict) => conflict.requiresResolution) ?? [];
	const allSelected = workspace.parts.every((part) => part.selectedRunId !== null);
	const sourcesReady = workspace.parts.every((part) => part.sourceState === "ready");
	const assemblyReady =
		supportsAssembly &&
		workspace.timeline.state === "ready" &&
		allSelected &&
		sourcesReady &&
		participants !== null &&
		!participants.approvalBlocked;
	const missingParts = workspace.parts.filter((part) => {
		const sourceRuns = runsBySource.get(part.sourceId) ?? [];
		const job = latestJobFor(jobs, workspace.sessionId, part.sourceId);
		return (
			sourceRuns.length === 0 &&
			job?.status !== "queued" &&
			job?.status !== "running"
		);
	});

	const activeWorkspace = workspace;

	async function mutate(
		key: string,
		operation: () => Promise<SessionWorkspace>,
		message: string,
	) {
		if (working || busy) return;
		setWorking(key);
		setError(null);
		try {
			const next = await operation();
			onWorkspaceChange(next);
			setStatus(message);
		} catch (cause) {
			setError(operationMessage(cause));
			if (
				cause instanceof BridgeError &&
				cause.serverCode === "SESSION_WORKSPACE_REVISION_CONFLICT"
			) {
				try {
					onWorkspaceChange(
						await bridge.sessionWorkspace(
							activeWorkspace.campaignId,
							activeWorkspace.sessionId,
							new AbortController().signal,
						),
					);
				} catch {
					// The actionable conflict copy above remains visible.
				}
			}
		} finally {
			setWorking(null);
		}
	}

	async function reorder(part: SessionWorkspacePart, delta: -1 | 1) {
		const nextIndex = part.ordinal + delta;
		if (nextIndex < 0 || nextIndex >= activeWorkspace.parts.length) return;
		const ids = activeWorkspace.parts.map((item) => item.partId);
		const [moved] = ids.splice(part.ordinal, 1);
		if (!moved) return;
		ids.splice(nextIndex, 0, moved);
		await mutate(
			`reorder:${part.partId}`,
			() =>
				bridge.reorderSessionParts(
					activeWorkspace.campaignId,
					activeWorkspace.sessionId,
					ids,
					activeWorkspace.revision,
					new AbortController().signal,
				),
			"Ordem da sessão atualizada.",
		);
	}

	async function saveOffset(part: SessionWorkspacePart) {
		const raw = timingDraft[part.partId] ?? String(part.sessionOffsetSeconds ?? 0);
		const offset = Number(raw);
		if (!Number.isFinite(offset) || offset < 0) {
			setError("Use um início em segundos igual ou maior que zero.");
			return;
		}
		await mutate(
			`timing:${part.partId}`,
			() =>
				bridge.updateSessionPartTiming(
					activeWorkspace.campaignId,
					activeWorkspace.sessionId,
					{
						partId: part.partId,
						expectedRevision: activeWorkspace.revision,
						sessionOffsetSeconds: offset,
						trimStartSeconds: part.trimStartSeconds,
						trimEndSeconds: part.trimEndSeconds,
					},
					new AbortController().signal,
				),
			"Posição manual preservada no workspace.",
		);
	}

	async function confirmGap(part: SessionWorkspacePart) {
		if (part.sessionOffsetSeconds === null) return;
		await mutate(
			`gap:${part.partId}`,
			() =>
				bridge.updateSessionPartTiming(
					activeWorkspace.campaignId,
					activeWorkspace.sessionId,
					{
						partId: part.partId,
						expectedRevision: activeWorkspace.revision,
						sessionOffsetSeconds: part.sessionOffsetSeconds as number,
						trimStartSeconds: part.trimStartSeconds,
						trimEndSeconds: part.trimEndSeconds,
						gapConfirmed: true,
					},
					new AbortController().signal,
				),
			"Gap confirmado sem deslocar ou inventar áudio.",
		);
	}

	async function resolveOverlap(
		part: SessionWorkspacePart,
		strategy: "prefer_earlier_until" | "prefer_later_from",
	) {
		if (part.sessionOffsetSeconds === null || part.effectiveStartSeconds === null)
			return;
		const previous = activeWorkspace.parts[part.ordinal - 1];
		if (!previous || previous.effectiveEndSeconds === null || part.effectiveEndSeconds === null)
			return;
		const boundary =
			strategy === "prefer_later_from"
				? Math.max(part.effectiveStartSeconds, previous.effectiveStartSeconds ?? 0)
				: Math.min(previous.effectiveEndSeconds, part.effectiveEndSeconds);
		await mutate(
			`overlap:${part.partId}`,
			() =>
				bridge.updateSessionPartTiming(
					activeWorkspace.campaignId,
					activeWorkspace.sessionId,
					{
						partId: part.partId,
						expectedRevision: activeWorkspace.revision,
						sessionOffsetSeconds: part.sessionOffsetSeconds as number,
						trimStartSeconds: part.trimStartSeconds,
						trimEndSeconds: part.trimEndSeconds,
						overlapResolution: strategy,
						overlapBoundarySeconds: boundary,
					},
					new AbortController().signal,
				),
			"Overlap resolvido com boundary explícito.",
		);
	}

	async function resolveParticipants() {
		if (!participants || working || busy) return;
		const requiredObservationIds = new Set(
			participants.conflicts
				.filter((conflict) => conflict.requiresResolution)
				.flatMap((conflict) => conflict.observationIds),
		);
		if (requiredObservationIds.size === 0) {
			setError(
				"Este conflito não possui identidade suficiente para uma decisão manual segura. Repare ou reimporte a fonte.",
			);
			return;
		}
		const merged = new Map(
			participants.manualAssignments.map((item) => [
				item.observationId,
				item.participantId,
			]),
		);
		for (const observationId of requiredObservationIds) {
			const participantId = participantDraft[observationId];
			if (!participantId) {
				setError("Escolha um participante para cada observação ambígua.");
				return;
			}
			merged.set(observationId, participantId);
		}
		setWorking("participants");
		setError(null);
		try {
			const next = await bridge.updateSessionParticipants(
				activeWorkspace.campaignId,
				activeWorkspace.sessionId,
				activeWorkspace.revision,
				[...merged.entries()].map(([observationId, participantId]) => ({
					observationId,
					participantId,
				})),
				new AbortController().signal,
			);
			setParticipants(next);
			setStatus(
				next.approvalBlocked
					? "Mapeamento salvo, mas ainda há conflitos que exigem atenção."
					: "Participantes reconciliados para esta sessão.",
			);
		} catch (cause) {
			setError(operationMessage(cause));
		} finally {
			setWorking(null);
		}
	}

	async function processMissing() {
		if (!profileId || working || busy || missingParts.length === 0) return;
		setWorking("missing");
		setError(null);
		try {
			for (const part of missingParts) await onQueueSource(part.sourceId);
			setStatus(
				`${missingParts.length} gravação(ões) pendente(s) enviada(s) à fila sem reenviar resultados existentes.`,
			);
		} catch (cause) {
			setError(operationMessage(cause));
		} finally {
			setWorking(null);
		}
	}

	async function buildAssembly() {
		if (!assemblyReady || working || busy) return;
		setWorking("assembly");
		setError(null);
		try {
			const assembly = await bridge.buildSessionAssembly(
				activeWorkspace.campaignId,
				activeWorkspace.sessionId,
				activeWorkspace.revision,
				new AbortController().signal,
			);
			setStatus(
				`Transcrição da sessão montada · ${assembly.segmentCount} segmentos · ${assembly.assemblyId.slice(0, 10)}…`,
			);
			onAssemblyBuilt(activeWorkspace.sessionId, assembly.assemblyId);
		} catch (cause) {
			setError(operationMessage(cause));
		} finally {
			setWorking(null);
		}
	}

	return (
		<section
			className={styles.composer}
			aria-labelledby="session-recording-composer"
			data-session-recording-composer="true"
			data-part-count={activeWorkspace.parts.length}
		>
			<header className={styles.header}>
				<div>
					<span className={styles.eyebrow}>Sessão persistida</span>
					<h3 id="session-recording-composer">{activeWorkspace.sessionId}</h3>
				</div>
				<div className={styles.headerMeta}>
					<strong>{activeWorkspace.parts.length} gravação(ões)</strong>
					<span>rev {activeWorkspace.revision}</span>
				</div>
			</header>

			{activeWorkspace.parts.length > 1 ? (
				<div className={styles.timelineSummary} data-state={activeWorkspace.timeline.state}>
					<strong>{timelineCopy(workspace)}</strong>
					<span>
						{activeWorkspace.timeline.gapCount} gap(s) · {activeWorkspace.timeline.overlapCount} overlap(s)
					</span>
					{supportsTimeline &&
					activeWorkspace.timeline.state === "needs_timing" &&
					activeWorkspace.timeline.automaticOrderAvailable ? (
						<Button
							size="sm"
							variant="secondary"
							disabled={Boolean(working) || busy}
							onClick={() =>
								void mutate(
									"derive",
									() =>
										bridge.deriveSessionTimeline(
											activeWorkspace.campaignId,
											activeWorkspace.sessionId,
											activeWorkspace.revision,
											new AbortController().signal,
										),
									"Cronologia derivada a partir dos timestamps confiáveis.",
								)
							}
						>
							Derivar ordem e tempos
						</Button>
					) : null}
				</div>
		) : null}

		<ol className={styles.parts} aria-label="Gravações da sessão">
			{activeWorkspace.parts.map((part) => {
				const sourceRuns = runsBySource.get(part.sourceId) ?? [];
				const selectedRun = sourceRuns.find((run) => run.runId === part.selectedRunId);
				const job = latestJobFor(jobs, activeWorkspace.sessionId, part.sourceId);
				const active = job?.status === "queued" || job?.status === "running";
				return (
					<li key={part.partId} className={styles.part} data-source-state={part.sourceState}>
						<div className={styles.partLead}>
							<span className={styles.ordinal}>{part.ordinal + 1}</span>
							<div>
								<strong>Gravação {part.ordinal + 1}</strong>
								<code title={part.sourceId}>{part.sourceId.slice(0, 18)}…</code>
							</div>
						</div>
						<div className={styles.partFacts}>
							<span>{formatOffset(part.sessionOffsetSeconds)}</span>
							<span>{formatSeconds(part.sourceDurationSeconds)}</span>
							<span>{relationLabel(part)}</span>
							<span data-job-status={job?.status ?? "idle"}>{jobLabel(job)}</span>
						</div>

						<div className={styles.partActions}>
							<Button
								size="sm"
								variant="tertiary"
								aria-label={`Mover gravação ${part.ordinal + 1} para cima`}
								disabled={part.ordinal === 0 || Boolean(working) || busy}
								onClick={() => void reorder(part, -1)}
							>
								↑
							</Button>
							<Button
								size="sm"
								variant="tertiary"
								aria-label={`Mover gravação ${part.ordinal + 1} para baixo`}
								disabled={
									part.ordinal === activeWorkspace.parts.length - 1 ||
									Boolean(working) ||
									busy
								}
								onClick={() => void reorder(part, 1)}
							>
								↓
							</Button>
							<Button
								size="sm"
								variant="tertiary"
								disabled={Boolean(working) || busy || active || !profileId}
								onClick={() => void onQueueSource(part.sourceId)}
							>
								{sourceRuns.length ? "Reprocessar" : "Processar"}
							</Button>
							<Button
								size="sm"
								variant="tertiary"
								disabled={Boolean(working) || busy || active}
								onClick={() => {
									if (
										!window.confirm(
											`Remover a gravação ${part.ordinal + 1} desta sessão? A fonte e seus runs locais serão preservados.`,
										)
									)
										return;
									void mutate(
										`detach:${part.partId}`,
										() =>
											bridge.detachSessionPart(
												activeWorkspace.campaignId,
												activeWorkspace.sessionId,
												part.partId,
												activeWorkspace.revision,
												new AbortController().signal,
											),
										"Gravação removida da sessão; source e runs foram preservados.",
									);
								}}
							>
								Remover
							</Button>
						</div>

						{supportsTimeline &&
						activeWorkspace.parts.length > 1 &&
						(part.timelineMode === "unresolved" ||
							activeWorkspace.timeline.state === "needs_timing") ? (
							<div className={styles.inlineDecision}>
								<label>
									<span>Início na sessão (segundos)</span>
									<input
										type="number"
										min="0"
										step="0.001"
										value={
											timingDraft[part.partId] ??
											String(part.sessionOffsetSeconds ?? (part.ordinal === 0 ? 0 : ""))
										}
										onChange={(event) =>
											setTimingDraft((current) => ({
												...current,
												[part.partId]: event.target.value,
											}))
										}
									/>
								</label>
								<Button
									size="sm"
									variant="secondary"
									disabled={Boolean(working) || busy}
									onClick={() => void saveOffset(part)}
								>
									Definir início
								</Button>
							</div>
						) : null}

						{part.relationToPrevious === "gap" && !part.gapConfirmed ? (
							<div className={styles.conflict} role="status">
								<span>
									Gap de {formatSeconds(part.relationSeconds)} será preservado como silêncio.
								</span>
								<Button
									size="sm"
									variant="secondary"
									disabled={Boolean(working) || busy}
									onClick={() => void confirmGap(part)}
								>
									Confirmar gap
								</Button>
							</div>
						) : null}

						{part.relationToPrevious === "overlap" && !part.overlapResolutionValid ? (
							<div className={styles.conflict} role="alert">
								<span>
									Overlap de {formatSeconds(part.relationSeconds)}. Não há dedupe textual automático.
								</span>
								<div>
									<Button
										size="sm"
										variant="secondary"
										disabled={Boolean(working) || busy}
										onClick={() => void resolveOverlap(part, "prefer_earlier_until")}
									>
										Manter anterior no overlap
									</Button>
									<Button
										size="sm"
										variant="secondary"
										disabled={Boolean(working) || busy}
										onClick={() => void resolveOverlap(part, "prefer_later_from")}
									>
										Usar esta gravação no overlap
									</Button>
								</div>
							</div>
						) : null}

						<div className={styles.runRow}>
							<label>
								<span>Resultado usado na sessão</span>
								<select
									value={part.selectedRunId ?? ""}
									disabled={Boolean(working) || busy || sourceRuns.length === 0}
									onChange={(event) => {
										const runId = event.target.value;
										if (!runId) return;
										void mutate(
											`run:${part.partId}`,
											() =>
												bridge.selectSessionPartRun(
													activeWorkspace.campaignId,
													activeWorkspace.sessionId,
													part.partId,
													runId,
													activeWorkspace.revision,
													new AbortController().signal,
												),
											"Resultado selecionado somente para esta gravação.",
										);
									}}
								>
									<option value="">
										{sourceRuns.length ? "Escolher run…" : "Nenhum resultado concluído"}
									</option>
									{sourceRuns.map((run) => (
										<option key={run.runId} value={run.runId}>
											{run.profileId} · {run.runId.slice(0, 12)}…
										</option>
									))}
								</select>
							</label>
							{selectedRun ? (
								<small>
									{selectedRun.engine ?? "engine"} · SHA {selectedRun.transcriptSha256.slice(0, 10)}…
								</small>
							) : null}
						</div>
					</li>
				);
			})}
		</ol>

		{supportsParticipants && participants && blockingConflicts.length > 0 ? (
			<details className={styles.participants} open>
				<summary>
					Participantes precisam de decisão · {blockingConflicts.length} conflito(s)
				</summary>
				<p>
					Track number não é identidade entre gravações. Confirme quem é quem antes da assembly.
				</p>
				{blockingConflicts.map((conflict, index) => (
					<div key={`${conflict.code}:${index}`} className={styles.participantConflict}>
						<strong>{conflict.code.replaceAll("_", " ")}</strong>
						{conflict.observationIds.length === 0 ? (
							<span>Fonte sem identidade suficiente. Reimporte ou repare a gravação.</span>
						) : (
							conflict.observationIds.map((observationId) => {
								const observation = participants.observations.find(
									(item) => item.observationId === observationId,
								);
								if (!observation) return null;
								return (
									<label key={observationId}>
										<span>
											Gravação {observation.partOrdinal + 1} · track {observation.trackNumber} · {observation.rawSpeaker}
										</span>
										<select
											value={participantDraft[observationId] ?? ""}
											onChange={(event) =>
												setParticipantDraft((current) => ({
													...current,
													[observationId]: event.target.value,
												}))
											}
										>
											<option value="">Escolher participante…</option>
											{participants.participants.map((participant) => (
												<option key={participant.participantId} value={participant.participantId}>
													{participant.displaySpeaker}
												</option>
											))}
										</select>
									</label>
								);
							})
						)}
					</div>
				))}
				<Button
					size="sm"
					variant="secondary"
					disabled={Boolean(working) || busy}
					onClick={() => void resolveParticipants()}
				>
					Salvar reconciliação
				</Button>
			</details>
		) : supportsParticipants && participants ? (
			<p className={styles.ok} role="status">
				Participantes reconciliados · {participants.participants.length} participante(s).
			</p>
		) : null}

		<footer className={styles.footer}>
			<div>
				<strong>
					{assemblyReady
						? "Sessão pronta para montar"
						: "A sessão ainda possui requisitos pendentes"}
				</strong>
				<span>
					{!allSelected
						? "Escolha um run por gravação. "
						: ""}
					{activeWorkspace.timeline.state !== "ready"
						? "Resolva a cronologia. "
						: ""}
					{participants?.approvalBlocked ? "Resolva participantes. " : ""}
				</span>
			</div>
			<div className={styles.footerActions}>
				{missingParts.length > 0 ? (
					<Button
						size="sm"
						variant="secondary"
						disabled={Boolean(working) || busy || !profileId}
						onClick={() => void processMissing()}
					>
						{working === "missing"
							? "Enviando pendentes…"
							: `Processar pendentes (${missingParts.length})`}
					</Button>
				) : null}
				<Button
					variant="primary"
					disabled={!assemblyReady || Boolean(working) || busy}
					onClick={() => void buildAssembly()}
				>
					{working === "assembly"
						? "Montando…"
						: "Montar transcrição da sessão"}
				</Button>
			</div>
		</footer>

		{status ? <p className={styles.status} role="status">{status}</p> : null}
		{error ? <p className={styles.error} role="alert">{error}</p> : null}
	</section>
	);
}
