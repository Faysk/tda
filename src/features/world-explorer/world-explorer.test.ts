import { describe, expect, it } from "vitest";
import { DANDELION_WORLD_DEMO } from "./fixtures/dandelion";
import { buildWorldProjection, resolveWorldFocusId } from "./projection";
import { closestCardinalHandles, radialWorldLayout } from "./radial-layout";

describe("World Explorer demo projection", () => {
	it("resolves focus by slug and falls back without exposing an unknown node", () => {
		expect(resolveWorldFocusId(DANDELION_WORLD_DEMO, "ASTEL")).toBe("astel");
		expect(resolveWorldFocusId(DANDELION_WORLD_DEMO, "missing")).toBe(
			"dandelion",
		);
	});

	it("keeps only direct neighbours and preserves the focus through filters", () => {
		const projection = buildWorldProjection(
			DANDELION_WORLD_DEMO,
			"dandelion",
			"locations",
		);
		expect(projection.nodes.map((node) => node.id)).toEqual([
			"dandelion",
			"reino-fadas",
		]);
		expect(projection.edges).toHaveLength(1);
	});

	it("can refocus on a selected neighbour without turning selection into focus", () => {
		const initial = buildWorldProjection(DANDELION_WORLD_DEMO, "dandelion");
		expect(initial.nodes.some((node) => node.id === "astel")).toBe(true);
		const refocused = buildWorldProjection(DANDELION_WORLD_DEMO, "astel");
		expect(refocused.focusId).toBe("astel");
		expect(refocused.nodes.some((node) => node.id === "raven-queen")).toBe(true);
	});
});

describe("World Explorer radial layout", () => {
	it("is deterministic and keeps the focus at the origin", () => {
		const projection = buildWorldProjection(DANDELION_WORLD_DEMO, "dandelion");
		const first = radialWorldLayout(projection);
		const second = radialWorldLayout(projection);
		expect(first).toEqual(second);
		expect(first.dandelion).toEqual({ x: 0, y: 0 });
	});

	it("routes connections through the nearest cardinal handles", () => {
		expect(closestCardinalHandles({ x: 0, y: 0 }, { x: 100, y: 20 })).toEqual({
			sourceHandle: "source-right",
			targetHandle: "target-left",
		});
		expect(closestCardinalHandles({ x: 0, y: 0 }, { x: 10, y: -100 })).toEqual({
			sourceHandle: "source-top",
			targetHandle: "target-bottom",
		});
	});
});
