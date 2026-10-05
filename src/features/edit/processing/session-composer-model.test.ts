import { describe, expect, it } from "vitest";
import type { SessionWorkspace } from "./protocol";
import { workspaceGenerationEligible } from "./session-composer-model";

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
		parts: [],
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
});
