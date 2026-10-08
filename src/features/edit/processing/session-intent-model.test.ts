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
	singleRecordingZeroAnchor,
	intentProgress,
	recordingVariantConflicts,
	retryableIntentJob,
	terminalIntentJob,
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

describe("single untimed recording placement", () => {
	const unplaced = () => {
		const value = workspace([{ ...part("source-one", "run-one"), sessionOffsetSeconds: null }]);
		value.timeline.state = "needs_timing";
		return value;
	};
	test("anchors one completed untrimmed recording without inventing wall clock", () => {
		const value = unplaced();
		expect(singleRecordingZeroAnchor(value)?.partId).toBe(value.parts[0].partId);
		expect(value.parts[0].sourceStartUtc).toBeNull();
		value.parts[0].sessionOffsetSeconds = 0;
		expect(singleRecordingZeroAnchor(value)).toBeNull();
	});
	test("preserves multiple recordings and operator timing decisions", () => {
		const multiple = unplaced();
		multiple.parts.push(part("source-two", "run-two"));
		expect(singleRecordingZeroAnchor(multiple)).toBeNull();
		for (const change of [
			{ selectedRunId: null }, { sourceState: "invalid" },
			{ trimStartSeconds: 1 }, { trimEndSeconds: 0.5 },
			{ sessionOffsetSeconds: 5 }, { timelineMode: "manual" },
			{ sourceStartConfidence: "ambiguous" },
			{ sourceStartConfidence: "trusted_absolute" },
			{ sourceDurationSeconds: null },
		] as Partial<SessionWorkspacePart>[]) {
			const value = unplaced();
			Object.assign(value.parts[0], change);
			expect(singleRecordingZeroAnchor(value)).toBeNull();
		}
	});
});

function run(
	sourceId: string,
	runId: string,
	intentFingerprint: string | null = "f".repeat(64),
	transcriptSha256 = "a".repeat(64),
): LocalRunSummary {
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
		intentFingerprint,
		transcriptSha256,
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
		expect(chooseIntentRun(target, runs, "run-intent", "f".repeat(64))).toEqual({
			kind: "automatic",
			runId: "run-intent",
			reason: "intent_job",
		});
		expect(chooseIntentRun(target, runs, null, "f".repeat(64))).toEqual({
			kind: "automatic",
			runId: "run-old",
			reason: "exact_match",
		});
		expect(
			chooseIntentRun(
				part(sourceId, "run-intent"),
				runs,
				"run-intent",
				"f".repeat(64),
			),
		).toEqual({ kind: "selected", runId: "run-intent" });
	});

	test("reuses only exact fingerprint matches and revalidates selected runs", () => {
		const sourceId = "craig-" + "2".repeat(64);
		const exact = run(sourceId, "run-exact", "f".repeat(64));
		const incompatible = run(sourceId, "run-old", "e".repeat(64));
		expect(
			chooseIntentRun(part(sourceId), [incompatible, exact], null, "f".repeat(64)),
		).toEqual({
			kind: "automatic",
			runId: "run-exact",
			reason: "exact_match",
		});
		expect(
			chooseIntentRun(
				part(sourceId, "run-old"),
				[incompatible, exact],
				null,
				"f".repeat(64),
			),
		).toEqual({
			kind: "automatic",
			runId: "run-exact",
			reason: "exact_match",
		});
		expect(
			chooseIntentRun(
				part(sourceId, "run-exact"),
				[incompatible, exact],
				null,
				"f".repeat(64),
			),
		).toEqual({ kind: "selected", runId: "run-exact" });
	});

	test("never reuses a legacy or incompatible singleton just because it is the only run", () => {
		const sourceId = "craig-" + "9".repeat(64);
		expect(
			chooseIntentRun(
				part(sourceId),
				[run(sourceId, "run-legacy", null)],
				null,
				"f".repeat(64),
			),
		).toEqual({ kind: "missing" });
		expect(
			chooseIntentRun(
				part(sourceId),
				[run(sourceId, "run-other-profile", "e".repeat(64))],
				null,
				"f".repeat(64),
			),
		).toEqual({ kind: "missing" });
	});

	test("keeps exact runs ambiguous when identical inputs produced different transcripts", () => {
		const sourceId = "craig-" + "8".repeat(64);
		const runs = [
			run(sourceId, "run-a", "f".repeat(64), "a".repeat(64)),
			run(sourceId, "run-b", "f".repeat(64), "b".repeat(64)),
		];
		expect(chooseIntentRun(part(sourceId), runs, null, "f".repeat(64))).toEqual({
			kind: "ambiguous",
			runIds: ["run-a", "run-b"],
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
				"f".repeat(64),
			),
		).toEqual({ total: 4, waiting: 1, running: 1, completed: 1, failed: 1 });
		expect(retryableIntentJob([job(c, "failed")], c)?.status).toBe("failed");
		expect(retryableIntentJob([job(b, "running")], b)).toBeNull();
		const nonRecoverable = {
			...job(c, "failed"),
			error: { code: "WORKER_PROGRESS_GAP", recoverable: false },
		};
		expect(terminalIntentJob([nonRecoverable], c)?.status).toBe("failed");
		expect(retryableIntentJob([nonRecoverable], c)).toBeNull();
		expect(retryableIntentJob([job(c, "cancelled")], c)).toBeNull();
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
