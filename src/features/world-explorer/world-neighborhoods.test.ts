import { describe, expect, it } from "vitest";
import type { WorldFlowNode } from "./adapters/react-flow";
import { deriveWorldVisualNeighborhoods } from "./world-neighborhoods";

function node(
	id: string,
	label: string,
	x: number,
	y: number,
	options: { hero?: boolean; prominence?: "hero" | "primary" | "supporting" | "context" } = {},
): WorldFlowNode {
	const isHero = options.hero ?? false;
	return {
		id,
		type: "worldEntity",
		position: { x, y },
		data: {
			item: {
				id,
				slug: id,
				kind: "entity",
				entityType: isHero ? "pc" : "npc",
				label,
			},
			isFocus: false,
			isHero,
			prominence: options.prominence ?? (isHero ? "hero" : "supporting"),
			isDimmed: false,
			authoringConnectable: false,
		},
	};
}

describe("World visual neighborhoods", () => {
	it("groups spatial satellites around their nearest hero", () => {
		const regions = deriveWorldVisualNeighborhoods([
			node("hero-a", "Astel", 0, 0, { hero: true }),
			node("a-1", "Layla", 220, 80),
			node("a-2", "Hati", -180, 120),
			node("hero-b", "Dandelion", 2400, 0, { hero: true }),
			node("b-1", "Syx", 2620, 40),
		]);

		expect(regions).toHaveLength(2);
		expect(regions.find((region) => region.id === "hero-a")).toMatchObject({
			label: "Astel",
			nodeCount: 3,
		});
		expect(regions.find((region) => region.id === "hero-b")).toMatchObject({
			label: "Dandelion",
			nodeCount: 2,
		});
	});

	it("keeps equidistant bridge nodes shared instead of forcing an island", () => {
		const regions = deriveWorldVisualNeighborhoods([
			node("hero-a", "Astel", -500, 0, { hero: true }),
			node("hero-b", "Dandelion", 500, 0, { hero: true }),
			node("bridge", "Trevelian", 0, 0),
			node("a-1", "Layla", -720, 100),
			node("b-1", "Syx", 720, 100),
		]);

		expect(regions.find((region) => region.id === "hero-a")?.nodeCount).toBe(2);
		expect(regions.find((region) => region.id === "hero-b")?.nodeCount).toBe(2);
	});

	it("does not stretch a neighborhood to absorb remote material", () => {
		const regions = deriveWorldVisualNeighborhoods([
			node("hero", "Astel", 0, 0, { hero: true }),
			node("near", "Layla", 240, 0),
			node("remote", "Outro continente", 4000, 0),
		]);

		expect(regions).toHaveLength(1);
		expect(regions[0]?.nodeCount).toBe(2);
		expect(regions[0]?.width).toBeLessThan(2000);
	});
});
