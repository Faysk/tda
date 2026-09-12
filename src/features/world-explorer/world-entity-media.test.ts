import { describe, expect, it } from "vitest";
import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	isWorldEntityMediaAssetId,
	worldEntityMediaPreviewUrl,
	worldEntityPortraitObjectKey,
	worldEntityPublicMediaUrl,
} from "./world-entity-media";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const SHA256 = "a".repeat(64);
const OBJECT_KEY = `campaigns/yuhara-main/entities/${ENTITY_ID}/portrait/${SHA256}.webp`;

describe("World entity media contract", () => {
	it("uses stable asset ids for private preview URLs", () => {
		expect(isWorldEntityMediaAssetId(ASSET_ID)).toBe(true);
		expect(worldEntityMediaPreviewUrl(ASSET_ID)).toBe(
			`/api/world/entity-media/${ASSET_ID}`,
		);
		expect(worldEntityMediaPreviewUrl("https://example.com/image.webp")).toBeUndefined();
	});

	it("builds immutable portrait keys from canonical entity identity and content hash", () => {
		expect(
			worldEntityPortraitObjectKey({
				entityId: ENTITY_ID,
				sha256: SHA256,
				extension: "webp",
			}),
		).toBe(OBJECT_KEY);
	});

	it("only exposes verified public R2 assets for the matching entity", () => {
		const verified = {
			status: "verified_public" as const,
			publicBucket: WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
			publicObjectKey: OBJECT_KEY,
			sha256: SHA256,
			readBackVerified: true,
			publicDeliveryVerified: true,
			publicVerifiedAt: "2026-09-12T19:00:00.000Z",
		};
		expect(worldEntityPublicMediaUrl(verified, ENTITY_ID)).toBe(
			`https://media.dnd.faysk.dev/${OBJECT_KEY}`,
		);
		expect(
			worldEntityPublicMediaUrl(verified, "33333333-3333-4333-8333-333333333333"),
		).toBeUndefined();
		expect(
			worldEntityPublicMediaUrl({ ...verified, publicDeliveryVerified: false }, ENTITY_ID),
		).toBeUndefined();
	});
});
