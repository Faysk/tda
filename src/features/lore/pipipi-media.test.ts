import { describe, expect, it } from "vitest";
import {
	PIPIPI_STAGE_BACKGROUND,
	pipipiMediaAsset,
} from "./pipipi-media";

describe("Pipipi canonical media", () => {
	it("derives the catalogue/hero stage background from the published manifest object", () => {
		expect(PIPIPI_STAGE_BACKGROUND).toEqual({
			file: "stage-bg.avif",
			bytes: 27571,
			sha256: "a50beeeb7b598aaab89dc74e3e5cec0787df63092bf8a5487f9e450d3228f816",
			contentType: "image/avif",
			source: "media/sources/pipipi/stage-bg.avif",
			publicUrl:
				"https://media.dnd.faysk.dev/lore/pipipi/a50beeeb7b598aaab89dc74e3e5cec0787df63092bf8a5487f9e450d3228f816/stage-bg.avif",
		});
	});

	it("fails closed when a consumer asks for an asset missing from the manifest", () => {
		expect(() => pipipiMediaAsset("missing-cover.avif")).toThrow(
			"Pipipi media manifest is missing missing-cover.avif",
		);
	});
});
