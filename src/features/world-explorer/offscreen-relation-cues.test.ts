import { describe, expect, it } from "vitest";
import {
	worldOffscreenCuePoint,
	worldOffscreenCueTransform,
	worldPointInsideRect,
} from "./offscreen-relation-cues";

const RECT = { left: 10, top: 20, right: 210, bottom: 120 };

describe("World off-screen relation cues", () => {
	it("detects points inside the usable canvas rectangle", () => {
		expect(worldPointInsideRect({ x: 10, y: 20 }, RECT)).toBe(true);
		expect(worldPointInsideRect({ x: 211, y: 20 }, RECT)).toBe(false);
	});

	it("finds the right boundary for a visible-to-offscreen relation", () => {
		expect(
			worldOffscreenCuePoint({ x: 100, y: 70 }, { x: 300, y: 70 }, RECT),
		).toEqual({ x: 210, y: 70, boundary: "right" });
	});

	it("finds vertical and diagonal exits deterministically", () => {
		expect(
			worldOffscreenCuePoint({ x: 100, y: 70 }, { x: 100, y: -100 }, RECT),
		).toEqual({ x: 100, y: 20, boundary: "top" });
		const diagonal = worldOffscreenCuePoint(
			{ x: 100, y: 70 },
			{ x: 400, y: 400 },
			RECT,
		);
		expect(diagonal?.boundary).toBe("bottom");
		expect(diagonal?.y).toBe(120);
	});

	it("does not create cues when both endpoints share the same visibility state", () => {
		expect(
			worldOffscreenCuePoint({ x: 50, y: 50 }, { x: 150, y: 80 }, RECT),
		).toBeNull();
		expect(
			worldOffscreenCuePoint({ x: -10, y: 50 }, { x: 300, y: 80 }, RECT),
		).toBeNull();
	});

	it("anchors labels inward from each boundary", () => {
		expect(worldOffscreenCueTransform("left")).toBe("translate(0, -50%)");
		expect(worldOffscreenCueTransform("right")).toBe("translate(-100%, -50%)");
		expect(worldOffscreenCueTransform("top")).toBe("translate(-50%, 0)");
		expect(worldOffscreenCueTransform("bottom")).toBe("translate(-50%, -100%)");
	});
});
