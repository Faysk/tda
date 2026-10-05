"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LocalBridge } from "./bridge";
import {
	latestJobForSource,
	sessionAssemblyReadiness,
} from "./session-composer-model";
import type { SessionAssembly } from "./session-composer-protocol";
import {
	clearSessionComposerRecoveryPointer,
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
	trustedTimelineOrderDiffers,
	trustedTimelineSourceOrder,
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
import {
	sessionRecoveryForError,
	sessionTimelineRecovery,
	type SessionRecoveryGuide,
	type SessionRecoveryTarget,
} from "./session-recovery";
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
	compatibilityFingerprint?: string | null;
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
	| Readonly<{ kind: "trusted_order"; sourceIds: readonly string[] }>
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
	onError?: (
		message: string,
		availabilityFailure?: "timeout" | "unreachable",
	) => void;
	onOpenTechnical?: (target?: SessionRecoveryTarget) => void;
	onSelectSource?: () => void;
	onReviewAssembly?: (assembly: SessionAssembly) => void;
	onNewTranscription?: () => void;
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

function RecoveryGuideCard({
	recovery,
	disabled,
	onAction,
}: Readonly<{
	recovery: SessionRecoveryGuide;
	disabled: boolean;
	onAction: (target: SessionRecoveryTarget) => void;
}>) {
	const role =
		recovery.severity === "blocker" || recovery.severity === "error"
			? "alert"
			: "status";
	return (
		<div
			className={styles.blocker}
			data-severity={recovery.severity}
			role={role}
		>
			<div>
				<strong>{recovery.title}</strong>
				<span>{recovery.detail}</span>
				{recovery.technicalCode ? (
					<details className={styles.recoveryTechnical}>
						<summary>Diagnóstico</summary>
						<code>{recovery.technicalCode}</code>
					</details>
				) : null}
			</div>
			{recovery.actionLabel && recovery.target ? (
				<Button
					type="button"
					size="sm"
					variant="secondary"
					disabled={disabled}
					onClick={() => {
						if (recovery.target) onAction(recovery.target);
					}}
				>
					{recovery.actionLabel}
				</Button>
			) : null}
		</div>
	);
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
	onSelectSource,
	onReviewAssembly,
	onNewTranscription,
}: Props) {
	const enabled = supported(capabilities);
	const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
	const [mapping, setMapping] = useState<SessionParticipantMapping | null>(null);
	const [runsBySource, setRunsBySource] = useState<
		ReadonlyMap<string, readonly LocalRunSummary[]>
	>(new Map());
	const [jobs, setJobs] = useState<readonly LocalJob[]>([]);
	const [assembly, setAssembly] = useState<SessionAssembly | null>(null);
	const [activeRequest, setActiveRequest] =
		useState<SessionTranscriptionIntent | null>(null);
	const [blocker, setBlocker] = useState<Blocker | null>(null);
	const [busy, setBusy] = useState(false);
	const [advancePulse, setAdvancePulse] = useState(0);
	const [live, setLive] = useState<string | null>(null);
	const [localError, setLocalError] = useState<string | null>(null);
	const [recovery, setRecovery] = useState<SessionRecoveryGuide | null>(null);
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
			setRecovery(null);
			setLocalError(null);
			setLive(message);
			onStatus?.(message);
		},
		[onStatus],
	);
	const fail = useCallback(
		(cause: unknown) => {
			const nextRecovery = sessionRecoveryForError(cause, workspace);
			const availabilityFailure =
				cause instanceof BridgeError &&
				(cause.code === "timeout" || cause.code === "unreachable")
					? cause.code
					: undefined;
			setLocalError(null);
			if (availabilityFailure && onError) {
				setRecovery(null);
				onError(
					`${nextRecovery.title} ${nextRecovery.detail}`,
					availabilityFailure,
				);
				return;
			}
			setRecovery(nextRecovery);
		},
		[onError, workspace],
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
				const authoritativeIntent: SessionTranscriptionIntent = {
					...normalizedIntent,
					compatibilityFingerprint: localIntent.compatibilityFingerprint,
				};
				setActiveRequest(authoritativeIntent);
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
							compatibilityFingerprint: localIntent.compatibilityFingerprint,
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

	const expectedFingerprint = activeRequest?.compatibilityFingerprint ?? null;
	const progress = useMemo(
		() => intentProgress(workspace, runsBySource, jobs, expectedFingerprint),
		[expectedFingerprint, jobs, runsBySource, workspace],
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
			blocker?.kind === "trusted_order" ||
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
		let continueAutomatically = false;
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
					// The run catalog below remains a safe fallback only for an exact fingerprint match.
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
					expectedFingerprint,
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
					continueAutomatically = true;
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
				.filter(
					(part) =>
						chooseIntentRun(
							part,
							runsBySource.get(part.sourceId) ?? [],
							intentRunIds.current.get(part.sourceId),
							expectedFingerprint,
						).kind === "missing",
				)
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
					chooseIntentRun(
						part,
						runsBySource.get(part.sourceId) ?? [],
						intentRunIds.current.get(part.sourceId),
						expectedFingerprint,
					).kind === "missing",
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
				workspace.orderingMode === "attachment"
			) {
				const trustedOrder = trustedTimelineSourceOrder(workspace);
				const editorialOrder = workspace.parts.map((part) => part.sourceId);
				if (
					trustedOrder &&
					trustedTimelineOrderDiffers(workspace, editorialOrder)
				) {
					setBlocker({ kind: "trusted_order", sourceIds: trustedOrder });
					return;
				}
				await bridge.deriveSessionTimeline(
					workspace.campaignId,
					workspace.sessionId,
					workspace.revision,
					controller.signal,
				);
				await loadSnapshot(workspace.sessionId, controller.signal);
				announce("Horários Craig confiáveis confirmaram a ordem escolhida.");
				continueAutomatically = true;
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
				continueAutomatically = true;
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
			if (continueAutomatically)
				setAdvancePulse((current) => current + 1);
		}
	}, [
		activeRequest,
		announce,
		expectedFingerprint,
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
		void advancePulse;
		void advance();
	}, [advance, advancePulse]);

	async function applyTrustedTimelineOrder() {
		if (!workspace || blocker?.kind !== "trusted_order" || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		try {
			await bridge.deriveSessionTimeline(
				workspace.campaignId,
				workspace.sessionId,
				workspace.revision,
				controller.signal,
			);
			setBlocker(null);
			await loadSnapshot(workspace.sessionId, controller.signal);
			announce("Ordem por horário Craig aplicada após sua confirmação.");
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	async function confirmCurrentOrder() {
		if (
			!workspace ||
			workspace.parts.length < 2 ||
			busy ||
			disabled ||
			!capabilities.includes("transcription.session-sequence")
		)
			return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		setRecovery(null);
		try {
			await bridge.confirmSessionSequence(
				workspace.campaignId,
				workspace.sessionId,
				workspace.revision,
				controller.signal,
			);
			setBlocker(null);
			await loadSnapshot(workspace.sessionId, controller.signal);
			announce(
				"Ordem confirmada. Intervalos sem horário comprovado seguem contínuos somente na leitura editorial.",
			);
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}


	async function refreshSession() {
		if (!workspace || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		try {
			setRecovery(null);
			setBlocker(null);
			await loadSnapshot(workspace.sessionId, controller.signal);
			announce("Sessão atualizada a partir do estado preservado no Companion.");
		} catch (cause) {
			fail(cause);
		} finally {
			setBusy(false);
		}
	}

	function runRecoveryAction(target: SessionRecoveryTarget) {
		if (target === "reload") {
			void refreshSession();
			return;
		}
		if (target === "source") {
			onSelectSource?.();
			return;
		}
		onOpenTechnical?.(target);
	}

	async function retryFailed() {
		if (!workspace || busy || disabled) return;
		const controller = new AbortController();
		setBusy(true);
		setLocalError(null);
		try {
			let retried = 0;
			for (const part of workspace.parts) {
				const choice = chooseIntentRun(
					part,
					runsBySource.get(part.sourceId) ?? [],
					intentRunIds.current.get(part.sourceId),
					expectedFingerprint,
				);
				if (choice.kind !== "missing") continue;
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

	function openReview() {
		if (!assembly || busy || disabled || !onReviewAssembly) return;
		onReviewAssembly(assembly);
	}

	function startNewTranscription() {
		if (busy || disabled || !assembly) return;
		try {
			clearSessionComposerRecoveryPointer(window.localStorage, campaignId);
		} catch {
			// Browser storage is recovery-only; completed Agent data remains authoritative.
		}
		processedRequest.current = null;
		pendingSubmissions.current.clear();
		intentEnqueueKeys.current.clear();
		intentJobIds.current.clear();
		intentRunIds.current.clear();
		enqueueRecoveryBlocked.current.clear();
		intentReceiptIdentity.current = null;
		intentReceipt.current = null;
		approvedVariantSources.current.clear();
		excludedSources.current.clear();
		setWorkspace(null);
		setMapping(null);
		setRunsBySource(new Map());
		setJobs([]);
		setAssembly(null);
		setActiveRequest(null);
		setBlocker(null);
		setRecovery(null);
		setLocalError(null);
		setLive(null);
		onActiveChange?.(false);
		onNewTranscription?.();
		window.dispatchEvent(new Event(SESSION_COMPOSER_CHANGE_EVENT));
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
	const timelineRecovery = sessionTimelineRecovery(workspace);
	const timelineBlockerRecovery =
		blocker?.kind === "timeline" ? timelineRecovery : null;
	const timelineNotice =
		blocker?.kind !== "timeline" && timelineRecovery?.severity === "info"
			? timelineRecovery
			: null;

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
				{progress.total && !assembly ? (
					<strong>
						{progress.completed}/{progress.total} concluída
						{progress.total === 1 ? "" : "s"}
					</strong>
				) : null}
			</div>

			{workspace?.parts.length && !assembly ? (
				<ol className={styles.progressList} aria-label="Progresso das gravações">
					{workspace.parts.map((part, index) => {
						const runs = runsBySource.get(part.sourceId) ?? [];
						const job = latestJobForSource(jobs, part.sourceId);
						const choice = chooseIntentRun(
							part,
							runs,
							intentRunIds.current.get(part.sourceId),
							expectedFingerprint,
						);
						const state =
							choice.kind === "selected" || choice.kind === "automatic"
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
											? intentJobIds.current.has(part.sourceId)
												? "concluída"
												: "resultado existente reutilizado"
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
			) : !assembly ? (
				<p className={styles.waiting}>Preparando as gravações desta sessão…</p>
			) : null}

			{recovery ? (
				<RecoveryGuideCard
					recovery={recovery}
					disabled={busy || disabled}
					onAction={runRecoveryAction}
				/>
			) : null}

			{timelineNotice ? (
				<RecoveryGuideCard
					recovery={timelineNotice}
					disabled={busy || disabled}
					onAction={runRecoveryAction}
				/>
			) : null}

			{workspace?.parts.length && workspace.parts.length > 1 && !assembly ? (
				<p className={styles.outputHint}>A saída será uma única transcrição da sessão.</p>
			) : null}

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

			{blocker?.kind === "trusted_order" && workspace ? (
				<div className={styles.blocker} role="status">
					<div>
						<strong>Os horários Craig indicam uma ordem diferente.</strong>
						<span>
							Você definiu:{" "}
							{workspace.parts
								.map((part) => sourceLabel(part.sourceId, activeRequest, workspace))
								.join(" → ")}.
							 Horário real confiável:{" "}
							{blocker.sourceIds
								.map((sourceId) => sourceLabel(sourceId, activeRequest, workspace))
								.join(" → ")}. O TDA não troca isso silenciosamente.
						</span>
					</div>
					<div className={styles.blockerActions}>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={busy}
							onClick={() => void applyTrustedTimelineOrder()}
						>
							Usar horários Craig
						</Button>
						{onOpenTechnical ? (
							<Button
								type="button"
								size="sm"
								variant="tertiary"
								disabled={busy}
								onClick={() => onOpenTechnical("order")}
							>
								Revisar ordem
							</Button>
						) : null}
					</div>
				</div>
			) : null}

			{blocker?.kind === "timeline" ? (
				<div
					className={styles.blocker}
					data-severity="blocker"
					role={
						blocker.state === "overlap_unresolved" || blocker.state === "order_conflict"
							? "alert"
							: "status"
					}
				>
					<div>
						<strong>
							{blocker.state === "overlap_unresolved"
								? "Há uma sobreposição comprovada que precisa de decisão."
								: blocker.state === "needs_timing" &&
										workspace &&
										workspace.parts.length > 1
									? "Confirme a ordem das gravações."
									: (timelineBlockerRecovery?.title ??
										"A cronologia da sessão ainda precisa de uma decisão.")}
						</strong>
						<span>
							{blocker.state === "needs_timing" &&
							workspace &&
							workspace.parts.length > 1
								? "A ordem exibida acima será usada como continuidade da sessão. Onde não houver horário confiável, o intervalo real continuará marcado como desconhecido."
								: (timelineBlockerRecovery?.detail ??
									"Revise somente a pendência indicada para continuar.")}
						</span>
					</div>
					<div className={styles.headerActions}>
						{blocker.state === "needs_timing" &&
						workspace &&
						workspace.parts.length > 1 &&
						capabilities.includes("transcription.session-sequence") ? (
							<Button
								type="button"
								size="sm"
								variant="primary"
								disabled={busy}
								onClick={() => void confirmCurrentOrder()}
							>
								Usar esta ordem para montar a sessão
							</Button>
						) : null}
						{timelineBlockerRecovery?.actionLabel &&
						timelineBlockerRecovery.target &&
						onOpenTechnical ? (
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={busy || disabled}
								onClick={() => {
								if (timelineBlockerRecovery.target)
									runRecoveryAction(timelineBlockerRecovery.target);
							}}
							>
								{timelineBlockerRecovery.actionLabel}
							</Button>
						) : null}
					</div>
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
							onClick={() => onOpenTechnical("participants")}
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
				<div className={styles.blocker} data-severity="blocker" role="alert">
					<div>
						<strong>A sessão foi recuperada do Companion.</strong>
						<span>
							{blocker.sourceIds.length} gravação
							{blocker.sourceIds.length === 1 ? "" : "ões"} ainda não possui
							resultado concluído. Selecione novamente os ZIPs para retomar sem
							mover ou duplicar as partes já salvas.
						</span>
					</div>
					{onSelectSource ? (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={busy || disabled}
							onClick={onSelectSource}
						>
							Selecionar ZIP para retomar
						</Button>
					) : null}
				</div>
			) : null}

			{blocker?.kind === "source" ? (
				<div className={styles.blocker} data-severity="blocker" role="alert">
					<div>
						<strong>Uma gravação local precisa ser restaurada.</strong>
						<span>
							Selecione novamente o ZIP original. Os resultados já concluídos serão
							preservados quando íntegros.
						</span>
					</div>
					{onSelectSource ? (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={busy || disabled}
							onClick={onSelectSource}
						>
							Selecionar ZIP original
						</Button>
					) : null}
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
					<div className={styles.blockerActions}>
						<Button
							type="button"
							variant="primary"
							disabled={busy || !onReviewAssembly}
							onClick={() => void openReview()}
						>
							Revisar transcrição
						</Button>
						<Button
							type="button"
							variant="secondary"
							disabled={busy}
							onClick={startNewTranscription}
						>
							Nova transcrição
						</Button>
					</div>
				</div>
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

			{localError && !onError ? (
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
