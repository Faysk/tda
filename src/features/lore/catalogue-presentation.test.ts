import { describe, expect, it } from "vitest";
import { normalizedCatalogueCover } from "./catalogue-presentation";

describe("normalizedCatalogueCover", () => {
	it("keeps a usable cover URL", () => {
		expect(
			normalizedCatalogueCover(
				" https://media.dnd.faysk.dev/lore/example/cover.avif ",
			),
		).toBe("https://media.dnd.faysk.dev/lore/example/cover.avif");
	});

	it.each([null, undefined, "", "   ", 42])(
		"uses the neutral fallback when cover metadata is absent (%s)",
		(value) => {
			expect(normalizedCatalogueCover(value)).toBeNull();
		},
	);
});
