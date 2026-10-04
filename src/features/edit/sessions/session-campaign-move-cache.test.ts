import { describe, expect, it } from "vitest";
import { sessionCampaignMoveRevalidationPaths } from "./session-campaign-move-cache";

describe("session campaign move cache invalidation", () => {
	it("invalidates source and destination private/public routes after a committed move", () => {
		expect(
			sessionCampaignMoveRevalidationPaths({
				sourceCampaignSlug: "campaign-a",
				sourceRouteKey: "campanha-a",
				destinationCampaignSlug: "campaign-b",
				destinationRouteKey: "campanha-b",
				sourceSessionId: "shared-session",
			}),
		).toEqual([
			"/",
			"/campanhas",
			"/campanhas/sessoes",
			"/edit/campaign-a/sessoes",
			"/edit/campaign-b/sessoes",
			"/edit/campaign-a/sessoes/shared-session",
			"/edit/campaign-b/sessoes/shared-session",
			"/sessoes",
			"/sessoes/shared-session",
			"/campanhas/campanha-a/sessoes",
			"/campanhas/campanha-b/sessoes",
			"/campanhas/campanha-a/sessoes/shared-session",
			"/campanhas/campanha-b/sessoes/shared-session",
		]);
	});

	it("encodes public route keys instead of composing untrusted path fragments", () => {
		const paths = sessionCampaignMoveRevalidationPaths({
			sourceCampaignSlug: "campaign-a",
			sourceRouteKey: "mesa a",
			destinationCampaignSlug: "campaign-b",
			destinationRouteKey: "mesa/b",
			sourceSessionId: "session-1",
		});
		expect(paths).toContain("/campanhas/mesa%20a/sessoes");
		expect(paths).toContain("/campanhas/mesa%2Fb/sessoes");
	});
});
