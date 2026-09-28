"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { LocalBridge } from "./bridge";
import {
	latestJobForSource,
	moveSessionPart,
	partRelationLabel,
	partStatusLabel,
	pendingSourceIds,
	runsForPart,
	sessionAssemblyReadiness,
	supportsSessionComposer,
} from "./session-composer-model";
import type {
	SessionAssembly,
	SessionAssemblyListItem,
	SessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import type {
	BridgeError,
	CraigSource,
	LocalJob,
	LocalRunSummary,
	SessionParticipantMapping,
	SessionWorkspace,
	SessionWorkspacePart,
	TranscriptionProfileId,
} from "./protocol";
import styles from "./session-composer.module.css";

const RECOVERY_KEY = "tda.processing.session-composer.v1";

type Props = Readonly<{
	bridge: LocalBridge;
	capabilities: readonly string[];
	sessionId: string;
	currentSource: CraigSource | null;
	profile: TranscriptionProfileId | "";
	context: string;
	glossary: string;
	profileReady: boolean;
	disabled?: boolean;
	onActiveChange?: (active: boolean) => void;
	onRestoreSessionId?: (sessionId: string) => void;
	onStatus?: (message: string) => void;
	onError?: (message: string) => void;
}>;

function validSessionId(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function errorMessage(cause: unknown): string {
	if (!(cause instanceof BridgeError))
		return "A composição local não foi concluída.";
	const code = cause.serverCode ?? cause.code;
	return {
		SESSION_WORKSPACE_REVISION_CONFLICT:
			"A sessão mudou em outra aba ou processo. O estado foi recarregado; repita a ação sobre a revisão atual.",
		SESSION_WORKSPACE_SOURCE_EXISTS:
			"Esta gravação já faz parte da sessão.",
		SESSION_WORKSPACE_SOURCE_UNAVAILABLE:
			"A gravação local não está disponível ou perdeu integridade.",
		SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS:
			"Os horários não estabelecem uma ordem segura. Use os botões de ordem e informe o início manualmente.",
		SESSION_WORKSPACE_TIMELINE_ORDER_COLLISION:
			"Os horários colidem e não autorizam ordem automática. Confirme a ordem manualmente.",
		SESSION_WORKSPACE_OVERLAP_BOUNDARY_INVALID:
			"O corte precisa ficar dentro do overlap real entre as duas gravações.",
		SESSION_ASSEMBLY_TIMELINE_NOT_READY:
			"Resolva ordem, gaps e overlaps antes de montar a transcrição da sessão.",
		SESSION_ASSEMBLY_PART_INVALID:
			"Cada gravação precisa ter exatamente um resultado selecionado.",
		SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID:
			"O mapa de participantes não passou na validação local.",
		SESSION_ASSEMBLY_SOURCE_UNAVAILABLE:
			"Uma gravação da sessão não está mais disponível no armazenamento local.",
		SESSION_ASSEMBLY_RUN_INVALID:
			"O resultado selecionado não passou na verificação de integridade.",
		SESSION_ASSEMBLY_RUN_NOT_VISIBLE:
			"O resultado selecionado não está mais elegível para a assembly.",
		conflict:
			"A operação conflitou com uma alteração mais nova. Recarregue o composer e tente novamente.",
		timeout:
			"O Companion demorou demais para responder. O workspace persistido foi preservado.",
		unreachable:
			"O Companion ficou indisponível. O workspace persistido foi preservado.",
	}[code] ?? ("Operação local não concluída · " + code);
}

function short(value: string | null | undefined, size = 10): string {
	return value ? value.slice(0, size) + "…" : "—";
}

function formatSeconds(value: number | null): string {
	if (value === null) return "—";
	const seconds = Math.max(0, Math.round(value));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	if (hours) return hours + "h " + String(minutes).padStart(2, "0") + "m";
	if (minutes) return minutes + "m " + String(rest).padStart(2, "0") + "s";
	return rest + "s";
}

function partTime(part: SessionWorkspacePart): string {
	if (part.effectiveStartSeconds === null || part.effectiveEndSeconds === null)
		return "posição temporal pendente";
	return (
		formatSeconds(part.effectiveStartSeconds) +
		" → " +
		formatSeconds(part.effectiveEndSeconds)
	);
}

export function SessionRecordingComposer({
	bridge,
	capabilities,
	sessionId,
	currentSource,
	profile,
	context,
	glossary,
	profileReady,
	disabled = false,
	onActiveChange,
	onRestoreSessionId,
	onStatus,
	onError,
}: Props) {
	const supported = supportsSessionComposer(capabilities);
	const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
	const [mapping, setMapping] = useState<SessionParticipantMapping | null>(null);
	const [runsBySource, setRunsBySource] = useState<
		ReadonlyMap<string, readonly LocalRunSummary[]>
	>(new Map());
	const [jobs, setJobs] = useState<readonly LocalJob[]>([]);
	const [assemblies, setAssemblies] = useState<readonly SessionAssemblyListItem[]>([]);
	const [lastAssembly, setLastAssembly] = useState<SessionAssembly | null>(null);
	const [review, setReview] = useState<SessionAssemblyReviewSummary | null>(null);
	const [busy, setBusy] = useState(false);
	const [live, setLive] = useState<string | null>(null);
	const [localError, setLocalError] = useState<string | null>(null);
	const [offsetDrafts, setOffsetDrafts] = useState<Record<string, string>>({});
	const [overlapDrafts, setOverlapDrafts] = useState<
		Record<string, { boundary: string; resolution: "prefer_earlier_until" | "prefer_later_from" }>
	>({});
	const [participantDrafts, setParticipantDrafts] = useState<Record<string, string>>({});
	const restored = useRef(false);

	const currentDuplicate =
		Boolean(currentSource) &&
		Boolean(workspace?.parts.some((part) => part.sourceId === currentSource?.sourceId));
	const readiness = useMemo(
		() => sessionAssemblyReadiness(workspace, mapping),
		[workspace, mapping],
	);
	const pending = useMemo(
		() => pendingSourceIds(workspace, runsBySource),
		[workspace, runsBySource],
	);

	function announce(message: string) {
		setLive(message);
		onStatus?.(message);
	}

	function fail(cause: unknown) {
		const message = errorMessage(cause);
		setLocalError(message);
		onError?.(message);
	}

	async function loadRelated(next: SessionWorkspace, signal: AbortSignal) {
		const runPairs = await Promise.all(
			next.parts.map(async (part) => [
				part.sourceId,
				await bridge.localRuns(part.sourceId, signal),
			] as const),
		);
		const [nextMapping, assemblyList, jobPage] = await Promise.all([
			bridge.sessionParticipants(next.campaignId, next.sessionId, signal),
			bridge.sessionAssemblies(next.campaignId, next.sessionId, signal),
			bridge.jobPage("all", signal, { limit: 200 }),
		]);
		if (signal.aborted) return;
		setRunsBySource(new Map(runPairs));
		setMapping(nextMapping);
		setAssemblies(assemblyList.assemblies);
		setJobs(jobPage.jobs);
	}

	async function adopt(next: SessionWorkspace, signal: AbortSignal) {
		setWorkspace(next);
		onActiveChange?.(next.parts.length > 0);
		try {
			window.localStorage.setItem(RECOVERY_KEY, next.sessionId);
		} catch {
			// Recovery is best-effort; the Agent workspace remains authoritative.
		}
		await loadRelated(next, signal);
	}

	async function reload(create = false) {
		if (!supported || !validSessionId(sessionId) || busy) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		try {
			const next = create
				? await bridge.ensureSessionWorkspace(CAMPAIGN_SLUG, sessionId, controller.signal)
				: await bridge.sessionWorkspace(CAMPAIGN_SLUG, sessionId, controller.signal);
			await adopt(next, controller.signal);
			announce("Composer da sessão recarregado.");
		} catch (cause) {
			if (
				cause instanceof BridgeError &&
				cause.serverCode === "SESSION_WORKSPACE_NOT_FOUND"
			) {
				setWorkspace(null);
				setMapping(null);
				setRunsBySource(new Map());
				setAssemblies([]);
				onActiveChange?.(false);
			} else {
				fail(cause);
			}
		} finally {
			setBusy(false);
		}
	}

	useEffect(() => {
		if (!supported || restored.current) return;
		restored.current = true;
		let saved: string | null = null;
		try {
			saved = window.localStorage.getItem(RECOVERY_KEY);
		} catch {
			saved = null;
		}
		if (!sessionId && saved && validSessionId(saved)) onRestoreSessionId?.(saved);
	}, [onRestoreSessionId, sessionId, supported]);

	useEffect(() => {
		if (!supported || !validSessionId(sessionId)) return;
		let saved: string | null = null;
		try {
			saved = window.localStorage.getItem(RECOVERY_KEY);
		} catch {
			saved = null;
		}
		if (saved !== sessionId) return;
		const controller = new AbortController();
		let cancelled = false;
		void (async () => {
			try {
				const next = await bridge.sessionWorkspace(
					CAMPAIGN_SLUG,
					sessionId,
					controller.signal,
				);
				if (!cancelled) await adopt(next, controller.signal);
			} catch (cause) {
				if (
					!cancelled &&
					!(
						cause instanceof BridgeError &&
						cause.serverCode === "SESSION_WORKSPACE_NOT_FOUND"
					)
				)
					fail(cause);
			}
		})();
		return () => {
			cancelled = true;
			controller.abort();
		};
		// This intentionally restores only the persisted workspace identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [bridge, sessionId, supported]);

	if (!supported) return null;

	async function attachCurrentSource() {
		if (!currentSource || !validSessionId(sessionId) || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		setReview(null);
		try {
			let next =
				workspace ??
				(await bridge.ensureSessionWorkspace(
					CAMPAIGN_SLUG,
					sessionId,
					controller.signal,
				));
			if (next.parts.some((part) => part.sourceId === currentSource.sourceId)) {
				await adopt(next, controller.signal);
				announce("Esta gravação já faz parte da sessão.");
				return;
			}
			next = await bridge.attachSessionSource(
				CAMPAIGN_SLUG,
				sessionId,
				currentSource.sourceId,
				next.revision,
				controller.signal,
			);
			await adopt(next, controller.signal);
			announce(
				next.parts.length === 1
					? "Gravação adicionada à sessão."
					: "Gravação " + next.parts.length + " adicionada sem apagar as anteriores.",
			);
		} catch (cause) {
			fail(cause);
			if (
				cause instanceof BridgeError &&
				cause.serverCode === "SESSION_WORKSPACE_REVISION_CONFLICT"
			)
				await reload(false);
		} finally {
			setBusy(false);
		}
	}

	async function mutate(
		action: (current: SessionWorkspace, signal: AbortSignal) => Promise<SessionWorkspace>,
		success: string,
	) {
		if (!workspace || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		setReview(null);
		try {
			const next = await action(workspace, controller.signal);
			await adopt(next, controller.signal);
			announce(success);
		} catch (cause) {
			fail(cause);
			if (
				cause instanceof BridgeError &&
				cause.serverCode === "SESSION_WORKSPACE_REVISION_CONFLICT"
			) {
				try {
					const next = await bridge.sessionWorkspace(
						CAMPAIGN_SLUG,
						sessionId,
						controller.signal,
					);
					await adopt(next, controller.signal);
				} catch {
					// Keep the original actionable conflict message.
				}
			}
		} finally {
			setBusy(false);
		}
	}

	async function reorder(part: SessionWorkspacePart, direction: -1 | 1) {
		if (!workspace) return;
		const ids = moveSessionPart(workspace.parts, part.partId, direction);
		if (ids.every((id, index) => id === workspace.parts[index]?.partId)) return;
		await mutate(
			(current, signal) =>
				bridge.reorderSessionParts(
					current.campaignId,
					current.sessionId,
					ids,
					current.revision,
					signal,
				),
			"Ordem das gravações atualizada.",
		);
	}

	async function deriveTimeline() {
		await mutate(
			(current, signal) =>
				bridge.deriveSessionTimeline(
					current.campaignId,
					current.sessionId,
					current.revision,
					signal,
				),
			"Cronologia recalculada a partir dos horários confiáveis.",
		);
	}

	async function saveOffset(part: SessionWorkspacePart) {
		const value = Number(offsetDrafts[part.partId] ?? part.sessionOffsetSeconds ?? 0);
		if (!Number.isFinite(value) || value < 0) {
			setLocalError("Informe um início manual em segundos igual ou maior que zero.");
			return;
		}
		await mutate(
			(current, signal) =>
				bridge.updateSessionPartTiming(
					current.campaignId,
					current.sessionId,
					{
						partId: part.partId,
						expectedRevision: current.revision,
						sessionOffsetSeconds: value,
						trimStartSeconds: part.trimStartSeconds,
						trimEndSeconds: part.trimEndSeconds,
						gapConfirmed: part.gapConfirmed,
						overlapResolution: part.overlapResolution,
						overlapBoundarySeconds: part.overlapBoundarySeconds,
					},
					signal,
				),
			"Posição temporal salva no workspace.",
		);
	}

	async function confirmGap(part: SessionWorkspacePart) {
		if (part.sessionOffsetSeconds === null) return;
		await mutate(
			(current, signal) =>
				bridge.updateSessionPartTiming(
					current.campaignId,
					current.sessionId,
					{
						partId: part.partId,
						expectedRevision: current.revision,
						sessionOffsetSeconds: part.sessionOffsetSeconds ?? 0,
						trimStartSeconds: part.trimStartSeconds,
						trimEndSeconds: part.trimEndSeconds,
						gapConfirmed: true,
						overlapResolution: part.overlapResolution,
						overlapBoundarySeconds: part.overlapBoundarySeconds,
					},
					signal,
				),
			"Gap confirmado sem aproximar artificialmente as gravações.",
		);
	}

	async function resolveOverlap(part: SessionWorkspacePart) {
		const draft = overlapDrafts[part.partId];
		const boundary = Number(draft?.boundary ?? part.overlapBoundarySeconds ?? "");
		if (!Number.isFinite(boundary) || boundary < 0 || part.sessionOffsetSeconds === null) {
			setLocalError("Informe um boundary em segundos dentro do overlap real.");
			return;
		}
		const resolution =
			draft?.resolution ?? part.overlapResolution ?? "prefer_later_from";
		await mutate(
			(current, signal) =>
				bridge.updateSessionPartTiming(
					current.campaignId,
					current.sessionId,
					{
						partId: part.partId,
						expectedRevision: current.revision,
						sessionOffsetSeconds: part.sessionOffsetSeconds ?? 0,
						trimStartSeconds: part.trimStartSeconds,
						trimEndSeconds: part.trimEndSeconds,
						gapConfirmed: part.gapConfirmed,
						overlapResolution: resolution,
						overlapBoundarySeconds: boundary,
					},
					signal,
				),
			"Overlap resolvido com boundary explícito.",
		);
	}

	async function selectRun(part: SessionWorkspacePart, runId: string) {
		if (!workspace || !runId) return;
		await mutate(
			(current, signal) =>
				bridge.selectSessionPartRun(
					current.campaignId,
					current.sessionId,
					part.partId,
					runId,
					current.revision,
					signal,
				),
			"Resultado selecionado somente para esta gravação.",
		);
	}

	async function detach(part: SessionWorkspacePart) {
		await mutate(
			(current, signal) =>
				bridge.detachSessionPart(
					current.campaignId,
					current.sessionId,
					part.partId,
					current.revision,
					signal,
				),
			"Gravação removida do workspace. A source e seus runs foram preservados.",
		);
	}

	async function saveParticipants() {
		if (!mapping || !workspace || busy || disabled) return;
		const assignments = new Map(
			mapping.manualAssignments.map((item) => [
				item.observationId,
				item.participantId,
			]),
		);
		for (const [observationId, participantId] of Object.entries(participantDrafts))
			if (participantId) assignments.set(observationId, participantId);
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		try {
			const next = await bridge.updateSessionParticipants(
				workspace.campaignId,
				workspace.sessionId,
				mapping.workspaceRevision,
				[...assignments.entries()].map(([observationId, participantId]) => ({
					observationId,
					participantId,
				})),
				controller.signal,
			);
			setMapping(next);
			setParticipantDrafts({});
			announce(
				next.approvalBlocked
					? "Decisão salva; ainda existem participantes ambíguos."
					: "Participantes reconciliados para esta sessão.",
			);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	async function processMissing() {
		if (
			!workspace ||
			!profile ||
			!profileReady ||
			pending.length === 0 ||
			busy ||
			disabled
		)
			return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		try {
			let queued = 0;
			for (const sourceId of pending) {
				await bridge.transcription(
					{
						campaignId: workspace.campaignId,
						sessionId: workspace.sessionId,
						sourceId,
						profileId: profile,
						glossary,
						context,
					},
					crypto.randomUUID(),
					controller.signal,
				);
				queued += 1;
			}
			announce(
				queued === 1
					? "1 gravação pendente entrou na fila."
					: queued + " gravações pendentes entraram na fila; parts com run foram ignoradas.",
			);
			await loadRelated(workspace, controller.signal);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	async function buildAssembly() {
		if (!workspace || !readiness.ready || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		setReview(null);
		try {
			const built = await bridge.buildSessionAssembly(
				workspace.campaignId,
				workspace.sessionId,
				workspace.revision,
				controller.signal,
			);
			setLastAssembly(built);
			const listing = await bridge.sessionAssemblies(
				workspace.campaignId,
				workspace.sessionId,
				controller.signal,
			);
			setAssemblies(listing.assemblies);
			announce(
				"Transcrição da sessão montada · " +
					built.segmentCount +
					" segmentos · assembly " +
					short(built.assemblyId, 12),
			);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	async function openReview(assemblyId: string) {
		if (!workspace || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		try {
			const value = await bridge.sessionAssemblyReviewBase(
				workspace.campaignId,
				workspace.sessionId,
				assemblyId,
				controller.signal,
			);
			setReview(value);
			announce(
				"Base de revisão da assembly carregada · " +
					value.segmentCount +
					" segmentos.",
			);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	function forgetComposer() {
		try {
			window.localStorage.removeItem(RECOVERY_KEY);
		} catch {
			// Only the browser recovery pointer is cleared.
		}
		setWorkspace(null);
		setMapping(null);
		setRunsBySource(new Map());
		setJobs([]);
		setAssemblies([]);
		setLastAssembly(null);
		setReview(null);
		onActiveChange?.(false);
		announce("Composer fechado. As gravações, runs e assemblies locais foram preservados.");
	}

	const unresolvedConflicts =
		mapping?.conflicts.filter((conflict) => conflict.requiresResolution) ?? [];

	return (
		<section className={styles.composer} aria-labelledby="session-composer-title">
			<div className={styles.header}>
				<div>
					<span>Composição da sessão</span>
					<h3 id="session-composer-title">
						{workspace?.parts.length
							? workspace.sessionId + " · " + workspace.parts.length + " gravação" + (workspace.parts.length === 1 ? "" : "ões")
							: "Uma sessão pode ter várias gravações"}
					</h3>
				</div>
				{workspace ? (
					<div className={styles.headerActions}>
						<Button type="button" size="sm" variant="tertiary" disabled={busy} onClick={() => void reload(false)}>
							Atualizar
						</Button>
						<Button type="button" size="sm" variant="tertiary" disabled={busy} onClick={forgetComposer}>
							Fechar composer
						</Button>
					</div>
				) : null}
			</div>

			{currentSource && validSessionId(sessionId) ? (
				<div className={styles.attachRow}>
					<div>
						<strong>{currentDuplicate ? "Esta gravação já faz parte da sessão." : "ZIP analisado e pronto para entrar nesta sessão."}</strong>
						<span>
							Fonte {short(currentSource.sourceId, 16)} · {currentSource.trackCount} tracks · {formatSeconds(currentSource.sessionDurationSeconds)}
						</span>
					</div>
					<Button
						type="button"
						size="sm"
						variant={currentDuplicate ? "tertiary" : "secondary"}
						disabled={busy || disabled || currentDuplicate}
						onClick={() => void attachCurrentSource()}
					>
						{currentDuplicate ? "Já adicionada" : workspace ? "+ Adicionar gravação" : "Usar composer da sessão"}
					</Button>
				</div>
			) : null}

			{workspace?.parts.length ? (
				<>
					{workspace.parts.length > 1 ? (
						<div className={styles.timelineSummary} data-state={workspace.timeline.state}>
							<div>
								<strong>Cronologia · {workspace.timeline.state}</strong>
								<span>
									{workspace.timeline.gapCount} gaps · {workspace.timeline.overlapCount} overlaps · {workspace.timeline.orderConflictCount} conflitos de ordem
								</span>
							</div>
							{workspace.timeline.automaticOrderAvailable && workspace.timeline.state !== "ready" ? (
								<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void deriveTimeline()}>
									Usar horários confiáveis
								</Button>
							) : null}
						</div>
					) : null}

					<ol className={styles.parts} aria-label="Gravações da sessão">
						{workspace.parts.map((part, index) => {
							const partRuns = runsForPart(runsBySource, part);
							const job = latestJobForSource(jobs, part.sourceId);
							const overlapDraft = overlapDrafts[part.partId] ?? {
								boundary:
									part.overlapBoundarySeconds === null
										? ""
										: String(part.overlapBoundarySeconds),
								resolution:
									part.overlapResolution ?? "prefer_later_from",
							};
							return (
								<li key={part.partId} className={styles.part}>
									<div className={styles.partMain}>
										<div className={styles.partIndex} aria-hidden="true">{index + 1}</div>
										<div className={styles.partCopy}>
											<strong>{partStatusLabel(part, partRuns, job)}</strong>
											<span>{partTime(part)} · {partRelationLabel(part)}</span>
											<small title={part.sourceId}>
												Fonte {short(part.sourceId, 16)}
												{job ? " · job " + short(job.id, 8) + " " + job.status : ""}
											</small>
										</div>
										<div className={styles.reorder} aria-label={"Ordenar gravação " + (index + 1)}>
											<Button type="button" size="sm" variant="tertiary" disabled={busy || index === 0} onClick={() => void reorder(part, -1)} aria-label={"Mover gravação " + (index + 1) + " para cima"}>
												↑
											</Button>
											<Button type="button" size="sm" variant="tertiary" disabled={busy || index === workspace.parts.length - 1} onClick={() => void reorder(part, 1)} aria-label={"Mover gravação " + (index + 1) + " para baixo"}>
												↓
											</Button>
										</div>
									</div>

									<div className={styles.partControls}>
										<label>
											<span>Run desta gravação</span>
											<select
												value={part.selectedRunId ?? ""}
												disabled={busy || partRuns.length === 0}
												onChange={(event) => void selectRun(part, event.target.value)}
											>
												<option value="">{partRuns.length ? "Selecionar resultado…" : "Nenhum run concluído"}</option>
												{partRuns.map((run) => (
													<option key={run.runId} value={run.runId}>
														{run.profileId} · {short(run.runId, 10)} · {run.completedAt ? new Date(run.completedAt).toLocaleString("pt-BR") : "data desconhecida"}
													</option>
												))}
											</select>
										</label>
										<details>
											<summary>Ajustar gravação</summary>
											<div className={styles.timingControls}>
												<label>
													<span>Início na sessão (s)</span>
													<input
														type="number"
														min="0"
														step="0.001"
														value={offsetDrafts[part.partId] ?? (part.sessionOffsetSeconds === null ? "" : String(part.sessionOffsetSeconds))}
														onChange={(event) => setOffsetDrafts((current) => ({ ...current, [part.partId]: event.target.value }))}
													/>
												</label>
												<Button type="button" size="sm" variant="tertiary" disabled={busy} onClick={() => void saveOffset(part)}>
													Salvar posição
												</Button>
												{part.relationToPrevious === "gap" && !part.gapConfirmed ? (
													<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void confirmGap(part)}>
														Confirmar gap de {Math.round(part.relationSeconds ?? 0)} s
													</Button>
												) : null}
												{part.relationToPrevious === "overlap" && !part.overlapResolutionValid ? (
													<div className={styles.overlapControls}>
														<label>
															<span>Regra do overlap</span>
															<select
																value={overlapDraft.resolution}
																onChange={(event) => setOverlapDrafts((current) => ({
																	...current,
																	[part.partId]: {
																		...overlapDraft,
																		resolution: event.target.value as "prefer_earlier_until" | "prefer_later_from",
																	},
																}))}
															>
																<option value="prefer_later_from">Usar gravação anterior até o corte; nova após o corte</option>
																<option value="prefer_earlier_until">Usar nova até o corte; anterior após o corte</option>
															</select>
														</label>
														<label>
															<span>Boundary na sessão (s)</span>
															<input
																type="number"
																min="0"
																step="0.001"
																value={overlapDraft.boundary}
																onChange={(event) => setOverlapDrafts((current) => ({
																	...current,
																	[part.partId]: { ...overlapDraft, boundary: event.target.value },
																}))}
															/>
														</label>
														<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void resolveOverlap(part)}>
															Resolver overlap
														</Button>
													</div>
												) : null}
												<Button type="button" size="sm" variant="tertiary" disabled={busy} onClick={() => void detach(part)}>
													Remover do workspace
												</Button>
											</div>
										</details>
									</div>
								</li>
							);
						})}
					</ol>

					{workspace.parts.length > 1 && mapping ? (
						<details className={styles.conflicts} open={unresolvedConflicts.length > 0}>
							<summary>
								Participantes · {mapping.participants.length}
								{unresolvedConflicts.length ? " · " + unresolvedConflicts.length + " conflito(s) a resolver" : " · reconciliados"}
							</summary>
							{unresolvedConflicts.length ? (
								<div className={styles.conflictList}>
									{unresolvedConflicts.map((conflict, index) => (
										<fieldset key={conflict.code + "-" + index}>
											<legend>{conflict.code.replaceAll("_", " ").toLocaleLowerCase("pt-BR")}</legend>
											{conflict.observationIds.map((observationId) => {
												const observation = mapping.observations.find((item) => item.observationId === observationId);
												return (
													<label key={observationId}>
														<span>{observation?.rawSpeaker ?? "Observação"} · gravação {(observation?.partOrdinal ?? 0) + 1}</span>
														<select
															value={participantDrafts[observationId] ?? mapping.manualAssignments.find((item) => item.observationId === observationId)?.participantId ?? ""}
															onChange={(event) => setParticipantDrafts((current) => ({ ...current, [observationId]: event.target.value }))}
														>
															<option value="">Escolher participante…</option>
															{mapping.participants.map((participant) => (
																<option key={participant.participantId} value={participant.participantId}>
																	{participant.displaySpeaker} · {participant.resolution}
																</option>
															))}
														</select>
													</label>
												);
											})}
										</fieldset>
									))}
									<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void saveParticipants()}>
										Salvar decisões de participantes
									</Button>
								</div>
							) : (
								<p>Nenhuma ambiguidade bloqueante entre as gravações.</p>
							)}
						</details>
					) : null}

					<div className={styles.actions}>
						<div>
							<strong>
								{pending.length
									? pending.length + " gravação" + (pending.length === 1 ? "" : "ões") + " sem run concluído"
									: "Todas as gravações possuem ao menos um run"}
							</strong>
							<span>
								{readiness.ready
									? "Tudo pronto para montar uma assembly imutável."
									: readiness.reasons.join(" ")}
							</span>
						</div>
						<div>
							{pending.length ? (
								<Button type="button" variant="secondary" disabled={busy || disabled || !profile || !profileReady} onClick={() => void processMissing()}>
									Processar pendentes ({pending.length})
								</Button>
							) : null}
							<Button type="button" variant="primary" disabled={busy || disabled || !readiness.ready} onClick={() => void buildAssembly()}>
								{busy ? "Trabalhando…" : "Montar transcrição da sessão"}
							</Button>
						</div>
					</div>

					{assemblies.length || lastAssembly ? (
						<div className={styles.assemblies}>
							<strong>Assemblies da sessão</strong>
							{assemblies.slice(0, 5).map((assembly) => (
								<div key={assembly.assemblyId}>
									<span>
										{assembly.partCount} parts · {assembly.segmentCount} segmentos · {short(assembly.assemblyId, 12)}
									</span>
									<Button type="button" size="sm" variant="tertiary" disabled={busy} onClick={() => void openReview(assembly.assemblyId)}>
										Abrir revisão
									</Button>
								</div>
							))}
						</div>
					) : null}

					{review ? (
						<div className={styles.reviewLoaded} role="status">
							<strong>Base da revisão carregada da assembly {short(review.assemblyId, 12)}</strong>
							<span>
								{review.segmentCount} segmentos · {review.reviewedSegments} revisados · estado {review.status}
								{review.approvalBlocked ? " · aprovação bloqueada por participantes" : ""}
							</span>
						</div>
					) : null}
				</>
			) : (
				<p className={styles.empty}>
					Para uma gravação, o fluxo acima continua igual. Use o composer somente quando quiser preservar 1..N gravações sob a mesma sessão.
				</p>
			)}

			{localError ? <p className={styles.error} role="alert">{localError}</p> : null}
			<p className={styles.live} role="status" aria-live="polite" aria-atomic="true">
				{live}
			</p>
		</section>
	);
}
