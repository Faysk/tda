import {
	WORLD_ENTITY_MEDIA_MAX_BYTES,
	WORLD_ENTITY_MEDIA_UPLOAD_CHUNK_BYTES,
	WORLD_ENTITY_MEDIA_MAX_UPLOAD_CHUNKS,
	type WorldEntityMediaMime,
	worldEntityMediaUploadChunkCount,
} from "@/features/world-explorer/world-entity-media";

export const SESSION_COVER_MEDIA_MAX_BYTES = WORLD_ENTITY_MEDIA_MAX_BYTES;
export const SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES =
	WORLD_ENTITY_MEDIA_UPLOAD_CHUNK_BYTES;
export const SESSION_COVER_MEDIA_MAX_UPLOAD_CHUNKS =
	WORLD_ENTITY_MEDIA_MAX_UPLOAD_CHUNKS;
export const SESSION_COVER_MEDIA_MAX_PIXELS = 64_000_000;

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/u;

export type SessionCoverMediaMime = WorldEntityMediaMime;

export type SessionCoverUploadIntent = Readonly<{
	sha256: string;
	mimeType: SessionCoverMediaMime;
	bytes: number;
}>;

export function isSessionCoverUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isSessionCoverSha256(value: unknown): value is string {
	return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isSessionCoverMime(value: unknown): value is SessionCoverMediaMime {
	return value === "image/png" || value === "image/webp";
}

export function isExistingPublishedSessionCoverReference(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const raw = value.trim();
	if (!raw) return false;
	if (raw.startsWith("/assets/sessions/") && !raw.includes("?") && !raw.includes("#"))
		return true;
	try {
		const url = new URL(raw);
		if (
			url.protocol !== "https:" ||
			url.port ||
			url.username ||
			url.password ||
			url.hash
		)
			return false;
		if (
			url.hostname === "media.dnd.faysk.dev" &&
			url.pathname.startsWith("/campaigns/yuhara-main/sessions/")
		)
			return !url.search;
		if (
			url.hostname === "dnd.faysk.dev" &&
			url.pathname.startsWith("/assets/sessions/")
		)
			return !url.search;
		return (
			url.hostname === "dmrqnbdvbkfqzctcerbx.supabase.co" &&
			url.pathname.startsWith("/storage/v1/object/public/session-images/")
		);
	} catch {
		return false;
	}
}

export function isSessionCoverIntent(
	value: unknown,
): value is SessionCoverUploadIntent {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const intent = value as Record<string, unknown>;
	return (
		isSessionCoverSha256(intent.sha256) &&
		isSessionCoverMime(intent.mimeType) &&
		typeof intent.bytes === "number" &&
		worldEntityMediaUploadChunkCount(intent.bytes) !== null
	);
}

export function sessionCoverUploadChunkCount(bytes: number): number | null {
	return worldEntityMediaUploadChunkCount(bytes);
}

export function sessionCoverPreviewUrl(
	sessionId: string,
	assetId: string,
): string | undefined {
	if (!isSessionCoverUuid(sessionId) || !isSessionCoverUuid(assetId))
		return undefined;
	return (
		"/api/edit/session-cover/" +
		encodeURIComponent(sessionId.toLowerCase()) +
		"/" +
		encodeURIComponent(assetId.toLowerCase())
	);
}

export function sessionCoverObjectKey(input: {
	campaignSlug: string;
	sessionId: string;
	sha256: string;
	extension: "png" | "webp";
}): string | null {
	if (
		!CAMPAIGN_SLUG_PATTERN.test(input.campaignSlug) ||
		!isSessionCoverUuid(input.sessionId) ||
		!isSessionCoverSha256(input.sha256)
	)
		return null;
	return (
		"campaigns/" +
		input.campaignSlug +
		"/sessions/" +
		input.sessionId.toLowerCase() +
		"/cover/" +
		input.sha256 +
		"." +
		input.extension
	);
}

export function sessionCoverPendingChunkObjectKey(input: {
	campaignSlug: string;
	sessionId: string;
	uploadId: string;
	sha256: string;
	part: number;
}): string | null {
	if (
		!CAMPAIGN_SLUG_PATTERN.test(input.campaignSlug) ||
		!isSessionCoverUuid(input.sessionId) ||
		!isSessionCoverUuid(input.uploadId) ||
		!isSessionCoverSha256(input.sha256) ||
		!Number.isSafeInteger(input.part) ||
		input.part < 0 ||
		input.part >= SESSION_COVER_MEDIA_MAX_UPLOAD_CHUNKS
	)
		return null;
	return (
		"uploads/pending/session-cover/" +
		input.campaignSlug +
		"/" +
		input.sessionId.toLowerCase() +
		"/" +
		input.uploadId.toLowerCase() +
		"/" +
		input.sha256 +
		".part-" +
		String(input.part).padStart(2, "0")
	);
}
