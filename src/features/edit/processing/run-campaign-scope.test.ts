import { describe, expect, it } from "vitest";
import type { LocalRunSummary } from "./protocol";
import { localRunMatchesCampaign, scopeLocalRunsToCampaign } from "./run-campaign-scope";

function run(
	runId: string,
	campaignSlug: string | null,
): LocalRunSummary {
	return {
		runId,
		sourceId: `source-${runId}`,
		profileId: "qwen-quality",
		engine: "qwen",
		model: null,
		modelRevision: null,
		device: null,
		computeType: null,
		alignment: null,
		executionLineage: null,
		language: "pt",
		completedAt: "2026-10-03T12:00:00Z",
		transcriptSha256: "a".repeat(64),
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
		publicationTarget:
			campaignSlug === null
				? null
				: {
						campaignSlug,
						sourceSessionId: `session-${runId}`,
						jobId: `job-${runId}`,
						attempt: 1,
					},
		review: null,
	};
}

describe("processing local run campaign scope", () => {
	it("shows only target-bound runs as campaign results", () => {
		const a = run("a", "campaign-a");
		const b = run("b", "campaign-b");
		const unbound = run("legacy", null);
		const scoped = scopeLocalRunsToCampaign([a, b, unbound], "campaign-a");

		expect(scoped.campaignRuns.map((item) => item.runId)).toEqual(["a"]);
		expect(scoped.recoveryRuns.map((item) => item.runId)).toEqual(["legacy"]);
		expect(localRunMatchesCampaign(a, "campaign-a")).toBe(true);
		expect(localRunMatchesCampaign(b, "campaign-a")).toBe(false);
		expect(localRunMatchesCampaign(unbound, "campaign-a")).toBe(false);
	});

	it("does not infer the active campaign for an unbound run", () => {
		const unbound = run("legacy", null);
		expect(scopeLocalRunsToCampaign([unbound], "campaign-b").campaignRuns).toEqual([]);
		expect(scopeLocalRunsToCampaign([unbound], "campaign-b").recoveryRuns).toEqual([unbound]);
	});
});
