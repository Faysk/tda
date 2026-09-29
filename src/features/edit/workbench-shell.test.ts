import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

function source(path: string) {
	return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("operational workbench shell contract (#1090)", () => {
	const surfaces = [
		{ path: "src/app/transcricoes/page.tsx", shell: "transcripts", role: "editorial", scroll: "document" },
		{ path: "src/app/edit/processamento/page.tsx", shell: "processing", role: "expansive", scroll: "document-local-log" },
		{ path: "src/app/edit/revisao/page.tsx", shell: "review", role: "editorial", scroll: "document" },
		{ path: "src/app/edit/sessoes/page.tsx", shell: "sessions", role: "expansive", scroll: "document" },
		{ path: "src/app/edit/sessoes/[id]/page.tsx", shell: "session-editor", role: "expansive", scroll: "pane-desktop-document-mobile" },
		{ path: "src/app/edit/[campaignSlug]/permissions/page.tsx", shell: "permissions", role: "editorial", scroll: "document" },
	] as const;

	for (const surface of surfaces) {
		test(`${surface.shell} declares workspace geometry and scroll ownership`, () => {
			const content = source(surface.path);
			expect(content).toContain('data-layout-family="workspace"');
			expect(content).toContain(`data-layout-role="${surface.role}"`);
			expect(content).toContain(`data-workbench-shell="${surface.shell}"`);
			expect(content).toContain(`data-scroll-owner="${surface.scroll}"`);
		});
	}

	test("review and permissions do not recreate global navigation", () => {
		const review = source("src/app/edit/revisao/page.tsx");
		const permissions = source("src/app/edit/[campaignSlug]/permissions/page.tsx");
		expect(review).not.toContain('aria-label="Navegação do Edit"');
		expect(review).not.toContain('href="/mundo"');
		expect(permissions).not.toContain('aria-label="Navegação do Edit"');
	});

	test("transcripts drops the redundant global account footer link", () => {
		expect(source("src/app/transcricoes/page.tsx")).not.toContain("className={styles.accountLink}");
	});

	test("session detail keeps local back-context navigation", () => {
		const detail = source("src/app/edit/sessoes/[id]/page.tsx");
		expect(detail).toContain('href="/edit/sessoes"');
		expect(detail).toContain("← Sessões do Edit");
	});

	test("capability and data guards remain on protected surfaces", () => {
		expect(source("src/app/transcricoes/page.tsx")).toContain("getTranscriptStatistics(campaign)");
		expect(source("src/app/edit/processamento/page.tsx")).toContain("requireCapability(");
		expect(source("src/app/edit/revisao/page.tsx")).toContain("requireCapability(");
		expect(source("src/app/edit/sessoes/page.tsx")).toContain("requireCapability(");
		expect(source("src/app/edit/sessoes/[id]/page.tsx")).toContain("requireCapability(");
		expect(source("src/app/edit/[campaignSlug]/permissions/page.tsx")).toContain("getPermissionsForEdit");
	});

	test("compatibility entrypoints remain redirect-only", () => {
		for (const path of ["src/app/edit/page.tsx", "src/app/edit/mundo/page.tsx"]) {
			const content = source(path);
			expect(content).toContain("redirect(");
			expect(content).not.toContain("data-workbench-shell");
		}
	});
});
