import { describe, expect, it } from "vitest";
import {
	presentJobError,
	presentJobEvent,
	presentJobTitle,
	stageLabels,
} from "./presentation";

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

	it("explains non-retryable run failures without exposing raw codes", () => {
		expect(presentJobError("WORKER_RESULT_RUN_MISMATCH")).toContain(
			"não corresponde",
		);
		expect(presentJobError("TRANSCRIPTION_SOURCE_HASH_MISMATCH")).toContain(
			"fonte Craig",
		);
	});

	it("explains recovery and legacy mirror degradation", () => {
		expect(
			presentJobEvent({
				seq: 1,
				code: "SUCCEEDED_RECOVERED",
				at: "2026-09-19T12:00:00Z",
				level: "warning",
				data: {},
			}).title,
		).toContain("recuperado");
		expect(
			presentJobEvent({
				seq: 2,
				code: "COMPATIBILITY_MIRROR_WRITE_FAILED",
				at: "2026-09-19T12:00:01Z",
				level: "warning",
				data: {},
			}).detail,
		).toContain("fonte de verdade");
	});

	it("labels canonical processing stages", () => {
		expect(stageLabels.transcription).toBe("Transcrição");
		expect(stageLabels.energy_analysis).toBe("Analisando energia entre faixas");
	});
});
