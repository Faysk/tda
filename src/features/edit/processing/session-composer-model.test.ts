import { describe, expect, it } from "vitest";
import type {
	LocalJob,
	LocalRunSummary,
	SessionWorkspace,
	SessionWorkspacePart,
} from "./protocol";
import {
	workspaceGenerationEligible,
	workspaceJobGenerationEligible,
	workspaceRunGenerationEligible,
} from "./session-composer-model";

const SOURCE_ID = "craig-" + "a".repeat(64);

function part(sourceId = SOURCE_ID): SessionWorkspacePart {
	return {
		partId: "p".repeat(32),
		sourceId,
		ordinal: 0,
		selectedRunId: null,
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
		createdAt: "2026-10-05T20:00:00.000Z",
		updatedAt: "2026-10-05T20:00:00.000Z",
	};
}

function job(overrides: Partial<LocalJob> = {}): LocalJob {
	return {
		id: "job-current",
		kind: "transcription.craig",
		status: "failed",
		stage: "failed",
		progress: null,
		error: { code: "FIXTURE", recoverable: true },
		result_available: false,
		updated_at: "2026-10-05T20:00:00.001Z",
		attempt: 1,
		context: {
			campaignId: "campaign",
			sessionId: "session",
			sourceId: SOURCE_ID,
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
		...overrides,
	};
}

function workspace(freshStartAt: string | null): SessionWorkspace {
	return {
		schemaVersion: "tda_session_workspace_v1",
		campaignId: "campaign",
		sessionId: "session",
		revision: 1,
		orderingMode: "attachment",
		createdAt: "2026-10-05T20:00:00.000Z",
		updatedAt: "2026-10-05T20:00:00.000Z",
		freshStartAt,
		freshStartExcludedJobIds: [],
		parts: [part()],
		timeline: {
			policyVersion: "tda_session_timeline_v2",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			fingerprintSha256: "a".repeat(64),
			strategy: "unresolved",
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

describe("workspaceGenerationEligible", () => {
	it("preserves legacy behavior when no fresh-start cutoff exists", () => {
		expect(workspaceGenerationEligible(workspace(null), null)).toBe(true);
		expect(
			workspaceGenerationEligible(
				workspace(null),
				"2020-01-01T00:00:00.000Z",
			),
		).toBe(true);
	});

	it("rejects old or undated evidence and accepts only the current generation", () => {
		const value = workspace("2026-10-05T20:00:00.000Z");
		expect(
			workspaceGenerationEligible(value, "2026-10-05T19:59:59.999Z"),
		).toBe(false);
		expect(workspaceGenerationEligible(value, null)).toBe(false);
		expect(
			workspaceGenerationEligible(value, "2026-10-05T20:00:00.000Z"),
		).toBe(true);
		expect(
			workspaceGenerationEligible(value, "2026-10-05T20:00:00.001Z"),
		).toBe(true);
	});

	it("keeps runs from excluded historical jobs out even if they finish after reset", () => {
		const current = {
			...workspace("2026-10-05T20:00:00.000Z"),
			freshStartExcludedJobIds: ["job-before-reset"],
		};
		const run = {
			runId: "run-job-before-reset-a2",
			sourceId: SOURCE_ID,
			jobId: "job-before-reset",
			profileId: "whisper-detailed",
			engine: "whisper",
			model: "fixture",
			modelRevision: null,
			device: "cuda",
			computeType: "float16",
			alignment: "none",
			executionLineage: null,
			language: "pt",
			completedAt: "2026-10-05T20:00:05.000Z",
			intentFingerprint: "b".repeat(64),
			transcriptSha256: "c".repeat(64),
			transcriptSizeBytes: 1,
			stats: {
				audioWorkSeconds: null,
				processingSeconds: null,
				sessionDurationSeconds: null,
				rtf: null,
				wordCount: null,
				segmentCount: null,
				trackCount: null,
				turnCount: null,
				deduplicatedSegmentCount: null,
				warningCount: null,
			},
			publicationTarget: null,
			review: null,
		} satisfies LocalRunSummary;

		expect(workspaceRunGenerationEligible(current, run)).toBe(false);
		expect(
			workspaceRunGenerationEligible(current, {
				...run,
				jobId: "job-after-reset",
			}),
		).toBe(true);
	});

	it("accepts only transcription jobs owned by this campaign/session/source generation", () => {
		const current = workspace("2026-10-05T20:00:00.000Z");
		expect(workspaceJobGenerationEligible(current, job())).toBe(true);
		expect(
			workspaceJobGenerationEligible(
				current,
				job({
					id: "job-other-session",
					context: {
						campaignId: "campaign",
						sessionId: "other-session",
						sourceId: SOURCE_ID,
					},
				}),
			),
		).toBe(false);
		expect(
			workspaceJobGenerationEligible(
				current,
				job({
					id: "job-other-campaign",
					context: {
						campaignId: "other-campaign",
						sessionId: "session",
						sourceId: SOURCE_ID,
					},
				}),
			),
		).toBe(false);
		expect(
			workspaceJobGenerationEligible(
				current,
				job({
					id: "job-other-source",
					context: {
						campaignId: "campaign",
						sessionId: "session",
						sourceId: "craig-" + "b".repeat(64),
					},
				}),
			),
		).toBe(false);
		expect(
			workspaceJobGenerationEligible(
				{ ...current, freshStartExcludedJobIds: ["job-current"] },
				job(),
			),
		).toBe(false);
		expect(
			workspaceJobGenerationEligible(
				current,
				job({
					id: "job-old",
					updated_at: "2026-10-05T19:59:59.999Z",
				}),
			),
		).toBe(false);
	});
});
