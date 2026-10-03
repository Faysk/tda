import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	CampaignPicker,
	campaignPickerOptions,
} from "./campaign-picker";

describe("campaignPickerOptions", () => {
	it("preserves 0/1/N projections without inventing a selection", () => {
		expect(campaignPickerOptions([])).toEqual([]);
		expect(
			campaignPickerOptions([{ value: "a", label: "Campanha A" }]),
		).toEqual([{ value: "a", label: "Campanha A", disabled: false }]);
		expect(
			campaignPickerOptions([
				{ value: "a", label: "Mesmo nome" },
				{ value: "b", label: "Mesmo nome" },
				{ value: "c", label: "Campanha com um nome editorial muito longo que precisa continuar íntegro" },
			]),
		).toEqual([
			{ value: "a", label: "Mesmo nome", disabled: false },
			{ value: "b", label: "Mesmo nome", disabled: false },
			{
				value: "c",
				label: "Campanha com um nome editorial muito longo que precisa continuar íntegro",
				disabled: false,
			},
		]);
	});

	it("makes Geral opt-in and keeps its domain value opaque", () => {
		expect(
			campaignPickerOptions([{ value: "campaign-id", label: "Campanha" }], {
				optional: true,
				generalValue: "all-contexts",
				generalLabel: "Geral",
			}),
		).toEqual([
			{ value: "all-contexts", label: "Geral" },
			{ value: "campaign-id", label: "Campanha", disabled: false },
		]);
	});

	it("labels archived campaigns explicitly and lets the domain opt into historical selection", () => {
		expect(
			campaignPickerOptions([
				{ value: "archived-disabled", label: "Antiga", lifecycle: "archived" },
				{
					value: "archived-readable",
					label: "Histórica",
					lifecycle: "archived",
					disabled: false,
				},
			]),
		).toEqual([
			{
				value: "archived-disabled",
				label: "Antiga (arquivada)",
				disabled: true,
			},
			{
				value: "archived-readable",
				label: "Histórica (arquivada)",
				disabled: false,
			},
		]);
	});
});

describe("CampaignPicker", () => {
	it("keeps management separate from selection and hides unauthorized actions", () => {
		const hidden = renderToStaticMarkup(
			<CampaignPicker
				value="a"
				options={[{ value: "a", label: "Campanha A" }]}
				onChange={vi.fn()}
				ariaLabel="Campanha"
			/>,
		);
		expect(hidden).not.toContain("Gerenciar campanhas");
		expect(hidden).not.toContain("Nova campanha");

		const visible = renderToStaticMarkup(
			<CampaignPicker
				value="a"
				options={[{ value: "a", label: "Campanha A" }]}
				onChange={vi.fn()}
				ariaLabel="Campanha"
				canManage
				manageHref="/edit/campanhas?next=%2Fedit%2Fa"
				canCreate
				onCreate={vi.fn()}
			/>,
		);
		expect(visible).toContain("Gerenciar campanhas");
		expect(visible).toContain("Nova campanha");
		expect(visible).toContain('aria-label="Ações de campanha"');
	});

	it("announces pending navigation and disables repeated selection", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value="a"
				options={[{ value: "a", label: "Campanha A" }]}
				onChange={vi.fn()}
				ariaLabel="Campanha"
				pending
				pendingLabel="Trocando campanha…"
				canManage
			/>,
		);
		expect(html).toContain('data-pending="true"');
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain("disabled");
		expect(html).toContain("Trocando campanha…");
		expect(html).toContain('aria-live="polite"');
	});
});
