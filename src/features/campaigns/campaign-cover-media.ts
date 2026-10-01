import { isCampaignMediaKey } from "@/features/media/campaign-media";
import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN,
	type WorldEntityMediaMime,
	isWorldEntityMediaMime,
	isWorldEntityMediaSha256,
} from "@/features/world-explorer/world-entity-media";

export const CAMPAIGN_COVER_MEDIA_ROLE = "campaign_cover" as const;
export const CAMPAIGN_COVER_MEDIA_MAX_PIXELS = 64_000_000;

export type CampaignCoverAsset = Readonly<{
	status: "staged" | "verified_public" | "retired";
	roleHint: string;
	objectKey: string;
	sha256: string;
	mimeType: string;
	readBackVerified: boolean;
	publicBucket: string | null;
	publicObjectKey: string | null;
	publicDeliveryVerified: boolean;
	publicVerifiedAt: string | null;
}>;

export function campaignCoverObjectKey(input: {
	campaignMediaKey: string;
	sha256: string;
	extension: "png" | "webp";
}): string | null {
	if (
		!isCampaignMediaKey(input.campaignMediaKey) ||
		!isWorldEntityMediaSha256(input.sha256)
	) {
		return null;
	}
	return (
		"campaigns/" +
		input.campaignMediaKey +
		"/campaign/cover/" +
		input.sha256 +
		"." +
		input.extension
	);
}

export function campaignCoverPublicUrl(
	asset: CampaignCoverAsset,
	campaignMediaKey: string,
): string | null {
	if (
		asset.status !== "verified_public" ||
		asset.roleHint !== CAMPAIGN_COVER_MEDIA_ROLE ||
		!asset.readBackVerified ||
		asset.publicBucket !== WORLD_ENTITY_MEDIA_PUBLIC_BUCKET ||
		!asset.publicObjectKey ||
		!asset.publicDeliveryVerified ||
		!asset.publicVerifiedAt ||
		Number.isNaN(Date.parse(asset.publicVerifiedAt)) ||
		!isWorldEntityMediaSha256(asset.sha256) ||
		!isWorldEntityMediaMime(asset.mimeType)
	) {
		return null;
	}
	const extension: "png" | "webp" =
		(asset.mimeType as WorldEntityMediaMime) === "image/png" ? "png" : "webp";
	const expected = campaignCoverObjectKey({
		campaignMediaKey,
		sha256: asset.sha256,
		extension,
	});
	if (
		!expected ||
		asset.objectKey !== expected ||
		asset.publicObjectKey !== expected
	) {
		return null;
	}
	return WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN + "/" + expected;
}
