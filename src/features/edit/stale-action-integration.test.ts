import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
	return readFileSync(path, "utf8");
}

describe("#1339 stale deployment integration", () => {
	it("covers campaign forms with the shared recovery boundary", () => {
		const campaigns = source("src/features/campaigns/management-view.tsx");
		expect(campaigns).toContain("RecoverableActionForm");
		expect(campaigns).toContain('recoveryKey="campaign:create"');
		expect(campaigns).toContain("campaign:update:");
		expect(campaigns).toContain("campaign:lifecycle:");
	});

	it("preserves session drafts and transcript working copies without replaying stale actions", () => {
		const sessions = source(
			"src/features/edit/sessions/editorial-draft-editor.tsx",
		);
		const transcript = source("src/features/edit/transcript/reader.tsx");
		for (const file of [sessions, transcript]) {
			expect(file).toContain("isStaleServerActionError");
			expect(file).toContain("persistStaleActionRecovery");
			expect(file).toContain("window.location.reload()");
		}
		expect(transcript).toContain("pendingOperation.current = null");
		expect(transcript).toContain("retry idempotente");
	});

	it("keeps a global stale-deployment fallback distinct from generic page failures", () => {
		const errorPage = source("src/app/error.tsx");
		expect(errorPage).toContain("isStaleServerActionError(error)");
		expect(errorPage).toContain("O TDA foi atualizado.");
		expect(errorPage).toContain("window.location.reload()");
	});
});
