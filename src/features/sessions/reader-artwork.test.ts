import { describe, expect, it } from "vitest";
import { resolveSessionReaderArtwork } from "./reader-artwork";

describe("session reader artwork", () => {
	it("prefers the published cover over the published hero", () => {
		expect(
			resolveSessionReaderArtwork({
				coverImage: "https://media.dnd.faysk.dev/campaigns/a/sessions/s/card.webp",
				heroImage: "https://media.dnd.faysk.dev/campaigns/a/sessions/s/hero.webp",
			}),
		).toEqual({
			url: "https://media.dnd.faysk.dev/campaigns/a/sessions/s/card.webp",
			source: "cover",
		});
	});

	it("falls back to the published hero when no cover exists", () => {
		expect(
			resolveSessionReaderArtwork({
				heroImage: "https://media.dnd.faysk.dev/campaigns/a/sessions/s/hero.webp",
			}),
		).toEqual({
			url: "https://media.dnd.faysk.dev/campaigns/a/sessions/s/hero.webp",
			source: "hero",
		});
	});

	it("keeps the reader intentional when the session has no artwork", () => {
		expect(resolveSessionReaderArtwork({})).toEqual({
			url: null,
			source: "fallback",
		});
	});
});
