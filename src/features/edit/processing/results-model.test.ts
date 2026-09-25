import { describe, expect, test } from "vitest";
import type { LocalRunSummary } from "./protocol";
import {
	compatibleRunCount,
	runReviewLabel,
	runSessionLabel,
	selectRuns,
} from "./results-model";

function run(
	runId: string,
	overrides: Partial<LocalRunSummary> = {},
): LocalRunSummary {
	return {
		runId,
		sourceId: "craig-" + "a".repeat(64),
		profileId: "qwen-quality",
		engine: "qwen3",
		model: "qwen-test",
		modelRevision: "rev",
		device: "cuda",
		computeType: "float16",
		alignment: "forced",
		executionLineage: null,
		language: "pt",
		completedAt: "2026-09-24T12:00:00.000Z",
		transcriptSha256: "b".repeat(64),
		transcriptSizeBytes: 1200,
		stats: {
			audioWorkSeconds: 120,
			processingSeconds: 30,
			sessionDurationSeconds: 120,
			rtf: 0.25,
			wordCount: 100,
			segmentCount: 20,
			trackCount: 2,
			turnCount: 12,
			deduplicatedSegmentCount: 3,
			warningCount: 0,
		},
		publicationTarget: null,
		reviewSummary: null,
		...overrides,
	};
}

const runs = [
	run("run-new", {
		publicationTarget: {
			campaignSlug: "yuhara-main",
			sourceSessionId: "sessao-yuhara",
			jobId: "job-new",
			attempt: 1,
		},
		reviewSummary: {
			status: "reviewed",
			draftRevision: 2,
			updatedAt: "2026-09-24T13:00:00.000Z",
		},
	}),
	run("run-warning", {
		profileId: "whisper-detailed",
		engine: "faster-whisper",
		completedAt: "2026-09-23T12:00:00.000Z",
		stats: {
			audioWorkSeconds: 120,
			processingSeconds: 12,
			sessionDurationSeconds: 120,
			rtf: 0.1,
			wordCount: 120,
			segmentCount: 24,
			trackCount: 2,
			turnCount: 15,
			deduplicatedSegmentCount: 0,
			warningCount: 4,
		},
		reviewSummary: {
			status: "draft",
			draftRevision: 1,
			updatedAt: "2026-09-23T12:10:00.000Z",
		},
	}),
	run("run-legacy", {
		sourceId: "craig-" + "c".repeat(64),
		profileId: "qwen-fast",
		completedAt: "2026-08-01T12:00:00.000Z",
		stats: {
			audioWorkSeconds: 60,
			processingSeconds: 40,
			sessionDurationSeconds: 60,
			rtf: 0.66,
			wordCount: 70,
			segmentCount: 14,
			trackCount: 1,
			turnCount: 10,
			deduplicatedSegmentCount: 2,
			warningCount: 0,
		},
		reviewSummary: {
			status: "invalid",
			draftRevision: null,
			updatedAt: null,
		},
	}),
];

describe("results model", () => {
	test("uses session target when available and keeps review state explicit", () => {
		expect(runSessionLabel(runs[0]!)).toBe("sessao-yuhara");
		expect(runReviewLabel(runs[0]!)).toBe("Revisado");
		expect(runReviewLabel(run("raw"))).toBe("ASR concluído");
		expect(runReviewLabel(runs[2]!)).toBe("Revisão indisponível");
	});

	test("filters by search/profile/engine/warnings/review/date without inventing values", () => {
		const base = {
			query: "",
			profile: "all",
			engine: "all",
			warnings: "all" as const,
			review: "all" as const,
			lineage: "all" as const,
			date: "all" as const,
			sort: "newest" as const,
			nowMs: Date.parse("2026-09-25T12:00:00.000Z"),
		};
		expect(selectRuns(runs, { ...base, query: "sessao-yuhara" }).map((x) => x.runId)).toEqual(["run-new"]);
		expect(selectRuns(runs, { ...base, profile: "whisper-detailed" }).map((x) => x.runId)).toEqual(["run-warning"]);
		expect(selectRuns(runs, { ...base, engine: "qwen3" }).map((x) => x.runId)).toEqual(["run-new", "run-legacy"]);
		expect(selectRuns(runs, { ...base, warnings: "warnings" }).map((x) => x.runId)).toEqual(["run-warning"]);
		expect(selectRuns(runs, { ...base, review: "draft" }).map((x) => x.runId)).toEqual(["run-warning"]);
		expect(selectRuns(runs, { ...base, date: "7d" }).map((x) => x.runId)).toEqual(["run-new", "run-warning"]);
	});

	test("sorting is factual and keeps missing metrics last", () => {
		const base = {
			query: "",
			profile: "all",
			engine: "all",
			warnings: "all" as const,
			review: "all" as const,
			lineage: "all" as const,
			date: "all" as const,
			nowMs: Date.parse("2026-09-25T12:00:00.000Z"),
		};
		expect(selectRuns(runs, { ...base, sort: "rtf" }).map((x) => x.runId)).toEqual(["run-warning", "run-new", "run-legacy"]);
		expect(selectRuns(runs, { ...base, sort: "duration" }).map((x) => x.runId)).toEqual(["run-warning", "run-new", "run-legacy"]);
		expect(selectRuns(runs, { ...base, sort: "warnings" }).map((x) => x.runId)[0]).toBe("run-warning");
	});

	test("comparison eligibility is source-bound only", () => {
		const sameSource = run("run-same-source-2");
		expect(compatibleRunCount([...runs, sameSource], runs[0]!)).toBe(3);
		expect(compatibleRunCount(runs, runs[2]!)).toBe(1);
	});
});
