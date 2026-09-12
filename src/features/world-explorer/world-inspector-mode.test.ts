import { describe, expect, it } from "vitest";
import { nextWorldInspectorMode } from "./world-inspector-mode";

describe("World inspector presentation mode", () => {
	it("cycles closed, overlay and docked without touching domain state", () => {
		expect(nextWorldInspectorMode("closed")).toBe("overlay");
		expect(nextWorldInspectorMode("overlay")).toBe("docked");
		expect(nextWorldInspectorMode("docked")).toBe("closed");
	});
});
