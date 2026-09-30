import { describe, expect, it } from "vitest";
import type { WorldLayout } from "../constellation-layout";
import {
	countWorldRouteCrossings,
	routeWorldEdgeBends,
} from "../edge-route-bends";
import { routeWorldEdgePorts } from "../edge-routing";
import { toReactFlowStructure } from "../adapters/react-flow";
import { WORLD_RELATION_STRESS_FIXTURE } from "./relation-stress";

function fixtureLayout(): WorldLayout {
	return Object.fromEntries(
		WORLD_RELATION_STRESS_FIXTURE.nodes.map((node) => {
			if (!node.layoutHint) {
				throw new Error(`Stress fixture node ${node.id} must define layoutHint`);
			}
			return [node.id, node.layoutHint];
		}),
	);
}

describe("World relation stress fixture", () => {
	it("keeps a deterministic dense graph with mixed relation semantics", () => {
		expect(WORLD_RELATION_STRESS_FIXTURE.nodes).toHaveLength(28);
		expect(WORLD_RELATION_STRESS_FIXTURE.edges).toHaveLength(40);
		expect(new Set(WORLD_RELATION_STRESS_FIXTURE.heroIds).size).toBe(4);
		expect(
			new Set(WORLD_RELATION_STRESS_FIXTURE.edges.map((edge) => edge.family)).size,
		).toBeGreaterThanOrEqual(6);
		expect(
			WORLD_RELATION_STRESS_FIXTURE.edges.some((edge) => edge.direction === "directed"),
		).toBe(true);
		expect(
			WORLD_RELATION_STRESS_FIXTURE.edges.some((edge) => edge.direction === "symmetric"),
		).toBe(true);
	});

	it("keeps dense routes deterministic and never worse than the straight-line crossing baseline", () => {
		const layout = fixtureLayout();
		const edges = WORLD_RELATION_STRESS_FIXTURE.edges;
		const baseline = Object.fromEntries(edges.map((edge) => [edge.id, 0]));
		const routed = routeWorldEdgeBends(layout, edges);

		const baselineCrossings = countWorldRouteCrossings(layout, edges, baseline);
		const routedCrossings = countWorldRouteCrossings(layout, edges, routed);

		expect(baselineCrossings).toBeGreaterThan(0);
		expect(routedCrossings).toBeLessThanOrEqual(baselineCrossings);
		expect(Object.values(routed).some((bend) => Math.abs(bend) > 0)).toBe(true);
		expect(routeWorldEdgeBends(layout, [...edges].reverse())).toEqual(routed);
	});

	it("preserves visible fan-out lanes for busy hub sides", () => {
		const layout = fixtureLayout();
		const routes = routeWorldEdgePorts(layout, WORLD_RELATION_STRESS_FIXTURE.edges);
		const groups = new Map<string, Set<number>>();

		for (const edge of WORLD_RELATION_STRESS_FIXTURE.edges) {
			const route = routes[edge.id];
			expect(route).toBeDefined();
			if (!route) continue;
			const key = `${edge.source}:${route.sourceSide}`;
			const lanes = groups.get(key) ?? new Set<number>();
			lanes.add(route.sourceLane);
			groups.set(key, lanes);
		}

		const busyGroups = [...groups.values()].filter((lanes) => lanes.size > 1);
		expect(busyGroups.length).toBeGreaterThan(0);
		expect(Math.max(...busyGroups.map((lanes) => lanes.size))).toBeGreaterThanOrEqual(3);
	});

	it("adapts the complete fixture into React Flow without dropping routing metadata", () => {
		const graph = toReactFlowStructure(WORLD_RELATION_STRESS_FIXTURE);
		expect(graph.nodes).toHaveLength(WORLD_RELATION_STRESS_FIXTURE.nodes.length);
		expect(graph.edges).toHaveLength(WORLD_RELATION_STRESS_FIXTURE.edges.length);
		expect(
			graph.edges.every(
				(edge) =>
					typeof edge.data?.sourceLane === "number" &&
					typeof edge.data?.targetLane === "number" &&
					typeof edge.data?.bendOffset === "number",
			),
		).toBe(true);
	});
});
