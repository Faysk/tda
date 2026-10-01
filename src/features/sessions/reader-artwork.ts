import type { PublishedSession } from "./model";

export type SessionReaderArtwork = Readonly<{
	url: string | null;
	source: "cover" | "hero" | "fallback";
}>;

/**
 * Resolves only artwork already approved by the public session projection.
 * The model boundary sanitizes media URLs before they reach this helper.
 */
export function resolveSessionReaderArtwork(
	session: Pick<PublishedSession, "coverImage" | "heroImage">,
): SessionReaderArtwork {
	if (session.coverImage) return { url: session.coverImage, source: "cover" };
	if (session.heroImage) return { url: session.heroImage, source: "hero" };
	return { url: null, source: "fallback" };
}
