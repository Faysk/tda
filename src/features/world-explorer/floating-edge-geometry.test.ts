import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getFloatingEdgeGeometry } from "./floating-edge-geometry";

describe("getFloatingEdgeGeometry", () => {
	it("anchors horizontal relations on the facing node borders", () => {
		const geometry = getFloatingEdgeGeometry(
			{ x: 0, y: 0, width: 100, height: 100 },
			{ x: 300, y: 0, width: 100, height: 100 },
		);

		expect(geometry.sourcePosition).toBe(Position.Right);
		expect(geometry.targetPosition).toBe(Position.Left);
		expect(geometry.sourceX).toBeCloseTo(102, 3);
		expect(geometry.sourceY).toBeCloseTo(50, 3);
		expect(geometry.targetX).toBeCloseTo(298, 3);
		expect(geometry.targetY).toBeCloseTo(50, 3);
	});

	it("follows diagonal movement without snapping to a fixed port", () => {
		const geometry = getFloatingEdgeGeometry(
			{ x: 20, y: 30, width: 120, height: 120 },
			{ x: 360, y: 260, width: 80, height: 80 },
		);

		expect(Number.isFinite(geometry.sourceX)).toBe(true);
		expect(Number.isFinite(geometry.sourceY)).toBe(true);
		expect(Number.isFinite(geometry.targetX)).toBe(true);
		expect(Number.isFinite(geometry.targetY)).toBe(true);
		expect(geometry.sourceX).toBeGreaterThan(80);
		expect(geometry.sourceY).toBeGreaterThan(90);
		expect([Position.Right, Position.Bottom]).toContain(geometry.sourcePosition);
		expect([Position.Left, Position.Top]).toContain(geometry.targetPosition);
	});

	it("anchors vertical relations at top and bottom", () => {
		const geometry = getFloatingEdgeGeometry(
			{ x: 0, y: 0, width: 80, height: 80 },
			{ x: 0, y: 260, width: 80, height: 80 },
		);

		expect(geometry.sourcePosition).toBe(Position.Bottom);
		expect(geometry.targetPosition).toBe(Position.Top);
		expect(geometry.sourceY).toBeCloseTo(82, 3);
		expect(geometry.targetY).toBeCloseTo(258, 3);
	});

	it("spreads routed lanes across the visible silhouette", () => {
		const source = { x: 0, y: 0, width: 100, height: 100 };
		const target = { x: 300, y: 0, width: 100, height: 100 };
		const lanes = [-2, -1, 0, 1, 2] as const;
		const sourcePoints = lanes.map((lane) =>
			getFloatingEdgeGeometry(source, target, {
				source: { side: "right", lane },
				target: { side: "left", lane: 0 },
			}),
		);

		expect(sourcePoints.map((point) => point.sourceY)).toEqual(
			[...sourcePoints.map((point) => point.sourceY)].sort((left, right) => left - right),
		);
		expect(new Set(sourcePoints.map((point) => point.sourceY)).size).toBe(lanes.length);
		expect(sourcePoints[2]?.sourceX).toBeCloseTo(102, 3);
		expect(sourcePoints[2]?.sourceY).toBeCloseTo(50, 3);
		for (const point of sourcePoints) {
			expect(point.sourcePosition).toBe(Position.Right);
			const ellipse =
				((point.sourceX - 2 - 50) / 50) ** 2 +
				((point.sourceY - 50) / 50) ** 2;
			expect(ellipse).toBeCloseTo(1, 6);
		}
	});

	it("keeps target lanes distinct and side-aware", () => {
		const source = { x: 0, y: 0, width: 80, height: 80 };
		const target = { x: 0, y: 260, width: 80, height: 80 };
		const upper = getFloatingEdgeGeometry(source, target, {
			source: { side: "bottom", lane: -2 },
			target: { side: "top", lane: -2 },
		});
		const lower = getFloatingEdgeGeometry(source, target, {
			source: { side: "bottom", lane: 2 },
			target: { side: "top", lane: 2 },
		});

		expect(upper.sourcePosition).toBe(Position.Bottom);
		expect(lower.sourcePosition).toBe(Position.Bottom);
		expect(upper.targetPosition).toBe(Position.Top);
		expect(lower.targetPosition).toBe(Position.Top);
		expect(upper.sourceX).toBeLessThan(lower.sourceX);
		expect(upper.targetX).toBeLessThan(lower.targetX);
	});
});
