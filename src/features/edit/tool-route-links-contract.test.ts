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
const editWorldEntrySource = readFileSync(
	new URL("../../app/edit/mundo/page.tsx", import.meta.url),
	"utf8",
);

describe("canonical Edit tool links", () => {
	it("does not use the /edit compatibility entrypoint as normal tool navigation", () => {
		for (const source of [sessionsSource, reviewSource, permissionsSource]) {
			expect(source).not.toContain('href="/edit"');
		}
	});

	it("keeps global destinations out of review and permissions page-local chrome", () => {
		for (const source of [reviewSource, permissionsSource]) {
			expect(source).toContain("OperationalPageHeader");
			expect(source).not.toContain('aria-label="Navegação do Edit"');
			expect(source).not.toContain('href="/edit/sessoes"');
		}
		expect(reviewSource).not.toContain('href="/mundo"');
		expect(permissionsSource).not.toContain('href="/conta"');
	});

	it("keeps the World compatibility entrypoint campaign-explicit", () => {
		expect(editEntrySource).toContain("firstAuthorizedEditDestination");
		expect(editEntrySource).toContain('redirect("/entrar?next=%2Fedit")');
		expect(editEntrySource).not.toContain("<nav");
		expect(editWorldEntrySource).toContain("readEditableWorldCampaigns");
		expect(editWorldEntrySource).toContain("worldEditCampaignHref");
		expect(editWorldEntrySource).toContain("Escolha a campanha");
		expect(editWorldEntrySource).not.toContain('redirect("/mundo")');
		expect(editWorldEntrySource).not.toContain("CAMPAIGN_SLUG");
	});
});
