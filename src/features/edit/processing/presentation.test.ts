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

	it("explains worker handshake, encoding and runtime failures", () => {
		expect(presentJobError("WORKER_STDOUT_ENCODING_INVALID")).toContain("codificação");
		expect(presentJobError("WORKER_READY_REQUIRED")).toContain("handshake");
		expect(presentJobError("WORKER_SEQUENCE_GAP")).toContain("sequência");
		expect(presentJobError("QWEN_PHYSICAL_ACCEPTANCE_REQUIRED")).toContain(
			"validação física",
		);
		expect(presentJobError("WHISPER_RUNTIME_UNAVAILABLE")).toContain(
			"Whisper",
		);
	});

	it("explains new integrity and worker-contract failures", () => {
		expect(presentJobError("AGENT_BUSY")).toContain("ocupado");
		expect(presentJobError("RESULT_ARTIFACT_UNAVAILABLE")).toContain(
			"não está mais disponível",
		);
		expect(presentJobError("WORKER_PROGRESS_GAP")).toContain("fora de ordem");
		expect(presentJobError("TRANSCRIPT_VALIDATION_FAILED")).toContain(
			"validação estrutural",
		);
		expect(presentJobError("CRAIG_MANIFEST_TRACK_METADATA_MISMATCH")).toContain(
			"reimporte",
		);
	});

	it("uses friendly worker diagnostics in the event history", () => {
		expect(
			presentJobEvent({
				seq: 20,
				code: "WORKER_READY_REQUIRED",
				at: "2026-09-19T12:00:00Z",
				level: "error",
				data: {},
			}).title,
		).toContain("handshake");
		expect(
			presentJobEvent({
				seq: 21,
				code: "WORKER_RESULT_TEARDOWN_FORCED",
				at: "2026-09-19T12:00:01Z",
				level: "warning",
				data: {},
			}).detail,
		).toContain("run imutável");
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
		expect(
			presentJobEvent({
				seq: 3,
				code: "INCOMPLETE_RUNS_CLEANED",
				at: "2026-09-19T12:00:02Z",
				level: "info",
				data: { count: 2 },
			}).title,
		).toContain("2 runs incompletos");
	});

	it("labels canonical processing stages", () => {
		expect(stageLabels.transcription).toBe("Transcrição");
		expect(stageLabels.energy_analysis).toBe("Analisando energia entre faixas");
	});
});


it("presents Qwen post-ASR track context truthfully", () => {
	expect(
		presentJobEvent({
			seq: 41,
			code: "TRACK_ALIGNMENT_STARTED",
			at: "2026-09-19T00:00:00.000Z",
			level: "info",
			data: { track: 1, total_tracks: 4, speaker: "Alice", stage: "alignment" },
		}),
	).toEqual({ title: "Alinhando arquivo 1 de 4 — Alice." });

	expect(
		presentJobEvent({
			seq: 42,
			code: "TRACK_ENERGY_STARTED",
			at: "2026-09-19T00:00:01.000Z",
			level: "info",
			data: { track: 2, total_tracks: 4, speaker: "Bob", stage: "energy_analysis" },
		}),
	).toEqual({ title: "Analisando energia do arquivo 2 de 4 — Bob." });
});
