import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = [
	new URL("./session-share-actions.tsx", import.meta.url),
	new URL("../features/world-explorer/hooks/use-world-edit-session.ts", import.meta.url),
];

// Issue #1356 scope guard: shared World discard and session sharing stay inside project UI.\ndescribe("native browser prompt contract for #1356", () => {
	it("keeps world discard and session sharing inside project UI", () => {
		for (const source of sources) {
			const text = readFileSync(source, "utf8");
			expect(text).not.toContain("window.alert(");
			expect(text).not.toContain("window.confirm(");
			expect(text).not.toContain("window.prompt(");
		}
	});
});
