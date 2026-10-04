import { describe, expect, it } from "vitest";
import {
	focusedSessionAssemblyIsReady,
	nextSessionAssemblyReviewFocus,
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


describe("session assembly review focus", () => {
	it("increments an explicit request and keeps the exact session/assembly identity", () => {
		const first = nextSessionAssemblyReviewFocus(
			null,
			"session-a",
			"a".repeat(64),
		);
		const second = nextSessionAssemblyReviewFocus(
			first,
			"session-b",
			"b".repeat(64),
		);
		expect(first).toEqual({
			sessionId: "session-a",
			assemblyId: "a".repeat(64),
			requestId: 1,
		});
		expect(second).toEqual({
			sessionId: "session-b",
			assemblyId: "b".repeat(64),
			requestId: 2,
		});
	});

	it("opens only the exact focused assembly after its session listing is ready", () => {
		const focus = {
			sessionId: "session-b",
			assemblyId: "b".repeat(64),
			requestId: 7,
		};
		expect(
			focusedSessionAssemblyIsReady({
				focus,
				currentSessionId: "session-b",
				assemblyIds: ["a".repeat(64), "b".repeat(64)],
				handledRequestId: 6,
				busy: false,
			}),
		).toBe(true);
		expect(
			focusedSessionAssemblyIsReady({
				focus,
				currentSessionId: "session-a",
				assemblyIds: ["b".repeat(64)],
				handledRequestId: 6,
				busy: false,
			}),
		).toBe(false);
		expect(
			focusedSessionAssemblyIsReady({
				focus,
				currentSessionId: "session-b",
				assemblyIds: ["a".repeat(64)],
				handledRequestId: 6,
				busy: false,
			}),
		).toBe(false);
		expect(
			focusedSessionAssemblyIsReady({
				focus,
				currentSessionId: "session-b",
				assemblyIds: ["b".repeat(64)],
				handledRequestId: 7,
				busy: false,
			}),
		).toBe(false);
	});
});
