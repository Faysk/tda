import { describe, expect, it } from "vitest";
import { PIPIPI_STORY, type PipipiSceneId } from "./pipipi-story";

describe("PIPIPI_STORY", () => {
	it("preserves the three-act editorial structure", () => {
		expect(PIPIPI_STORY.parts.map((part) => part.title)).toEqual([
			"A Casa",
			"O outro nome da Casa",
			"O que ficou",
		]);
		expect(PIPIPI_STORY.turningPoint.title).toBe(
			"Pipipi não mentiu nenhuma vez.",
		);
	});

	it("binds each prepared cinematic scene exactly once", () => {
		const scenes = PIPIPI_STORY.parts.flatMap((part) =>
			part.sections.flatMap((section) =>
				section.sceneAfter ? [section.sceneAfter] : [],
			),
		);
		const expected: PipipiSceneId[] = [
			"casa",
			"super-herois",
			"corredores",
			"cadeira",
			"ultimo-dia",
			"acordou",
		];
		expect(scenes).toEqual(expected);
		expect(new Set(scenes).size).toBe(expected.length);
	});

	it("keeps the closing idea in the approved story", () => {
		const closingSection = PIPIPI_STORY.parts[2]?.sections.find(
			(section) => section.id === "o-coracao-de-pipipi",
		);
		expect(closingSection?.html).toContain(
			"Quando você não consegue salvar alguém, ainda pode ficar.",
		);
	});
});
