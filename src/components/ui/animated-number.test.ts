import { describe, expect, test } from "vitest";
import {
	ANIMATED_NUMBER_MAX_MS,
	ANIMATED_NUMBER_MIN_MS,
	animatedNumberDuration,
	clampNumber,
	interpolateNumber,
	shouldAnimateNumber,
	smoothstep,
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

	test("keeps the fallback duration bounded and can bridge the full sample window", () => {
		expect(animatedNumberDuration(40, 41, 0, 100)).toBeGreaterThanOrEqual(
			ANIMATED_NUMBER_MIN_MS,
		);
		expect(animatedNumberDuration(0, 100, 0, 100)).toBe(
			ANIMATED_NUMBER_MAX_MS,
		);
		expect(animatedNumberDuration(3, 67, 0, 100, 1_500)).toBe(1_500);
		expect(animatedNumberDuration(67, 46, 0, 100, 6_000)).toBe(6_000);
	});

	test("smoothstep uses the whole window and retargeting starts from the current visual value", () => {
		expect(smoothstep(0)).toBe(0);
		expect(smoothstep(0.5)).toBe(0.5);
		expect(smoothstep(1)).toBe(1);

		const halfwayUp = interpolateNumber(3, 67, 0.5);
		expect(halfwayUp).toBeCloseTo(35);

		const retargeted = interpolateNumber(halfwayUp, 46, 0.5);
		expect(retargeted).toBeGreaterThan(halfwayUp);
		expect(retargeted).toBeLessThan(46);
		expect(interpolateNumber(67, 46, 1)).toBe(46);
	});

	test("reduced motion and hidden tabs never start a frame loop", () => {
		expect(shouldAnimateNumber(40, 100, true, false)).toBe(false);
		expect(shouldAnimateNumber(40, 100, false, true)).toBe(false);
		expect(shouldAnimateNumber(40, 40, false, false)).toBe(false);
		expect(shouldAnimateNumber(40, 100, false, false)).toBe(true);
	});
});
