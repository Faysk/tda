import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignPicker } from "./campaign-picker";

const choices = [
	{
		value: "11111111-1111-4111-8111-111111111111",
		label: "Destino Sem Fim",
		lifecycle: "active" as const,
	},
	{
		value: "22222222-2222-4222-8222-222222222222",
		label: "Passos Retomados — um nome deliberadamente longo para reflow",
		lifecycle: "archived" as const,
	},
] as const;

describe("CampaignPicker", () => {
	it("keeps optional Geral and administrative actions semantically outside the value list", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value=""
				choices={choices}
				onChange={() => undefined}
				ariaLabel="Campanha da referência"
				optional
				canCreate
				onCreate={() => undefined}
				canManage
			/>,
		);

		expect(html).toContain("Geral");
		expect(html).toContain("+ Nova campanha");
		expect(html).toContain("Gerenciar campanhas");
		expect(html).toContain('href="/edit/campanhas"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('aria-haspopup="listbox"');
		expect(html).not.toContain('role="option"');
	});

	it("does not expose create/manage affordances when presentation hints are false", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value={choices[0].value}
				choices={choices}
				onChange={() => undefined}
				ariaLabel="Campanha obrigatória"
			/>,
		);

		expect(html).toContain("Destino Sem Fim");
		expect(html).not.toContain("+ Nova campanha");
		expect(html).not.toContain("Gerenciar campanhas");
		expect(html).not.toContain("Geral");
	});

	it("supports empty required projections without inventing a fallback campaign", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value=""
				choices={[]}
				onChange={() => undefined}
				ariaLabel="Campanha obrigatória"
			/>,
		);

		expect(html).toContain("Selecionar");
		expect(html).not.toContain("Destino Sem Fim");
		expect(html).not.toContain("yuhara-main");
	});
});
