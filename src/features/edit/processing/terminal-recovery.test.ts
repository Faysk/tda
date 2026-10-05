import { describe, expect, test } from "vitest";
import type { LocalJob } from "./protocol";
import { terminalRecoveryActions } from "./terminal-recovery";

function job(
	status: LocalJob["status"],
	recoverable: boolean | null = null,
	errorCode = "WORKER_EXECUTION_FAILED",
): LocalJob {
	return {
		timing: {
			schemaVersion: "tda_job_timing_v1",
			attemptStartedAt: null,
			attemptFinishedAt: null,
			attemptElapsedSeconds: null,
			stageStartedAt: null,
			stageElapsedSeconds: null,
			tracks: [],
		},
		id: `job-${status}`,
		kind: "benchmark.craig",
		status,
		stage: status,
		progress: { completed: 0, total: 4, unit: "profiles" },
		error:
			recoverable === null
				? null
				: { code: errorCode, recoverable },
		result_available: status === "succeeded",
		updated_at: "2026-10-05T20:00:00Z",
		attempt: status === "queued" ? 0 : 1,
		context: {
			campaignId: "benchmark-local",
			sessionId: "benchmark-local",
			sourceId: "craig-" + "a".repeat(64),
			profiles: [
				"whisper-turbo",
				"whisper-detailed",
				"qwen-fast",
				"qwen-quality",
			],
		},
	};
}

describe("terminal recovery actions", () => {
	test.each([
		["failed", true, true],
		["failed", false, false],
		["interrupted", true, true],
		["interrupted", false, false],
		["cancelled", null, false],
		["succeeded", null, false],
	] as const)(
		"%s exposes new/discard while retry follows recoverability",
		(status, recoverable, retry) => {
			const value = terminalRecoveryActions(job(status, recoverable), true);
			expect(value).toEqual({
				canStartNew: true,
				canRetry: retry,
				canDiscard: true,
				canDiagnose: true,
			});
		},
	);

	test.each(["queued", "running"] as const)(
		"%s is not disposable terminal work",
		(status) => {
			const value = terminalRecoveryActions(job(status), true);
			expect(value.canStartNew).toBe(false);
			expect(value.canRetry).toBe(false);
			expect(value.canDiscard).toBe(false);
			expect(value.canDiagnose).toBe(true);
		},
	);

	test("discard remains gated by Companion support", () => {
		expect(terminalRecoveryActions(job("failed", true), false).canDiscard).toBe(
			false,
		);
	});

	test("does not offer Start New for synthetic maintenance jobs", () => {
		const synthetic: LocalJob = {
			...job("failed", true),
			id: "synthetic-failed",
			kind: "synthetic.fixture",
			progress: { completed: 0, total: 1, unit: "items" },
			context: {
				campaignId: "synthetic-campaign",
				sessionId: "synthetic-session",
				sourceId: "synthetic-source",
			},
		};
		const value = terminalRecoveryActions(synthetic, true);
		expect(value.canStartNew).toBe(false);
		expect(value.canRetry).toBe(true);
		expect(value.canDiscard).toBe(true);
	});

	test("inherits the existing futile-retry guard for Qwen Fast uncertain signal", () => {
		const uncertain: LocalJob = {
			...job("failed", true, "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN"),
			kind: "transcription.craig",
			context: {
				campaignId: "campaign",
				sessionId: "session",
				sourceId: "craig-" + "b".repeat(64),
				profileId: "qwen-fast" as const,
			},
		};
		expect(terminalRecoveryActions(uncertain, true).canRetry).toBe(false);
	});
});
