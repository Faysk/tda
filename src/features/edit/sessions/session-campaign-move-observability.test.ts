import { describe, expect, it } from "vitest";
import { sessionCampaignMoveOperationalRecord } from "./session-campaign-move-observability";

describe("session campaign move observability", () => {
	it("emits only the allowlisted operational fields", () => {
		const record = sessionCampaignMoveOperationalRecord({
			phase: "commit",
			outcome: "moved",
			operationId: "61000000-0000-4000-8000-000000000001",
			contractVersion: 2,
			preparedAssets: 2,
		});
		expect(record).toEqual({
			schema: "tda.session-campaign-move.operation.v1",
			phase: "commit",
			outcome: "moved",
			operationId: "61000000-0000-4000-8000-000000000001",
			contractVersion: 2,
			preparedAssets: 2,
		});
		expect(JSON.stringify(record)).not.toContain("PRIVATE TRANSCRIPT SENTINEL");
	});

	it("normalizes untrusted reasons and drops invalid correlation ids", () => {
		const record = sessionCampaignMoveOperationalRecord({
			phase: "commit",
			outcome: "failed",
			operationId: "not-a-uuid PRIVATE TRANSCRIPT SENTINEL",
			reason: "PRIVATE TRANSCRIPT SENTINEL",
		});
		expect(record).toEqual({
			schema: "tda.session-campaign-move.operation.v1",
			phase: "commit",
			outcome: "failed",
			reason: "unknown",
		});
	});

	it("keeps known failure reasons useful for production aggregation", () => {
		expect(
			sessionCampaignMoveOperationalRecord({
				phase: "prepare",
				outcome: "failed",
				reason: "cover_unverified",
			}),
		).toMatchObject({ reason: "cover_unverified" });
	});
});
