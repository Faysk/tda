import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
	return readFileSync(
		new URL("../../../../supabase/migrations/" + name, import.meta.url),
		"utf8",
	);
}

describe("session comic SQL migration integrity (#1765)", () => {
	it("retains both existing campaign covers and new HQ media keys", () => {
		const sql = migration("20261019153000_session_comic_media_constraints.sql");
		expect(sql).toContain("'campaign_cover'");
		expect(sql).toContain("'session_comic_page'");
		expect(sql).toContain("campaign/cover");
		expect(sql).toContain("(cover|comic)");
	});

	it.each([
		[
			"20261019163000_session_comic_editorial_draft.sql",
			"save_session_editorial_draft_with_comic_atomic",
		],
		[
			"20261019173000_session_comic_publication.sql",
			"publish_session_editorial_with_comic_atomic",
		],
	] as const)("retains exactly one complete SQL function in %s", (filename, name) => {
		const sql = migration(filename);
		const header = `create function public.${name}(`;
		const comment = `comment on function public.${name}(`;
		expect(sql.split(header)).toHaveLength(2);
		expect(sql.split(comment)).toHaveLength(2);
		expect(sql.split("end;\n$$;")).toHaveLength(2);
		const regexLine = "and a.sha256 ~ '^[0-9a-f]{64}$'";
		const media = sql.indexOf(regexLine);
		const end = sql.indexOf("end;\n$$;");
		expect(media).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(media);
		expect(sql.indexOf("and a.mime_type in ('image/png', 'image/webp')", media)).toBeGreaterThan(media);
		expect(sql.lastIndexOf(comment)).toBeGreaterThan(end);
		// No accidentally appended SQL fragment beyond the function ACL/comment.
		expect(sql.trimEnd().endsWith(`';`)).toBe(true);
	});
	it("saves independent HQ drafts without touching editorial publication", () => {
		const sql = migration("20261020230000_session_comic_independent_draft.sql");
		expect(sql).toContain("create table public.session_comic_drafts");
		expect(sql).toContain("create function public.save_session_comic_draft_atomic(");
		expect(sql).toContain("summary_not_published");
		expect(sql).toContain("current_session_publication_id");
		expect(sql).toContain("for update of s");
		expect(sql).not.toMatch(/update\\s+public\\.sessions\\s+set/iu);
		expect(sql).not.toMatch(/update\\s+public\\.session_publications\\s+set/iu);
	});

	it("publishes immutable HQ snapshots with strict idempotency and no editorial writes", () => {
		const sql = migration("20261020231000_session_comic_independent_publication.sql");
		expect(sql).toContain("create table public.session_comic_publications");
		expect(sql).toContain("create function public.publish_session_comic_atomic(");
		expect(sql).toContain("cp.editorial_publication_id = p_expected_editorial_publication_id");
		expect(sql).toContain("cp.pages = p_public_pages");
		expect(sql).toContain("operation_conflict");
		expect(sql).toContain("stale_current");
		expect(sql).toContain("for update of s");
		expect(sql).not.toMatch(/update\\s+public\\.sessions\\s+set/iu);
		expect(sql).not.toMatch(/update\\s+public\\.session_publications\\s+set/iu);
		expect(sql).not.toContain("publish_session_editorial_with_date_atomic(");
	});

});
