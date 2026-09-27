import { describe, expect, test } from "vitest";
import {
	ActivityPackError,
	activityPackExample,
	parseActivityPackJson,
} from "./activity-pack";

describe("activity pack contract", () => {
	test("parses the official example as data", () => {
		const pack = parseActivityPackJson(activityPackExample());
		expect(pack.id).toBe("faysk-chaos-pack");
		expect(pack.templates).toHaveLength(1);
	});

	test("rejects critical events from humor packs", () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].event_codes = ["QWEN_ALIGNMENT_WINDOW_FAILED"];
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			"PACK_EVENT_NOT_HUMOROUS",
		);
	});

	test("rejects executable-looking or unknown surface", () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].handler = "eval(alert(1))";
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			"PACK_TEMPLATE_FIELD_UNSUPPORTED",
		);
	});

	test("requires placeholders to be declared when requires is explicit", () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].requires = [];
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			"PACK_REQUIRES_MISSING",
		);
	});

	test("rejects HTML", () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].text = "<img src=x onerror=alert(1)>";
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			ActivityPackError,
		);
	});
});
