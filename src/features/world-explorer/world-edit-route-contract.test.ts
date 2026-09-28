import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
	new URL("../../app/edit/mundo/page.tsx", import.meta.url),
	"utf8",
);

describe("legacy World edit route contract", () => {
	it("keeps /edit/mundo as a capability-gated redirect to canonical /mundo", () => {
		expect(pageSource).toContain("EDIT_CAPABILITIES.worldLayoutEdit");
		expect(pageSource).toContain(
			'requireCapability(EDIT_CAPABILITIES.worldLayoutEdit, "/edit/mundo")',
		);
		expect(pageSource).toContain('redirect("/mundo")');
	});

	it("does not render the retired unsafe staging editor", () => {
		expect(pageSource).not.toContain("unsafe-access");
		expect(pageSource).not.toContain("isUnsafeEditEnabled");
		expect(pageSource).not.toContain("WorldLayoutEditorClient");
		expect(pageSource).not.toContain("DANDELION_WORLD_DEMO");
	});
});
