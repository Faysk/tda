import { describe, expect, it } from "vitest";
import {
	AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION,
	COMPLETED_RUN_DELETE_MINIMUM_VERSION,
	QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION,
	supportsAutomaticLoopbackSession,
	supportsCompletedRunDelete,
	supportsQwenAlignmentRuntime,
	supportsTerminalJobDelete,
} from "./compatibility";

describe("processing compatibility", () => {
	it("fails closed on Qwen runtimes before the owned-overflow recovery", () => {
		expect(QWEN_ALIGNMENT_RUNTIME_MINIMUM_VERSION).toBe("1.0.12");
		expect(supportsQwenAlignmentRuntime("1.0.10")).toBe(false);
		expect(supportsQwenAlignmentRuntime("1.0.11")).toBe(false);
		expect(supportsQwenAlignmentRuntime("1.0.12")).toBe(true);
		expect(supportsQwenAlignmentRuntime("1.0.13")).toBe(true);
		expect(supportsQwenAlignmentRuntime("1.0.12-rc.1")).toBe(false);
		expect(supportsQwenAlignmentRuntime("development")).toBe(false);
	});

	it("fails closed on completed-run deletion before Companion 0.3.16", () => {
		expect(COMPLETED_RUN_DELETE_MINIMUM_VERSION).toBe("0.3.16");
		expect(supportsCompletedRunDelete(undefined)).toBe(false);
		expect(supportsCompletedRunDelete(null)).toBe(false);
		expect(supportsCompletedRunDelete("0.3.15")).toBe(false);
		expect(supportsCompletedRunDelete("0.3.16")).toBe(true);
		expect(supportsCompletedRunDelete("0.3.16-rc.1")).toBe(true);
		expect(supportsCompletedRunDelete("0.4.0")).toBe(true);
		expect(supportsCompletedRunDelete("garbage")).toBe(false);
	});

	it("publishes one minimum version for the automatic browser-session contract", () => {
		expect(AUTOMATIC_LOOPBACK_SESSION_MINIMUM_VERSION).toBe("0.3.14");
	});

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
