import { describe, expect, it } from "vitest";
import { statisticsReadModelV2Enabled } from "./rollout";

describe("statistics read-model rollout", () => {
	it.each([
		[undefined, false],
		["", false],
		["false", false],
		["TRUE", false],
		["1", false],
		["true", true],
	])("treats %s as enabled=%s", (value, expected) => {
		expect(statisticsReadModelV2Enabled(value)).toBe(expected);
	});
});
