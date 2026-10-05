import { describe, expect, it } from "vitest";
import {
	BENCHMARK_PROFILES,
	deriveBenchmarkAttemptUiState,
} from "./benchmark-outcomes";
import type {
	BenchmarkPartialResult,
	JobEvent,
	LocalJob,
} from "./protocol";

function job(
	status: LocalJob["status"] = "running",
	overrides: Partial<LocalJob> = {},
): LocalJob {
	return {
		id: "benchmark-job",
		kind: "benchmark.craig",
		status,
		stage: "benchmark",
		progress: { completed: 0, total: 4, unit: "profiles" },
		error: null,
		result_available: false,
		updated_at: "2026-10-04T20:00:00Z",
		attempt: 1,
		context: null,
		timing: null,
		executionDevice: null,
		...overrides,
	} as LocalJob;
}

function event(
	seq: number,
	code: string,
	profile: string,
	data: Record<string, string | number | boolean | null> = {},
): JobEvent {
	return {
		seq,
		attempt: 1,
		code,
		at: `2026-10-04T20:00:0${Math.min(seq, 9)}Z`,
		level: code.endsWith("FAILED") ? "warning" : "info",
		data: { stage: "benchmark", profile, ...data },
	};
}

function partial(): BenchmarkPartialResult {
	return {
		schemaVersion: "tda_processing_benchmark_partial_v1",
		status: "partial",
		jobId: "benchmark-job",
		sourceId: `craig-${"a".repeat(64)}`,
		campaignId: "benchmark-local",
		sessionId: "benchmark-local",
		sampleIdentitySha256: "b".repeat(64),
		sampleSeconds: 300,
		executionMode: "prepared_artifacts_fresh_worker_per_profile_v1",
		trackCount: 1,
		audioWorkSeconds: 300,
		prepared: true,
		benchmarkId: "benchmark-benchmark-job-a1",
		bundleManifestSha256: null,
		bundleSizeBytes: null,
		attemptedCount: 4,
		completedCount: 3,
		failedCount: 1,
		profiles: BENCHMARK_PROFILES.map((profileId) =>
			profileId === "qwen-fast"
				? {
						profileId,
						status: "failed" as const,
						artifactAvailable: false as const,
						error: {
							code: "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
							recoverable: true as const,
							scope: "profile" as const,
						},
						continuation: {
							decision: "continue" as const,
							reason: "profile_local_allowlist" as const,
						},
					}
				: {
						profileId,
						status: "completed" as const,
						artifactAvailable: true as const,
						transcriptSha256: "c".repeat(64),
						transcriptSizeBytes: 123,
					},
		),
	};
}

