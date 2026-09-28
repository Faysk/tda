import { describe, expect, it } from "vitest";
import {
	isPublicationHash,
	isPublicationVersion,
	validateSessionPublicationRequest,
} from "./session-publication-model";

const base = {
	sessionId: "11111111-1111-4111-8111-111111111111",
	draftId: "22222222-2222-4222-8222-222222222222",
	expectedCurrentPublicationId: null,
	operationId: "33333333-3333-4333-8333-333333333333",
} as const;

describe("session publication contract", () => {
	it("accepts first-publish and replacement CAS identities", () => {
		expect(validateSessionPublicationRequest(base)).toEqual([]);
		expect(
			validateSessionPublicationRequest({
				...base,
				expectedCurrentPublicationId:
					"44444444-4444-4444-8444-444444444444",
			}),
		).toEqual([]);
	});

	it("rejects malformed operation and current-publication identities", () => {
		expect(
			validateSessionPublicationRequest({
				...base,
				operationId: "retry-me",
				expectedCurrentPublicationId: "stale",
			}),
		).toEqual(["operation_id", "expected_current_publication_id"]);
	});

	it("accepts only durable publication receipt primitives", () => {
		expect(isPublicationVersion(1)).toBe(true);
		expect(isPublicationVersion(0)).toBe(false);
		expect(isPublicationVersion(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
		expect(isPublicationHash("a".repeat(64))).toBe(true);
		expect(isPublicationHash("A".repeat(64))).toBe(false);
		expect(isPublicationHash("a".repeat(63))).toBe(false);
	});
});
