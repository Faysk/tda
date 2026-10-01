import { describe, expect, it } from "vitest";
import {
	isWorldCampaignRouteKey,
	isWorldCampaignSlug,
	worldEditCampaignHref,
	worldEditLeaseStorageKey,
	worldPublicCampaignHref,
} from "./world-campaign";

describe("World campaign identity", () => {
	it("keeps technical campaign slugs distinct in browser lease storage", () => {
		expect(worldEditLeaseStorageKey("campaign-a")).toBe("tda.world.edit.lease.campaign-a");
		expect(worldEditLeaseStorageKey("campaign-b")).toBe("tda.world.edit.lease.campaign-b");
		expect(worldEditLeaseStorageKey("campaign-a")).not.toBe(
			worldEditLeaseStorageKey("campaign-b"),
		);
	});

	it("builds campaign-qualified public and Edit World links", () => {
		expect(worldPublicCampaignHref("cronicas-da-mesa")).toBe(
			"/campanhas/cronicas-da-mesa/mundo",
		);
		expect(worldPublicCampaignHref("cronicas-da-mesa", "Astel & D")).toBe(
			"/campanhas/cronicas-da-mesa/mundo?foco=Astel%20%26%20D",
		);
		expect(worldEditCampaignHref("yuhara-main", "astel")).toBe(
			"/edit/yuhara-main/mundo?foco=astel",
		);
	});

	it("rejects campaign identities that could escape routing or storage namespaces", () => {
		expect(isWorldCampaignSlug("yuhara-main")).toBe(true);
		expect(isWorldCampaignSlug("campaign_B")).toBe(true);
		expect(isWorldCampaignSlug("../campaign-b")).toBe(false);
		expect(isWorldCampaignSlug("campaign/b")).toBe(false);
		expect(isWorldCampaignRouteKey("cronicas-da-mesa")).toBe(true);
		expect(isWorldCampaignRouteKey("Crônicas-da-Mesa")).toBe(false);
		expect(() => worldEditCampaignHref("../escape")).toThrow(
			"WORLD_CAMPAIGN_INVALID_SLUG",
		);
		expect(() => worldPublicCampaignHref("../escape")).toThrow(
			"WORLD_CAMPAIGN_INVALID_ROUTE_KEY",
		);
	});
});
