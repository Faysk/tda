import { describe, expect, test } from "vitest";
import {
	activityEventCanBeHumorous,
	selectActivityBark,
	type ActivityBark,
	type ActivityContext,
} from "./activity-barks";

const context: ActivityContext = {
	eventCode: "QWEN_WINDOW_TRANSCRIBED",
	seq: 205,
	eventAt: "2026-09-27T02:00:00Z",
	jobId: "job-a",
	attempt: 2,
	sessionId: "session",
	profileId: "qwen-quality",
	speaker: "Faysk",
	track: 3,
	totalTracks: 4,
	window: 205,
	segment: null,
	audioStartSeconds: 100,
	audioEndSeconds: 160,
	gpuName: "RTX 4070",
	gpuUtilizationPercent: 96,
};

describe("activity bark engine", () => {
	test("selection is deterministic for the same factual event", () => {
		expect(selectActivityBark(context)).toEqual(selectActivityBark(context));
	});

	test("legacy event keeps attempt unknown instead of borrowing the current job attempt", () => {
		const legacy = { ...context, attempt: null };
		expect(selectActivityBark(legacy)).toEqual(selectActivityBark(legacy));
	});

	test("recent template and family are avoided when alternatives exist", () => {
		const first = selectActivityBark(context);
		expect(first).not.toBeNull();
		const next = selectActivityBark(context, {
			recentTemplateIds: first ? [first.templateId] : [],
			recentFamilies: first ? [first.family] : [],
		});
		expect(next?.templateId).not.toBe(first?.templateId);
		if (next) expect(next.family).not.toBe(first?.family);
	});

	test("only explicit routine success events can become humorous", () => {
		expect(activityEventCanBeHumorous({ code: "QWEN_WINDOW_TRANSCRIBED", level: "info" })).toBe(true);
		expect(activityEventCanBeHumorous({ code: "QWEN_WINDOW_TRANSCRIBED", level: "warning" })).toBe(false);
		expect(activityEventCanBeHumorous({ code: "QWEN_ALIGNMENT_WINDOW_FAILED", level: "error" })).toBe(false);
		expect(activityEventCanBeHumorous({ code: "ASR_CHECKPOINT_SAVED", level: "info" })).toBe(false);
	});

	test("missing requirements never render undefined placeholders", () => {
		const withoutSpeaker = { ...context, speaker: null, gpuName: null };
		const result = selectActivityBark(withoutSpeaker, { level: "light" });
		expect(result?.text).not.toContain("undefined");
		expect(result?.text).not.toContain("{");
	});

	test("inserted factual values are terminal text and never reparsed as placeholders", () => {
		const catalog: readonly ActivityBark[] = [
			{
				id: "literal-speaker",
				family: "speaker",
				tone: "tda",
				eventCodes: ["QWEN_WINDOW_TRANSCRIBED"],
				requires: ["speaker", "gpu"],
				text: "{speaker} terminou na {gpu}.",
			},
		];
		const result = selectActivityBark(
			{ ...context, speaker: "{gpu}", gpuName: "RTX 4070" },
			{ catalog },
		);
		expect(result?.text).toBe("{gpu} terminou na RTX 4070.");
	});

	test("script-looking factual values stay literal text", () => {
		const catalog: readonly ActivityBark[] = [
			{
				id: "literal-angle-brackets",
				family: "speaker",
				tone: "tda",
				eventCodes: ["QWEN_WINDOW_TRANSCRIBED"],
				requires: ["speaker"],
				text: "{speaker} avançou.",
			},
		];
		const speaker = "<script>alert('nope')</script>";
		const result = selectActivityBark({ ...context, speaker }, { catalog });
		expect(result?.text).toBe("<script>alert('nope')</script> avançou.");
	});

	test("supported placeholders preserve their ordinary rendering semantics", () => {
		const catalog: readonly ActivityBark[] = [
			{
				id: "all-placeholders",
				family: "meta",
				tone: "tda",
				eventCodes: ["QWEN_WINDOW_TRANSCRIBED"],
				requires: ["speaker", "window", "segment", "gpu"],
				text: "{speaker} · janela {window} · segmento {segment} · {gpu}",
			},
		];
		const result = selectActivityBark(
			{ ...context, segment: 9 },
			{ catalog },
		);
		expect(result?.text).toBe("Faysk · janela 205 · segmento 9 · RTX 4070");
	});

	test("off disables the personality renderer", () => {
		expect(selectActivityBark(context, { level: "off" })).toBeNull();
	});
});
