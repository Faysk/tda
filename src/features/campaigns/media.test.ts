import { expect, it } from "vitest";
import { type CampaignMediaManifest, verifiedCampaignCover } from "./media";
const sha256 = "a".repeat(64);
const objectKey = `campaigns/campaign-b/cover/${sha256}/cover.webp`;
const binding = {
	campaignId: "b-id", technicalSlug: "campaign-b", cover: {
		state: "verified-public" as const, publicUrl: `https://media.dnd.faysk.dev/${objectKey}`,
		objectKey, bucket: "tda-media-public", sha256, mimeType: "image/webp", bytes: 100,
		width: 800, height: 600, verifiedAt: "2026-10-01T00:00:00Z",
		readBackVerified: true as const, publicDeliveryVerified: true as const,
	},
};
const manifest: CampaignMediaManifest = { "campaign-b": binding };
it("requires both relational identity and immutable technical key", () => {
	expect(verifiedCampaignCover("b-id", "campaign-b", manifest)?.url).toBe(binding.cover.publicUrl);
	expect(verifiedCampaignCover("a-id", "campaign-b", manifest)).toBeUndefined();
	expect(verifiedCampaignCover("b-id", "public-renamed-b", manifest)).toBeUndefined();
	expect(verifiedCampaignCover("a-id", "campaign-a", { "campaign-a": binding })).toBeUndefined();
});
it("rejects wrong namespace, private bucket and missing read-back", () => {
	for (const patch of [
		{ objectKey: objectKey.replace("campaign-b", "campaign-a") },
		{ bucket: "tda-media-private" }, { state: "pending" as const },
		{ publicUrl: `${binding.cover.publicUrl}?token=secret` },
	]) expect(verifiedCampaignCover("b-id", "campaign-b", {
		"campaign-b": { ...binding, cover: { ...binding.cover, ...patch } },
	})).toBeUndefined();
});
