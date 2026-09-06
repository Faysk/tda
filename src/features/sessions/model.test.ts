import { describe, expect, it } from "vitest";
import { formatSessionDate, toPublishedSession } from "./model";

const row = {
	source_session_id: "session-1",
	title: "A jornada",
	session_date: "2026-09-01",
	arc: "Arco",
	summary_short: "Resumo público",
	summary_full: "Resumo completo",
	cover_image_url:
		"https://dnd.faysk.dev/assets/sessions/2026-09-01/card.webp",
	hero_image_url:
		"https://dmrqnbdvbkfqzctcerbx.supabase.co/storage/v1/object/public/session-images/yuhara-main/example/hero.webp",
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
		expect(result?.coverImage).toContain("dnd.faysk.dev/assets/sessions/");
		expect(result?.heroImage).toContain("supabase.co/storage/v1/object/public/session-images/");
		expect(JSON.stringify(result)).not.toContain("PRIVATE");
	});

	it("rejects media outside the public allowlist", () => {
		const result = toPublishedSession({
			...row,
			cover_image_url: "https://example.com/tracker.webp",
			hero_image_url: "javascript:alert(1)",
		});
		expect(result).not.toHaveProperty("coverImage");
		expect(result).not.toHaveProperty("heroImage");
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

describe("session date presentation", () => {
	it("formats ISO dates in Brazilian Portuguese without timezone drift", () => {
		expect(formatSessionDate("2026-09-01")).toBe("01 de setembro de 2026");
	});

	it("rejects invalid dates", () => {
		expect(formatSessionDate("2026-02-31")).toBe("");
		expect(formatSessionDate("not-a-date")).toBe("");
	});
});
