import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editSource = readFileSync(
	new URL("../../app/edit/page.tsx", import.meta.url),
	"utf8",
);
const accountSource = readFileSync(
	new URL("../../app/conta/page.tsx", import.meta.url),
	"utf8",
);
const accountOverviewSource = readFileSync(
	new URL("../auth/account-overview.tsx", import.meta.url),
	"utf8",
);

describe("global navigation compatibility entrypoints", () => {
	it("keeps /edit as a redirect-only compatibility route", () => {
		expect(editSource).toContain("firstAuthorizedEditDestination");
		expect(editSource).toContain('redirect("/entrar?next=%2Fedit")');
		expect(editSource).toContain('redirect("/conta?acesso=indisponivel")');
		expect(editSource).toContain('redirect("/conta?acesso=negado")');
		expect(editSource).not.toContain("Ferramentas administrativas");
		expect(editSource).not.toContain("moduleList");
		expect(editSource).not.toContain("<nav");
	});

	it("keeps /conta focused on identity and access recovery instead of admin shortcuts", () => {
		expect(accountSource).toContain("Conta e acesso");
		expect(accountSource).toContain('query.acesso === "negado"');
		expect(accountSource).toContain('query.acesso === "indisponivel"');
		expect(accountSource).toContain("<AccountOverview");
		expect(accountOverviewSource).toContain('action="/auth/logout"');
		expect(accountSource).not.toContain("taskGrid");
		expect(accountOverviewSource).not.toContain("taskGrid");
		expect(accountOverviewSource).not.toContain("Abrir Edit");
		expect(accountOverviewSource).not.toContain("Processamento local");
		expect(accountOverviewSource).not.toContain("Consultar permissões");
	});
});
