import { describe, expect, it } from "vitest";
import type { PublicCampaign } from "./model";
import type { PublishedSession } from "@/features/sessions/model";
import { buildCampaignDirectoryCards } from "./directory-presentation";

const campaigns: readonly PublicCampaign[] = [
	{
		routeKey: "a",
		name: "Campaign A",
		description: "A",
		coverImage: "https://media.dnd.faysk.dev/campaigns/a/campaign/cover/a.webp",
	},
	{
		routeKey: "b",
		name: "Campaign B",
		description: null,
		coverImage: null,
	},
	{
		routeKey: "c",
		name: "Campaign C",
		description: null,
		coverImage: null,
	},
	{
		routeKey: "d",
		name: "Campaign D",
		description: null,
		coverImage: null,
	},
];

function session(
	campaignSlug: string,
	id: string,
	date: string,
	media: Partial<Pick<PublishedSession, "coverImage" | "heroImage">> = {},
): PublishedSession {
	return {
		id,
		campaignId: `campaign-${campaignSlug}`,
		campaignSlug,
		campaignName: `Campaign ${campaignSlug.toUpperCase()}`,
		campaignTechnicalSlug: campaignSlug,
		title: `Session ${id}`,
		date,
		arc: "Arc",
		summary: "Public summary",
		...media,
	};
}

describe("campaign directory presentation", () => {
	it("prefers campaign cover, then latest session cover, then latest hero", () => {
		const cards = buildCampaignDirectoryCards(campaigns, [
			session("a", "a-session", "2026-09-20", {
				coverImage: "https://media.dnd.faysk.dev/campaigns/a/sessions/a-session/card.webp",
			}),
			session("b", "z-tie", "2026-09-30", {
				coverImage: "https://media.dnd.faysk.dev/campaigns/b/sessions/z-tie/card.webp",
			}),
			session("b", "a-tie", "2026-09-30", {
				coverImage: "https://media.dnd.faysk.dev/campaigns/b/sessions/a-tie/card.webp",
			}),
			session("c", "c-session", "2026-09-29", {
				heroImage: "https://media.dnd.faysk.dev/campaigns/c/sessions/c-session/hero.webp",
			}),
		]);

		expect(cards[0]).toMatchObject({
			artworkSource: "campaign-cover",
			artwork: campaigns[0].coverImage,
			publishedSessionCount: 1,
		});
		expect(cards[1]).toMatchObject({
			artworkSource: "latest-session-cover",
			artwork:
				"https://media.dnd.faysk.dev/campaigns/b/sessions/a-tie/card.webp",
			publishedSessionCount: 2,
			latestSession: { id: "a-tie", date: "2026-09-30" },
		});
		expect(cards[2]).toMatchObject({
			artworkSource: "latest-session-hero",
			artwork:
				"https://media.dnd.faysk.dev/campaigns/c/sessions/c-session/hero.webp",
			publishedSessionCount: 1,
		});
		expect(cards[3]).toMatchObject({
			artworkSource: "fallback",
			artwork: null,
			publishedSessionCount: 0,
			latestSession: null,
		});
	});

	it("ignores sessions whose campaign is not present in the public directory", () => {
		const [card] = buildCampaignDirectoryCards([campaigns[1]], [
			session("private-or-archived", "hidden", "2026-10-01", {
				coverImage:
					"https://media.dnd.faysk.dev/campaigns/private-or-archived/sessions/hidden/card.webp",
			}),
			session("b", "public", "2026-09-01"),
		]);

		expect(card).toMatchObject({
			artworkSource: "fallback",
			publishedSessionCount: 1,
			latestSession: { id: "public" },
		});
		expect(JSON.stringify(card)).not.toContain("private-or-archived");
	});

	it("does not misreport zero sessions when the session projection is unavailable", () => {
		const cards = buildCampaignDirectoryCards(campaigns, null);
		expect(cards[0]).toMatchObject({
			artworkSource: "campaign-cover",
			publishedSessionCount: null,
		});
		expect(cards[1]).toMatchObject({
			artworkSource: "fallback",
			publishedSessionCount: null,
			latestSession: null,
		});
	});
});
