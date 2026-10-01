import { describe, expect, it } from "vitest";
import { validateLegacyTranscriptPrepareRequest } from "./legacy-prepare-model";

const valid = {
	campaignSlug: "yuhara-main",
	sessionId: "11111111-1111-4111-8111-111111111111",
	operationId: "22222222-2222-4222-8222-222222222222",
	expectedSnapshotSha256: "a".repeat(64),
};

describe("legacy transcript preparation request", () => {
	it("accepts only opaque identity metadata, never transcript payload", () => {
		expect(validateLegacyTranscriptPrepareRequest(valid)).toEqual([]);
	});

	it("rejects malformed session, operation and snapshot identities", () => {
		expect(
			validateLegacyTranscriptPrepareRequest({
				sessionId: "session",
				operationId: "retry",
				expectedSnapshotSha256: "A".repeat(64),
			}),
		).toEqual([
			"session_id",
			"operation_id",
			"expected_snapshot_sha256",
		]);
	});
});
