import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaths } from "./classify-changes.mjs";

function flags(files) {
	const { web, navigation, db, companion, processing, lembra, sessions, media } =
		classifyPaths(files);
	return { web, navigation, db, companion, processing, lembra, sessions, media };
}

const fastOnly = {
	web: true,
	navigation: false,
	db: false,
	companion: false,
	processing: false,
	lembra: false,
	sessions: false,
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

test("navigation shell paths activate only the targeted Navigation E2E contract", () => {
	for (const path of [
		"src/components/public-nav.tsx",
		"src/components/account-menu.tsx",
		"src/components/navigation-auth.ts",
		"src/components/public-navigation-model.ts",
		"src/components/theme-toggle.tsx",
		"src/components/session-list.tsx",
		"src/components/global-loading/global-loading.tsx",
		"src/app/e2e-fixtures/global-loading/page.tsx",
		"src/config/brand-assets.ts",
		"src/config/brand-assets.test.ts",
		"public/lore/d/index.html",
		"public/lore/d/script.js",
		"tests/global-loading.spec.ts",
		"tests/d-lore-reading-mode.spec.ts",
		"tests/route-loading.spec.ts",
		"tests/pending-actions.spec.ts",
		"tests/progress-feedback.spec.ts",
		"tools/ux/async-feedback-contract.mjs",
		"src/app/e2e-fixtures/pending-actions/page.tsx",
		"src/app/e2e-fixtures/progress-feedback/page.tsx",
		"src/components/ui/button.tsx",
		"src/components/ui/form-submit-button.tsx",
		"src/features/world-explorer/hooks/use-world-edit-session.ts",
		"src/features/world-explorer/components/world-conductor-bar.tsx",
		"src/components/ui/progress.tsx",
		"src/components/ui/progress.module.css",
		"src/components/ui/animated-progress.tsx",
		"src/components/loading/route-skeletons.tsx",
		"src/components/loading/route-skeletons.module.css",
		"src/app/e2e-fixtures/route-loading/editorial/loading.tsx",
		"src/app/sessoes/loading.tsx",
		"tests/world-catalogs.spec.ts",
		"src/features/lore/components/lore-index-page.tsx",
		"src/features/lore/components/lore-cinematic-hero.module.css",
		"tests/system-states.spec.ts",
		"tests/session-public-layout.spec.ts",
		"src/app/sessoes/page.module.css",
		"src/app/campanhas/page.tsx",
		"src/app/campanhas/[campaignSlug]/sessoes/page.tsx",
		"src/features/campaigns/model.ts",
		"src/app/error.tsx",
		"src/app/not-found.tsx",
		"src/app/e2e-fixtures/system-states/error/page.tsx",
		"src/features/auth/config.ts",
		"src/features/auth/presentation.ts",
		"src/features/auth/server.ts",
		"src/features/edit/navigation-entry.ts",
		"src/app/layout.tsx",
		"src/app/public-shell.css",
		"src/app/api/auth/me/route.ts",
		"src/app/edit/page.tsx",
		"src/app/conta/page.tsx",
		"src/features/theme/preference.ts",
		"tests/global-navigation.spec.ts",
		"tests/layout-geometry.spec.ts",
		"tests/layout-receipts.spec.ts",
		"tests/foundation.spec.ts",
		"tests/navigation-origin.spec.ts",
		"tests/campaign-directory.spec.ts",
		"playwright.config.ts",
	]) {
		const result = flags([path]);
		assert.equal(result.navigation, true, path);
		assert.equal(result.processing, false, path);
		assert.equal(result.lembra, false, path);
	}
	assert.equal(
		flags(["src/components/session-share-actions.tsx"]).navigation,
		false,
	);
	assert.equal(flags(["src/app/loading.tsx"]).navigation, true);
	assert.equal(flags(["src/app/mundo/loading.tsx"]).navigation, true);
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
	assert.equal(flags(["src/app/api/edit/processing/campaign-context/route.ts"]).processing, true);
	assert.equal(flags(["tests/processing-ux/responsive.spec.ts"]).processing, true);
	assert.equal(flags(["playwright.processing-ux.config.ts"]).processing, true);
	assert.equal(
		flags(["playwright.processing-integration.config.ts"]).processing,
		true,
	);
});

test("Lembra paths activate only the targeted Lembra E2E contract", () => {
	const source = flags(["src/features/lembra/components/lembra-experience.tsx"]);
	assert.equal(source.lembra, true);
	assert.equal(source.processing, false);
	assert.equal(source.navigation, false);
	assert.equal(flags(["src/app/lembra/page.tsx"]).lembra, true);
	assert.equal(flags(["src/app/api/lembra/abc/image/route.ts"]).lembra, true);
	assert.equal(flags(["tests/lembra.spec.ts"]).lembra, true);
});

test("Session editorial paths activate the targeted private-to-public journey gate", () => {
	for (const path of [
		"src/features/edit/sessions/editorial-draft-editor.tsx",
		"src/features/edit/transcript/reader.tsx",
		"src/app/edit/sessoes/page.tsx",
		"src/app/sessoes/[id]/page.tsx",
		"tests/session-editorial.spec.ts",
		"playwright.session-editorial.config.ts",
		"tools/session-publication-db.py",
		"supabase/migrations/20260928004000_session_publications.sql",
	]) {
		assert.equal(flags([path]).sessions, true, path);
	}
	assert.equal(
		flags(["src/features/transcript-publication/repository.ts"]).sessions,
		true,
	);
	assert.equal(flags(["src/app/mundo/page.tsx"]).sessions, false);
});

test("Companion source activates Companion and Processing E2E", () => {
	const result = flags(["local-companion/tda_companion/app.py"]);
	assert.equal(result.companion, true);
	assert.equal(result.processing, true);
	assert.equal(result.navigation, false);
	assert.equal(flags([".github/workflows/companion.yml"]).companion, true);
	assert.equal(
		flags(["tools/check-companion-model-freshness.py"]).companion,
		true,
	);
});

test("specialized runtime workflows do not build generic MSI or browser gates by themselves", () => {
	for (const path of [
		".github/workflows/qwen-runtime-package.yml",
		".github/workflows/runtime-promote.yml",
		".github/workflows/whisper-runtime.yml",
	]) {
		assert.equal(flags([path]).companion, false);
		assert.equal(flags([path]).processing, false);
		assert.equal(flags([path]).navigation, false);
	}
});

test("CI workflow changes exercise the browser gates they define", () => {
	const result = flags([".github/workflows/ci.yml"]);
	assert.equal(result.navigation, true);
	assert.equal(result.processing, true);
	assert.equal(result.lembra, true);
	assert.equal(result.sessions, true);
});

test("Supabase and transcript-sync changes activate PostgreSQL integration", () => {
	assert.equal(
		flags(["supabase/migrations/202609140001_example.sql"]).db,
		true,
	);
	assert.equal(flags(["src/features/transcript-sync/client.ts"]).db, true);
	assert.equal(flags(["tools/campaign-registry-db.py"]).db, true);
	assert.equal(flags(["tools/campaign-authorization-db.py"]).db, true);
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
		navigation: true,
		db: true,
		companion: true,
		processing: true,
		lembra: true,
		sessions: true,
		media: true,
	};
	assert.deepEqual(flags(["tools/ci/classify-changes.mjs"]), expected);
	assert.deepEqual(flags(["tools/ci/classify-changes.test.mjs"]), expected);
});

test("mixed changes activate each relevant domain", () => {
	assert.deepEqual(
		flags([
			"src/features/edit/processing/panel.tsx",
			"src/components/public-nav.tsx",
			"supabase/migrations/202609140002_example.sql",
			"local-companion/tda_companion/app.py",
			"media/yllith/manifest.json",
		]),
		{
			web: true,
			navigation: true,
			db: true,
			companion: true,
			processing: true,
			lembra: false,
			sessions: false,
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
	assert.equal(result.navigation, false);
});
