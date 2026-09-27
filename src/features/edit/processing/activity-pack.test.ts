import { describe, expect, test } from "vitest";
import {
	ActivityPackError,
	activityPackExample,
	activityPackPrompt,
	parseActivityPackJson,
	serializeActivityPack,
} from "./activity-pack";

describe("activity pack contract", () => {
	test("parses the official example as inert data", () => {
		const pack = parseActivityPackJson(activityPackExample());
		expect(pack.id).toBe("faysk-chaos-pack");
		expect(pack.templates).toHaveLength(2);
		expect(pack.templates[0]?.packId).toBe("faysk-chaos-pack");
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

	test("rejects recursive prototype-pollution keys", () => {
		const raw = activityPackExample().replace(
			'"conditions": {',
			'"conditions": {"prototype": {"polluted": true},',
		);
		expect(() => parseActivityPackJson(raw)).toThrow("PACK_UNSAFE_KEY");
	});

	test("requires placeholders to be declared when requires is explicit", () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].requires = [];
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			"PACK_REQUIRES_MISSING",
		);
	});

	test("rejects unknown conditions and invalid ranges", () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].conditions = { arbitrary_expression: "gpu > 90" };
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			"PACK_CONDITION_UNSUPPORTED",
		);
		value.templates[0].conditions = { window_min: 20, window_max: 10 };
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			"PACK_CONDITIONS_INVALID",
		);
	});

	test("rejects HTML and control content", () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].text = "<img src=x onerror=alert(1)>";
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			ActivityPackError,
		);
	});

	test("duplicate template ids inside one pack fail closed", () => {
		const value = JSON.parse(activityPackExample());
		value.templates.push({ ...value.templates[0] });
		expect(() => parseActivityPackJson(JSON.stringify(value))).toThrow(
			"PACK_TEMPLATE_ID_INVALID",
		);
	});

	test("export round-trip preserves stable pack/template identity", () => {
		const pack = parseActivityPackJson(activityPackExample());
		const roundTrip = parseActivityPackJson(serializeActivityPack(pack, false));
		expect(roundTrip.id).toBe(pack.id);
		expect(roundTrip.templates.map((item) => item.id)).toEqual(
			pack.templates.map((item) => item.id),
		);
		expect(roundTrip.enabled).toBe(false);
	});

	test("prompt generator only advertises the closed v1 surface", () => {
		const prompt = activityPackPrompt();
		expect(prompt).toContain("tda_activity_pack_v1");
		expect(prompt).toContain("QWEN_WINDOW_TRANSCRIBED");
		expect(prompt).toContain("gpu_utilization_min");
		expect(prompt).not.toContain("eval(");
	});
});
