import { describe, expect, it } from "vitest";
import { CANONICAL_SITE_ORIGIN, canonicalPublicUrl } from "./site";

describe("canonical public URL", () => {
	it("uses the official production origin", () => {
		expect(CANONICAL_SITE_ORIGIN).toBe("https://dnd.faysk.dev");
	});

	it("keeps path, query and hash while replacing infrastructure aliases", () => {
		expect(
			canonicalPublicUrl({
				pathname: "/sessoes/rmDsxh640RR4",
				search: "?from=archive",
				hash: "#historia",
			}),
		).toBe(
			"https://dnd.faysk.dev/sessoes/rmDsxh640RR4?from=archive#historia",
		);
	});
});
