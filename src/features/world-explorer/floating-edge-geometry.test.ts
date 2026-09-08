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
});
