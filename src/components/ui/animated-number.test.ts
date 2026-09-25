import { describe, expect, test } from "vitest";
import {
	ANIMATED_NUMBER_MAX_MS,
	ANIMATED_NUMBER_MIN_MS,
	animatedNumberDuration,
	clampNumber,
	interpolateNumber,
	shouldAnimateNumber,
} from "./animated-number";

describe("animated number helpers", () => {
	test("clamps telemetry to its factual domain", () => {
		expect(clampNumber(-4, 0, 100)).toBe(0);
		expect(clampNumber(140, 0, 100)).toBe(100);
		expect(clampNumber(42, 0, 100)).toBe(42);
	});

	test("interpolates upward and downward without overshoot", () => {
		const upward = interpolateNumber(40, 100, 0.5);
		const downward = interpolateNumber(100, 25, 0.5);

		expect(upward).toBeGreaterThan(40);
		expect(upward).toBeLessThan(100);
		expect(downward).toBeLessThan(100);
		expect(downward).toBeGreaterThan(25);
		expect(interpolateNumber(40, 100, 1)).toBe(100);
		expect(interpolateNumber(100, 25, 1)).toBe(25);
	});

	test("keeps animation duration inside the approved window", () => {
		expect(animatedNumberDuration(40, 41, 0, 100)).toBeGreaterThanOrEqual(
			ANIMATED_NUMBER_MIN_MS,
		);
		expect(animatedNumberDuration(0, 100, 0, 100)).toBe(
			ANIMATED_NUMBER_MAX_MS,
		);
	});

	test("reduced motion and hidden tabs never start a frame loop", () => {
		expect(shouldAnimateNumber(40, 100, true, false)).toBe(false);
		expect(shouldAnimateNumber(40, 100, false, true)).toBe(false);
		expect(shouldAnimateNumber(40, 40, false, false)).toBe(false);
		expect(shouldAnimateNumber(40, 100, false, false)).toBe(true);
	});
});
