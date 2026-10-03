import { describe, expect, it } from "vitest";
import { LORE_INDEX_COPY } from "./index-config";

describe("LORE_INDEX_COPY empty states", () => {
	it("keeps reader-facing copy free of publication pipeline jargon", () => {
		const descriptions = Object.values(LORE_INDEX_COPY)
			.map((entry) => entry.emptyDescription)
			.join(" ");

		expect(descriptions).not.toMatch(
			/\bprojection\b|explicitamente|autorizad[oa]|visibilidade pública|\bweb\b/iu,
		);
	});
});
