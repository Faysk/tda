import "server-only";

import {
	inspectWorldEntityImage,
	type WorldEntityImageInfo,
} from "@/features/world-explorer/world-entity-media-image";
import {
	promoteGovernedImageObject,
	stageGovernedImageObject,
	type VerifiedWorldEntityUpload,
} from "@/features/world-explorer/world-entity-media-server";
import {
	CAMPAIGN_COVER_MEDIA_MAX_PIXELS,
	campaignCoverObjectKey,
} from "./campaign-cover-media";

function campaignCoverKey(
	campaignMediaKey: string,
	info: WorldEntityImageInfo,
): string {
	const key = campaignCoverObjectKey({
		campaignMediaKey,
		sha256: info.sha256,
		extension: info.extension,
	});
	if (!key) throw new Error("CAMPAIGN_COVER_MEDIA_INVALID_OBJECT_KEY");
	return key;
}

export async function stageCampaignCover(input: {
	campaignMediaKey: string;
	bytes: Uint8Array;
}): Promise<VerifiedWorldEntityUpload> {
	const info = inspectWorldEntityImage(input.bytes);
	if (info.width * info.height > CAMPAIGN_COVER_MEDIA_MAX_PIXELS)
		throw new Error("CAMPAIGN_COVER_MEDIA_PIXEL_BUDGET_EXCEEDED");
	const objectKey = campaignCoverKey(input.campaignMediaKey, info);
	return stageGovernedImageObject({
		objectKey,
		bytes: input.bytes,
		maxPixels: CAMPAIGN_COVER_MEDIA_MAX_PIXELS,
	});
}

export async function promoteCampaignCover(input: {
	campaignMediaKey: string;
	stagedBucket: string;
	objectKey: string;
	sha256: string;
	mimeType: "image/png" | "image/webp";
	bytes: number;
	width: number;
	height: number;
}) {
	const extension = input.mimeType === "image/png" ? "png" : "webp";
	const expectedObjectKey = campaignCoverObjectKey({
		campaignMediaKey: input.campaignMediaKey,
		sha256: input.sha256,
		extension,
	});
	if (!expectedObjectKey)
		throw new Error("CAMPAIGN_COVER_MEDIA_INVALID_OBJECT_KEY");
	return promoteGovernedImageObject({
		stagedBucket: input.stagedBucket,
		objectKey: input.objectKey,
		expectedObjectKey,
		info: {
			sha256: input.sha256,
			mimeType: input.mimeType,
			extension,
			bytes: input.bytes,
			width: input.width,
			height: input.height,
		},
		maxPixels: CAMPAIGN_COVER_MEDIA_MAX_PIXELS,
	});
}
