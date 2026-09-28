import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	new URL("../../app/conta/page.tsx", import.meta.url),
	"utf8",
);

describe("account and access surface contract", () => {
	it("does not duplicate the global launcher as an administrative hub", () => {
		expect(source).not.toContain("taskGrid");
		expect(source).not.toContain("Abrir Edit");
		expect(source).not.toContain("Processamento local");
		expect(source).not.toContain("Consultar permissões");
	});

	it("keeps identity, access recovery and POST logout semantics", () => {
		expect(source).toContain("Conta e acesso");
		expect(source).toContain('query.acesso === "negado"');
		expect(source).toContain('query.acesso === "indisponivel"');
		expect(source).toContain('action="/auth/logout" method="post"');
	});
});
