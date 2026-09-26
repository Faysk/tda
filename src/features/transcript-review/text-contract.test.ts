import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/transcript-review-words-v1.json";
import { countWordsV1, isReviewStringV1 } from "./text-contract";
import strings from "../../../fixtures/transcript-review-strings-v1.json";

describe("count_words_v1 shared fixture", () => {
	it("uses the shared scalar length and control policy without normalization", () => {
		for (const item of strings.cases) {
			expect(isReviewStringV1((item.codePoints ? String.fromCodePoint(...item.codePoints) : item.value).repeat(item.repeat), item.field as "text" | "speaker"), item.name).toBe(item.valid);
		}
	});
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
