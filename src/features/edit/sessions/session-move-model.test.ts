import { describe, expect, it } from "vitest";
import {
	normalizeSessionMoveBlockers,
	type SessionCampaignMoveRequest,
	validateSessionCampaignMoveRequest,
} from "./session-move-model";

const valid: SessionCampaignMoveRequest = {
	operationId: "60000000-0000-4000-8000-000000000001",
	sessionId: "40000000-0000-4000-8000-000000000001",
	sourceSessionId: "craig-session-2026-10-01",
	sourceCampaignSlug: "campaign-a",
	destinationCampaignSlug: "campaign-b",
};

describe("safe session move model", () => {
	it("accepts a campaign-qualified source identity", () => {
		expect(validateSessionCampaignMoveRequest(valid)).toEqual([]);
	});

	it("rejects malformed, missing or same-campaign identities before RPC", () => {
		expect(
			validateSessionCampaignMoveRequest({
				...valid,
				operationId: "not-a-uuid",
				sourceSessionId: "",
				destinationCampaignSlug: "campaign-a",
			}),
		).toEqual(
			expect.arrayContaining([
				"operation_id",
				"source_session_id",
				"same_campaign",
			]),
		);
	});

	it("caps source identity and rejects embedded NUL", () => {
		expect(
			validateSessionCampaignMoveRequest({
				...valid,
				sourceSessionId: "x".repeat(221),
			}),
		).toContain("source_session_id");
		expect(
			validateSessionCampaignMoveRequest({
				...valid,
				sourceSessionId: "bad\u0000source",
			}),
		).toContain("source_session_id");
	});

	it("normalizes only known blockers and removes duplicates", () => {
		expect(
			normalizeSessionMoveBlockers([
				"session_media",
				"session_scoped_access",
				"session_evidence_or_lineage",
				"session_media",
				"unknown",
				42,
			]),
		).toEqual([
			"session_media",
			"session_scoped_access",
			"session_evidence_or_lineage",
		]);
	});
});
