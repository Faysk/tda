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
	runMatchesIntent,
	recordingVariantConflicts,
	retryableIntentJob,
	trustedTimelineOrderDiffers,
	trustedTimelineSourceOrder,
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
		physicalIntervalState: "first",
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
			policyVersion: "tda_session_timeline_v2",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			fingerprintSha256: "f".repeat(64),
			strategy: "trusted_absolute",
			wallClock: "unavailable",
			unknownIntervalCount: 0,
			state: "ready",
			allSourcesTrusted: false,
			automaticOrderAvailable: false,
			gapCount: 0,
			overlapCount: 0,
			orderConflictCount: 0,
			unresolvedOverlapCount: 0,
			unconfirmedGapCount: 0,
		},
	};
}

const CONTRACT = {
	profileId: "whisper-detailed",
	profileContractSha256: "b".repeat(64),
	contextSha256: "c".repeat(64),
	glossarySha256: "d".repeat(64),
} as const;

function run(
	sourceId: string,
	runId: string,
	overrides: Partial<LocalRunSummary> = {},
): LocalRunSummary {
	return {
		runId,
		sourceId,
		sourceSha256: sourceId.replace(/^craig-/u, ""),
		profileId: "whisper-detailed",
		profileContractSha256: CONTRACT.profileContractSha256,
		contextSha256: CONTRACT.contextSha256,
		glossarySha256: CONTRACT.glossarySha256,
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
		...overrides,
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

	test("selects the run produced by this intent before historical reuse", () => {
		const sourceId = "craig-" + "1".repeat(64);
		const target = part(sourceId);
		const runs = [
			run(sourceId, "run-old", { profileId: "qwen-quality" }),
			run(sourceId, "run-intent", { profileId: "qwen-quality" }),
		];
		expect(chooseIntentRun(target, runs, "run-intent", CONTRACT)).toEqual({
			kind: "automatic",
			runId: "run-intent",
			reason: "intent_job",
		});
	});

	test("reuses only a historical run with the exact intent contract", () => {
		const sourceId = "craig-" + "2".repeat(64);
		const exact = run(sourceId, "run-exact");
		expect(runMatchesIntent(exact, sourceId, CONTRACT)).toBe(true);
		expect(chooseIntentRun(part(sourceId), [exact], null, CONTRACT)).toEqual({
			kind: "automatic",
			runId: "run-exact",
			reason: "exact_match",
		});

		for (const incompatible of [
			run(sourceId, "profile", { profileId: "qwen-quality" }),
			run(sourceId, "recipe", { profileContractSha256: "e".repeat(64) }),
			run(sourceId, "context", { contextSha256: "e".repeat(64) }),
			run(sourceId, "glossary", { glossarySha256: "e".repeat(64) }),
			run(sourceId, "legacy-recipe", { profileContractSha256: null }),
			run(sourceId, "legacy-context", { contextSha256: null }),
			run(sourceId, "legacy-glossary", { glossarySha256: null }),
		]) {
			expect(chooseIntentRun(part(sourceId), [incompatible], null, CONTRACT)).toEqual({
				kind: "missing",
			});
		}
	});

	test("revalidates a persisted selected run against a new intent", () => {
		const sourceId = "craig-" + "3".repeat(64);
		const selected = run(sourceId, "run-chosen", { profileId: "qwen-quality" });
		expect(
			chooseIntentRun(part(sourceId, "run-chosen"), [selected], null, CONTRACT),
		).toEqual({ kind: "missing" });
		expect(
			chooseIntentRun(part(sourceId, "run-chosen"), [selected], null, undefined),
		).toEqual({ kind: "selected", runId: "run-chosen" });
	});

	test("chooses the newest exact historical run deterministically", () => {
		const sourceId = "craig-" + "4".repeat(64);
		const older = run(sourceId, "run-a", {
			completedAt: "2026-09-29T00:00:00.000Z",
		});
		const newer = run(sourceId, "run-b", {
			completedAt: "2026-09-30T00:00:00.000Z",
		});
		expect(chooseIntentRun(part(sourceId), [older, newer], null, CONTRACT)).toEqual({
			kind: "automatic",
			runId: "run-b",
			reason: "exact_match",
		});
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
				CONTRACT,
			),
		).toEqual({ total: 4, waiting: 1, running: 1, completed: 1, failed: 1 });
		expect(retryableIntentJob([job(c, "failed")], c)?.status).toBe("failed");
		expect(retryableIntentJob([job(b, "running")], b)).toBeNull();
	});

	test("compares trusted wall-clock order with editorial order without inventing timestamps", () => {
		const a = "craig-" + "a".repeat(64);
		const b = "craig-" + "b".repeat(64);
		const first = {
			...part(a),
			sourceStartConfidence: "trusted_absolute" as const,
			sourceStartUtc: "2026-10-04T21:00:00Z",
		};
		const second = {
			...part(b),
			sourceStartConfidence: "trusted_absolute" as const,
			sourceStartUtc: "2026-10-04T20:00:00Z",
		};
		const base = workspace([first, second]);
		const value: SessionWorkspace = {
			...base,
			orderingMode: "attachment",
			timeline: { ...base.timeline, automaticOrderAvailable: true },
		};
		expect(trustedTimelineSourceOrder(value)).toEqual([b, a]);
		expect(trustedTimelineOrderDiffers(value, [a, b])).toBe(true);
		expect(trustedTimelineOrderDiffers(value, [b, a])).toBe(false);
	});

	test("does not infer trusted chronology from missing clocks", () => {
		const a = "craig-" + "a".repeat(64);
		const b = "craig-" + "b".repeat(64);
		const first = {
			...part(a),
			sourceStartConfidence: "trusted_absolute" as const,
			sourceStartUtc: "2026-10-04T20:00:00Z",
		};
		const second = {
			...part(b),
			sourceStartConfidence: "missing" as const,
			sourceStartUtc: null,
		};
		const base = workspace([first, second]);
		const value: SessionWorkspace = {
			...base,
			orderingMode: "attachment",
			timeline: { ...base.timeline, automaticOrderAvailable: true },
		};
		expect(trustedTimelineSourceOrder(value)).toBeNull();
		expect(trustedTimelineOrderDiffers(value, [a, b])).toBe(false);
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
