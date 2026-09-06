import { describe, it, expect } from "vitest";
import { toPublishedSession } from "./model";
const row = {
	source_session_id: "session-1",
	title: "A jornada",
	session_date: "2026-09-01",
	arc: "Arco",
	summary_short: "Resumo público",
	summary_full: "Resumo completo",
	status: "published",
	campaigns: { slug: "yuhara-main" },
	transcript: "PRIVATE",
	metadata: { secret: "PRIVATE" },
};
describe("public session boundary", () => {
	it("rejects drafts and other campaigns", () => {
		expect(toPublishedSession({ ...row, status: "draft" })).toBeNull();
		expect(
			toPublishedSession({ ...row, campaigns: { slug: "other" } }),
		).toBeNull();
	});
	it("only returns approved fields", () => {
		const result = toPublishedSession(row);
		expect(result).not.toHaveProperty("metadata");
		expect(result).not.toHaveProperty("transcript");
		expect(result).not.toHaveProperty("fullSummary");
		expect(JSON.stringify(result)).not.toContain("PRIVATE");
	});
	it("includes full summary only for detail", () => {
		expect(toPublishedSession(row, true)?.fullSummary).toBe("Resumo completo");
	});
	it("bounds content and rejects missing IDs", () => {
		expect(toPublishedSession({ ...row, source_session_id: "" })).toBeNull();
		expect(
			toPublishedSession({ ...row, summary_short: "x".repeat(9000) })?.summary,
		).toHaveLength(4000);
	});
});
