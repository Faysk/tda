import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sessionsSource = readFileSync(
	new URL("../../app/edit/sessoes/page.tsx", import.meta.url),
	"utf8",
);
const reviewSource = readFileSync(
	new URL("../../app/edit/revisao/page.tsx", import.meta.url),
	"utf8",
);
const permissionsSource = readFileSync(
	new URL("../../app/edit/[campaignSlug]/permissions/page.tsx", import.meta.url),
	"utf8",
);
const editEntrySource = readFileSync(
	new URL("../../app/edit/page.tsx", import.meta.url),
	"utf8",
);

describe("canonical Edit tool links", () => {
	it("does not use the /edit compatibility entrypoint as normal tool navigation", () => {
		for (const source of [sessionsSource, reviewSource, permissionsSource]) {
			expect(source).not.toContain('href="/edit"');
		}
	});

	it("keeps explicit destinations for review and permissions", () => {
		expect(reviewSource).toContain('href="/edit/sessoes"');
		expect(reviewSource).toContain("← Sessões do Edit");
		expect(permissionsSource).toContain('href="/edit/sessoes"');
		expect(permissionsSource).toContain("Conta e acesso");
	});

	it("keeps /edit itself as a redirect-only compatibility entrypoint", () => {
		expect(editEntrySource).toContain("firstAuthorizedEditDestination");
		expect(editEntrySource).toContain('redirect("/entrar?next=%2Fedit")');
		expect(editEntrySource).not.toContain("<nav");
	});
});
