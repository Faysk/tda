import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const repositorySource = readFileSync(
	new URL("./repository.ts", import.meta.url),
	"utf8",
);
const pageSource = readFileSync(
	new URL("../../../app/edit/sessoes/[id]/page.tsx", import.meta.url),
	"utf8",
);

function exportedFunctionSource(name: string): string {
	const marker = `export async function ${name}`;
	const start = repositorySource.indexOf(marker);
	if (start < 0) throw new Error(`Missing exported function: ${name}`);
	const next = repositorySource.indexOf("\nexport async function ", start + marker.length);
	return next < 0 ? repositorySource.slice(start) : repositorySource.slice(start, next);
}

describe("canonical Edit session workspace boundary", () => {
	it("keeps the supported session route independent from the unsafe feature fuse", () => {
		expect(pageSource).toContain("EDIT_CAPABILITIES.transcriptRead");
		expect(pageSource).toContain("requireCapability(");
		expect(pageSource).toContain("findEditSessionBySourceId");
		expect(pageSource).toContain("CAMPAIGN_SLUG");
		expect(pageSource).not.toContain("findUnsafeEditSessionBySourceId");
		expect(pageSource).not.toContain("isUnsafeEditEnabled");
		expect(pageSource).not.toContain("@/features/edit/unsafe-access");
		expect(pageSource).not.toContain("Edit desativado");
	});

	it("scopes the supported lookup to the explicit campaign and source id", () => {
		const supportedLookup = exportedFunctionSource("findEditSessionBySourceId");
		expect(supportedLookup).toContain("dataClientOrThrow()");
		expect(supportedLookup).toContain('.eq("campaigns.slug", campaignSlug)');
		expect(supportedLookup).toContain('.eq("source_session_id", sourceSessionId)');
		expect(supportedLookup).toContain(".maybeSingle()");
		expect(supportedLookup).not.toContain("unsafeClientOrThrow");
		expect(supportedLookup).not.toContain("requireUnsafeEdit");
	});

	it("keeps the legacy lookup behind the unsafe fuse", () => {
		const legacyLookup = exportedFunctionSource("findUnsafeEditSessionBySourceId");
		expect(legacyLookup).toContain("requireUnsafeEdit()");
		expect(legacyLookup).toContain(
			"findEditSessionBySourceId(CAMPAIGN_SLUG, sourceSessionId)",
		);
	});
});
