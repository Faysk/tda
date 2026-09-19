import { describe, expect, it } from "vitest";
import { presentJobTitle, stageLabels } from "./presentation";

describe("processing presentation", () => {
	it("presents Craig transcription jobs as a session transcription", () => {
		expect(presentJobTitle({ kind: "transcription.craig" })).toBe(
			"Transcrição de sessão",
		);
	});

	it("keeps synthetic jobs friendly and unknown kinds explicit", () => {
		expect(presentJobTitle({ kind: "synthetic.fixture" })).toBe("Ensaio sintético");
		expect(presentJobTitle({ kind: "custom.kind" })).toBe("custom.kind");
	});

	it("labels the canonical transcription stage", () => {
		expect(stageLabels.transcription).toBe("Transcrição");
	});
});
