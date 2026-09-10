import { describe, expect, it } from "vitest";
import {
	buildWorldHeroAffinityIndex,
	constellationWorldLayout,
} from "./constellation-layout";
import type { WorldDemoDataset } from "./model";
import { buildWorldProjection } from "./projection";

const AFFINITY_DATASET: WorldDemoDataset = {
	nodes: [
		{ id: "hero-a", slug: "hero-a", kind: "entity", entityType: "pc", label: "Hero A" },
		{ id: "hero-b", slug: "hero-b", kind: "entity", entityType: "pc", label: "Hero B" },
		{ id: "bridge", slug: "bridge", kind: "entity", entityType: "npc", label: "Bridge" },
		{ id: "echo", slug: "echo", kind: "entity", entityType: "location", label: "Echo" },
		{ id: "direct", slug: "direct", kind: "entity", entityType: "npc", label: "Direct" },
		{ id: "deep", slug: "deep", kind: "entity", entityType: "location", label: "Deep" },
	],
	edges: [
		{
			id: "a-bridge",
			source: "hero-a",
			target: "bridge",
			relationType: "shared",
			label: "Shared",
			direction: "symmetric",
			family: "context",
		},
		{
			id: "b-bridge",
			source: "hero-b",
			target: "bridge",
			relationType: "shared",
			label: "Shared",
			direction: "symmetric",
			family: "context",
		},
		{
			id: "bridge-echo",
			source: "bridge",
			target: "echo",
			relationType: "echo",
			label: "Echo",
			direction: "symmetric",
			family: "context",
		},
		{
			id: "a-direct",
			source: "hero-a",
			target: "direct",
			relationType: "direct",
			label: "Direct",
			direction: "symmetric",
			family: "affinity",
		},
		{
			id: "direct-deep",
			source: "direct",
			target: "deep",
			relationType: "deep",
			label: "Deep",
			direction: "symmetric",
			family: "context",
		},
	],
};

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
	return Math.hypot(left.x - right.x, left.y - right.y);
}

describe("World Explorer affinity layout", () => {
	it("indexes tied nearest heroes for the whole visible topology", () => {
		const projection = buildWorldProjection(AFFINITY_DATASET);
		const affinities = buildWorldHeroAffinityIndex(projection, projection.heroIds);

		expect(affinities.get("bridge")).toEqual({
			heroIds: ["hero-a", "hero-b"],
			distance: 1,
		});
		expect(affinities.get("echo")).toEqual({
			heroIds: ["hero-a", "hero-b"],
			distance: 2,
		});
		expect(affinities.get("direct")).toEqual({ heroIds: ["hero-a"], distance: 1 });
		expect(affinities.get("deep")).toEqual({ heroIds: ["hero-a"], distance: 2 });
	});

	it("keeps the affinity traversal bounded to the editorial layout depth", () => {
		const dataset: WorldDemoDataset = {
			...AFFINITY_DATASET,
			nodes: [
				...AFFINITY_DATASET.nodes,
				{ id: "depth-3", slug: null, kind: "moment", label: "Depth 3" },
				{ id: "depth-4", slug: null, kind: "moment", label: "Depth 4" },
				{ id: "depth-5", slug: null, kind: "moment", label: "Depth 5" },
			],
			edges: [
				...AFFINITY_DATASET.edges,
				{
					id: "deep-depth-3",
					source: "deep",
					target: "depth-3",
					relationType: "context",
					label: "Context",
					direction: "symmetric",
					family: "context",
				},
				{
					id: "depth-3-depth-4",
					source: "depth-3",
					target: "depth-4",
					relationType: "context",
					label: "Context",
					direction: "symmetric",
					family: "context",
				},
				{
					id: "depth-4-depth-5",
					source: "depth-4",
					target: "depth-5",
					relationType: "context",
					label: "Context",
					direction: "symmetric",
					family: "context",
				},
			],
		};
		const projection = buildWorldProjection(dataset);
		const affinities = buildWorldHeroAffinityIndex(projection, projection.heroIds);

		expect(affinities.get("depth-3")).toEqual({ heroIds: ["hero-a"], distance: 3 });
		expect(affinities.get("depth-4")).toEqual({ heroIds: ["hero-a"], distance: 4 });
		expect(affinities.has("depth-5")).toBe(false);
	});

	it("places shared context between peer heroes instead of assigning the first hero", () => {
		const projection = buildWorldProjection(AFFINITY_DATASET);
		const layout = constellationWorldLayout(projection);
		const midpoint = {
			x: (layout["hero-a"].x + layout["hero-b"].x) / 2,
			y: (layout["hero-a"].y + layout["hero-b"].y) / 2,
		};

		expect(distance(layout.bridge, midpoint)).toBeLessThan(120);
		expect(distance(layout.echo, midpoint)).toBeLessThan(120);
		expect(layout.bridge).not.toEqual(layout.echo);
	});

	it("pushes second-order context farther out from its nearest hero than direct context", () => {
		const projection = buildWorldProjection(AFFINITY_DATASET);
		const layout = constellationWorldLayout(projection);
		const hero = layout["hero-a"];

		expect(distance(layout.deep, hero)).toBeGreaterThan(distance(layout.direct, hero));
	});

	it("remains deterministic for the same authorized projection", () => {
		const projection = buildWorldProjection(AFFINITY_DATASET);
		expect(constellationWorldLayout(projection)).toEqual(constellationWorldLayout(projection));
	});
});
