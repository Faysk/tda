import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN,
} from "@/features/world-explorer/world-entity-media";

export const CAMPAIGN_COVER_MEDIA_ROLE = "campaign_cover" as const;
export const CAMPAIGN_COVER_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const CAMPAIGN_COVER_MEDIA_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const CAMPAIGN_COVER_MEDIA_MAX_UPLOAD_CHUNKS = Math.ceil(
	CAMPAIGN_COVER_MEDIA_MAX_BYTES / CAMPAIGN_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
);
export const CAMPAIGN_COVER_MEDIA_PUBLIC_BUCKET = WORLD_ENTITY_MEDIA_PUBLIC_BUCKET;
export const CAMPAIGN_COVER_MEDIA_PUBLIC_ORIGIN = WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN;

const CAMPAIGN_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;

export type CampaignCoverMediaMime = "image/png" | "image/webp";

export type CampaignCoverAssetRecord = Readonly<{
	id: string;
	campaignId: string;
	status: "staged" | "verified_public" | "retired";
	stagedBucket: string;
	objectKey: string;
	sha256: string;
	mimeType: CampaignCoverMediaMime;
	bytes: number;
	width: number;
	height: number;
	readBackVerified: boolean;
	publicBucket: string | null;
	publicObjectKey: string | null;
	publicDeliveryVerified: boolean;
	publicVerifiedAt: string | null;
}>;

export function isCampaignMediaKey(value: unknown): value is string {
	return typeof value === "string" && value.length <= 80 && CAMPAIGN_KEY.test(value);
}

export function isCampaignMediaUuid(value: unknown): value is string {
	return typeof value === "string" && UUID.test(value);
}

export function isCampaignMediaSha256(value: unknown): value is string {
	return typeof value === "string" && SHA256.test(value);
}

export function isCampaignCoverMediaMime(value: unknown): value is CampaignCoverMediaMime {
	return value === "image/png" || value === "image/webp";
}

export function campaignCoverUploadChunkCount(bytes: number): number | null {
	if (!Number.isSafeInteger(bytes) || bytes < 24 || bytes > CAMPAIGN_COVER_MEDIA_MAX_BYTES)
		return null;
	return Math.ceil(bytes / CAMPAIGN_COVER_MEDIA_UPLOAD_CHUNK_BYTES);
}

export function campaignCoverObjectKey({
	campaignMediaKey,
	sha256,
	extension,
}: {
	campaignMediaKey: string;
	sha256: string;
	extension: "png" | "webp";
}): string | null {
	if (!isCampaignMediaKey(campaignMediaKey) || !isCampaignMediaSha256(sha256))
		return null;
	return `campaigns/${campaignMediaKey}/campaign/cover/${sha256}.${extension}`;
}

export function campaignCoverPendingChunkObjectKey({
	campaignMediaKey,
	uploadId,
	sha256,
	part,
}: {
	campaignMediaKey: string;
	uploadId: string;
	sha256: string;
	part: number;
}): string | null {
	if (
		!isCampaignMediaKey(campaignMediaKey) ||
		!isCampaignMediaUuid(uploadId) ||
		!isCampaignMediaSha256(sha256) ||
		!Number.isSafeInteger(part) ||
		part < 0 ||
		part >= CAMPAIGN_COVER_MEDIA_MAX_UPLOAD_CHUNKS
	)
		return null;
	return `uploads/pending/campaign-cover/${campaignMediaKey}/${uploadId.toLowerCase()}/${sha256}.part-${part
		.toString()
		.padStart(2, "0")}`;
}

export function campaignCoverPublicUrl(
	asset: Pick<
		CampaignCoverAssetRecord,
		| "status"
		| "publicBucket"
		| "publicObjectKey"
		| "sha256"
		| "readBackVerified"
		| "publicDeliveryVerified"
		| "publicVerifiedAt"
	>,
	campaignMediaKey: string,
): string | undefined {
	if (
		asset.status !== "verified_public" ||
		asset.publicBucket !== CAMPAIGN_COVER_MEDIA_PUBLIC_BUCKET ||
		!asset.publicObjectKey ||
		!asset.readBackVerified ||
		!asset.publicDeliveryVerified ||
		!asset.publicVerifiedAt ||
		Number.isNaN(Date.parse(asset.publicVerifiedAt)) ||
		!isCampaignMediaSha256(asset.sha256) ||
		!isCampaignMediaKey(campaignMediaKey)
	)
		return undefined;
	const extension = asset.publicObjectKey.endsWith(".png") ? "png" : "webp";
	const expected = campaignCoverObjectKey({
		campaignMediaKey,
		sha256: asset.sha256,
		extension,
	});
	if (!expected || expected !== asset.publicObjectKey) return undefined;
	return `${CAMPAIGN_COVER_MEDIA_PUBLIC_ORIGIN}/${asset.publicObjectKey}`;
}

export function legacyCampaignMediaUrlBelongsTo(
	value: unknown,
	expectedCampaignMediaKey: string,
): boolean {
	if (expectedCampaignMediaKey !== "yuhara-main" || typeof value !== "string")
		return false;
	try {
		const url = new URL(value, "https://dnd.faysk.dev");
		if (url.search || url.hash) return false;
		if (url.origin === "https://dnd.faysk.dev")
			return url.pathname.startsWith("/assets/sessions/");
		return (
			url.hostname === "dmrqnbdvbkfqzctcerbx.supabase.co" &&
			url.pathname.startsWith("/storage/v1/object/public/session-images/")
		);
	} catch {
		return false;
	}
}
