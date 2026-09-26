// count_words_v1: explicit Unicode White_Space; never normalize editorial text.
// U+001C..001F and U+FEFF are deliberately not separators.
const tokens =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the versioned separator contract explicitly includes TAB through CR.
	/[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;

export function countWordsV1(value: string): number {
	let count = 0;
	for (const _token of value.matchAll(tokens)) count += 1;
	return count;
}
