import { describe, expect, it } from "vitest";
import { DANDELION_WORLD_DEMO } from "./fixtures/dandelion";
import type { WorldGraphProjection } from "./model";
import { buildWorldInspectorContext } from "./world-inspector-context";

function demoProjection(): WorldGraphProjection {
	return {
		demo: true,
		mode: "overview",
		focusId: null,
		heroIds: ["dandelion", "screacky", "astel"],
		nodes: DANDELION_WORLD_DEMO.nodes,
		edges: DANDELION_WORLD_DEMO.edges,
		relationTypes: [],
	};
}

describe("buildWorldInspectorContext", () => {
	it("derives visible inspector context without changing the graph projection", () => {
		const projection = demoProjection();
		const selected = projection.nodes.find((node) => node.id === "dandelion");
		expect(selected).toBeDefined();
		if (!selected) return;

		const context = buildWorldInspectorContext(selected, projection);

		expect(context.connections).toHaveLength(10);
		expect(context.moments.map(({ destination }) => destination.id).sort()).toEqual([
			"fantasminhos",
			"porta-kenku",
		]);
		expect(context.characterConnections).toHaveLength(5);
		expect(context.contextualConnections).toBe(5);
		expect(context.familyCounts[0]).toEqual({ family: "affinity", count: 4 });
		expect(context.visibleRelationHighlights).toHaveLength(6);
		expect(projection.edges).toHaveLength(14);
	});

	it("returns an empty context for a visible node with no surviving relations", () => {
		const projection = demoProjection();
		const selected = projection.nodes.find((node) => node.id === "ivory");
		expect(selected).toBeDefined();
		if (!selected) return;

		const isolatedProjection = { ...projection, edges: [] };
		const context = buildWorldInspectorContext(selected, isolatedProjection);

		expect(context.connections).toEqual([]);
		expect(context.familyCounts).toEqual([]);
		expect(context.visibleRelationHighlights).toEqual([]);
	});
});
