import { sessionDraftScalarLength } from "./editorial-draft-model";

export const SESSION_COMIC_LIMITS = {
	pages: 150,
	altText: 500,
	caption: 1000,
} as const;

/**
 * Pages are stored in reading order. The client submits opaque asset IDs;
 * the server must authorize each asset against the current campaign/session
 * before saving or publishing. Public URLs never belong in editable drafts.
 */
export type SessionComicDraftPage = Readonly<{
	assetId: string;
	altText: string;
	caption: string;
}>;

/** Immutable, already promoted page from an explicitly published snapshot. */
export type SessionComicPublishedPage = Readonly<{
	imageUrl: string;
	altText: string;
	caption: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MEDIA_KEY = /^[a-z0-9][a-z0-9-]{0,95}$/u;
const IMAGE_FILENAME = /^[a-f0-9]{64}\.(?:png|webp)$/u;

function validCopy(value: unknown, maxLength: number): value is string {
	if (typeof value !== "string" || value.includes("\u0000")) return false;
	const length = sessionDraftScalarLength(value);
	return length !== null && length <= maxLength;
}

/**
 * Validate untrusted serializable data before saving or publishing.
 * Empty drafts are valid: a session does not have to offer an HQ.
 * A published nonempty HQ requires a useful description per page.
 */
export function validateSessionComicDraftPages(
	value: unknown,
	options: Readonly<{ forPublication?: boolean }> = {},
): readonly string[] {
	if (!Array.isArray(value)) return ["invalid_pages"];
	if (value.length > SESSION_COMIC_LIMITS.pages) return ["too_many_pages"];

	const issues: string[] = [];
	const seen = new Set<string>();
	for (const [index, raw] of value.entries()) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			issues.push("invalid_page_" + index);
			continue;
		}
		const page = raw as Record<string, unknown>;
		if (
			Object.keys(page).some(
				(key) => key !== "assetId" && key !== "altText" && key !== "caption",
			)
		) {
			issues.push("extra_fields_" + index);
		}
		if (typeof page.assetId !== "string" || !UUID.test(page.assetId)) {
			issues.push("invalid_asset_" + index);
		} else {
			const normalized = page.assetId.toLowerCase();
			if (seen.has(normalized)) issues.push("duplicate_asset_" + index);
			seen.add(normalized);
		}
		if (!validCopy(page.altText, SESSION_COMIC_LIMITS.altText))
			issues.push("invalid_alt_" + index);
		else if (options.forPublication && !page.altText.trim())
			issues.push("missing_alt_" + index);
		if (!validCopy(page.caption, SESSION_COMIC_LIMITS.caption))
			issues.push("invalid_caption_" + index);
	}
	return issues;
}

/**
 * Public display accepts only immutable content-addressed HQ objects in the
 * exact session/campaign namespace. An invalid snapshot fails closed rather
 * than rendering only some pages or accepting arbitrary image origins.
 */
export function readPublishedSessionComicPages(
	value: unknown,
	campaignMediaKey: string,
	sessionId: string,
): readonly SessionComicPublishedPage[] | null {
	if (!MEDIA_KEY.test(campaignMediaKey) || !UUID.test(sessionId))
		return null;
	if (!Array.isArray(value) || value.length > SESSION_COMIC_LIMITS.pages)
		return null;

	const prefix =
		"/campaigns/" + campaignMediaKey + "/sessions/" + sessionId.toLowerCase() + "/comic/";
	const result: SessionComicPublishedPage[] = [];
	const seen = new Set<string>();
	for (const raw of value) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
		const page = raw as Record<string, unknown>;
		if (
			typeof page.imageUrl !== "string" ||
			!validCopy(page.altText, SESSION_COMIC_LIMITS.altText) ||
			!page.altText.trim() ||
			!validCopy(page.caption, SESSION_COMIC_LIMITS.caption)
		)
			return null;
		let url: URL;
		try {
			url = new URL(page.imageUrl);
		} catch {
			return null;
		}
		if (
			url.protocol !== "https:" ||
			url.hostname !== "media.dnd.faysk.dev" ||
			url.port ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!url.pathname.startsWith(prefix)
		)
			return null;
		const filename = url.pathname.slice(prefix.length);
		if (!IMAGE_FILENAME.test(filename) || seen.has(filename)) return null;
		seen.add(filename);
		result.push({
			imageUrl: url.toString(),
			altText: page.altText,
			caption: page.caption,
		});
	}
	return result;
}

/** Defensive mapper for private JSONB draft pages returned by the server. */
export function readSessionComicDraftPages(
	value: unknown,
): readonly SessionComicDraftPage[] | null {
	if (validateSessionComicDraftPages(value).length) return null;
	return (value as SessionComicDraftPage[]).map((page) => ({
		assetId: page.assetId.toLowerCase(),
		altText: page.altText,
		caption: page.caption,
	}));
}
