import { describe, expect, it } from "vitest";
import {
	retainSessionAssemblyReview,
	shouldApplySessionAssemblyResult,
	type SessionAssemblyReviewSelection,
} from "./session-assembly-results-model";

const reviewSelection = {
	sessionId: "session-a",
	review: {
		schemaVersion: "tda_local_review_summary_v1",
		assemblyId: "a".repeat(64),
		status: "draft",
		segmentCount: 12,
		reviewedSegments: 3,
		reviewPercent: 25,
		approvalBlocked: false,
		baseTranscriptSha256: "b".repeat(64),
		persistence: "base",
		draftRevision: null,
	},
} as unknown as SessionAssemblyReviewSelection;

describe("session assembly results session fence", () => {
	it("retains an opened review only while the active session identity is unchanged", () => {
		expect(retainSessionAssemblyReview(reviewSelection, "session-a")).toBe(
			reviewSelection,
		);
		expect(retainSessionAssemblyReview(reviewSelection, "session-b")).toBeNull();
		expect(retainSessionAssemblyReview(reviewSelection, null)).toBeNull();
	});

	it("rejects late responses from an older refresh generation", () => {
		expect(
			shouldApplySessionAssemblyResult({
				requestGeneration: 4,
				currentGeneration: 5,
				requestSessionId: "session-a",
				currentSessionId: "session-a",
			}),
		).toBe(false);
	});

	it("rejects a response when the active session changed while it was in flight", () => {
		expect(
			shouldApplySessionAssemblyResult({
				requestGeneration: 5,
				currentGeneration: 5,
				requestSessionId: "session-a",
				currentSessionId: "session-b",
			}),
		).toBe(false);
	});

	it("accepts only the current generation for the current session", () => {
		expect(
			shouldApplySessionAssemblyResult({
				requestGeneration: 5,
				currentGeneration: 5,
				requestSessionId: "session-b",
				currentSessionId: "session-b",
			}),
		).toBe(true);
	});
});
