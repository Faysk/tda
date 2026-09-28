import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
	new URL("../../../app/edit/sessoes/[id]/page.tsx", import.meta.url),
	"utf8",
);

describe("canonical Edit session route contract", () => {
	it("does not depend on the legacy unsafe gate", () => {
		expect(pageSource).not.toContain("unsafe-access");
		expect(pageSource).not.toContain("isUnsafeEditEnabled");
		expect(pageSource).not.toContain("findUnsafeEditSessionBySourceId");
	});

	it("keeps capability gating and the supported campaign-scoped lookup", () => {
		expect(pageSource).toContain("EDIT_CAPABILITIES.transcriptRead");
		expect(pageSource).toContain("findEditSessionBySourceId");
		expect(pageSource).toContain("findEditSessionBySourceId(CAMPAIGN_SLUG, sourceSessionId)");
		expect(pageSource).toContain("EDIT_CAPABILITIES.contentEdit");
		expect(pageSource).toContain("EDIT_CAPABILITIES.sessionPublish");
	});
});
