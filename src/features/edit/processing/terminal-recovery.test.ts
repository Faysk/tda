import { describe, expect, it } from "vitest";
import type { LocalJob } from "./protocol";
import {
	processingJobRetryAvailable,
	terminalRecoveryActions,
} from "./terminal-recovery";

function job(
	kind: LocalJob["kind"],
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
		id: `${kind}-${status}`,
		kind,
		status,
		stage: status,
		progress: { completed: 0, total: kind === "benchmark.craig" ? 4 : 2, unit: "items" },
		error:
			recoverable === null
				? null
				: { code: errorCode, recoverable },
		result_available: status === "succeeded",
		updated_at: "2026-10-05T20:00:00Z",
		attempt: status === "queued" ? 0 : 1,
		context: {
			campaignId: kind === "benchmark.craig" ? "benchmark-local" : "yuhara-main",
			sessionId: kind === "benchmark.craig" ? "benchmark-local" : "session-1",
			sourceId: "craig-" + "a".repeat(64),
			...(kind === "transcription.craig" ? { profileId: "whisper-detailed" } : {}),
		},
	};
}

describe("terminal recovery actions", () => {
	it("separates new benchmark from retry and discard", () => {
		const failed = job("benchmark.craig", "failed", true);
		expect(terminalRecoveryActions(failed, true)).toEqual({
			canStartNew: true,
			canRetry: true,
			canDiscard: true,
			destination: "benchmark",
			newLabel: "Executar novo benchmark",
			retryLabel: "Repetir tentativa",
			discardLabel: "Descartar trabalho",
		});
	});

	it("does not offer retry for non-recoverable failures", () => {
		const failed = job("benchmark.craig", "failed", false, "WORKER_PROGRESS_GAP");
		expect(terminalRecoveryActions(failed, true)).toMatchObject({
			canStartNew: true,
			canRetry: false,
			canDiscard: true,
		});
	});

	it("keeps cancelled work new/discard only", () => {
		const cancelled = job("benchmark.craig", "cancelled");
		expect(terminalRecoveryActions(cancelled, true)).toMatchObject({
			canStartNew: true,
			canRetry: false,
			canDiscard: true,
		});
	});

	it("does not expose terminal actions to active work", () => {
		const running = job("benchmark.craig", "running");
		expect(terminalRecoveryActions(running, true)).toMatchObject({
			canStartNew: false,
			canRetry: false,
			canDiscard: false,
			destination: null,
		});
	});

	it("respects Companion delete support", () => {
		const failed = job("transcription.craig", "failed", true);
		expect(terminalRecoveryActions(failed, false)).toMatchObject({
			canStartNew: true,
			canRetry: true,
			canDiscard: false,
			destination: "overview",
		});
	});

	it("keeps the Qwen Fast uncertain-signal retry fail-closed", () => {
		const uncertain = {
			...job("transcription.craig", "failed", true, "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN"),
			context: {
				campaignId: "yuhara-main",
				sessionId: "session-1",
				sourceId: "craig-" + "a".repeat(64),
				profileId: "qwen-fast" as const,
			},
		} satisfies LocalJob;
		expect(processingJobRetryAvailable(uncertain)).toBe(false);
		expect(terminalRecoveryActions(uncertain, true)).toMatchObject({
			canStartNew: true,
			canRetry: false,
			canDiscard: true,
		});
	});

	it("allows a new job after success without calling it a retry", () => {
		const succeeded = job("transcription.craig", "succeeded");
		expect(terminalRecoveryActions(succeeded, true)).toMatchObject({
			canStartNew: true,
			canRetry: false,
			canDiscard: true,
			destination: "overview",
		});
	});
});
