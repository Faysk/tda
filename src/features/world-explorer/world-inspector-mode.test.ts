import { describe, expect, it } from "vitest";
import { nextInspectorMode } from "./world-inspector-mode";

describe("World authoring inspector mode", () => {
  it("cycles closed to overlay to docked and back to closed", () => {
    expect(nextInspectorMode("closed")).toBe("overlay");
    expect(nextInspectorMode("overlay")).toBe("docked");
    expect(nextInspectorMode("docked")).toBe("closed");
  });
});
