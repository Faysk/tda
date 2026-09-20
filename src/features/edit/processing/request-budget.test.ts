import { describe, expect, it } from "vitest";
import {
	buildCraigTranscriptionRequest,
	craigTranscriptionRequestByteLength,
	LOCAL_JSON_BODY_MAX_BYTES,
	serializedJsonBody,
	TRANSCRIPTION_TEXT_MAX_CHARS,
	truncateUnicodeScalars,
} from "./request-budget";
import type { CraigTranscriptionInput } from "./protocol";

const base: CraigTranscriptionInput = {
	campaignId: "yuhara-main",
	sessionId: "sessao-42",
	sourceId: `craig-${"a".repeat(64)}`,
	profileId: "qwen-quality",
	glossary: "",
	context: "",
};

describe("processing request byte budget", () => {
	it("measures serialized UTF-8 bytes instead of JavaScript string length", () => {
		expect(serializedJsonBody({ value: "a" }).byteLength).toBe(
			Buffer.byteLength(JSON.stringify({ value: "a" }), "utf8"),
		);
		expect(serializedJsonBody({ value: "é" }).byteLength).toBe(
			serializedJsonBody({ value: "a" }).byteLength + 1,
		);
		expect(serializedJsonBody({ value: "😀" }).byteLength).toBe(
			serializedJsonBody({ value: "a" }).byteLength + 3,
		);
	});

	it("truncates by Unicode scalar values without splitting surrogate pairs", () => {
		const value = "😀".repeat(TRANSCRIPTION_TEXT_MAX_CHARS + 1);
		const truncated = truncateUnicodeScalars(value, TRANSCRIPTION_TEXT_MAX_CHARS);
		expect(Array.from(truncated)).toHaveLength(TRANSCRIPTION_TEXT_MAX_CHARS);
		expect(truncated.endsWith("😀")).toBe(true);
	});

	it("counts the entire Craig envelope and accepts the exact byte boundary", () => {
		const emptyBytes = craigTranscriptionRequestByteLength(base);
		const available = LOCAL_JSON_BODY_MAX_BYTES - emptyBytes;
		const emojiCount = Math.floor(available / 4);
		const asciiCount = available % 4;
		const context = `${"😀".repeat(emojiCount)}${"a".repeat(asciiCount)}`;
		expect(Array.from(context).length).toBeLessThanOrEqual(
			TRANSCRIPTION_TEXT_MAX_CHARS,
		);

		const exact = { ...base, context };
		expect(craigTranscriptionRequestByteLength(exact)).toBe(
			LOCAL_JSON_BODY_MAX_BYTES,
		);
		expect(
			craigTranscriptionRequestByteLength({
				...exact,
				context: `${context}a`,
			}),
		).toBe(LOCAL_JSON_BODY_MAX_BYTES + 1);
	});

	it("includes identifiers and both text fields in the same budget", () => {
		const short = craigTranscriptionRequestByteLength(base);
		expect(
			craigTranscriptionRequestByteLength({
				...base,
				sessionId: `${base.sessionId}-longer`,
				context: "ação",
				glossary: "Yllith 😀",
			}),
		).toBeGreaterThan(short);
	});

	it("builds the same field order and semantic limits used on the wire", () => {
		const request = buildCraigTranscriptionRequest({
			...base,
			glossary: "g".repeat(1300),
			context: "c".repeat(1300),
		});
		expect(request).toEqual({
			kind: "transcription.craig",
			campaign_id: base.campaignId,
			session_id: base.sessionId,
			source_id: base.sourceId,
			profile_id: "qwen-quality",
			glossary: "g".repeat(TRANSCRIPTION_TEXT_MAX_CHARS),
			context: "c".repeat(TRANSCRIPTION_TEXT_MAX_CHARS),
			cpu: false,
		});
	});
});
