import { describe, expect, it } from "vitest";
import { parseBenchmarkAttemptResult } from "./protocol";

const JOB_ID = "benchmark-job";
const BENCHMARK_ID = "benchmark-benchmark-job-a1";
const SAMPLE_SHA = "b".repeat(64);

function completed(profileId: string) {
	return {
		profile_id: profileId,
		status: "completed",
		artifact_available: true,
		receipt: {
			schema_version: "tda_benchmark_profile_v1",
			profile_id: profileId,
			benchmark_id: BENCHMARK_ID,
			sample_identity_sha256: SAMPLE_SHA,
			artifact_available: true,
			transcript_sha256: "c".repeat(64),
			transcript_size_bytes: 321,
		},
	};
}

function failed(profileId: string) {
	return {
		profile_id: profileId,
		status: "failed",
		artifact_available: false,
		error: {
			code: "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
			recoverable: true,
			scope: "profile",
		},
		continuation: {
			decision: "continue",
			reason: "profile_local_allowlist",
		},
	};
}

function payload() {
	return {
		schema_version: "tda_processing_benchmark_partial_v1",
		kind: "benchmark.craig",
		status: "partial",
		job_id: JOB_ID,
		source_id: `craig-${"a".repeat(64)}`,
		campaign_id: "benchmark-local",
		session_id: "benchmark-local",
		sample_identity_sha256: SAMPLE_SHA,
		sample_seconds: 300,
		execution_mode: "prepared_artifacts_fresh_worker_per_profile_v1",
		track_count: 1,
		audio_work_seconds: 300,
		prepared: true,
		benchmark_id: BENCHMARK_ID,
		bundle_manifest_sha256: null,
		bundle_size_bytes: null,
		attempted_count: 4,
		completed_count: 3,
		failed_count: 1,
		profiles: [
			completed("whisper-turbo"),
			completed("whisper-detailed"),
			failed("qwen-fast"),
			completed("qwen-quality"),
		],
	};
}

describe("partial Benchmark protocol", () => {
	it("accepts an explicit 3/4 partial receipt without promoting it to a full result", () => {
		const result = parseBenchmarkAttemptResult(payload(), JOB_ID);
		expect(result.schemaVersion).toBe("tda_processing_benchmark_partial_v1");
		if (result.schemaVersion !== "tda_processing_benchmark_partial_v1")
			throw new Error("expected partial result");
		expect(result.completedCount).toBe(3);
		expect(result.failedCount).toBe(1);
		expect(result.bundleManifestSha256).toBeNull();
		expect(result.profiles.map((item) => item.status)).toEqual([
			"completed",
			"completed",
			"failed",
			"completed",
		]);
	});

	it("rejects duplicate or reordered profile identity", () => {
		const value = payload();
		value.profiles[3] = completed("qwen-fast");
		expect(() => parseBenchmarkAttemptResult(value, JOB_ID)).toThrow();
	});

	it("rejects a completed profile without a preserved artifact receipt", () => {
		const value = payload();
		value.profiles[0] = {
			...completed("whisper-turbo"),
			artifact_available: false,
		};
		expect(() => parseBenchmarkAttemptResult(value, JOB_ID)).toThrow();
	});

	it("rejects profile-local failures that do not explicitly continue", () => {
		const value = payload();
		value.profiles[2] = {
			...failed("qwen-fast"),
			continuation: { decision: "stop", reason: "benchmark_global" },
		};
		expect(() => parseBenchmarkAttemptResult(value, JOB_ID)).toThrow();
	});

	it("rejects count drift and any fake bundle metadata on a partial attempt", () => {
		const value = payload();
		value.completed_count = 4;
		value.failed_count = 0;
		value.bundle_manifest_sha256 = "d".repeat(64);
		expect(() => parseBenchmarkAttemptResult(value, JOB_ID)).toThrow();
	});
});
