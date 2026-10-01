import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
	new URL(
		"../../../app/edit/[campaignSlug]/sessoes/[id]/page.tsx",
		import.meta.url,
	),
	"utf8",
);

const legacyEntrySource = readFileSync(
	new URL("../../../app/edit/sessoes/[id]/page.tsx", import.meta.url),
	"utf8",
);

describe("canonical Edit session route contract", () => {
	it("uses an explicit campaign-qualified route and never the legacy fixed slug", () => {
		expect(pageSource).toContain("campaignSlug");
		expect(pageSource).toContain("findEditSessionBySourceId");
		expect(pageSource).toContain(
			"findEditSessionBySourceId(campaignSlug, sourceSessionId)",
		);
		expect(pageSource).not.toContain("CAMPAIGN_SLUG");
		expect(pageSource).not.toContain("unsafe-access");
	});

	it("gates read, edit and publication against the selected campaign", () => {
		expect(pageSource).toContain("requireCampaignCapability");
		expect(pageSource).toContain("EDIT_CAPABILITIES.transcriptRead");
		expect(pageSource).toContain("EDIT_CAPABILITIES.contentEdit");
		expect(pageSource).toContain("EDIT_CAPABILITIES.sessionPublish");
		expect(pageSource).toContain("SessionCampaignMovePanel");
	});

	it("keeps the legacy deep link as a campaign chooser instead of a global source lookup", () => {
		expect(legacyEntrySource).toContain("readEditableSessionCampaigns");
		expect(legacyEntrySource).toContain("não é usado como");
		expect(legacyEntrySource).not.toContain("findEditSessionBySourceId");
	});
});
