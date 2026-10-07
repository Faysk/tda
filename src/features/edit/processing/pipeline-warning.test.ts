import { describe, expect, it } from "vitest";
import { presentPipelineWarning } from "./pipeline-warning";

describe("unrecognized audio warning", () => {
	it("shows the omitted interval without implying silence or fabricated words", () => {
		expect(presentPipelineWarning("QWEN_UNRECOGNIZED_WINDOW:track-1:window-2:54.000-114.000")).toBe("Faixa 1 · 00:00:54–00:01:54: trecho sem reconhecimento ignorado. O restante foi processado normalmente.");
	});
	it("preserves unrelated and malformed warnings", () => {
		for (const warning of ["QWEN_ALIGNMENT_FALLBACK:track-1", "QWEN_UNRECOGNIZED_WINDOW:track-1:window-2:114-54"]) expect(presentPipelineWarning(warning)).toBe(warning);
	});
});
