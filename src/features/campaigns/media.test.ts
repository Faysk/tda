import { describe, expect, it } from "vitest";
import {
	campaignCoverObjectKey,
	campaignCoverPendingChunkObjectKey,
	campaignCoverPublicUrl,
	legacyCampaignMediaUrlBelongsTo,
} from "./media";

const sha = "a".repeat(64);

describe("campaign media identity", () => {
	it("uses the immutable technical campaign key, not the mutable public route", () => {
		expect(
			campaignCoverObjectKey({
				campaignMediaKey: "yuhara-main",
				sha256: sha,
				extension: "webp",
			}),
		).toBe(`campaigns/yuhara-main/campaign/cover/${sha}.webp`);
		expect(
			campaignCoverObjectKey({
				campaignMediaKey: "cronicas-da-mesa",
				sha256: sha,
				extension: "webp",
			}),
		).toBe(`campaigns/cronicas-da-mesa/campaign/cover/${sha}.webp`);
	});

	it("keeps pending keys campaign-separated even for identical bytes", () => {
		const uploadId = "d0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001";
		const a = campaignCoverPendingChunkObjectKey({
			campaignMediaKey: "campaign-a",
			uploadId,
			sha256: sha,
			part: 0,
		});
		const b = campaignCoverPendingChunkObjectKey({
			campaignMediaKey: "campaign-b",
			uploadId,
			sha256: sha,
			part: 0,
		});
		expect(a).not.toBe(b);
		expect(a).toContain("/campaign-a/");
		expect(b).toContain("/campaign-b/");
	});

	it("accepts a public URL only when the canonical key belongs to the expected campaign", () => {
		const asset = {
			status: "verified_public" as const,
			publicBucket: "tda-media-public",
			publicObjectKey: `campaigns/campaign-a/campaign/cover/${sha}.webp`,
			sha256: sha,
			readBackVerified: true,
			publicDeliveryVerified: true,
			publicVerifiedAt: "2026-10-01T00:00:00.000Z",
		};
		expect(campaignCoverPublicUrl(asset, "campaign-a")).toContain(
			"/campaigns/campaign-a/campaign/cover/",
		);
		expect(campaignCoverPublicUrl(asset, "campaign-b")).toBeUndefined();
	});

	it("preserves legacy Yuhara media only for the legacy owner", () => {
		const legacy =
			"https://dnd.faysk.dev/assets/sessions/legacy-cover.webp";
		expect(legacyCampaignMediaUrlBelongsTo(legacy, "yuhara-main")).toBe(true);
		expect(legacyCampaignMediaUrlBelongsTo(legacy, "campaign-b")).toBe(false);
	});
});
