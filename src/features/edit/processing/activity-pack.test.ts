import { describe, expect, test } from "vitest";
import {
	ACTIVITY_PACK_SCHEMA,
	ActivityPackError,
	activityPackCatalog,
	activityPackExample,
	parseActivityPackJson,
} from "./activity-pack";

describe("activity pack contract", () => {
	test("parses the example but never self-activates imported data", async () => {
		const pack = await parseActivityPackJson(activityPackExample());
		expect(pack.schemaVersion).toBe(ACTIVITY_PACK_SCHEMA);
		expect(pack.id).toBe("faysk-chaos-pack");
		expect(pack.enabled).toBe(false);
		expect(pack.templates).toHaveLength(1);
		expect(pack.canonicalSha256).toMatch(/^[0-9a-f]{64}$/u);
	});

	test("rejects critical events", async () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].event_codes = ["QWEN_ALIGNMENT_WINDOW_FAILED"];
		await expect(
			parseActivityPackJson(JSON.stringify(value)),
		).rejects.toThrow("PACK_EVENT_NOT_HUMOROUS");
	});

	test("rejects unknown fields and HTML-like template content", async () => {
		const unknown = JSON.parse(activityPackExample());
		unknown.templates[0].handler = "unsupported";
		await expect(
			parseActivityPackJson(JSON.stringify(unknown)),
		).rejects.toThrow("PACK_TEMPLATE_FIELD_UNSUPPORTED");

		const html = JSON.parse(activityPackExample());
		html.templates[0].text = "<strong>nope</strong>";
		await expect(parseActivityPackJson(JSON.stringify(html))).rejects.toThrow(
			ActivityPackError,
		);
	});

	test("requires declared requirements to include used placeholders", async () => {
		const value = JSON.parse(activityPackExample());
		value.templates[0].requires = [];
		await expect(
			parseActivityPackJson(JSON.stringify(value)),
		).rejects.toThrow("PACK_REQUIRES_MISSING");
	});

	test("keeps same template id from different packs distinct", async () => {
		const first = await parseActivityPackJson(activityPackExample(), {
			preserveEnabled: true,
		});
		const secondValue = JSON.parse(activityPackExample());
		secondValue.id = "another-chaos-pack";
		const second = await parseActivityPackJson(JSON.stringify(secondValue), {
			preserveEnabled: true,
		});
		const ids = activityPackCatalog([first, second])
			.map((item) => item.id)
			.filter((id) => id.includes("chaos-pack:"));
		expect(ids).toEqual([
			"faysk-chaos-pack:grammar-001",
			"another-chaos-pack:grammar-001",
		]);
	});

	test("rejects duplicate ids inside one pack", async () => {
		const value = JSON.parse(activityPackExample());
		value.templates.push({ ...value.templates[0] });
		await expect(
			parseActivityPackJson(JSON.stringify(value)),
		).rejects.toThrow("PACK_TEMPLATE_ID_INVALID");
	});
});
