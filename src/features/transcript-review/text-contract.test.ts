import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/transcript-review-words-v1.json";
import { countWordsV1 } from "./text-contract";

describe("count_words_v1 shared fixture", () => {
	it("counts the explicit separator set without rewriting strings", () => {
		for (const { text, count } of fixture.examples)
			expect(countWordsV1(text)).toBe(count);
		for (const code of fixture.separators) {
			const separator = String.fromCodePoint(code);
			expect(
				countWordsV1(`${separator}a${separator}${separator}b${separator}`),
			).toBe(2);
		}
		for (const code of fixture.non_separators)
			expect(countWordsV1(`a${String.fromCodePoint(code)}b`)).toBe(1);
	});
});
