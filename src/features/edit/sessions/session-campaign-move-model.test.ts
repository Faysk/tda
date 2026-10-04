import { describe, expect, it } from "vitest";
import {
	SESSION_CAMPAIGN_MOVE_CONTRACT_V2,
	sessionCampaignMoveOptionsKey,
	sessionCampaignMovePlanHeading,
} from "./session-campaign-move-model";

describe("session campaign move v2 model", () => {
	it("keeps the backend contract identifier stable", () => {
		expect(SESSION_CAMPAIGN_MOVE_CONTRACT_V2).toBe(
			"tda_session_campaign_move_v2",
		);
	});

	it("canonicalizes decision identity independently from property insertion order", () => {
		expect(
			sessionCampaignMoveOptionsKey({
				sessionGrantPolicy: "preserve",
				publishedPolicy: "unpublish",
			}),
		).toBe(
			sessionCampaignMoveOptionsKey({
				publishedPolicy: "unpublish",
				sessionGrantPolicy: "preserve",
			}),
		);
	});

	it("keeps plan classifications human-oriented", () => {
		expect(sessionCampaignMovePlanHeading("auto")).toBe(
			"Pode acompanhar automaticamente",
		);
		expect(sessionCampaignMovePlanHeading("external_prepare")).toBe(
			"Preparo automático antes do commit",
		);
		expect(sessionCampaignMovePlanHeading("decision")).toBe(
			"Decisões explícitas",
		);
		expect(sessionCampaignMovePlanHeading("historical")).toBe(
			"Histórico preservado",
		);
		expect(sessionCampaignMovePlanHeading("hard_block")).toBe(
			"Bloqueadores manuais",
		);
	});
});
