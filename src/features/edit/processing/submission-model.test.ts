import { describe, expect, test } from "vitest";
import {
	formatLocalBytes,
	profileEngineLabel,
	profileModeLabel,
	safeStoredSession,
	validateCraigFileMeta,
	validSessionId,
} from "./submission-model";

describe("processing submission model", () => {
	test("validates session ids against the local contract", () => {
		expect(validSessionId("sessao-42")).toBe(true);
		expect(validSessionId("Sessao_42")).toBe(true);
		expect(validSessionId("sessão 42")).toBe(false);
		expect(validSessionId("")).toBe(false);
		expect(validSessionId("a".repeat(129))).toBe(false);
	});

	test("rejects non-zip, empty and multi-file selections before upload", () => {
		expect(validateCraigFileMeta("craig.zip", 2048)).toBeNull();
		expect(validateCraigFileMeta("craig.wav", 2048)).toContain(".zip");
		expect(validateCraigFileMeta("craig.zip", 0)).toContain("vazio");
		expect(validateCraigFileMeta("craig.zip", 2048, 2)).toContain("exatamente um");
	});

	test("formats only factual local byte counts", () => {
		expect(formatLocalBytes(900)).toBe("900 B");
		expect(formatLocalBytes(1536)).toBe("1.5 KB");
		expect(formatLocalBytes(8 * 1024 ** 2)).toBe("8.0 MB");
	});

	test("presents profile engine and mode without quality ranking", () => {
		expect(profileEngineLabel("qwen3")).toBe("Qwen3-ASR");
		expect(profileEngineLabel("whisper")).toBe("Whisper");
		expect(profileModeLabel("qwen-quality")).toBe("qualidade");
		expect(profileModeLabel("whisper-detailed")).toBe("detalhado");
		expect(profileModeLabel("qwen-fast")).toBe("rápido");
		expect(profileModeLabel("whisper-turbo")).toBe("turbo");
	});

	test("stored session is suggestion-only and must remain protocol-safe", () => {
		expect(safeStoredSession("sessao-ontem")).toBe("sessao-ontem");
		expect(safeStoredSession(" sessão errada ")).toBeNull();
		expect(safeStoredSession(null)).toBeNull();
	});
});
