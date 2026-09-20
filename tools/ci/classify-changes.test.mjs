import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaths } from "./classify-changes.mjs";

function flags(files) {
	const { web, db, companion, processing, media } = classifyPaths(files);
	return { web, db, companion, processing, media };
}

const fastOnly = {
	web: true,
	db: false,
	companion: false,
	processing: false,
	media: false,
};

test("docs-only stays on fast CI only", () => {
	assert.deepEqual(
		flags(["docs/operations/cicd-simplification-plan.md"]),
		fastOnly,
	);
});

test("ordinary web and lore files do not activate heavy domains", () => {
	assert.deepEqual(
		flags([
			"src/app/page.tsx",
			"public/lore/yllith/yllith.css",
			"public/lore/yllith/historia.md",
		]),
		fastOnly,
	);
});

test("Processing Web paths activate the Processing E2E contract", () => {
	assert.equal(
		flags(["src/features/edit/processing/bridge.ts"]).processing,
		true,
	);
	assert.equal(
		flags(["src/app/edit/processamento/page.tsx"]).processing,
		true,
	);
	assert.equal(flags(["tests/processing/journey.spec.ts"]).processing, true);
	assert.equal(
		flags(["playwright.processing-integration.config.ts"]).processing,
		true,
	);
});

test("Companion source activates Companion and Processing E2E", () => {
	const result = flags(["local-companion/tda_companion/app.py"]);
	assert.equal(result.companion, true);
	assert.equal(result.processing, true);
	assert.equal(flags([".github/workflows/companion.yml"]).companion, true);
	assert.equal(
		flags(["tools/check-companion-model-freshness.py"]).companion,
		true,
	);
});

test("specialized runtime workflows do not build generic MSI or Processing E2E by themselves", () => {
	for (const path of [
		".github/workflows/qwen-runtime-package.yml",
		".github/workflows/runtime-promote.yml",
		".github/workflows/whisper-runtime.yml",
	]) {
		assert.equal(flags([path]).companion, false);
		assert.equal(flags([path]).processing, false);
	}
});

test("CI workflow changes exercise the Processing gate they define", () => {
	assert.equal(flags([".github/workflows/ci.yml"]).processing, true);
});

test("Supabase and transcript-sync changes activate PostgreSQL integration", () => {
	assert.equal(
		flags(["supabase/migrations/202609140001_example.sql"]).db,
		true,
	);
	assert.equal(flags(["src/features/transcript-sync/client.ts"]).db, true);
	assert.equal(flags(["tools/world-layout-db.py"]).db, true);
});

test("database documentation alone does not start PostgreSQL", () => {
	assert.equal(flags(["docs/database/migrations.md"]).db, false);
});

test("media manifests and tooling activate media domain", () => {
	assert.equal(flags(["media/yllith/manifest.json"]).media, true);
	assert.equal(flags(["tools/media/verify-public.mjs"]).media, true);
	assert.equal(
		flags(["tools/world-entity-media-r2-policy.test.mjs"]).media,
		true,
	);
});

test("classifier contract changes fail safe into every heavy domain", () => {
	const expected = {
		web: true,
		db: true,
		companion: true,
		processing: true,
		media: true,
	};
	assert.deepEqual(flags(["tools/ci/classify-changes.mjs"]), expected);
	assert.deepEqual(flags(["tools/ci/classify-changes.test.mjs"]), expected);
});

test("mixed changes activate each relevant domain", () => {
	assert.deepEqual(
		flags([
			"src/features/edit/processing/panel.tsx",
			"supabase/migrations/202609140002_example.sql",
			"local-companion/tda_companion/app.py",
			"media/yllith/manifest.json",
		]),
		{
			web: true,
			db: true,
			companion: true,
			processing: true,
			media: true,
		},
	);
});

test("normalizes duplicate and Windows-style paths", () => {
	const result = classifyPaths([
		".\\local-companion\\tda_companion\\app.py",
		"local-companion/tda_companion/app.py",
	]);
	assert.deepEqual(result.files, [
		"local-companion/tda_companion/app.py",
	]);
	assert.equal(result.companion, true);
	assert.equal(result.processing, true);
});
