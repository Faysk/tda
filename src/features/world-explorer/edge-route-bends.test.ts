import { describe, expect, it } from "vitest";
import type { WorldLayout } from "./constellation-layout";
import {
	countWorldRouteCrossings,
	routeWorldEdgeBends,
} from "./edge-route-bends";
import type { WorldEdgeDTO } from "./model";

function edge(id: string, source: string, target: string): WorldEdgeDTO {
	return {
		id,
		source,
		target,
		relationType: "test",
		label: id,
		direction: "symmetric",
		family: "context",
	};
}

describe("routeWorldEdgeBends", () => {
	it("reduces avoidable crossings without moving the persisted node layout", () => {
		const layout: WorldLayout = {
			a: { x: -100, y: -100 },
			b: { x: -100, y: 100 },
			c: { x: 100, y: -100 },
			d: { x: 100, y: 100 },
		};
		const edges = [
			edge("a-diagonal", "a", "d"),
			edge("b-diagonal", "b", "c"),
		];
		const baseline = { "a-diagonal": 0, "b-diagonal": 0 };
		const routed = routeWorldEdgeBends(layout, edges);

		expect(countWorldRouteCrossings(layout, edges, baseline)).toBeGreaterThan(0);
		expect(countWorldRouteCrossings(layout, edges, routed)).toBeLessThan(
			countWorldRouteCrossings(layout, edges, baseline),
		);
		expect(Math.abs(routed["b-diagonal"] ?? 0)).toBeGreaterThan(100);
		expect(layout).toEqual({
			a: { x: -100, y: -100 },
			b: { x: -100, y: 100 },
			c: { x: 100, y: -100 },
			d: { x: 100, y: 100 },
		});
	});

	it("routes around a non-endpoint node center when a bounded bend is cheaper", () => {
		const layout: WorldLayout = {
			source: { x: 0, y: 0 },
			blocker: { x: 200, y: 0 },
			target: { x: 400, y: 0 },
		};
		const routed = routeWorldEdgeBends(layout, [
			edge("through-blocker", "source", "target"),
		]);

		expect(Math.abs(routed["through-blocker"] ?? 0)).toBeGreaterThan(0);
		expect(Math.abs(routed["through-blocker"] ?? 0)).toBeLessThanOrEqual(220);
	});

	it("is deterministic even when projection edge order changes", () => {
		const layout: WorldLayout = {
			a: { x: -100, y: -100 },
			b: { x: -100, y: 100 },
			c: { x: 100, y: -100 },
			d: { x: 100, y: 100 },
		};
		const edges = [
			edge("edge-1", "a", "d"),
			edge("edge-2", "b", "c"),
			edge("edge-3", "a", "c"),
		];

		expect(routeWorldEdgeBends(layout, edges)).toEqual(
			routeWorldEdgeBends(layout, [...edges].reverse()),
		);
	});
});
