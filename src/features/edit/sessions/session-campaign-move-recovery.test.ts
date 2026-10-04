import { describe, expect, it } from "vitest";
import {
	decodeSessionCampaignMoveRecovery,
	encodeSessionCampaignMoveRecovery,
} from "./session-campaign-move-recovery";

const intent = {
	version: 1 as const,
	sessionId: "41000000-0000-4000-8000-000000000001",
	sourceSessionId: "session-1",
	sourceCampaignSlug: "campaign-a",
	destinationCampaignSlug: "campaign-b",
	operationId: "61000000-0000-4000-8000-000000000001",
};

describe("session campaign move durable recovery", () => {
	it("round-trips only the opaque move identity", () => {
		const encoded = encodeSessionCampaignMoveRecovery(intent, 1_000);
		expect(encoded).not.toContain("unlinkParticipantEntities");
		expect(encoded).not.toContain("revokeSessionGrants");
		expect(decodeSessionCampaignMoveRecovery(encoded, 1_001)).toEqual(intent);
	});

	it("expires stale intents and rejects malformed payloads", () => {
		const encoded = encodeSessionCampaignMoveRecovery(intent, 1_000);
		expect(
			decodeSessionCampaignMoveRecovery(encoded, 1_000 + 24 * 60 * 60 * 1000 + 1),
		).toBeNull();
		expect(
			decodeSessionCampaignMoveRecovery(
				JSON.stringify({ version: 1, savedAt: 1_000, intent: { ...intent, operationId: 42 } }),
				1_001,
			),
		).toBeNull();
	});
});
