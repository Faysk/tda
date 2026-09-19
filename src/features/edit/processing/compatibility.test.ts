import { describe, expect, it } from "vitest";
import {
	supportsAutomaticLoopbackSession,
	supportsTerminalJobDelete,
} from "./compatibility";

describe("processing compatibility", () => {
	it.each([
		[undefined, false],
		[null, false],
		["", false],
		["0.3.9", false],
		["0.3.10", false],
		["0.3.11", true],
		["0.3.11-rc.1", true],
		["0.3.12", true],
		["0.4.0", true],
		["1.0.0", true],
		["garbage", false],
	])("terminal job deletion compatibility for %s", (version, expected) => {
		expect(supportsTerminalJobDelete(version)).toBe(expected);
	});


	it.each([
		[undefined, false],
		["0.3.13", false],
		["0.3.14", true],
		["0.3.14-rc.1", true],
		["0.4.0", true],
		["1.0.0", true],
		["garbage", false],
	])("automatic loopback session compatibility for %s", (version, expected) => {
		expect(supportsAutomaticLoopbackSession(version)).toBe(expected);
	});
});
