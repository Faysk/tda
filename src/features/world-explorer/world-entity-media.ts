import type { WorldVisibility } from "./model";

export const WORLD_ENTITY_MEDIA_ROLE = "portrait" as const;
export const WORLD_ENTITY_MEDIA_PUBLIC_BUCKET = "tda-media-public" as const;
export const WORLD_ENTITY_MEDIA_PREVIEW_BUCKET = "tda-media-preview" as const;
export const WORLD_ENTITY_MEDIA_PRIVATE_BUCKET = "tda-media-private" as const;
export const WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN = "https://media.dnd.faysk.dev" as const;
export const WORLD_ENTITY_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OBJECT_KEY_PATTERN =
	/^campaigns\/yuhara-main\/entities\/([0-9a-f-]{36})\/portrait\/([a-f0-9]{64})\.(png|webp)$/u;

export type WorldEntityMediaMime = "image/png" | "image/webp";

export type WorldEntityMediaAssetRecord = Readonly<{
	id: string;
	campaignId: string;
	stagedBucket: string;
	objectKey: string;
	sha256: string;
	mimeType: WorldEntityMediaMime;
	bytes: number;
	width: number;
	height: number;
	status: "staged" | "verified_public" | "retired";
	publicBucket: string | null;
	publicObjectKey: string | null;
	readBackVerified: boolean;
	publicDeliveryVerified: boolean;
	publicVerifiedAt: string | null;
}>;

export function isWorldEntityMediaAssetId(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

export function worldEntityMediaPreviewUrl(assetId: string): string | undefined {
	if (!isWorldEntityMediaAssetId(assetId)) return undefined;
	return `/api/world/entity-media/${encodeURIComponent(assetId.toLowerCase())}`;
}

export function worldEntityPortraitObjectKey({
	entityId,
	sha256,
	extension,
}: {
	entityId: string;
	sha256: string;
	extension: "png" | "webp";
}): string | null {
	if (!isWorldEntityMediaAssetId(entityId) || !SHA256_PATTERN.test(sha256)) return null;
	return `campaigns/yuhara-main/entities/${entityId.toLowerCase()}/portrait/${sha256}.${extension}`;
}

export function worldEntityPublicMediaUrl(
	asset: Pick<
		WorldEntityMediaAssetRecord,
		| "status"
		| "publicBucket"
		| "publicObjectKey"
		| "sha256"
		| "readBackVerified"
		| "publicDeliveryVerified"
		| "publicVerifiedAt"
	>,
	entityId?: string,
): string | undefined {
	if (
		asset.status !== "verified_public" ||
		asset.publicBucket !== WORLD_ENTITY_MEDIA_PUBLIC_BUCKET ||
		!asset.publicObjectKey ||
		!asset.readBackVerified ||
		!asset.publicDeliveryVerified ||
		!asset.publicVerifiedAt ||
		Number.isNaN(Date.parse(asset.publicVerifiedAt)) ||
		!SHA256_PATTERN.test(asset.sha256)
	) {
		return undefined;
	}
	const match = OBJECT_KEY_PATTERN.exec(asset.publicObjectKey);
	if (!match || match[2] !== asset.sha256) return undefined;
	if (entityId && (!isWorldEntityMediaAssetId(entityId) || match[1] !== entityId.toLowerCase())) {
		return undefined;
	}
	return `${WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN}/${asset.publicObjectKey}`;
}

export function worldEntityMediaCanBecomePublic(visibility: WorldVisibility): boolean {
	return visibility === "public_web";
}
