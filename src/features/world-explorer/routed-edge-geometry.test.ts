import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getRoutedBezierPath } from "./routed-edge-geometry";

describe("getRoutedBezierPath", () => {
	it("keeps endpoints fixed while bending the relation corridor", () => {
		const [path, labelX, labelY] = getRoutedBezierPath({
			sourceX: 0,
			sourceY: 0,
			sourcePosition: Position.Right,
			targetX: 200,
			targetY: 0,
			targetPosition: Position.Left,
			bendOffset: 80,
		});

		expect(path.startsWith("M 0,0 C ")).toBe(true);
		expect(path.endsWith(" 200,0")).toBe(true);
		expect(labelX).toBeCloseTo(100, 6);
		expect(labelY).toBeCloseTo(60, 6);
	});

	it("mirrors the label corridor for the opposite bend", () => {
		const [, , positiveY] = getRoutedBezierPath({
			sourceX: 0,
			sourceY: 0,
			sourcePosition: Position.Right,
			targetX: 200,
			targetY: 0,
			targetPosition: Position.Left,
			bendOffset: 80,
		});
		const [, , negativeY] = getRoutedBezierPath({
			sourceX: 0,
			sourceY: 0,
			sourcePosition: Position.Right,
			targetX: 200,
			targetY: 0,
			targetPosition: Position.Left,
			bendOffset: -80,
		});

		expect(positiveY).toBeCloseTo(-negativeY, 6);
	});
});
