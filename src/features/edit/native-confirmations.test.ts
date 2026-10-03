import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scopedFiles = [
	"src/features/edit/processing/panel.tsx",
	"src/features/edit/processing/local-review.tsx",
	"src/features/edit/transcript/reader.tsx",
	"src/features/edit/transcript/editor.tsx",
] as const;

describe("integrated confirmation contract", () => {
	for (const path of scopedFiles) {
		it(`${path} does not use native browser alert/confirm/prompt`, () => {
			const source = readFileSync(path, "utf8");
			expect(source).not.toMatch(/window\.(?:alert|confirm|prompt)\s*\(/u);
		});
	}
});