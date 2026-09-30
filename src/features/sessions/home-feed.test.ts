import { describe, expect, it } from "vitest";
import type { PublicSessionMediaManifest } from "../../config/public-session-media";
import type { PublishedSession } from "./model";
import { sessionPublicMetadataImage } from "./metadata";
import {
	buildHomeSessionFeed,
	compareHomeSessions,
	HOME_RECENT_SESSION_LIMIT,
} from "./home-feed";

function session(
	id: string,
	date: string,
	campaignSlug: string,
	campaignName = campaignSlug,
): PublishedSession {
	return {
		id,
		campaignId: `id-${campaignSlug}`,
		campaignSlug,
		campaignName,
		campaignTechnicalSlug: campaignSlug,
		title: `Sessão ${id}`,
		date,
		arc: "Arco",
		summary: "Resumo",
	};
}

describe("multi-campaign Home feed", () => {
	it("supports zero, one and many published sessions without inventing entries", () => {
		expect(buildHomeSessionFeed([])).toEqual({
			ordered: [],
			latest: undefined,
			recent: [],
		});

		const only = session("one", "2026-09-20", "campaign-a");
		expect(buildHomeSessionFeed([only])).toEqual({
			ordered: [only],
			latest: only,
			recent: [],
		});

		const many = Array.from({ length: HOME_RECENT_SESSION_LIMIT + 3 }, (_, index) =>
			session(
				`session-${index}`,
				`2026-09-${String(29 - index).padStart(2, "0")}`,
				index % 2 ? "campaign-b" : "campaign-a",
			),
		);
		const feed = buildHomeSessionFeed(many);
		expect(feed.latest).toBe(many[0]);
		expect(feed.recent).toHaveLength(HOME_RECENT_SESSION_LIMIT);
	});

	it("lets the global latest come from any campaign", () => {
		const a = session("a", "2026-09-29", "campaign-a", "Campaign A");
		const b = session("b", "2026-09-30", "campaign-b", "Campaign B");
		const feed = buildHomeSessionFeed([a, b]);

		expect(feed.latest).toMatchObject({
			id: "b",
			campaignSlug: "campaign-b",
			campaignName: "Campaign B",
		});
		expect(feed.recent[0]).toBe(a);
	});

	it("orders equal dates deterministically by campaign then source identity", () => {
		const sessions = [
			session("z", "2026-09-30", "campaign-b"),
			session("b", "2026-09-30", "campaign-a"),
			session("a", "2026-09-30", "campaign-a"),
		];
		const ordered = [...sessions].sort(compareHomeSessions);

		expect(ordered.map((item) => `${item.campaignSlug}:${item.id}`)).toEqual([
			"campaign-a:a",
			"campaign-a:b",
			"campaign-b:z",
		]);
	});

	it("keeps colliding source IDs distinct across campaigns", () => {
		const a = session("shared", "2026-09-30", "campaign-a");
		const b = session("shared", "2026-09-30", "campaign-b");
		const feed = buildHomeSessionFeed([b, a]);

		expect(feed.ordered).toHaveLength(2);
		expect(feed.ordered.map((item) => item.campaignSlug)).toEqual([
			"campaign-a",
			"campaign-b",
		]);
	});

	it("uses the same selected hero session for social metadata image resolution", () => {
		const a = session("a", "2026-09-29", "campaign-a");
		const b = session("b", "2026-09-30", "campaign-b");
		const latest = buildHomeSessionFeed([a, b]).latest;
		expect(latest).toBeDefined();

		const manifest: PublicSessionMediaManifest = {
			a: {
				hero: {
					state: "verified-public",
					publicUrl: "https://media.example.test/a.webp",
					sha256: "a".repeat(64),
					mimeType: "image/webp",
					bytes: 100,
					width: 1200,
					height: 630,
					verifiedAt: "2026-09-30T00:00:00Z",
					readBackVerified: true,
					publicDeliveryVerified: true,
				},
			},
			b: {
				hero: {
					state: "verified-public",
					publicUrl: "https://media.example.test/b.webp",
					sha256: "b".repeat(64),
					mimeType: "image/webp",
					bytes: 100,
					width: 1200,
					height: 630,
					verifiedAt: "2026-09-30T00:00:00Z",
					readBackVerified: true,
					publicDeliveryVerified: true,
				},
			},
		};

		expect(sessionPublicMetadataImage(latest!, manifest)).toMatchObject({
			url: "https://media.example.test/b.webp",
		});
	});
});
