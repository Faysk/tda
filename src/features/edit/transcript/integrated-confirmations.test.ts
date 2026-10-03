import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scopedFiles = [
	"../processing/panel.tsx",
	"../processing/local-review.tsx",
	"./reader.tsx",
	"./editor.tsx",
] as const;

describe("Edit confirmation surfaces", () => {
	it("keeps destructive and context-switch confirmations inside TDA dialogs", () => {
		for (const relativePath of scopedFiles) {
			const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
			expect(source, relativePath).not.toContain("window.confirm(");
			expect(source, relativePath).not.toContain("window.alert(");
			expect(source, relativePath).not.toContain("window.prompt(");
		}
	});

	it("preserves browser beforeunload protection for an unsaved transcript", () => {
		const reader = readFileSync(new URL("./reader.tsx", import.meta.url), "utf8");
		expect(reader).toContain('window.addEventListener("beforeunload", beforeUnload)');
		expect(reader).toContain("destination.origin !== window.location.origin");
		expect(reader).toContain('setConfirmation({ kind: "navigate", href: destination.href })');
	});

	it("keeps uncertain handoff abandonment explicit instead of replaying blindly", () => {
		const review = readFileSync(
			new URL("../processing/local-review.tsx", import.meta.url),
			"utf8",
		);
		expect(review).toContain('setReviewConfirmation("abandon-recovery")');
		expect(review).toContain("browserPublicationRecovery().abandon");
		expect(review).toContain("Abandonar não desfaz um commit privado");
	});
});
