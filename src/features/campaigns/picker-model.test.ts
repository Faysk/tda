import { describe, expect, it } from "vitest";
import {
	buildCampaignPickerItems,
	campaignPickerControlValue,
	campaignValueForControl,
	selectedCampaignControlValue,
} from "./picker-model";

describe("campaign picker projection", () => {
	it("preserves opaque domain values and keeps Geral opt-in", () => {
		const uuid = "11111111-1111-4111-8111-111111111111";
		const items = buildCampaignPickerItems([
			{ value: null, label: "Geral", lifecycle: "active" },
			{ value: uuid, label: "Crônicas da Mesa", lifecycle: "active" },
		]);

		expect(items.map((item) => item.value)).toEqual([null, uuid]);
		expect(campaignValueForControl(items, campaignPickerControlValue(null))).toBeNull();
		expect(
			campaignValueForControl(items, campaignPickerControlValue(uuid)),
		).toBe(uuid);
	});

	it("marks archived choices in text and can disable them as destinations", () => {
		const [archived] = buildCampaignPickerItems([
			{
				value: "historica",
				label: "Campanha histórica",
				lifecycle: "archived",
				disabled: true,
			},
		]);

		expect(archived).toMatchObject({
			value: "historica",
			label: "Campanha histórica · Arquivada",
			lifecycle: "archived",
			disabled: true,
		});
	});

	it("supports duplicate human names when identities differ", () => {
		const items = buildCampaignPickerItems([
			{ value: "campaign-a", label: "Mesa", lifecycle: "active" },
			{ value: "campaign-b", label: "Mesa", lifecycle: "active" },
		]);

		expect(items).toHaveLength(2);
		expect(items[0]?.controlValue).not.toBe(items[1]?.controlValue);
	});

	it("rejects duplicate values instead of silently aliasing identities", () => {
		expect(() =>
			buildCampaignPickerItems([
				{ value: "same", label: "A", lifecycle: "active" },
				{ value: "same", label: "B", lifecycle: "active" },
			]),
		).toThrow(/unique values/u);
	});

	it("keeps controlled selection stable across 0, 1 and N options", () => {
		const none = buildCampaignPickerItems<string>([]);
		expect(selectedCampaignControlValue(none, undefined)).toBeUndefined();

		const one = buildCampaignPickerItems([
			{ value: "a", label: "A", lifecycle: "active" },
		]);
		expect(selectedCampaignControlValue(one, "a")).toBe(
			campaignPickerControlValue("a"),
		);
		expect(selectedCampaignControlValue(one, "missing")).toBeUndefined();

		const many = buildCampaignPickerItems([
			{ value: "a", label: "Mesmo nome", lifecycle: "active" },
			{
				value: "b",
				label: "Nome deliberadamente muito longo para provar que identidade e apresentação continuam separadas",
				lifecycle: "active",
			},
			{ value: "c", label: "Histórica", lifecycle: "archived" },
		]);
		expect(campaignValueForControl(many, campaignPickerControlValue("b"))).toBe("b");
	});
});
