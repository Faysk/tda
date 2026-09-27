import { describe, expect, it } from "vitest";
import {
	shortPublicationId,
	validPublicationHash,
	validSessionPublicationRequest,
} from "./session-publication-model";

const request = {
	sessionId: "11111111-1111-4111-8111-111111111111",
	draftId: "22222222-2222-4222-8222-222222222222",
	expectedCurrentPublicationId: null,
	operationId: "33333333-3333-4333-8333-333333333333",
} as const;

describe("session publication client contract", () => {
	it("accepts a first-publication request with frozen null current pointer", () => {
		expect(validSessionPublicationRequest(request)).toBe(true);
	});

	it("accepts replace only with a UUID current pointer", () => {
		expect(
			validSessionPublicationRequest({
				...request,
				expectedCurrentPublicationId:
					"44444444-4444-4444-8444-444444444444",
			}),
		).toBe(true);
		expect(
			validSessionPublicationRequest({
				...request,
				expectedCurrentPublicationId: "stale",
			}),
		).toBe(false);
	});

	it("rejects malformed operation, draft and session identities", () => {
		for (const patch of [
			{ sessionId: "nope" },
			{ draftId: "nope" },
			{ operationId: "nope" },
		])
			expect(validSessionPublicationRequest({ ...request, ...patch })).toBe(
				false,
			);
	});

	it("accepts only canonical lowercase sha256 receipts", () => {
		expect(validPublicationHash("a".repeat(64))).toBe(true);
		expect(validPublicationHash("A".repeat(64))).toBe(false);
		expect(validPublicationHash("a".repeat(63))).toBe(false);
	});

	it("renders publication identifiers without exposing a complete UUID", () => {
		expect(shortPublicationId(null)).toBe("nenhuma");
		expect(
			shortPublicationId("11111111-1111-4111-8111-111111111111"),
		).toBe("11111111…");
	});
});
