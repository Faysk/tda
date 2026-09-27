import { describe, expect, test } from "vitest";
import {
	activityEventCanBeHumorous,
	selectActivityBark,
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

	test("off disables the personality renderer", () => {
		expect(selectActivityBark(context, { level: "off" })).toBeNull();
	});
});
