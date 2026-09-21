export const LEMBRA_CAPABILITIES = {
	read: "campaign.read",
	write: "campaign.references.write",
} as const;

export const LEMBRA_PREVIEW_BUCKET = "tda-media-preview" as const;
export const LEMBRA_PRIVATE_BUCKET = "tda-media-private" as const;
export const LEMBRA_MAX_BYTES = 12 * 1024 * 1024;
export const LEMBRA_MAX_DIMENSION = 20_000;
export const LEMBRA_UPLOAD_EXPIRES_SECONDS = 300;

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/u;

export type LembraMediaMime = "image/jpeg" | "image/png" | "image/webp";
export type LembraExtension = "jpg" | "png" | "webp";

export type LembraReference = Readonly<{
	id: string;
	title: string;
	description: string;
	author: string;
	authorProfileId: string | null;
	createdAt: string;
	imageUrl: string;
	mine: boolean;
}>;

export type LembraUploadIntent = Readonly<{
	sha256: string;
	mimeType: LembraMediaMime;
	bytes: number;
}>;

export function isLembraUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isLembraSha256(value: unknown): value is string {
	return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isLembraMediaMime(value: unknown): value is LembraMediaMime {
	return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

export function lembraExtensionForMime(mimeType: LembraMediaMime): LembraExtension {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/png") return "png";
	return "webp";
}

export function validLembraUploadIntent(intent: LembraUploadIntent): boolean {
	return (
		isLembraSha256(intent.sha256) &&
		isLembraMediaMime(intent.mimeType) &&
		Number.isSafeInteger(intent.bytes) &&
		intent.bytes >= 24 &&
		intent.bytes <= LEMBRA_MAX_BYTES
	);
}

export function lembraReferenceObjectKey({
	campaignSlug,
	referenceId,
	sha256,
	extension,
}: {
	campaignSlug: string;
	referenceId: string;
	sha256: string;
	extension: LembraExtension;
}): string | null {
	if (!CAMPAIGN_SLUG_PATTERN.test(campaignSlug)) return null;
	if (!isLembraUuid(referenceId) || !SHA256_PATTERN.test(sha256)) return null;
	return `campaigns/${campaignSlug}/lembra/${referenceId.toLowerCase()}/${sha256}.${extension}`;
}

export function lembraPendingObjectKey({
	campaignSlug,
	referenceId,
	uploadId,
	sha256,
	extension,
}: {
	campaignSlug: string;
	referenceId: string;
	uploadId: string;
	sha256: string;
	extension: LembraExtension;
}): string | null {
	if (!CAMPAIGN_SLUG_PATTERN.test(campaignSlug)) return null;
	if (
		!isLembraUuid(referenceId) ||
		!isLembraUuid(uploadId) ||
		!SHA256_PATTERN.test(sha256)
	) {
		return null;
	}
	return `uploads/pending/lembra/${campaignSlug}/${referenceId.toLowerCase()}/${uploadId.toLowerCase()}/${sha256}.${extension}`;
}

export function lembraImageUrl(referenceId: string): string | undefined {
	if (!isLembraUuid(referenceId)) return undefined;
	return `/api/lembra/${encodeURIComponent(referenceId.toLowerCase())}/image`;
}

export function validLembraTitle(value: unknown): value is string {
	return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 120;
}

export function validLembraDescription(value: unknown): value is string {
	return typeof value === "string" && value.length <= 320;
}
