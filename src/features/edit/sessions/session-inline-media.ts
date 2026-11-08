import { isCampaignMediaKey } from "@/features/media/campaign-media";
import { WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN } from "@/features/world-explorer/world-entity-media";
import {
	SESSION_COVER_MEDIA_MAX_BYTES,
	SESSION_COVER_MEDIA_MAX_PIXELS,
	SESSION_COVER_MEDIA_MAX_UPLOAD_CHUNKS,
	SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
	isSessionCoverMime,
	isSessionCoverSha256,
	isSessionCoverUuid,
	sessionCoverUploadChunkCount,
	type SessionCoverMediaMime,
} from "./session-cover-media";

/**
 * Inline illustrations share the validated image transport limits with the session-cover
 * pipeline, but they are independent assets with their own role and namespace.
 * In particular, a session_cover asset must never pass as an inline illustration.
 */
export const SESSION_INLINE_MEDIA_ROLE = "session_inline_image" as const;
export const SESSION_INLINE_MEDIA_MAX_BYTES = SESSION_COVER_MEDIA_MAX_BYTES;
export const SESSION_INLINE_MEDIA_MAX_PIXELS = SESSION_COVER_MEDIA_MAX_PIXELS;
export const SESSION_INLINE_MEDIA_UPLOAD_CHUNK_BYTES =
	SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES;
export const SESSION_INLINE_MEDIA_MAX_UPLOAD_CHUNKS =
	SESSION_COVER_MEDIA_MAX_UPLOAD_CHUNKS;

export type SessionInlineMediaMime = SessionCoverMediaMime;

export type SessionInlineUploadIntent = Readonly<{
	sha256: string;
	mimeType: SessionInlineMediaMime;
	bytes: number;
}>;

export function isSessionInlineUploadIntent(value: unknown): value is SessionInlineUploadIntent {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const intent = value as Record<string, unknown>;
	return (
		Object.keys(intent).length === 3 &&
		isSessionCoverSha256(intent.sha256) &&
		isSessionCoverMime(intent.mimeType) &&
		typeof intent.bytes === "number" &&
		sessionCoverUploadChunkCount(intent.bytes) !== null
	);
}

export function sessionInlineObjectKey(input: {
	campaignSlug: string;
	sessionId: string;
	sha256: string;
	extension: "png" | "webp";
}): string | null {
	if (
		!isCampaignMediaKey(input.campaignSlug) ||
		!isSessionCoverUuid(input.sessionId) ||
		!isSessionCoverSha256(input.sha256) ||
		!["png", "webp"].includes(input.extension)
	)
		return null;
	return (
		"campaigns/" +
		input.campaignSlug +
		"/sessions/" +
		input.sessionId.toLowerCase() +
		"/inline/" +
		input.sha256 +
		"." +
		input.extension
	);
}

export function sessionInlinePendingChunkObjectKey(input: {
	campaignSlug: string;
	sessionId: string;
	uploadId: string;
	sha256: string;
	part: number;
}): string | null {
	if (
		!isCampaignMediaKey(input.campaignSlug) ||
		!isSessionCoverUuid(input.sessionId) ||
		!isSessionCoverUuid(input.uploadId) ||
		!isSessionCoverSha256(input.sha256) ||
		!Number.isSafeInteger(input.part) ||
		input.part < 0 ||
		input.part >= SESSION_INLINE_MEDIA_MAX_UPLOAD_CHUNKS
	)
		return null;
	return (
		"uploads/pending/session-inline/" +
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

/** Authenticated, session-scoped read path; never expose staged R2 URLs. */
export function sessionInlinePreviewUrl(
	sessionId: string,
	assetId: string,
): string | undefined {
	if (!isSessionCoverUuid(sessionId) || !isSessionCoverUuid(assetId))
		return undefined;
	return (
		"/api/edit/session-inline/" +
		encodeURIComponent(sessionId.toLowerCase()) +
		"/" +
		encodeURIComponent(assetId.toLowerCase())
	);
}

/** Local aliases keep the HQ transport independent of the cover public API. */
export const isSessionInlineUuid = isSessionCoverUuid;
export const isSessionInlineSha256 = isSessionCoverSha256;
export const isSessionInlineMime = isSessionCoverMime;
export const sessionInlineUploadChunkCount = sessionCoverUploadChunkCount;


/** This URL is deliberately unavailable until an authorized session publication promotes the private staged bytes. */
export function sessionInlinePublicUrl(input: {
	campaignSlug: string;
	sessionId: string;
	sha256: string;
	extension: "png" | "webp";
}): string | null {
	const key = sessionInlineObjectKey(input);
	return key ? WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN + "/" + key : null;
}
