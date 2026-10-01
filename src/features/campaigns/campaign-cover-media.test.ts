import { describe, expect, it } from "vitest";
import {
	CAMPAIGN_COVER_MEDIA_ROLE,
	campaignCoverObjectKey,
	campaignCoverPublicUrl,
} from "./campaign-cover-media";

const sha256 = "a".repeat(64);

function verified(campaignMediaKey: string) {
	const objectKey = campaignCoverObjectKey({
		campaignMediaKey,
		sha256,
		extension: "webp",
	});
	if (!objectKey) throw new Error("fixture key");
	return {
		status: "verified_public" as const,
		roleHint: CAMPAIGN_COVER_MEDIA_ROLE,
		objectKey,
		sha256,
		mimeType: "image/webp",
		readBackVerified: true,
		publicBucket: "tda-media-public",
		publicObjectKey: objectKey,
		publicDeliveryVerified: true,
		publicVerifiedAt: "2026-10-01T00:00:00.000Z",
	};
}

describe("campaign cover media", () => {
	it("isolates equal hashes in campaign A and campaign B", () => {
		const a = campaignCoverObjectKey({
			campaignMediaKey: "campaign-a",
			sha256,
			extension: "webp",
		});
		const b = campaignCoverObjectKey({
			campaignMediaKey: "campaign-b",
			sha256,
			extension: "webp",
		});
		expect(a).not.toBe(b);
		expect(a).toBe(
			"campaigns/campaign-a/campaign/cover/" + sha256 + ".webp",
		);
		expect(b).toBe(
			"campaigns/campaign-b/campaign/cover/" + sha256 + ".webp",
		);
	});

	it("only resolves the verified cover owned by the expected campaign", () => {
		const asset = verified("campaign-a");
		expect(
			campaignCoverPublicUrl(asset, "campaign-a"),
		).toBe(
			"https://media.dnd.faysk.dev/" + asset.objectKey,
		);
		expect(campaignCoverPublicUrl(asset, "campaign-b")).toBeNull();
	});

	it("fails closed for private, staged, missing-readback and malformed bindings", () => {
		const asset = verified("campaign-a");
		expect(
			campaignCoverPublicUrl(
				{ ...asset, status: "staged", publicBucket: null },
				"campaign-a",
			),
		).toBeNull();
		expect(
			campaignCoverPublicUrl(
				{ ...asset, readBackVerified: false },
				"campaign-a",
			),
		).toBeNull();
		expect(
			campaignCoverPublicUrl(
				{ ...asset, publicDeliveryVerified: false },
				"campaign-a",
			),
		).toBeNull();
		expect(
			campaignCoverPublicUrl(
				{ ...asset, roleHint: "portrait" },
				"campaign-a",
			),
		).toBeNull();
		expect(
			campaignCoverPublicUrl(
				{
					...asset,
					publicObjectKey: asset.objectKey.replace(
						"campaign-a",
						"campaign-b",
					),
				},
				"campaign-a",
			),
		).toBeNull();
	});
});
