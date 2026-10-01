import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoreCampaignContext } from "./model";
import { resolveLorePresentation } from "./presentation";

const mocks = vi.hoisted(() => ({
	findPublishedLoreProfile: vi.fn(),
	notFound: vi.fn(),
}));

vi.mock("./repository", () => ({
	findPublishedLoreProfile: mocks.findPublishedLoreProfile,
}));

vi.mock("next/navigation", () => ({
	notFound: mocks.notFound,
}));

import {
	buildLoreMetadata,
	renderLoreRoutePage,
} from "./route-page";

const campaignA: LoreCampaignContext = {
	routeKey: "campaign-a",
	technicalSlug: "campaign-a-tech",
	name: "Campaign A",
};

const campaignB: LoreCampaignContext = {
	routeKey: "campaign-b",
	technicalSlug: "campaign-b-tech",
	name: "Campaign B",
};

function profile(campaign: LoreCampaignContext) {
	return {
		identity: {
			id: campaign.routeKey + ":same",
			slug: "same",
			entityType: "pc" as const,
			name: "Same",
			summary: "Resumo público",
		},
		campaign,
		presentation: resolveLorePresentation(),
		sections: [],
	};
}

describe("public lore route page", () => {
	beforeEach(() => {
		mocks.findPublishedLoreProfile.mockReset();
		mocks.notFound.mockReset();
		mocks.notFound.mockImplementation(() => {
			throw new Error("NEXT_NOT_FOUND");
		});
	});

	it("keeps an incompatible profile route as a 404 boundary", async () => {
		mocks.findPublishedLoreProfile.mockResolvedValue({
			identity: {
				id: "campaign-a:ivory",
				slug: "ivory",
				entityType: "npc",
				name: "Ivory",
			},
			campaign: campaignA,
			presentation: resolveLorePresentation(),
			sections: [],
		});
		await expect(
			renderLoreRoutePage("personagens", "ivory", campaignA),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.findPublishedLoreProfile).toHaveBeenCalledWith(
			"personagens",
			"ivory",
			campaignA,
		);
	});

	it("builds campaign-qualified canonical and social metadata", async () => {
		mocks.findPublishedLoreProfile.mockResolvedValue(profile(campaignA));
		const metadata = await buildLoreMetadata("personagens", "same", campaignA);
		expect(metadata.alternates?.canonical).toBe(
			"https://dnd.faysk.dev/campanhas/campaign-a/personagens/same",
		);
		expect(metadata.openGraph).toMatchObject({
			url: "https://dnd.faysk.dev/campanhas/campaign-a/personagens/same",
		});
	});

	it("keeps same-slug metadata distinct across campaigns", async () => {
		mocks.findPublishedLoreProfile
			.mockResolvedValueOnce(profile(campaignA))
			.mockResolvedValueOnce(profile(campaignB));
		const metadataA = await buildLoreMetadata("personagens", "same", campaignA);
		const metadataB = await buildLoreMetadata("personagens", "same", campaignB);
		expect(metadataA.alternates?.canonical).not.toBe(
			metadataB.alternates?.canonical,
		);
	});
});
