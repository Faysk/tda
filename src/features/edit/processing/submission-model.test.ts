import { describe, expect, test } from "vitest";
import type { TranscriptionProfileState } from "./protocol";
import {
	CRAIG_UPLOAD_MAX_BYTES,
	formatSubmissionBytes,
	profileReadinessCopy,
	selectInitialSubmissionProfile,
	submissionCtaLabel,
	suggestSessionIdFromFilename,
	validateCraigFile,
} from "./submission-model";

function profile(
	overrides: Partial<TranscriptionProfileState> = {},
): TranscriptionProfileState {
	return {
		id: "qwen-quality",
		engine: "qwen3",
		ready: true,
		preparationRequired: false,
		reason: null,
		...overrides,
	};
}

describe("submission model", () => {

	test("defaults to an operable profile without overriding explicit later choices", () => {
		expect(
			selectInitialSubmissionProfile([
				profile(),
				profile({
					id: "whisper-turbo",
					engine: "whisper",
					ready: true,
				}),
			]),
		).toBe("qwen-quality");

		expect(
			selectInitialSubmissionProfile([
				profile({
					ready: false,
					preparationRequired: false,
					reason: "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED",
				}),
				profile({
					id: "whisper-turbo",
					engine: "whisper",
					ready: true,
				}),
			]),
		).toBe("whisper-turbo");

		expect(
			selectInitialSubmissionProfile([
				profile({
					ready: false,
					preparationRequired: false,
					reason: "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED",
				}),
				profile({
					id: "whisper-detailed",
					engine: "whisper",
					ready: false,
					preparationRequired: true,
				}),
			]),
		).toBe("whisper-detailed");

		expect(
			selectInitialSubmissionProfile([
				profile({
					ready: false,
					preparationRequired: false,
					reason: "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED",
				}),
			]),
		).toBe("qwen-quality");
	});

	test("suggests an editable safe session id from the Craig filename", () => {
		expect(suggestSessionIdFromFilename("Sessão épica #42.zip")).toBe(
			"Sessao-epica-42",
		);
		expect(suggestSessionIdFromFilename("___teste__final___.ZIP")).toBe(
			"teste-final",
		);
		expect(suggestSessionIdFromFilename("🔥🔥.zip")).toBe("");
	});

	test("validates extension, emptiness and the Companion upload budget", () => {
		expect(validateCraigFile({ name: "craig.wav", size: 20 })).toMatch(/\.zip/u);
		expect(validateCraigFile({ name: "craig.zip", size: 0 })).toMatch(/vazio/u);
		expect(
			validateCraigFile({
				name: "craig.zip",
				size: CRAIG_UPLOAD_MAX_BYTES + 1,
			}),
		).toMatch(/64 GiB/u);
		expect(validateCraigFile({ name: "craig.zip", size: 2048 })).toBeNull();
	});

	test("keeps file size formatting compact and factual", () => {
		expect(formatSubmissionBytes(0)).toBe("0 B");
		expect(formatSubmissionBytes(2048)).toBe("2.0 KB");
		expect(formatSubmissionBytes(10 * 1024 ** 2)).toBe("10 MB");
	});

	test("CTA reflects readiness and only uses local pending stages", () => {
		expect(submissionCtaLabel(profile(), null)).toBe("Adicionar à fila");
		expect(
			submissionCtaLabel(
				profile({ ready: false, preparationRequired: true }),
				null,
			),
		).toBe("Preparar profile");
		expect(submissionCtaLabel(profile(), "validating")).toBe("Validando ZIP…");
		expect(submissionCtaLabel(profile(), "preparing")).toBe(
			"Preparando profile…",
		);
		expect(submissionCtaLabel(profile(), "submitting")).toBe(
			"Enviando ao Companion…",
		);
	});

	test("readiness separates preparation from incompatibility", () => {
		expect(profileReadinessCopy(profile())).toBeNull();
		expect(
			profileReadinessCopy(
				profile({ ready: false, preparationRequired: true }),
			),
		).toMatch(/preparado/u);
		expect(
			profileReadinessCopy(
				profile({ ready: false, preparationRequired: false }),
			),
		).toMatch(/indisponível/u);
	});
});
