import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignPicker } from "./campaign-picker";

const options = [
	{
		value: "11111111-1111-4111-8111-111111111111",
		label: "Destino Sem Fim",
		disambiguation: "destino-principal",
		lifecycle: "active" as const,
	},
	{
		value: "22222222-2222-4222-8222-222222222222",
		label: "Destino Sem Fim",
		disambiguation: "destino-legado",
		lifecycle: "archived" as const,
	},
	{
		value: "33333333-3333-4333-8333-333333333333",
		label: "Passos Retomados — um nome deliberadamente longo para reflow",
		lifecycle: "active" as const,
	},
] as const;

describe("CampaignPicker", () => {
	it("keeps optional Geral and administrative actions outside the value list", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value=""
				options={options}
				onChange={() => undefined}
				ariaLabel="Campanha da referência"
				optional
				canCreate
				onCreate={() => undefined}
				canManage
			/>,
		);

		expect(html).toContain("Geral");
		expect(html).toContain("Nova campanha");
		expect(html).toContain("Gerenciar campanhas");
		expect(html).toContain('href="/edit/campanhas"');
		expect(html).toContain('target="_blank"');
	});

	it("does not silently project the first campaign for required 0/1/N states", () => {
		for (const projected of [[], options.slice(0, 1), options] as const) {
			const html = renderToStaticMarkup(
				<CampaignPicker
					value=""
					options={projected}
					onChange={() => undefined}
					ariaLabel="Campanha obrigatória"
				/>,
			);
			expect(html).toContain("Selecione…");
		}
	});

	it("keeps duplicate human names distinct by opaque value and labels archived state", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value={options[1].value}
				options={options}
				onChange={() => undefined}
				ariaLabel="Campanha obrigatória"
			/>,
		);

		expect(html.match(/Destino Sem Fim/g)?.length).toBeGreaterThanOrEqual(2);
		expect(html).toContain("destino-principal");
		expect(html).toContain("destino-legado");
		expect(html).toContain("arquivada");
		expect(html).toContain(options[0].value);
		expect(html).toContain(options[1].value);
	});

	it("marks pending navigation busy and disables campaign actions", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value={options[0].value}
				options={options}
				onChange={() => undefined}
				ariaLabel="Campanha obrigatória"
				pending
				canCreate
				onCreate={() => undefined}
				canManage
			/>,
		);

		expect(html).toContain('data-pending="true"');
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain("Abrindo campanha…");
	});

	it("supports same-tab management when a workflow owns a safe return path", () => {
		const html = renderToStaticMarkup(
			<CampaignPicker
				value={options[0].value}
				options={options}
				onChange={() => undefined}
				ariaLabel="Campanha obrigatória"
				canManage
				manageHref="/edit/campanhas?next=%2Fedit%2Fsessoes"
				manageTarget="_self"
			/>,
		);

		expect(html).toContain("Gerenciar campanhas");
		expect(html).not.toContain('target="_blank"');
	});
});
