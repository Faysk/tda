import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolvePublicCampaignRoute: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/campaigns/server", () => ({
	resolvePublicCampaignRoute: mocks.resolvePublicCampaignRoute,
}));

import {
	LEGACY_LORE_CAMPAIGN_CONTEXT,
	resolveLoreCampaignContext,
} from "./campaign-context";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("lore campaign route context", () => {
	it("maps canonical public campaign identity into the lore repository context", async () => {
		mocks.resolvePublicCampaignRoute.mockResolvedValue({
			ok: true,
			canonical: true,
			campaign: {
				routeKey: "campaign-a",
				technicalSlug: "campaign-a-tech",
				name: "Campaign A",
				description: null,
			},
		});
		await expect(resolveLoreCampaignContext("campaign-a")).resolves.toEqual({
			ok: true,
			canonical: true,
			legacyCompatibility: false,
			campaign: {
				routeKey: "campaign-a",
				technicalSlug: "campaign-a-tech",
				name: "Campaign A",
			},
		});
	});

	it("preserves alias information for canonical redirects", async () => {
		mocks.resolvePublicCampaignRoute.mockResolvedValue({
			ok: true,
			canonical: false,
			campaign: {
				routeKey: "canonical-a",
				technicalSlug: "campaign-a-tech",
				name: "Campaign A",
				description: null,
			},
		});
		const result = await resolveLoreCampaignContext("old-a");
		expect(result.ok && result.canonical).toBe(false);
		if (result.ok) expect(result.campaign.routeKey).toBe("canonical-a");
	});

	it("fails closed for archived/private/missing campaigns reported as not_found", async () => {
		mocks.resolvePublicCampaignRoute.mockResolvedValue({
			ok: false,
			reason: "not_found",
		});
		await expect(resolveLoreCampaignContext("campaign-c")).resolves.toEqual({
			ok: false,
			reason: "not_found",
		});
	});

	it("uses the known legacy context only for the pre-registry compatibility gap", async () => {
		mocks.resolvePublicCampaignRoute.mockResolvedValue({
			ok: false,
			reason: "dependency_unavailable",
		});
		await expect(
			resolveLoreCampaignContext(LEGACY_LORE_CAMPAIGN_CONTEXT.routeKey),
		).resolves.toEqual({
			ok: true,
			canonical: true,
			legacyCompatibility: true,
			campaign: LEGACY_LORE_CAMPAIGN_CONTEXT,
		});
		await expect(resolveLoreCampaignContext("campaign-b")).resolves.toEqual({
			ok: false,
			reason: "dependency_unavailable",
		});
	});
});
