import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaths } from "./classify-changes.mjs";

function sessionRelevant(path) {
	return classifyPaths([path]).sessions;
}

test("session editorial source and public projections activate the gate", () => {
	for (const path of [
		"src/app/edit/sessoes/page.tsx",
		"src/app/edit/sessoes/[id]/page.tsx",
		"src/app/api/edit/session-cover/upload/route.ts",
		"src/app/sessoes/page.tsx",
		"src/app/sessoes/[id]/page.tsx",
		"src/features/edit/sessions/editorial-draft-model.ts",
		"src/features/edit/transcript/download.ts",
		"src/features/sessions/repository.ts",
		"supabase/tests/session_publication_atomic.sql",
		"tools/session-publication-db.py",
	]) {
		assert.equal(sessionRelevant(path), true, path);
	}
});

test("session publication migrations activate the gate without matching unrelated migrations", () => {
	assert.equal(
		sessionRelevant("supabase/migrations/20260928004000_session_publications.sql"),
		true,
	);
	assert.equal(
		sessionRelevant("supabase/migrations/20260928011000_session_editorial_date.sql"),
		true,
	);
	assert.equal(
		sessionRelevant("supabase/migrations/20260927205500_session_cover_media_scope.sql"),
		true,
	);
	assert.equal(
		sessionRelevant("supabase/migrations/202609140001_unrelated.sql"),
		false,
	);
});

test("unrelated product surfaces stay out of the session gate", () => {
	for (const path of [
		"src/features/lembra/model.ts",
		"src/features/world-explorer/world.ts",
		"docs/README.md",
	]) {
		assert.equal(sessionRelevant(path), false, path);
	}
});
