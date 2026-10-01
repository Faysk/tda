import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const legacyPageSource = readFileSync(
	new URL("../../../app/edit/sessoes/[id]/page.tsx", import.meta.url),
	"utf8",
);
const canonicalPageSource = readFileSync(
	new URL("../../../app/edit/[campaignSlug]/sessoes/[id]/page.tsx", import.meta.url),
	"utf8",
);
const detailSource = readFileSync(new URL("./session-detail-page.tsx", import.meta.url), "utf8");

describe("canonical Edit session route contract", () => {
	it("does not depend on the legacy unsafe gate", () => {
		for (const source of [legacyPageSource, canonicalPageSource, detailSource]) {
			expect(source).not.toContain("unsafe-access");
			expect(source).not.toContain("isUnsafeEditEnabled");
			expect(source).not.toContain("findUnsafeEditSessionBySourceId");
		}
	});

	it("keeps the canonical route campaign-qualified and capability gated", () => {
		expect(canonicalPageSource).toContain("EDIT_CAPABILITIES.transcriptRead");
		expect(canonicalPageSource).toContain("CampaignSessionDetailPage");
		expect(canonicalPageSource).toContain("candidate.technicalSlug === campaignSlug");
		expect(detailSource).toContain("findEditSessionBySourceId(campaignSlug, sourceSessionId)");
		expect(detailSource).toContain("EDIT_CAPABILITIES.contentEdit");
		expect(detailSource).toContain("EDIT_CAPABILITIES.sessionPublish");
	});

	it("keeps the legacy detail route fail-closed when campaign identity is ambiguous", () => {
		expect(legacyPageSource).toContain("available.campaigns.length === 1");
		expect(legacyPageSource).toContain("Escolha a campanha");
		expect(legacyPageSource).not.toContain("CAMPAIGN_SLUG");
		expect(legacyPageSource).not.toContain("findEditSessionBySourceId");
	});
});
