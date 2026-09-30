import { describe, expect, it } from "vitest";
import { worldStatusOverlayMessage } from "./world-status-overlay";

describe("worldStatusOverlayMessage", () => {
	it("coalesces busy and feedback into one current message", () => {
		expect(
			worldStatusOverlayMessage(
				"Outra pessoa está editando o Mundo.",
				"Feedback anterior.",
			),
		).toEqual({
			kind: "busy",
			message: "Outra pessoa está editando o Mundo.",
		});
	});

	it("falls back to edit feedback when no busy notice exists", () => {
		expect(worldStatusOverlayMessage(null, "Rascunho salvo.")).toEqual({
			kind: "feedback",
			message: "Rascunho salvo.",
		});
	});

	it("renders no status surface without a current message", () => {
		expect(worldStatusOverlayMessage(null, null)).toBeNull();
	});
});