describe("deriveBenchmarkAttemptUiState", () => {
	it("keeps a failed Fast profile failed while Quality becomes current", () => {
		const state = deriveBenchmarkAttemptUiState(job(), [
			event(1, "BENCHMARK_PROFILE_STARTED", "whisper-turbo"),
			event(2, "BENCHMARK_PROFILE_COMPLETED", "whisper-turbo"),
			event(3, "BENCHMARK_PROFILE_STARTED", "whisper-detailed"),
			event(4, "BENCHMARK_PROFILE_COMPLETED", "whisper-detailed"),
			event(5, "BENCHMARK_PROFILE_STARTED", "qwen-fast"),
			event(6, "BENCHMARK_PROFILE_FAILED", "qwen-fast", {
				error_code: "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
				recoverable: true,
				scope: "profile",
				continuation: "continue",
			}),
			event(7, "BENCHMARK_PROFILE_STARTED", "qwen-quality"),
		]);

		expect(state.profiles.map((item) => item.status)).toEqual([
			"completed",
			"completed",
			"failed",
			"running",
		]);
		expect(state.attemptedCount).toBe(4);
		expect(state.completedCount).toBe(2);
		expect(state.failedCount).toBe(1);
		expect(state.currentProfile).toBe("qwen-quality");
		expect(state.profiles[2].errorCode).toBe(
			"QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
		);
		expect(state.profiles[2].continuation).toBe("continue");
	});

	it("uses terminal partial receipt as authoritative 3/4 state", () => {
		const value = partial();
		const state = deriveBenchmarkAttemptUiState(
			job("failed", {
				result_available: true,
				error: { code: "BENCHMARK_PARTIAL", recoverable: false },
			}),
			[],
			value,
		);
		expect(state.profiles.map((item) => item.status)).toEqual([
			"completed",
			"completed",
			"failed",
			"completed",
		]);
		expect(state.attemptedCount).toBe(4);
		expect(state.completedCount).toBe(3);
		expect(state.failedCount).toBe(1);
		expect(state.currentProfile).toBeNull();
	});

	it("marks later profiles not attempted after a benchmark-global failure", () => {
		const state = deriveBenchmarkAttemptUiState(
			job("failed", {
				error: { code: "BENCHMARK_PROFILE_EVIDENCE_INVALID", recoverable: false },
			}),
			[
				event(1, "BENCHMARK_PROFILE_STARTED", "whisper-turbo"),
				event(2, "BENCHMARK_PROFILE_FAILED", "whisper-turbo", {
					error_code: "BENCHMARK_PROFILE_EVIDENCE_INVALID",
					recoverable: false,
					scope: "benchmark",
					continuation: "stop",
				}),
			],
		);
		expect(state.profiles.map((item) => item.status)).toEqual([
			"failed",
			"not_attempted",
			"not_attempted",
			"not_attempted",
		]);
		expect(state.attemptedCount).toBe(1);
	});

	it("does not turn cancelled pending profiles into engine failures", () => {
		const state = deriveBenchmarkAttemptUiState(
			job("cancelled"),
			[event(1, "BENCHMARK_PROFILE_STARTED", "whisper-turbo")],
		);
		expect(state.profiles.map((item) => item.status)).toEqual([
			"cancelled",
			"not_attempted",
			"not_attempted",
			"not_attempted",
		]);
		expect(state.failedCount).toBe(0);
	});

	it("can fail the first profile and continue with the next independent profile", () => {
		const state = deriveBenchmarkAttemptUiState(job(), [
			event(1, "BENCHMARK_PROFILE_STARTED", "whisper-turbo"),
			event(2, "BENCHMARK_PROFILE_FAILED", "whisper-turbo", {
				error_code: "PROFILE_LOCAL_TEST_FAILURE",
				recoverable: true,
				scope: "profile",
				continuation: "continue",
			}),
			event(3, "BENCHMARK_PROFILE_STARTED", "whisper-detailed"),
		]);
		expect(state.profiles.map((item) => item.status)).toEqual([
			"failed",
			"running",
			"pending",
			"pending",
		]);
		expect(state.attemptedCount).toBe(2);
		expect(state.completedCount).toBe(0);
		expect(state.failedCount).toBe(1);
		expect(state.currentProfile).toBe("whisper-detailed");
	});

	it("keeps a last-profile failure distinct from the three accepted profiles", () => {
		const state = deriveBenchmarkAttemptUiState(
			job("failed", {
				error: { code: "BENCHMARK_PARTIAL", recoverable: false },
			}),
			[
				event(1, "BENCHMARK_PROFILE_STARTED", "whisper-turbo"),
				event(2, "BENCHMARK_PROFILE_COMPLETED", "whisper-turbo"),
				event(3, "BENCHMARK_PROFILE_STARTED", "whisper-detailed"),
				event(4, "BENCHMARK_PROFILE_COMPLETED", "whisper-detailed"),
				event(5, "BENCHMARK_PROFILE_STARTED", "qwen-fast"),
				event(6, "BENCHMARK_PROFILE_COMPLETED", "qwen-fast"),
				event(7, "BENCHMARK_PROFILE_STARTED", "qwen-quality"),
				event(8, "BENCHMARK_PROFILE_FAILED", "qwen-quality", {
					error_code: "PROFILE_LOCAL_TEST_FAILURE",
					recoverable: true,
					scope: "profile",
					continuation: "continue",
				}),
			],
		);
		expect(state.profiles.map((item) => item.status)).toEqual([
			"completed",
			"completed",
			"completed",
			"failed",
		]);
		expect(state.attemptedCount).toBe(4);
		expect(state.completedCount).toBe(3);
		expect(state.failedCount).toBe(1);
	});

	it("represents two independent profile-local failures without promoting the attempt", () => {
		const state = deriveBenchmarkAttemptUiState(
			job("failed", {
				error: { code: "BENCHMARK_PARTIAL", recoverable: false },
			}),
			[
				event(1, "BENCHMARK_PROFILE_STARTED", "whisper-turbo"),
				event(2, "BENCHMARK_PROFILE_COMPLETED", "whisper-turbo"),
				event(3, "BENCHMARK_PROFILE_STARTED", "whisper-detailed"),
				event(4, "BENCHMARK_PROFILE_FAILED", "whisper-detailed", {
					error_code: "PROFILE_LOCAL_TEST_FAILURE",
					recoverable: true,
					scope: "profile",
					continuation: "continue",
				}),
				event(5, "BENCHMARK_PROFILE_STARTED", "qwen-fast"),
				event(6, "BENCHMARK_PROFILE_FAILED", "qwen-fast", {
					error_code: "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
					recoverable: true,
					scope: "profile",
					continuation: "continue",
				}),
				event(7, "BENCHMARK_PROFILE_STARTED", "qwen-quality"),
				event(8, "BENCHMARK_PROFILE_COMPLETED", "qwen-quality"),
			],
		);
		expect(state.profiles.map((item) => item.status)).toEqual([
			"completed",
			"failed",
			"failed",
			"completed",
		]);
		expect(state.attemptedCount).toBe(4);
		expect(state.completedCount).toBe(2);
		expect(state.failedCount).toBe(2);
	});

	it("does not replay previous-attempt profile events while a retry is still queued", () => {
		const previousAttemptEvents = [
			event(1, "BENCHMARK_PROFILE_STARTED", "whisper-turbo"),
			event(2, "BENCHMARK_PROFILE_COMPLETED", "whisper-turbo"),
			event(3, "BENCHMARK_PROFILE_STARTED", "whisper-detailed"),
			event(4, "BENCHMARK_PROFILE_COMPLETED", "whisper-detailed"),
		];

		const state = deriveBenchmarkAttemptUiState(
			job("queued", {
				stage: "queued",
				progress: { completed: 0, total: 4, unit: "profiles" },
				// Store.action(retry) keeps the old attempt number until claim()
				// allocates the next running attempt.
				attempt: 1,
			}),
			previousAttemptEvents,
		);

		expect(state.profiles.map((item) => item.status)).toEqual([
			"pending",
			"pending",
			"pending",
			"pending",
		]);
		expect(state.attemptedCount).toBe(0);
		expect(state.completedCount).toBe(0);
		expect(state.failedCount).toBe(0);
		expect(state.pendingCount).toBe(4);
		expect(state.currentProfile).toBeNull();
	});

	it("keeps the scalar progress mapping only as a legacy fallback", () => {
		const state = deriveBenchmarkAttemptUiState(
			job("running", {
				progress: { completed: 2, total: 4, unit: "profiles" },
			}),
			[],
		);
		expect(state.profiles.map((item) => item.status)).toEqual([
			"completed",
			"completed",
			"running",
			"pending",
		]);
	});
});
