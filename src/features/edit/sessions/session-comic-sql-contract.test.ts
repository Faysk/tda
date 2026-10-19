import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function candidate(name: string): string {
	return readFileSync(
		new URL("../../../../supabase/candidates/" + name, import.meta.url),
		"utf8",
	);
}

describe("session comic SQL candidate integrity (#1765)", () => {
	it("retains both existing campaign covers and new HQ media keys", () => {
		const sql = candidate("20261019153000_session_comic_media_constraints.sql");
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
		const sql = candidate(filename);
		const header = `create function public.${name}(`;
		const comment = `comment on function public.${name}(`;
		expect(sql.split(header)).toHaveLength(2);
		expect(sql.split(comment)).toHaveLength(2);
		expect(sql.match(/end;\\n\\$\\$;/gu)).toHaveLength(1);
		const regexLine = "and a.sha256 ~ '^[0-9a-f]{64}$'";
		const media = sql.indexOf(regexLine);
		const end = sql.indexOf("end;\\n$$;");
		expect(media).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(media);
		expect(sql.indexOf("and a.mime_type in ('image/png', 'image/webp')", media)).toBeGreaterThan(media);
		expect(sql.lastIndexOf(comment)).toBeGreaterThan(end);
		// No accidentally appended SQL fragment beyond the function ACL/comment.
		expect(sql.trimEnd()).toMatch(/\\) is '[^'\\n]+';$/u);
	});
});
