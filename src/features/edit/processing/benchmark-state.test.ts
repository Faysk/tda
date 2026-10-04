import { describe, expect, it } from "vitest";
import type { JobEvent } from "./protocol";
import { deriveBenchmarkLiveState } from "./benchmark-state";

function event(
	seq: number,
	code: string,
	data: JobEvent["data"],
): JobEvent {
	return {
		seq,
		attempt: 1,
		code,
		at: "2026-10-04T20:00:00Z",
		level: code.endsWith("FAILED") ? "warning" : "info",
		data,
	};
}

describe("deriveBenchmarkLiveState", () => {
	it("keeps a failed Fast profile visible while Quality becomes current", () => {
		const state = deriveBenchmarkLiveState(
			[
				event(1, "BENCHMARK_PROFILE_STARTED", {
					profile: "whisper-turbo",
					attempted_count: 1,
					completed_count: 0,
					failed_count: 0,
					total: 4,
				}),
				event(2, "BENCHMARK_PROFILE_COMPLETED", {
					profile: "whisper-turbo",
					attempted_count: 1,
					completed_count: 1,
					failed_count: 0,
					total: 4,
				}),
				event(3, "BENCHMARK_PROFILE_STARTED", {
					profile: "whisper-detailed",
					attempted_count: 2,
					completed_count: 1,
					failed_count: 0,
					total: 4,
				}),
				event(4, "BENCHMARK_PROFILE_COMPLETED", {
					profile: "whisper-detailed",
					attempted_count: 2,
					completed_count: 2,
					failed_count: 0,
					total: 4,
				}),
				event(5, "BENCHMARK_PROFILE_STARTED", {
					profile: "qwen-fast",
					attempted_count: 3,
					completed_count: 2,
					failed_count: 0,
					total: 4,
				}),
				event(6, "BENCHMARK_PROFILE_FAILED", {
					profile: "qwen-fast",
					attempted_count: 3,
					completed_count: 2,
					failed_count: 1,
					total: 4,
					error_code: "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
					recoverable: true,
					scope: "profile",
					continuation: "continue",
				}),
				event(7, "BENCHMARK_PROFILE_STARTED", {
					profile: "qwen-quality",
					attempted_count: 4,
					completed_count: 2,
					failed_count: 1,
					total: 4,
				}),
			],
			3,
			"running",
		);

		expect(state.attempted).toBe(4);
		expect(state.completed).toBe(2);
		expect(state.failed).toBe(1);
		expect(state.currentProfile).toBe("qwen-quality");
		expect(state.profiles.map(({ profileId, status }) => [profileId, status])).toEqual([
			["whisper-turbo", "completed"],
			["whisper-detailed", "completed"],
			["qwen-fast", "failed"],
			["qwen-quality", "running"],
		]);
		expect(state.profiles[2]?.errorCode).toBe(
			"QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
		);
	});

	it("keeps backward-compatible scalar progress when structured events are absent", () => {
		const state = deriveBenchmarkLiveState([], 2, "running");
		expect(state.completed).toBe(2);
		expect(state.currentProfile).toBe("qwen-fast");
		expect(state.profiles.map(({ status }) => status)).toEqual([
			"completed",
			"completed",
			"running",
			"pending",
		]);
	});
});
