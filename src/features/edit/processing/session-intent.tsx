"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LocalBridge } from "./bridge";
import {
	latestJobForSource,
	sessionAssemblyReadiness,
} from "./session-composer-model";
import type {
	SessionAssembly,
	SessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import {
	confirmSessionComposerPendingSubmission,
	resolveSessionComposerPendingSubmission,
	SESSION_COMPOSER_CHANGE_EVENT,
	readSessionComposerRecoveryPointer,
	saveSessionComposerPointers,
	type SessionComposerPendingSubmission,
} from "./session-composer-storage";
import {
	chooseIntentRun,
	intentProgress,
	recordingVariantConflicts,
	retryableIntentJob,
	uniqueIntentSources,
} from "./session-intent-model";
import {
	createSessionIntentReceipt,
	loadSessionIntentReceipt,
	saveSessionIntentReceipt,
	sessionIntentReceiptIdentity,
	type SessionIntentReceipt,
	type SessionIntentReceiptIdentity,
	updateSessionIntentReceipt,
} from "./session-intent-storage";
import type {
	LocalJob,
	LocalRunSummary,
	SessionParticipantMapping,
	SessionWorkspace,
	TranscriptionProfileId,
} from "./protocol";
import { BridgeError } from "./protocol";
import { SessionAssemblyReview } from "./session-assembly-review";
import styles from "./session-intent.module.css";

export type SessionIntentSource = Readonly<{
	sourceId: string;
	label: string;
}>;

export type SessionTranscriptionIntent = Readonly<{
	id: string;
	sessionId: string;
	sources: readonly SessionIntentSource[];
	profile: TranscriptionProfileId;
	context: string;
	glossary: string;
}>;

type Blocker =
	| Readonly<{
			kind: "variant";
			sourceIds: readonly string[];
			recordingId: string;
	  }>
	| Readonly<{
			kind: "runs";
			sourceId: string;
			runIds: readonly string[];
	  }>
	| Readonly<{ kind: "timeline"; state: SessionWorkspace["timeline"]["state"] }>
	| Readonly<{ kind: "participants"; count: number }>
	| Readonly<{ kind: "failed"; sourceIds: readonly string[] }>
	| Readonly<{ kind: "enqueue"; sourceIds: readonly string[] }>
	| Readonly<{ kind: "resume"; sourceIds: readonly string[] }>
	| Readonly<{ kind: "source"; sourceIds: readonly string[] }>;

type Snapshot = Readonly<{
	workspace: SessionWorkspace;
	mapping: SessionParticipantMapping;
	runsBySource: ReadonlyMap<string, readonly LocalRunSummary[]>;
	jobs: readonly LocalJob[];
}>;

type Props = Readonly<{
	bridge: LocalBridge;
	campaignId: string;
	capabilities: readonly string[];
	request: SessionTranscriptionIntent | null;
	recoveryScope: string | null;
	disabled?: boolean;
	onActiveChange?: (active: boolean) => void;
	onRestoreSessionId?: (sessionId: string) => void;
	onRestoreIntent?: (intent: SessionTranscriptionIntent) => void;
	onStatus?: (message: string) => void;
	onError?: (message: string) => void;
	onOpenTechnical?: () => void;
}>;

function supported(capabilities: readonly string[]): boolean {
	return [
		"transcription.session-workspace",
		"transcription.session-intent",
		"transcription.session-timeline",
		"transcription.session-participants",
		"transcription.session-assembly",
		"transcription.session-assembly.review",
	].every((capability) => capabilities.includes(capability));
}

function validSessionId(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function errorMessage(cause: unknown): string {
	if (!(cause instanceof BridgeError))
		return "Não foi possível continuar a transcrição da sessão.";
	const code = cause.serverCode ?? cause.code;
	const messages: Record<string, string> = {
		SESSION_WORKSPACE_REVISION_CONFLICT:
			"A sessão mudou em outra aba. O TDA vai recarregar o estado antes de continuar.",
		SESSION_WORKSPACE_SOURCE_UNAVAILABLE:
			"Uma gravação local não está mais íntegra. Reimporte o ZIP correspondente.",
		SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS:
			"Não conseguimos provar a ordem de todas as gravações.",
		SESSION_WORKSPACE_TIMELINE_ORDER_COLLISION:
			"Dois horários colidem e não autorizam uma ordem automática.",
		SESSION_ASSEMBLY_TIMELINE_NOT_READY:
			"A cronologia ainda precisa de uma decisão antes de concluir a transcrição.",
		SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID:
			"Há um conflito de participante que precisa de decisão.",
		timeout:
			"O Companion demorou demais para responder. O estado já salvo foi preservado.",
		unreachable:
			"O Companion ficou indisponível. O estado já salvo foi preservado.",
	};
	return messages[code] ?? `Operação local não concluída · ${code}`;
}

function sourceLabel(
	sourceId: string,
	request: SessionTranscriptionIntent | null,
	workspace: SessionWorkspace | null,
): string {
	const requested = request?.sources.find((item) => item.sourceId === sourceId);
	if (requested) return requested.label;
	const index = workspace?.parts.findIndex((part) => part.sourceId === sourceId) ?? -1;
	return index >= 0 ? `Gravação ${index + 1}` : "Gravação";
}

function saveRecoveryPointer(campaignId: string, sessionId: string) {
	try {
		saveSessionComposerPointers(window.localStorage, campaignId, sessionId);
	} catch {
		// Browser storage is only a pointer. The Agent workspace remains authoritative.
	}
	window.dispatchEvent(new Event(SESSION_COMPOSER_CHANGE_EVENT));
}

export function SessionIntentCoordinator({
	bridge,
	campaignId,
	capabilities,
	request,
	recoveryScope,
	disabled = false,
	onActiveChange,
	onRestoreSessionId,
	onRestoreIntent,
	onStatus,
	onError,
	onOpenTechnical,
}: Props) {
	const enabled = supported(capabilities);
	const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
	const [mapping, setMapping] = useState<SessionParticipantMapping | null>(null);
	const [runsBySource, setRunsBySource] = useState<
		ReadonlyMap<string, readonly LocalRunSummary[]>
	>(new Map());
	const [jobs, setJobs] = useState<readonly LocalJob[]>([]);
	const [assembly, setAssembly] = useState<SessionAssembly | null>(null);
	const [review, setReview] = useState<SessionAssemblyReviewSummary | null>(null);
	const [activeRequest, setActiveRequest] =
		useState<SessionTranscriptionIntent | null>(null);
	const [blocker, setBlocker] = useState<Blocker | null>(null);
	const [busy, setBusy] = useState(false);
	const [live, setLive] = useState<string | null>(null);
	const [localError, setLocalError] = useState<string | null>(null);
	const processedRequest = useRef<string | null>(null);
	const advancing = useRef(false);
	const pendingSubmissions = useRef(
		new Map<string, SessionComposerPendingSubmission>(),
	);
	const intentEnqueueKeys = useRef(new Map<string, string>());
	const intentJobIds = useRef(new Map<string, string>());
	const intentRunIds = useRef(new Map<string, string>());
	const enqueueRecoveryBlocked = useRef(new Set<string>());
	const intentReceiptIdentity = useRef<SessionIntentReceiptIdentity | null>(null);
	const intentReceipt = useRef<SessionIntentReceipt | null>(null);
	const approvedVariantSources = useRef(new Set<string>());
	const excludedSources = useRef(new Set<string>());

	const announce = useCallback(
		(message: string) => {
			setLive(message);
			onStatus?.(message);
		},
		[onStatus],
	);
	const fail = useCallback(
		(cause: unknown) => {
			const message = errorMessage(cause);
			setLocalError(message);
			onError?.(message);
		},
		[onError],
	);

	const persistIntentReceipt = useCallback(
		(patch: Readonly<{
			enqueue?: Readonly<{ sourceId: string; key: string }>;
			job?: Readonly<{ sourceId: string; jobId: string }>;
			run?: Readonly<{ sourceId: string; runId: string }>;
		}>) => {
			const identity = intentReceiptIdentity.current;
			const current = intentReceipt.current;
			if (!identity || !current) return;
			const next = updateSessionIntentReceipt(current, patch);
			intentReceipt.current = next;
			try {
				saveSessionIntentReceipt(window.localStorage, identity, next);
			} catch {
				// Recovery metadata must never block the Agent-owned processing flow.
			}
		},
		[],
	);

	const loadSnapshot = useCallback(
		async (sessionId: string, signal: AbortSignal): Promise<Snapshot> => {
			const next = await bridge.sessionWorkspace(
				campaignId,
				sessionId,
				signal,
			);
			const runPairs = await Promise.all(
				next.parts.map(
					async (part) =>
						[
							part.sourceId,
							await bridge.localRuns(part.sourceId, signal),
						] as const,
				),
			);
			const [nextMapping, jobPage] = await Promise.all([
				bridge.sessionParticipants(next.campaignId, next.sessionId, signal),
				bridge.jobPage("all", signal, { limit: 200 }),
			]);
			const snapshot: Snapshot = {
				workspace: next,
				mapping: nextMapping,
				runsBySource: new Map(runPairs),
				jobs: jobPage.jobs,
			};
			if (!signal.aborted) {
				setWorkspace(snapshot.workspace);
				setMapping(snapshot.mapping);
				setRunsBySource(snapshot.runsBySource);
				setJobs(snapshot.jobs);
				onActiveChange?.(snapshot.workspace.parts.length > 0);
				saveRecoveryPointer(campaignId, snapshot.workspace.sessionId);
			}
			return snapshot;
		},
		[bridge, campaignId, onActiveChange],
	);

	const begin = useCallback(
		async (intent: SessionTranscriptionIntent) => {
			if (
				!enabled ||
				disabled ||
				busy ||
				!validSessionId(intent.sessionId) ||
				intent.sources.length === 0
			)
				return;
			const controller = new AbortController();
			setBusy(true);
			setLocalError(null);
			setBlocker(null);
			enqueueRecoveryBlocked.current.clear();
			setReview(null);
			setAssembly(null);
			setActiveRequest(intent);
			try {
				let next: SessionWorkspace;
				try {
					next = await bridge.sessionWorkspace(
						campaignId,
						intent.sessionId,
						controller.signal,
					);
				} catch (cause) {
					if (
						cause instanceof BridgeError &&
						cause.serverCode === "SESSION_WORKSPACE_NOT_FOUND"
					) {
						next = await bridge.ensureSessionWorkspace(
							campaignId,
							intent.sessionId,
							controller.signal,
						);
					} else {
						throw cause;
					}
				}

				const sourceCatalog = await bridge.localSources(controller.signal);
				const catalog = new Map(
					sourceCatalog.map((source) => [source.sourceId, source]),
				);
				const desired = uniqueIntentSources(
					intent.sources.filter(
						(source) => !excludedSources.current.has(source.sourceId),
					),
				);
				const combinedIds = [
					...next.parts.map((part) => part.sourceId),
					...desired.map((source) => source.sourceId),
				];
				const requestIds = new Set(desired.map((source) => source.sourceId));
				const variant = recordingVariantConflicts(combinedIds, catalog).find(
					(conflict) =>
						requestIds.has(conflict.sourceId) &&
						!next.parts.some(
							(part) => part.sourceId === conflict.sourceId,
						) &&
						!approvedVariantSources.current.has(conflict.sourceId),
				);
				if (variant) {
					setWorkspace(next);
					saveRecoveryPointer(campaignId, intent.sessionId);
					setBlocker({
						kind: "variant",
						sourceIds: [variant.sourceId, ...variant.conflictsWith],
						recordingId: variant.recordingId,
					});
					announce(
						"Encontramos duas versões da mesma gravação. Nenhuma foi descartada automaticamente.",
					);
					return;
				}

				const normalizedIntent: SessionTranscriptionIntent = {
					...intent,
					sources: desired,
				};
				const localIntent = await bridge.saveSessionTranscriptionIntent(
					campaignId,
					intent.sessionId,
					{
						requestId: normalizedIntent.id,
						profileId: normalizedIntent.profile,
						context: normalizedIntent.context,
						glossary: normalizedIntent.glossary,
					},
					controller.signal,
				);
				setActiveRequest(normalizedIntent);
				saveRecoveryPointer(campaignId, intent.sessionId);
				if (recoveryScope) {
					try {
						const identity = await sessionIntentReceiptIdentity({
							profileScope: recoveryScope,
							campaignId: campaignId,
							sessionId: intent.sessionId,
						});
						const receipt = createSessionIntentReceipt(identity, {
							requestId: normalizedIntent.id,
							sourceIds: desired.map((source) => source.sourceId),
							profileId: normalizedIntent.profile,
							contextSha256: localIntent.contextSha256,
							glossarySha256: localIntent.glossarySha256,
							enqueueKeys: Object.fromEntries(intentEnqueueKeys.current),
							jobIds: Object.fromEntries(intentJobIds.current),
							runIds: Object.fromEntries(intentRunIds.current),
						});
						intentReceiptIdentity.current = identity;
						intentReceipt.current = receipt;
						saveSessionIntentReceipt(window.localStorage, identity, receipt);
					} catch {
						// Browser persistence is recovery-only; local Agent state remains authoritative.
					}
				}

				for (const source of desired) {
					if (next.parts.some((part) => part.sourceId === source.sourceId))
						continue;
					next = await bridge.attachSessionSource(
						campaignId,
						intent.sessionId,
						source.sourceId,
						next.revision,
						controller.signal,
					);
				}
				await loadSnapshot(intent.sessionId, controller.signal);
				announce(
					desired.length === 1
						? "Gravação pronta. O TDA vai cuidar das etapas determinísticas."
						: `${desired.length} gravações prontas. O TDA vai processar somente o que ainda falta.`,
				);
			} catch (cause) {
				fail(cause);
			} finally {
				setBusy(false);
			}
		},
		[
			announce,
			bridge,
			busy,
			campaignId,
			disabled,
			enabled,
			fail,
			loadSnapshot,
			recoveryScope,
		],
	);

	useEffect(() => {
		if (
			!enabled ||
			disabled ||
			!request ||
			processedRequest.current === request.id
		)
			return;
		processedRequest.current = request.id;
		void begin(request);
	}, [begin, disabled, enabled, request]);

	useEffect(() => {
		if (!enabled || disabled || request || workspace) return;
		let saved: string | null = null;
		try {
			saved = readSessionComposerRecoveryPointer(window.localStorage, campaignId);
		} catch {
			saved = null;
		}
		if (!saved || !validSessionId(saved)) return;
		const savedSessionId = saved;
		onRestoreSessionId?.(savedSessionId);
		const controller = new AbortController();
		const recover = async () => {
			if (recoveryScope) {
				try {
					const identity = await sessionIntentReceiptIdentity({
						profileScope: recoveryScope,
						campaignId: campaignId,
						sessionId: savedSessionId,
					});
					const receipt = loadSessionIntentReceipt(
						window.localStorage,
						identity,
					);
					if (receipt) {
						const localIntent = await bridge.sessionTranscriptionIntent(
							campaignId,
							savedSessionId,
							controller.signal,
						);
						if (
							localIntent.requestId !== receipt.requestId ||
							localIntent.profileId !== receipt.profileId ||
							localIntent.contextSha256 !== receipt.contextSha256 ||
							localIntent.glossarySha256 !== receipt.glossarySha256
						)
							throw new Error("SESSION_INTENT_RECOVERY_AUTHORITY_MISMATCH");
						intentReceiptIdentity.current = identity;
						intentReceipt.current = receipt;
						intentEnqueueKeys.current = new Map(
							Object.entries(receipt.enqueueKeys),
						);
						intentJobIds.current = new Map(Object.entries(receipt.jobIds));
						intentRunIds.current = new Map(Object.entries(receipt.runIds));
						const restored: SessionTranscriptionIntent = {
							id: receipt.requestId,
							sessionId: receipt.sessionId,
							sources: receipt.sourceIds.map((sourceId, index) => ({
								sourceId,
								label: `Gravação ${index + 1}`,
							})),
							profile: localIntent.profileId,
							context: localIntent.context,
							glossary: localIntent.glossary,
						};
						setActiveRequest(restored);
						onRestoreIntent?.(restored);
						processedRequest.current = restored.id;
						await begin(restored);
						return;
					}
				} catch {
					// Invalid or unavailable browser recovery metadata falls back to Agent state.
				}
			}
			await loadSnapshot(savedSessionId, controller.signal);
		};
		void recover().catch((cause) => {
			if (
				!(
					cause instanceof BridgeError &&
					cause.serverCode === "SESSION_WORKSPACE_NOT_FOUND"
				)
			)
				fail(cause);
		});
		return () => controller.abort();
	}, [
		begin,
		bridge.sessionTranscriptionIntent,
		campaignId,
		disabled,
		enabled,
		fail,
		loadSnapshot,
		onRestoreIntent,
		onRestoreSessionId,
		recoveryScope,
		request,
		workspace,
	]);

	const pollingSessionId = workspace?.sessionId ?? null;
	useEffect(() => {
		if (!enabled || !pollingSessionId) return;
		const controller = new AbortController();
		let reading = false;
		const tick = async () => {
			if (reading || controller.signal.aborted) return;
			reading = true;
			try {
				await loadSnapshot(pollingSessionId, controller.signal);
			} catch {
				// Keep the last good Agent snapshot. Explicit errors remain actionable.
			} finally {
				reading = false;
			}
		};
		const timer = window.setInterval(() => void tick(), 2500);
		return () => {
			window.clearInterval(timer);
			controller.abort();
		};
	}, [enabled, loadSnapshot, pollingSessionId]);

	const progress = useMemo(
		() => intentProgress(workspace, runsBySource, jobs),
		[jobs, runsBySource, workspace],
	);

	const advance = useCallback(async () => {
		if (
			!enabled ||
			disabled ||
			busy ||
			advancing.current ||
			!workspace ||
			!mapping ||
			assembly ||
			blocker?.kind === "variant" ||
			blocker?.kind === "runs" ||
			blocker?.kind === "timeline" ||
			blocker?.kind === "participants" ||
			blocker?.kind === "enqueue" ||
			blocker?.kind === "resume" ||
			blocker?.kind === "source" ||
			enqueueRecoveryBlocked.current.size > 0
		)
			return;
		advancing.current = true;
		const controller = new AbortController();
		try {
			if (activeRequest) {
				for (const part of workspace.parts) {
					if (intentJobIds.current.has(part.sourceId)) continue;
					const key = intentEnqueueKeys.current.get(part.sourceId);
					if (!key) continue;
					const job = await bridge.transcription(
						{
							campaignId: workspace.campaignId,
							sessionId: workspace.sessionId,
							sourceId: part.sourceId,
							profileId: activeRequest.profile,
							glossary: activeRequest.glossary,
							context: activeRequest.context,
						},
						key,
						controller.signal,
					);
					enqueueRecoveryBlocked.current.delete(part.sourceId);
					intentJobIds.current.set(part.sourceId, job.id);
					persistIntentReceipt({
						job: { sourceId: part.sourceId, jobId: job.id },
					});
					setJobs((current) => [
						job,
						...current.filter((item) => item.id !== job.id),
					]);
					await loadSnapshot(workspace.sessionId, controller.signal);
					announce(
						`${sourceLabel(part.sourceId, activeRequest, workspace)} recuperada com a mesma identidade de envio.`,
					);
					return;
				}
			}

			for (const [sourceId, jobId] of intentJobIds.current) {
				if (intentRunIds.current.has(sourceId)) continue;
				const job = jobs.find((item) => item.id === jobId);
				if (job?.status !== "succeeded" || !job.result_available) continue;
				try {
					const result = await bridge.result(jobId, controller.signal);
					if (result.runId) {
						intentRunIds.current.set(sourceId, result.runId);
						persistIntentReceipt({
							run: { sourceId, runId: result.runId },
						});
					}
				} catch {
					// The run catalog below remains a safe fallback when only one run exists.
				}
			}

			for (const part of workspace.parts) {
				if (part.sourceState !== "ready") {
					setBlocker({ kind: "source", sourceIds: [part.sourceId] });
					return;
				}
				const choice = chooseIntentRun(
					part,
					runsBySource.get(part.sourceId) ?? [],
					intentRunIds.current.get(part.sourceId),
				);
				if (choice.kind === "automatic") {
					await bridge.selectSessionPartRun(
						workspace.campaignId,
						workspace.sessionId,
						part.partId,
						choice.runId,
						workspace.revision,
						controller.signal,
					);
					await loadSnapshot(workspace.sessionId, controller.signal);
					announce(
						`${sourceLabel(part.sourceId, activeRequest, workspace)} pronta; o resultado inequívoco foi aplicado automaticamente.`,
					);
					return;
				}
				if (choice.kind === "ambiguous") {
					setBlocker({
						kind: "runs",
						sourceId: part.sourceId,
						runIds: choice.runIds,
					});
					return;
				}
			}

			const failedSources = workspace.parts
				.filter((part) => retryableIntentJob(jobs, part.sourceId))
				.filter((part) => (runsBySource.get(part.sourceId)?.length ?? 0) === 0)
				.map((part) => part.sourceId);
			if (failedSources.length) {
				setBlocker({ kind: "failed", sourceIds: failedSources });
				return;
			}
			if (
				workspace.parts.some((part) => {
					const job = latestJobForSource(jobs, part.sourceId);
					return job?.status === "queued" || job?.status === "running";
				})
			) {
				setBlocker(null);
				return;
			}

			const missing = workspace.parts.filter(
				(part) =>
					!part.selectedRunId &&
					(runsBySource.get(part.sourceId)?.length ?? 0) === 0,
			);
			if (missing.length) {
				if (!activeRequest) {
					setBlocker({
						kind: "resume",
						sourceIds: missing.map((part) => part.sourceId),
					});
					return;
				}
				for (const part of missing) {
					const signature = JSON.stringify([
						workspace.campaignId,
						workspace.sessionId,
						part.sourceId,
						activeRequest.profile,
						activeRequest.glossary,
						activeRequest.context,
						false,
					]);
					const submission = await resolveSessionComposerPendingSubmission({
						storage: window.localStorage,
						recoveryScope,
						campaignId: workspace.campaignId,
						sessionId: workspace.sessionId,
						sourceId: part.sourceId,
						profileId: activeRequest.profile,
						requestSignature: signature,
						existing:
							pendingSubmissions.current.get(part.sourceId) ?? null,
					});
					pendingSubmissions.current.set(part.sourceId, submission);
					intentEnqueueKeys.current.set(part.sourceId, submission.key);
					persistIntentReceipt({
						enqueue: { sourceId: part.sourceId, key: submission.key },
					});
					let job: LocalJob;
					try {
						job = await bridge.transcription(
							{
								campaignId: workspace.campaignId,
								sessionId: workspace.sessionId,
								sourceId: part.sourceId,
								profileId: activeRequest.profile,
								glossary: activeRequest.glossary,
								context: activeRequest.context,
							},
							submission.key,
							controller.signal,
						);
					} catch (cause) {
						enqueueRecoveryBlocked.current.add(part.sourceId);
						fail(cause);
						setBlocker({ kind: "enqueue", sourceIds: [part.sourceId] });
						return;
					}
					enqueueRecoveryBlocked.current.delete(part.sourceId);
					intentJobIds.current.set(part.sourceId, job.id);
					persistIntentReceipt({
						job: { sourceId: part.sourceId, jobId: job.id },
					});
					setJobs((current) => [
						job,
						...current.filter((item) => item.id !== job.id),
					]);
					confirmSessionComposerPendingSubmission(
						window.localStorage,
						submission,
					);
					pendingSubmissions.current.delete(part.sourceId);
				}
				announce(
					missing.length === 1
						? "1 gravação entrou no processamento local."
						: `${missing.length} gravações entraram no processamento local.`,
				);
				await loadSnapshot(workspace.sessionId, controller.signal);
				return;
			}

			if (
				workspace.timeline.automaticOrderAvailable &&
				workspace.orderingMode !== "automatic"
			) {
				await bridge.deriveSessionTimeline(
					workspace.campaignId,
					workspace.sessionId,
					workspace.revision,
					controller.signal,
				);
				await loadSnapshot(workspace.sessionId, controller.signal);
				announce("Cronologia confiável aplicada automaticamente.");
				return;
			}

			if (workspace.timeline.state === "gap_unconfirmed") {
				let current = workspace;
				for (const part of current.parts) {
					if (
						part.relationToPrevious !== "gap" ||
						part.gapConfirmed ||
						part.sessionOffsetSeconds === null
					)
						continue;
					current = await bridge.updateSessionPartTiming(
						current.campaignId,
						current.sessionId,
						{
							partId: part.partId,
							expectedRevision: current.revision,
							sessionOffsetSeconds: part.sessionOffsetSeconds,
							trimStartSeconds: part.trimStartSeconds,
							trimEndSeconds: part.trimEndSeconds,
							gapConfirmed: true,
							overlapResolution: part.overlapResolution,
							overlapBoundarySeconds: part.overlapBoundarySeconds,
						},
						controller.signal,
					);
				}
				await loadSnapshot(workspace.sessionId, controller.signal);
				announce("Intervalos comprovados foram preservados sem inventar fala.");
				return;
			}

			if (workspace.timeline.state !== "ready") {
				setBlocker({ kind: "timeline", state: workspace.timeline.state });
				return;
			}
			if (mapping.approvalBlocked) {
				setBlocker({
					kind: "participants",
					count: mapping.conflicts.filter(
						(conflict) => conflict.requiresResolution,
					).length,
				});
				return;
			}

			const readiness = sessionAssemblyReadiness(workspace, mapping);
			if (!readiness.ready) return;
			const built = await bridge.buildSessionAssembly(
				workspace.campaignId,
				workspace.sessionId,
				workspace.revision,
				controller.signal,
			);
			setAssembly(built);
			setBlocker(null);
			window.dispatchEvent(new Event(SESSION_COMPOSER_CHANGE_EVENT));
			announce(
				`Transcrição pronta · ${built.segmentCount.toLocaleString("pt-BR")} falas em ${built.parts.length} ${built.parts.length === 1 ? "gravação" : "gravações"}.`,
			);
		} catch (cause) {
			fail(cause);
		} finally {
			advancing.current = false;
		}
	}, [
		activeRequest,
		announce,
		assembly,
		blocker?.kind,
		bridge,
		busy,
		disabled,
		enabled,
		fail,
		jobs,
		loadSnapshot,
		mapping,
		persistIntentReceipt,
		recoveryScope,
		runsBySource,
		workspace,
	]);

	useEffect(() => {
		void advance();
	}, [advance]);

	async function retryFailed() {
		if (!workspace || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		try {
			let retried = 0;
			for (const part of workspace.parts) {
				if ((runsBySource.get(part.sourceId)?.length ?? 0) > 0) continue;
				const job = retryableIntentJob(jobs, part.sourceId);
				if (!job) continue;
				const next = await bridge.jobAction(job.id, "retry", controller.signal);
				intentJobIds.current.set(part.sourceId, next.id);
				setJobs((current) => [
					next,
					...current.filter((item) => item.id !== next.id),
				]);
				retried += 1;
			}
			setBlocker(null);
			announce(
				retried === 1
					? "Reprocessando 1 gravação; as concluídas não serão retranscritas."
					: `Reprocessando ${retried} gravações; as concluídas continuam preservadas.`,
			);
			await loadSnapshot(workspace.sessionId, controller.signal);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	async function cancelSource(sourceId: string) {
		if (!workspace || busy || disabled) return;
		const job = latestJobForSource(jobs, sourceId);
		if (!job || (job.status !== "queued" && job.status !== "running")) return;
		const controller = new AbortController();
		setBusy(true);
		try {
			await bridge.jobAction(job.id, "cancel", controller.signal);
			announce(
				`${sourceLabel(sourceId, activeRequest, workspace)} cancelada. As demais gravações continuam preservadas.`,
			);
			await loadSnapshot(workspace.sessionId, controller.signal);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	async function cancelActive() {
		if (!workspace || busy || disabled) return;
		const active = workspace.parts
			.map((part) => latestJobForSource(jobs, part.sourceId))
			.filter(
				(job): job is LocalJob =>
					Boolean(job) &&
					(job?.status === "queued" || job?.status === "running"),
			);
		if (!active.length) return;
		const controller = new AbortController();
		setBusy(true);
		try {
			for (const job of active)
				await bridge.jobAction(job.id, "cancel", controller.signal);
			announce(
				"Cancelamento solicitado. Gravações já concluídas continuam preservadas.",
			);
			await loadSnapshot(workspace.sessionId, controller.signal);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	async function chooseRun(runId: string) {
		if (!workspace || blocker?.kind !== "runs" || busy || disabled) return;
		const part = workspace.parts.find(
			(item) => item.sourceId === blocker.sourceId,
		);
		if (!part) return;
		const controller = new AbortController();
		setBusy(true);
		try {
			await bridge.selectSessionPartRun(
				workspace.campaignId,
				workspace.sessionId,
				part.partId,
				runId,
				workspace.revision,
				controller.signal,
			);
			setBlocker(null);
			await loadSnapshot(workspace.sessionId, controller.signal);
			announce("Resultado escolhido para esta gravação.");
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	function approveVariants() {
		if (blocker?.kind !== "variant" || !activeRequest) return;
		for (const sourceId of blocker.sourceIds)
			approvedVariantSources.current.add(sourceId);
		setBlocker(null);
		void begin(activeRequest);
	}

	function keepOnlyVariant(sourceId: string) {
		if (blocker?.kind !== "variant" || !activeRequest) return;
		for (const candidate of blocker.sourceIds)
			if (candidate !== sourceId) excludedSources.current.add(candidate);
		approvedVariantSources.current.add(sourceId);
		setBlocker(null);
		void begin(activeRequest);
	}

	async function openReview() {
		if (!workspace || !assembly || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		try {
			const next = await bridge.sessionAssemblyReview(
				workspace.campaignId,
				workspace.sessionId,
				assembly.assemblyId,
				controller.signal,
			);
			setReview(next);
			announce("Transcrição contínua carregada e pronta para revisão.");
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	if (!enabled || (!workspace && !request)) return null;

	const activeJobs = workspace
		? workspace.parts
				.map((part) => latestJobForSource(jobs, part.sourceId))
				.filter(
					(job): job is LocalJob =>
						Boolean(job) &&
						(job?.status === "queued" || job?.status === "running"),
				)
		: [];
	const runBlockerPart =
		blocker?.kind === "runs"
			? workspace?.parts.find((part) => part.sourceId === blocker.sourceId) ??
				null
			: null;
	const runBlockerOptions =
		blocker?.kind === "runs"
			? (runsBySource.get(blocker.sourceId) ?? []).filter((run) =>
					blocker.runIds.includes(run.runId),
				)
			: [];

	return (
		<section
			className={styles.intent}
			aria-label={
				"Transcrição da sessão · " +
				(workspace?.sessionId ?? request?.sessionId ?? "Sessão")
			}
			data-session-intent="true"
		>
			<div className={styles.header}>
				<div>
					<span>Transcrição da sessão</span>
					<h3 id="session-intent-title">
						{workspace?.sessionId ?? request?.sessionId ?? "Sessão"}
					</h3>
				</div>
				{progress.total ? (
					<strong>
						{progress.completed}/{progress.total} concluída
						{progress.total === 1 ? "" : "s"}
					</strong>
				) : null}
			</div>

			{workspace?.parts.length ? (
				<ol className={styles.progressList} aria-label="Progresso das gravações">
					{workspace.parts.map((part, index) => {
						const runs = runsBySource.get(part.sourceId) ?? [];
						const job = latestJobForSource(jobs, part.sourceId);
						const state =
							part.selectedRunId || runs.length
								? "completed"
								: job?.status === "queued" || job?.status === "running"
									? "running"
									: job?.status === "failed" ||
											job?.status === "cancelled" ||
											job?.status === "interrupted"
										? "failed"
										: "waiting";
						return (
							<li key={part.partId} data-state={state}>
								<span aria-hidden="true">
									{state === "completed"
										? "✓"
										: state === "running"
											? "●"
											: state === "failed"
												? "!"
												: "○"}
								</span>
								<div>
									<strong>
										{index + 1}/{workspace.parts.length} ·{" "}
										{sourceLabel(part.sourceId, activeRequest, workspace)}
									</strong>
									<small>
										{state === "completed"
											? "concluída"
											: state === "running"
												? job?.progress
													? `transcrevendo · ${job.progress.completed}/${job.progress.total} ${job.progress.unit}`
													: "transcrevendo"
												: state === "failed"
													? "precisa de atenção"
													: "aguardando"}
									</small>
								</div>
								{state === "running" ? (
									<Button
										type="button"
										size="sm"
										variant="tertiary"
										disabled={busy}
										aria-label={`Cancelar ${sourceLabel(
											part.sourceId,
											activeRequest,
											workspace,
										)}`}
										onClick={() => void cancelSource(part.sourceId)}
									>
										Cancelar
									</Button>
								) : null}
							</li>
						);
					})}
				</ol>
			) : (
				<p className={styles.waiting}>Preparando as gravações desta sessão…</p>
			)}

			{blocker?.kind === "variant" ? (
				<div className={styles.blocker} role="alert" tabIndex={-1}>
					<div>
						<strong>Encontramos duas versões da mesma gravação.</strong>
						<span>
							O identificador Craig é o mesmo ({blocker.recordingId}), mas os
							bytes são diferentes. Escolha uma versão ou mantenha ambas se forem
							partes realmente distintas.
						</span>
					</div>
					<div className={styles.blockerActions}>
						{blocker.sourceIds.map((sourceId) => (
							<Button
								key={sourceId}
								type="button"
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() => keepOnlyVariant(sourceId)}
							>
								Usar só {sourceLabel(sourceId, activeRequest, workspace)}
							</Button>
						))}
						<Button
							type="button"
							size="sm"
							variant="tertiary"
							disabled={busy}
							onClick={approveVariants}
						>
							Manter ambas
						</Button>
					</div>
				</div>
			) : null}

			{blocker?.kind === "runs" && runBlockerPart ? (
				<div className={styles.blocker} role="alert">
					<div>
						<strong>Existem dois resultados desta gravação.</strong>
						<span>Escolha qual entra na transcrição da sessão.</span>
					</div>
					<div className={styles.blockerActions}>
						{runBlockerOptions.map((run) => (
							<Button
								key={run.runId}
								type="button"
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() => void chooseRun(run.runId)}
							>
								{run.profileId}
								{run.completedAt
									? ` · ${new Date(run.completedAt).toLocaleString("pt-BR")}`
									: ""}
							</Button>
						))}
					</div>
				</div>
			) : null}

			{blocker?.kind === "timeline" ? (
				<div className={styles.blocker} role="alert">
					<div>
						<strong>
							{blocker.state === "overlap_unresolved"
								? "Há uma sobreposição que precisa de decisão."
								: "Não conseguimos provar onde uma gravação entra na sessão."}
						</strong>
						<span>
							Nenhuma ordem ou corte será inventado. Resolva somente esta
							ambiguidade e o fluxo continua sozinho.
						</span>
					</div>
					{onOpenTechnical ? (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							onClick={onOpenTechnical}
						>
							Resolver cronologia
						</Button>
					) : null}
				</div>
			) : null}

			{blocker?.kind === "participants" ? (
				<div className={styles.blocker} role="alert">
					<div>
						<strong>Há participante ambíguo nesta sessão.</strong>
						<span>
							{blocker.count} conflito{blocker.count === 1 ? "" : "s"} precisa
							{blocker.count === 1 ? "" : "m"} de uma decisão antes da montagem final.
						</span>
					</div>
					{onOpenTechnical ? (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							onClick={onOpenTechnical}
						>
							Resolver participantes
						</Button>
					) : null}
				</div>
			) : null}

			{blocker?.kind === "failed" ? (
				<div className={styles.blocker} role="alert">
					<div>
						<strong>
							{blocker.sourceIds.length === 1
								? "Uma gravação falhou."
								: `${blocker.sourceIds.length} gravações falharam.`}
						</strong>
						<span>
							As gravações concluídas continuam preservadas. A nova tentativa
							reprocessa somente o que falhou.
						</span>
					</div>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={busy}
						onClick={() => void retryFailed()}
					>
						{blocker.sourceIds.length === 1
							? "Reprocessar 1 gravação"
							: `Reprocessar ${blocker.sourceIds.length} gravações`}
					</Button>
				</div>
			) : null}

			{blocker?.kind === "enqueue" ? (
				<div className={styles.blocker} role="alert">
					<div>
						<strong>Não foi possível confirmar a entrada desta gravação.</strong>
						<span>
							A identidade da tentativa foi preservada. Tentar novamente não cria
							um segundo job se o Agent já tiver recebido o primeiro pedido.
						</span>
					</div>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={busy}
						onClick={() => {
							enqueueRecoveryBlocked.current.clear();
							setLocalError(null);
							setBlocker(null);
						}}
					>
						Tentar novamente
					</Button>
				</div>
			) : null}

			{blocker?.kind === "resume" ? (
				<div className={styles.blocker} role="status">
					<div>
						<strong>A sessão foi recuperada do Companion.</strong>
						<span>
							{blocker.sourceIds.length} gravação
							{blocker.sourceIds.length === 1 ? "" : "ões"} ainda não possui
							execução confirmada. Selecione novamente os ZIPs para retomar sem
							mover ou duplicar as partes já salvas.
						</span>
					</div>
				</div>
			) : null}

			{blocker?.kind === "source" ? (
				<div className={styles.blocker} role="alert">
					<div>
						<strong>Uma gravação local precisa ser restaurada.</strong>
						<span>
							O workspace foi preservado, mas a fonte não passou na verificação de
							integridade.
						</span>
					</div>
				</div>
			) : null}

			{assembly ? (
				<div className={styles.complete} role="status">
					<div>
						<strong>✓ Transcrição pronta</strong>
						<span>
							{assembly.segmentCount.toLocaleString("pt-BR")} falas ·{" "}
							{assembly.parts.length}{" "}
							{assembly.parts.length === 1 ? "gravação" : "gravações"}
						</span>
					</div>
					<Button
						type="button"
						variant="primary"
						disabled={busy}
						onClick={() => void openReview()}
					>
						Revisar transcrição
					</Button>
				</div>
			) : null}

			{review && assembly ? (
				<SessionAssemblyReview
					bridge={bridge}
					assembly={assembly}
					review={review}
					disabled={busy || disabled}
					onChange={setReview}
					onStatus={announce}
				/>
			) : null}

			{activeJobs.length ? (
				<div className={styles.secondaryActions}>
					<Button
						type="button"
						size="sm"
						variant="tertiary"
						disabled={busy}
						onClick={() => void cancelActive()}
					>
						Cancelar novas execuções
					</Button>
				</div>
			) : null}

			{localError ? (
				<p className={styles.error} role="alert">
					{localError}
				</p>
			) : null}
			<p className={styles.live} role="status" aria-live="polite" aria-atomic="true">
				{live}
			</p>
		</section>
	);
}
