import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
	new URL("../../app/edit/mundo/page.tsx", import.meta.url),
	"utf8",
);
const canonicalPageSource = readFileSync(
	new URL("../../app/edit/[campaignSlug]/mundo/page.tsx", import.meta.url),
	"utf8",
);
const publicLayoutSource = readFileSync(
	new URL("../../app/campanhas/[campaignSlug]/mundo/layout.tsx", import.meta.url),
	"utf8",
);
const editLayoutSource = readFileSync(
	new URL("../../app/edit/[campaignSlug]/mundo/layout.tsx", import.meta.url),
	"utf8",
);

describe("World campaign route contract", () => {
	it("keeps /edit/mundo as an explicit campaign selector instead of assuming legacy scope", () => {
		expect(pageSource).toContain("currentAccess");
		expect(pageSource).toContain("readEditableWorldCampaigns");
		expect(pageSource).toContain("worldEditCampaignHref");
		expect(pageSource).toContain("Escolha a campanha");
		expect(pageSource).not.toContain('redirect("/mundo")');
		expect(pageSource).not.toContain("CAMPAIGN_SLUG");
	});

	it("keeps canonical authoring campaign-qualified", () => {
		expect(canonicalPageSource).toContain("campaignSlug");
		expect(canonicalPageSource).toContain("readEditableWorldCampaigns");
		expect(canonicalPageSource).toContain("worldEditCampaignHref");
	});

	it("wraps both canonical World routes in the workspace shell", () => {
		for (const source of [publicLayoutSource, editLayoutSource]) {
			expect(source).toContain("WorldWorkspaceShell");
			expect(source).toContain("@xyflow/react/dist/style.css");
		}
	});

	it("does not render the retired unsafe staging editor", () => {
		expect(pageSource).not.toContain("unsafe-access");
		expect(pageSource).not.toContain("isUnsafeEditEnabled");
		expect(pageSource).not.toContain("WorldLayoutEditorClient");
		expect(pageSource).not.toContain("DANDELION_WORLD_DEMO");
	});
});
