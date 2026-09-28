import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editPageSource = readFileSync(
	new URL("../../app/edit/page.tsx", import.meta.url),
	"utf8",
);
const accountPageSource = readFileSync(
	new URL("../../app/conta/page.tsx", import.meta.url),
	"utf8",
);
const transcriptsPageSource = readFileSync(
	new URL("../../app/transcricoes/page.tsx", import.meta.url),
	"utf8",
);

describe("retired navigation hubs contract", () => {
	it("/edit is only a deterministic compatibility redirect", () => {
		expect(editPageSource).toContain("resolveEditCompatibilityTarget");
		expect(editPageSource).toContain(
			"redirect(resolveEditCompatibilityTarget(access))",
		);
		expect(editPageSource).not.toContain("MODULES");
		expect(editPageSource).not.toContain("moduleList");
		expect(editPageSource).not.toContain("<nav");
	});

	it("/conta describes identity and access without duplicating admin navigation", () => {
		expect(accountPageSource).toContain("Conta e acesso");
		expect(accountPageSource).toContain("navegação global");
		expect(accountPageSource).not.toContain("taskGrid");
		expect(accountPageSource).not.toContain("taskCard");
		expect(accountPageSource).not.toContain("Abrir Edit");
		expect(accountPageSource).not.toContain("Processamento local");
		expect(accountPageSource).not.toContain("authorizeCampaignCapability");
		expect(accountPageSource).not.toContain("EDIT_CAPABILITIES");
	});

	it("transcript recovery links use the focused account language", () => {
		expect(transcriptsPageSource).toContain("Conta e acesso");
		expect(transcriptsPageSource).not.toContain("Minha conta");
		expect(transcriptsPageSource).not.toContain("Consultar meu acesso");
	});
});
