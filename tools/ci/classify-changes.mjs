import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CLASSIFIER_CONTRACT = new Set([
	"tools/ci/classify-changes.mjs",
	"tools/ci/classify-changes.test.mjs",
]);

const EXACT = {
	navigation: new Set([
		".github/workflows/ci.yml",
		"package.json",
		"playwright.config.ts",
		"tests/lore-catalog-viewport.spec.ts",
		"src/app/lore/page.tsx",
		"src/app/lore/page.module.css",
		"tests/global-navigation.spec.ts",
		"tests/layout-geometry.spec.ts",
		"tests/layout-receipts.spec.ts",
		"tests/foundation.spec.ts",
		"tests/navigation-origin.spec.ts",
		"tests/auth.spec.ts",
		"tests/pipipi-cinematic.spec.ts",
		"tests/campaign-directory.spec.ts",
		"tests/global-loading.spec.ts",
		"tests/d-lore-reading-mode.spec.ts",
		"tests/route-loading.spec.ts",
		"tests/pending-actions.spec.ts",
		"tests/progress-feedback.spec.ts",
		"tools/ux/async-feedback-contract.mjs",
		"src/components/ui/progress.tsx",
		"src/components/ui/progress.module.css",
		"src/components/ui/animated-progress.tsx",
		"tests/world-catalogs.spec.ts",
		"tests/world-shell.spec.ts",
		"src/features/lore/components/lore-index-page.tsx",
		"src/features/lore/components/lore-index-page.module.css",
		"src/features/lore/components/lore-page.tsx",
		"src/features/lore/components/lore-page.module.css",
		"src/features/lore/components/lore-cinematic-hero.tsx",
		"src/features/lore/components/lore-cinematic-hero.module.css",
		"src/features/lore/index-config.ts",
		"tests/system-states.spec.ts",
		"tests/session-public-layout.spec.ts",
		"src/app/error.tsx",
		"src/app/not-found.tsx",
		"src/app/layout.tsx",
		"src/app/public-shell.css",
		"src/app/api/auth/me/route.ts",
		"src/app/edit/page.tsx",
		"src/app/conta/page.tsx",
		"src/components/public-nav.tsx",
		"src/components/account-menu.tsx",
		"src/components/navigation-auth.ts",
		"src/components/public-navigation-model.ts",
		"src/components/theme-toggle.tsx",
		"src/features/world-explorer/hooks/use-world-edit-session.ts",
		"src/features/world-explorer/components/world-conductor-bar.tsx",
		"src/components/ui/form-submit-button.tsx",
		"src/components/ui/button.tsx",
		"src/components/session-list.tsx",
		"src/config/brand-assets.ts",
		"src/config/brand-assets.test.ts",
		"src/features/auth/config.ts",
		"src/features/auth/presentation.ts",
		"src/features/auth/server.ts",
		"src/features/edit/navigation-entry.ts",
	]),
	db: new Set([
		"tools/transcript-sync-db.py",
		"tools/campaign-registry-db.py",
		"tools/campaign-authorization-db.py",
		"tools/world-layout-db.py",
		"tools/world-entity-media-db.py",
		"tools/test_world_layout_db.py",
		"tools/test_world_entity_media_db.py",
		"tools/ci/check-migrations.mjs",
		"tools/check-migration-naming.py",
		"tools/check-relation-migration-safety.py",
	]),
	companion: new Set([".github/workflows/companion.yml"]),
	processing: new Set([
		".github/workflows/ci.yml",
		"playwright.processing.config.ts",
		"playwright.processing-ux.config.ts",
		"playwright.processing-integration.config.ts",
		"tools/processing-ui-fixture.mjs",
	]),
	lembra: new Set([
		".github/workflows/ci.yml",
		"tests/lembra.spec.ts",
		"tools/lembra-db.py",
	]),
	sessions: new Set([
		".github/workflows/ci.yml",
		"playwright.session-editorial.config.ts",
		"tests/session-editorial.spec.ts",
		"tools/session-publication-db.py",
	]),
	media: new Set([
		"tools/media-pipeline.py",
		"tools/check-canonical-media-usage.py",
		"tools/check-lore-assets.py",
		"tools/migrate-r2-keys.mjs",
		"tools/world-entity-media-r2-policy.test.mjs",
	]),
};

