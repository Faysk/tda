import { describe, expect, it } from "vitest";
import {
	LEGACY_CAMPAIGN_MEDIA_KEY,
	campaignMediaCacheKey,
	campaignMediaObjectBelongsTo,
	campaignMediaPublicUrl,
	isCampaignMediaKey,
} from "./campaign-media";

describe("campaign media identity", () => {
	it("uses immutable technical keys and keeps the legacy key valid", () => {
		expect(isCampaignMediaKey(LEGACY_CAMPAIGN_MEDIA_KEY)).toBe(true);
		expect(isCampaignMediaKey("antes-que-seja-tarde")).toBe(true);
		expect(isCampaignMediaKey("Crônicas da Mesa")).toBe(false);
		expect(isCampaignMediaKey("../escape")).toBe(false);
	});

	it("separates identical resource identities across sibling campaigns", () => {
		const objectKey =
			"campaigns/campaign-a/sessions/shared-id/cover/" +
			"a".repeat(64) +
			".webp";
		expect(
			campaignMediaObjectBelongsTo({
				objectKey,
				campaignMediaKey: "campaign-a",
				resourcePrefix: "sessions",
			}),
		).toBe(true);
		expect(
			campaignMediaObjectBelongsTo({
				objectKey,
				campaignMediaKey: "campaign-b",
				resourcePrefix: "sessions",
			}),
		).toBe(false);
	});

	it("accepts only clean public URLs in the expected campaign namespace", () => {
		const url =
			"https://media.dnd.faysk.dev/campaigns/campaign-b/entities/" +
			"11111111-1111-4111-8111-111111111111/portrait/" +
			"a".repeat(64) +
			".webp";
		expect(
			campaignMediaPublicUrl({
				value: url,
				campaignMediaKey: "campaign-b",
				resourcePrefix: "entities",
			}),
		).toBe(url);
		for (const invalid of [
			url.replace("/campaign-b/", "/campaign-a/"),
			url + "?token=private",
			url + "#fragment",
			url.replace("https:", "http:"),
			url.replace("media.dnd.faysk.dev", "media.dnd.faysk.dev.evil.example"),
		]) {
			expect(
				campaignMediaPublicUrl({
					value: invalid,
					campaignMediaKey: "campaign-b",
					resourcePrefix: "entities",
				}),
			).toBeNull();
		}
	});

	it("keeps standalone lore outside campaign namespace", () => {
		const standaloneLoreKey =
			"lore/d/" + "b".repeat(64) + "/hero.webp";
		expect(
			campaignMediaObjectBelongsTo({
				objectKey: standaloneLoreKey,
				campaignMediaKey: "campaign-a",
			}),
		).toBe(false);
		expect(standaloneLoreKey.startsWith("lore/")).toBe(true);
	});

	it("includes campaign owner and namespace in cache identity", () => {
		const a = campaignMediaCacheKey({
			campaignId: "campaign-uuid-a",
			campaignMediaKey: "campaign-a",
			resourceKind: "session",
			resourceId: "shared-source-id",
			role: "social",
		});
		const b = campaignMediaCacheKey({
			campaignId: "campaign-uuid-b",
			campaignMediaKey: "campaign-b",
			resourceKind: "session",
			resourceId: "shared-source-id",
			role: "social",
		});
		expect(a).not.toBe(b);
		expect(a).toContain("campaign-uuid-a");
		expect(b).toContain("campaign-uuid-b");
	});
});
