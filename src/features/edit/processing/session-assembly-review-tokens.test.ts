import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("SessionAssemblyReview design-system tokens", () => {
	it("uses only canonical --ds-* custom properties", () => {
		const css = readFileSync(
			fileURLToPath(
				new URL("./session-assembly-review.module.css", import.meta.url),
			),
			"utf8",
		);
		const tokens = [...css.matchAll(/var\((--[^,)]+)/gu)].map(
			(match) => match[1] ?? "",
		);
		const nonCanonical = [...new Set(tokens.filter((token) => !token.startsWith("--ds-")))];

		expect(nonCanonical).toEqual([]);
	});
});