const PREFIX = {
	navigation: [
		"src/features/theme/",
		"src/components/global-loading/",
		"src/app/e2e-fixtures/global-loading/",
		"src/app/e2e-fixtures/system-states/",
		"src/app/e2e-fixtures/route-loading/",
		"src/app/e2e-fixtures/pending-actions/",
		"src/app/e2e-fixtures/progress-feedback/",
		"src/components/loading/",
		"src/app/sessoes/",
		"src/app/campanhas/",
		"src/features/campaigns/",
		"src/features/world-shell/",
		"public/lore/d/",
	],
	db: ["supabase/", "src/features/transcript-sync/"],
	companion: ["local-companion/"],
	processing: [
		"src/features/edit/processing/",
		"src/app/edit/processamento/",
		"src/app/api/edit/processing/",
		"tests/processing/",
		"tests/processing-ux/",
		"tests/processing-integration/",
		"tests/processing-fixture/",
		"local-companion/",
	],
	lembra: [
		"src/features/lembra/",
		"src/app/lembra/",
		"src/app/api/lembra/",
	],
	sessions: [
		"src/app/edit/sessoes/",
		"src/app/e2e-fixtures/session-editorial/",
		"src/app/sessoes/",
		"src/features/edit/sessions/",
		"src/features/edit/transcript/",
		"src/features/sessions/",
		"src/features/transcript-publication/",
	],
	media: [
		"media/",
		"tools/media/",
		"src/features/media/",
		"src/features/campaigns/campaign-cover",
		"src/features/edit/sessions/session-cover-media",
		"src/features/world-explorer/world-entity-media",
		"src/app/api/edit/campaign-cover/",
		"src/app/api/edit/session-cover/",
		"src/app/api/world/entity-media/",
	],
};

function normalized(path) {
	return path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function matches(path, domain) {
	if (CLASSIFIER_CONTRACT.has(path)) return true;
	if (EXACT[domain].has(path)) return true;
	if (PREFIX[domain].some((prefix) => path.startsWith(prefix))) return true;
	if (
		domain === "navigation" &&
		(path === "src/app/loading.tsx" || /^src\/app\/.+\/loading\.tsx$/u.test(path))
	)
		return true;
	if (domain === "companion" && /^tools\/check-companion-.*\.py$/u.test(path))
		return true;
	if (
		domain === "sessions" &&
		/^supabase\/(?:migrations|tests)\/.*session_(?:editorial|publication|cover)/u.test(path)
	)
		return true;
	if (
		domain === "lembra" &&
		/^supabase\/(?:migrations|tests)\/.*lembra/u.test(path)
	)
		return true;
	return false;
}

export function classifyPaths(inputPaths) {
	const files = [...new Set(inputPaths.map(normalized).filter(Boolean))].sort();
	const classes = {
		web: files.length > 0,
		navigation: files.some((path) => matches(path, "navigation")),
		db: files.some((path) => matches(path, "db")),
		companion: files.some((path) => matches(path, "companion")),
		processing: files.some((path) => matches(path, "processing")),
		lembra: files.some((path) => matches(path, "lembra")),
		sessions: files.some((path) => matches(path, "sessions")),
		media: files.some((path) => matches(path, "media")),
	};
	return { files, ...classes };
}

export function changedFilesForRange(range) {
	if (!range || typeof range !== "string")
		throw new Error("An explicit git range is required");
	const output = execFileSync(
		"git",
		["diff", "--name-only", "--diff-filter=ACMR", range],
		{ encoding: "utf8" },
	);
	return output.split(/\r?\n/u).filter(Boolean);
}

function writeGithubOutputs(result) {
	if (!process.env.GITHUB_OUTPUT) return;
	for (const key of ["web", "navigation", "db", "companion", "processing", "lembra", "sessions", "media"])
		appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${result[key]}\n`);
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`files_json=${JSON.stringify(result.files)}\n`,
	);
}

function writeSummary(range, result) {
	if (!process.env.GITHUB_STEP_SUMMARY) return;
	appendFileSync(
		process.env.GITHUB_STEP_SUMMARY,
		[
			"## Change relevance",
			`- Range: \`${range}\``,
			`- web: \`${result.web}\``,
			`- navigation: \`${result.navigation}\``,
			`- db: \`${result.db}\``,
			`- companion: \`${result.companion}\``,
			`- processing: \`${result.processing}\``,
			`- lembra: \`${result.lembra}\``,
			`- sessions: \`${result.sessions}\``,
			`- media: \`${result.media}\``,
			`- Files (${result.files.length}): ${result.files.map((file) => `\`${file}\``).join(", ") || "none"}`,
			"",
		].join("\n"),
	);
}

function main() {
	const range = process.argv[2];
	const result = classifyPaths(changedFilesForRange(range));
	writeGithubOutputs(result);
	writeSummary(range, result);
	console.log(JSON.stringify({ range, ...result }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
