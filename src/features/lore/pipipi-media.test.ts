import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	PIPIPI_STAGE_BACKGROUND,
	pipipiMediaAsset,
} from "./pipipi-media";

function runtimeSourceFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...runtimeSourceFiles(path));
		} else if (/\.(?:[cm]?[jt]sx?|json|css)$/u.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

describe("Pipipi canonical media", () => {
	it("derives the catalogue/hero stage background from the published manifest object", () => {
		expect(PIPIPI_STAGE_BACKGROUND).toMatchObject({
			file: "stage-bg.avif",
			bytes: 27571,
			sha256: "a50beeeb7b598aaab89dc74e3e5cec0787df63092bf8a5487f9e450d3228f816",
			contentType: "image/avif",
			publicUrl:
				"https://media.dnd.faysk.dev/lore/pipipi/a50beeeb7b598aaab89dc74e3e5cec0787df63092bf8a5487f9e450d3228f816/stage-bg.avif",
		});
	});

	it("fails closed when a consumer asks for an asset missing from the manifest", () => {
		expect(() => pipipiMediaAsset("missing-cover.avif")).toThrow(
			"Pipipi media manifest is missing missing-cover.avif",
		);
	});

	it("keeps the removed local stage path out of runtime source", () => {
		const staleReference = '"/lore/pipipi/stage-bg.avif"';
		const offenders = runtimeSourceFiles(join(process.cwd(), "src")).filter((path) =>
			readFileSync(path, "utf8").includes(staleReference),
		);
		expect(offenders).toEqual([]);
	});
});
