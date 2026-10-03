import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directorySource = new URL("./directory.tsx", import.meta.url);

describe("permission confirmation contract", () => {
	it("keeps authority and self-revocation confirmation inside the TDA dialog", () => {
		const source = readFileSync(directorySource, "utf8");
		expect(source).not.toContain("window.confirm(");
		expect(source).not.toContain("window.alert(");
		expect(source).not.toContain("window.prompt(");
		expect(source).toContain('title="Confirmar mudança de acesso?"');
		expect(source).toContain("pendingConfirmation.sensitive");
		expect(source).toContain("pendingConfirmation.selfRevoke");
		expect(source).toContain("executeChanges(pendingConfirmation)");
	});
});
