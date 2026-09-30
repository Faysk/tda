import { describe, expect, test } from "vitest";
import type {
	LocalJob,
	LocalRunSummary,
	LocalSourceSummary,
	SessionWorkspace,
	SessionWorkspacePart,
} from "./protocol";
import {
	chooseIntentRun,
	intentProgress,
	recordingVariantConflicts,
	retryableIntentJob,
	uniqueIntentSources,
} from "./session-intent-model";

const NOW = "2026-09-30T00:00:00.000Z";

function part(sourceId: string, selectedRunId: string | null = null): SessionWorkspacePart {
	return {
		partId: sourceId.slice(-32),
		sourceId,
		ordinal: 0,
		selectedRunId,
		sourceState: "ready",
		timelineMode: "automatic",
		sessionOffsetSeconds: 0,
		trimStartSeconds: 0,
		trimEndSeconds: null,
		gapConfirmed: false,
		overlapResolution: null,
		overlapBoundarySeconds: null,
		sourceStartTime: null,
		sourceStartConfidence: "missing",
		sourceStartUtc: null,
		sourceDurationSeconds: 1,
		effectiveStartSeconds: 0,
		effectiveEndSeconds: 1,
		relationToPrevious: "first",
		relationSeconds: null,
		overlapResolutionValid: true,
		createdAt: NOW,
		updatedAt: NOW,
	};
}

function workspace(parts: SessionWorkspacePart[]): SessionWorkspace {
	return {
		schemaVersion: "tda_session_workspace_v1",
		campaignId: "yuhara-main",
		sessionId: "sessao-42",
		revision: 1,
		orderingMode: "automatic",
		createdAt: NOW,
		updatedAt: NOW,
		parts,
		timeline: {
			policyVersion: "tda_session_timeline_v1",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			fingerprintSha256: "f".repeat(64),
			state: "ready",
			allSourcesTrusted: true,
			automaticOrderAvailable: true,
			gapCount: 0,
			overlapCount: 0,
			orderConflictCount: 0,
			unresolvedOverlapCount: 0,
			unconfirmedGapCount: 0,
		},
	};
}

function run(sourceId: string, runId: string): LocalRunSummary {
	return {
		runId,
		sourceId,
		profileId: "whisper-detailed",
		engine: "faster-whisper",
		model: "large-v3",
		modelRevision: null,
		device: "cuda",
		computeType: "float16",
		alignment: "native",
		executionLineage: null,
		language: "pt",
		completedAt: NOW,
		transcriptSha256: "a".repeat(64),
		transcriptSizeBytes: 128,
		stats: {
			audioWorkSeconds: 1,
			processingSeconds: 1,
			sessionDurationSeconds: 1,
			rtf: 1,
			wordCount: 1,
			segmentCount: 1,
			trackCount: 1,
			turnCount: 1,
			deduplicatedSegmentCount: 0,
			warningCount: 0,
		},
		publicationTarget: null,
		review: null,
	};
}

function job(sourceId: string, status: LocalJob["status"]): LocalJob {
	return {
		id: "job-" + sourceId.slice(-4),
		kind: "transcription.craig",
		status,
		stage: status,
		progress: null,
		error: status === "failed" ? { code: "FIXTURE", recoverable: true } : null,
		result_available: status === "succeeded",
		updated_at: NOW,
		attempt: 1,
		context: {
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
			sourceId,
		},
		timing: {
			schemaVersion: "tda_job_timing_v1",
			attemptStartedAt: null,
			attemptFinishedAt: null,
			attemptElapsedSeconds: null,
			stageStartedAt: null,
			stageElapsedSeconds: null,
			tracks: [],
		},
	};
}

describe("session intent model", () => {
	test("deduplicates exact source identities without discarding byte variants", () => {
		expect(
			uniqueIntentSources([
				{ sourceId: "craig-a" },
				{ sourceId: "craig-a" },
				{ sourceId: "craig-b" },
			]).map((item) => item.sourceId),
		).toEqual(["craig-a", "craig-b"]);
	});

	test("selects the run produced by this intent before considering historical ambiguity", () => {
		const sourceId = "craig-" + "1".repeat(64);
		const target = part(sourceId);
		const runs = [run(sourceId, "run-old"), run(sourceId, "run-intent")];
		expect(chooseIntentRun(target, runs, "run-intent")).toEqual({
			kind: "automatic",
			runId: "run-intent",
			reason: "intent_job",
		});
		expect(chooseIntentRun(target, runs, null)).toEqual({
			kind: "ambiguous",
			runIds: ["run-old", "run-intent"],
		});
	});

	test("reuses one existing run and preserves an already selected run", () => {
		const sourceId = "craig-" + "2".repeat(64);
		expect(chooseIntentRun(part(sourceId), [run(sourceId, "run-only")], null)).toEqual({
			kind: "automatic",
			runId: "run-only",
			reason: "single_run",
		});
		expect(
			chooseIntentRun(part(sourceId, "run-chosen"), [run(sourceId, "run-other")], null),
		).toEqual({ kind: "selected", runId: "run-chosen" });
	});

	test("reports session-level progress without retranscribing completed parts", () => {
		const a = "craig-" + "1".repeat(64);
		const b = "craig-" + "2".repeat(64);
		const c = "craig-" + "3".repeat(64);
		const d = "craig-" + "4".repeat(64);
		const runs = new Map<string, readonly LocalRunSummary[]>([[a, [run(a, "run-a")]]]);
		expect(
			intentProgress(
				workspace([part(a), part(b), part(c), part(d)]),
				runs,
				[job(b, "running"), job(c, "failed")],
			),
		).toEqual({ total: 4, waiting: 1, running: 1, completed: 1, failed: 1 });
		expect(retryableIntentJob([job(c, "failed")], c)?.status).toBe("failed");
		expect(retryableIntentJob([job(b, "running")], b)).toBeNull();
	});

	test("flags only same-recording byte variants", () => {
		const a = "craig-" + "1".repeat(64);
		const b = "craig-" + "2".repeat(64);
		const c = "craig-" + "3".repeat(64);
		const catalog = new Map<string, LocalSourceSummary>([
			[a, { sourceId: a, sourceSha256: "1".repeat(64), recordingId: "recording-x", trackCount: 1 }],
			[b, { sourceId: b, sourceSha256: "2".repeat(64), recordingId: "recording-x", trackCount: 1 }],
			[c, { sourceId: c, sourceSha256: "3".repeat(64), recordingId: "recording-y", trackCount: 1 }],
		]);
		const conflicts = recordingVariantConflicts([a, b, c], catalog);
		expect(conflicts).toHaveLength(2);
		expect(conflicts.map((item) => item.sourceId).sort()).toEqual([a, b].sort());
	});
});
