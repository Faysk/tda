"use client";

import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { LocalBridge } from "./bridge";
import type {
	CraigSource,
	SessionWorkspace,
	TranscriptionProfileId,
} from "./protocol";
import {
	SESSION_COMPOSER_CHANGE_EVENT,
	SESSION_COMPOSER_LAST_SESSION_KEY,
	SESSION_COMPOSER_RECOVERY_KEY,
} from "./session-composer-storage";
import {
	clearPendingSubmission,
	loadPendingSubmission,
	pendingSubmissionRecoveryIdentity,
	savePendingSubmission,
	type PendingSubmissionRecoveryIdentity,
} from "./submission-recovery";

export class SessionTranscriptionWorkflowError extends Error {
	constructor(
		readonly code:
			| "recording_variant"
			| "empty_selection",
	) {
		super(code);
		this.name = "SessionTranscriptionWorkflowError";
	}
}

export async function stageSessionSources(
	bridge: LocalBridge,
	files: readonly File[],
	signal: AbortSignal,
	onProgress?: (index: number, total: number, file: File) => void,
): Promise<readonly CraigSource[]> {
	if (!files.length) throw new SessionTranscriptionWorkflowError("empty_selection");
	const sources: CraigSource[] = [];
	for (let index = 0; index < files.length; index += 1) {
		const file = files[index];
		if (!file) continue;
		onProgress?.(index + 1, files.length, file);
		sources.push(await bridge.craigSource(file, signal));
	}
	return sources;
}

function assertNoRecordingVariants(
	sources: readonly CraigSource[],
	workspace: SessionWorkspace,
	catalog: Awaited<ReturnType<LocalBridge["localSources"]>>,
) {
	const bySource = new Map(catalog.map((item) => [item.sourceId, item]));
	const recording = new Map<string, string>();
	for (const sourceId of [
		...workspace.parts.map((part) => part.sourceId),
		...sources.map((source) => source.sourceId),
	]) {
		const item = bySource.get(sourceId);
		if (!item?.recordingId) continue;
		const previous = recording.get(item.recordingId);
		if (previous && previous !== sourceId)
			throw new SessionTranscriptionWorkflowError("recording_variant");
		recording.set(item.recordingId, sourceId);
	}
}

export async function composeAndQueueSession(input: Readonly<{
	bridge: LocalBridge;
	sources: readonly CraigSource[];
	sessionId: string;
	profile: TranscriptionProfileId;
	glossary: string;
	context: string;
	recoveryScope: string | null;
	storage: Storage;
	signal: AbortSignal;
}>): Promise<Readonly<{
	workspace: SessionWorkspace;
	queued: number;
	reused: number;
}>> {
	const {
		bridge,
		sources,
		sessionId,
		profile,
		glossary,
		context,
		recoveryScope,
		storage,
		signal,
	} = input;
	if (!sources.length) throw new SessionTranscriptionWorkflowError("empty_selection");

	let workspace = await bridge.ensureSessionWorkspace(
		CAMPAIGN_SLUG,
		sessionId,
		signal,
	);
	const catalog = await bridge.localSources(signal);
	assertNoRecordingVariants(sources, workspace, catalog);

	for (const source of sources) {
		if (workspace.parts.some((part) => part.sourceId === source.sourceId))
			continue;
		workspace = await bridge.attachSessionSource(
			CAMPAIGN_SLUG,
			sessionId,
			source.sourceId,
			workspace.revision,
			signal,
		);
	}
	if (
		workspace.parts.length > 1 &&
		workspace.timeline.state !== "ready" &&
		workspace.timeline.automaticOrderAvailable
	) {
		workspace = await bridge.deriveSessionTimeline(
			workspace.campaignId,
			workspace.sessionId,
			workspace.revision,
			signal,
		);
	}

	try {
		storage.setItem(SESSION_COMPOSER_RECOVERY_KEY, sessionId);
		storage.setItem(SESSION_COMPOSER_LAST_SESSION_KEY, sessionId);
	} catch {
		// The Agent workspace remains authoritative if browser recovery fails.
	}
	window.dispatchEvent(new Event(SESSION_COMPOSER_CHANGE_EVENT));

	const page = await bridge.jobPage("all", signal, { limit: 200 });
	let queued = 0;
	let reused = 0;
	for (const source of sources) {
		const runs = await bridge.localRuns(source.sourceId, signal);
		const activeOrDone = page.jobs.some(
			(job) =>
				job.context?.sourceId === source.sourceId &&
				(job.status === "queued" ||
					job.status === "running" ||
					job.status === "succeeded"),
		);
		if (runs.length || activeOrDone) {
			reused += 1;
			continue;
		}

		const signature = JSON.stringify([
			CAMPAIGN_SLUG,
			sessionId,
			source.sourceId,
			profile,
			glossary,
			context,
			false,
		]);
		let recoveryIdentity: PendingSubmissionRecoveryIdentity | null = null;
		if (recoveryScope) {
			try {
				recoveryIdentity = await pendingSubmissionRecoveryIdentity({
					profileScope: recoveryScope,
					campaignId: CAMPAIGN_SLUG,
					sessionId,
					sourceId: source.sourceId,
					profileId: profile,
					requestSignature: signature,
				});
			} catch {
				recoveryIdentity = null;
			}
		}
		let idempotencyKey: string | null = null;
		if (recoveryIdentity) {
			try {
				idempotencyKey =
					loadPendingSubmission(storage, recoveryIdentity)?.idempotencyKey ??
					null;
			} catch {
				idempotencyKey = null;
			}
		}
		idempotencyKey ??= crypto.randomUUID();
		if (recoveryIdentity) {
			try {
				savePendingSubmission(storage, recoveryIdentity, idempotencyKey);
			} catch {
				// The same in-flight request still owns the generated key.
			}
		}
		await bridge.transcription(
			{
				campaignId: CAMPAIGN_SLUG,
				sessionId,
				sourceId: source.sourceId,
				profileId: profile,
				glossary,
				context,
			},
			idempotencyKey,
			signal,
		);
		if (recoveryIdentity) {
			try {
				clearPendingSubmission(storage, recoveryIdentity);
			} catch {
				// A confirmed Agent response is authoritative.
			}
		}
		queued += 1;
	}
	return { workspace, queued, reused };
}
