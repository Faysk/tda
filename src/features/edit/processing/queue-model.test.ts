import { describe, expect, test } from "vitest";
import type { LocalJob, TranscriptionProfileId } from "./protocol";
import {
	compactQueueId,
	queueFilterCount,
	queuePrimaryIdentity,
	queueProfileLabel,
	selectQueueJobs,
} from "./queue-model";

function job(
	id: string,
	status: LocalJob["status"],
	sessionId: string,
	profileId: TranscriptionProfileId,
	updated_at: string,
): LocalJob {
	return {
		id,
		kind: "transcription.craig",
		status,
		stage: status === "running" ? "transcription" : status,
		progress: { completed: status === "queued" ? 0 : 1, total: 4, unit: "tracks" },
		error:
			status === "failed"
				? { code: "QWEN_ALIGNMENT_REQUIRED", recoverable: true }
				: null,
		result_available: status === "succeeded",
		updated_at,
		attempt: status === "queued" ? 0 : 1,
		context: {
			campaignId: "yuhara-main",
			sessionId,
			sourceId: `source-${id}`,
			profileId,
		},
	};
}

const jobs = [
	job("run", "running", "sessao-z", "qwen-quality", "2026-09-25T10:00:00Z"),
	job("queued", "queued", "sessao-a", "whisper-turbo", "2026-09-25T10:02:00Z"),
	job("failed", "failed", "sessao-b", "qwen-quality", "2026-09-25T10:03:00Z"),
	job("done", "succeeded", "sessao-c", "whisper-turbo", "2026-09-25T10:04:00Z"),
	job("cancel", "cancelled", "sessao-d", "qwen-quality", "2026-09-25T10:05:00Z"),
];

describe("queue model", () => {
	test("default active scope excludes terminal history", () => {
		expect(selectQueueJobs(jobs, "active", "", "updated").map((item) => item.id)).toEqual([
			"run",
			"queued",
		]);
		expect(queueFilterCount(jobs, "cancelled")).toBe(1);
		expect(queueFilterCount(jobs, "all")).toBe(5);
	});

	test("attention and completed scopes are explicit", () => {
		expect(selectQueueJobs(jobs, "attention", "", "updated").map((item) => item.id)).toEqual([
			"failed",
		]);
		expect(selectQueueJobs(jobs, "completed", "", "updated").map((item) => item.id)).toEqual([
			"done",
		]);
	});

	test("search includes session, source, profile and job id", () => {
		expect(selectQueueJobs(jobs, "all", "sessao-b", "updated")[0]?.id).toBe("failed");
		expect(selectQueueJobs(jobs, "all", "Whisper Turbo", "updated").map((item) => item.id)).toEqual([
			"done",
			"queued",
		]);
		expect(selectQueueJobs(jobs, "all", "source-cancel", "updated")[0]?.id).toBe("cancel");
		expect(selectQueueJobs(jobs, "all", "queued", "updated")[0]?.id).toBe("queued");
	});

	test("running remains pinned above history regardless of selected sort", () => {
		for (const sort of ["updated", "status", "profile", "session"] as const) {
			expect(selectQueueJobs(jobs, "all", "", sort)[0]?.id).toBe("run");
		}
	});

	test("human presentation helpers stay deterministic", () => {
		expect(queueProfileLabel("qwen-quality")).toBe("Qwen Quality");
		expect(queueProfileLabel("qwen-fast")).toBe("Qwen Fast");
		expect(queueProfileLabel("whisper-detailed")).toBe("Whisper Detailed");
		expect(queueProfileLabel("custom-fast_profile")).toBe("Custom Fast Profile");
		expect(queuePrimaryIdentity(jobs[0]!)).toBe("sessao-z");
		expect(compactQueueId("abcdefghijklmnopqrstuvwxyz", 6, 4)).toBe("abcdef…wxyz");
	});
});
