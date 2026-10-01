import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { scanCampaignIsolationReadiness } from "./campaign-isolation-readiness.mjs";

const requiredFiles = [
	"src/app/edit/processamento/page.tsx",
	"src/features/edit/processing/submission.tsx",
	"src/app/edit/sessoes/page.tsx",
	"src/app/edit/[campaignSlug]/sessoes/page.tsx",
	"src/app/edit/[campaignSlug]/sessoes/[id]/page.tsx",
	"src/features/edit/sessions/session-campaign-move-actions.ts",
	"src/app/mundo/page.tsx",
	"src/app/campanhas/[campaignSlug]/mundo/page.tsx",
	"src/app/edit/[campaignSlug]/mundo/page.tsx",
	"src/features/world-explorer/world-edit-actions.ts",
	"src/features/world-explorer/layout-repository.ts",
	"src/features/world-explorer/world-graph-actions.ts",
	"src/features/world-explorer/world-layout-session-actions.ts",
	"src/features/lore/repository.ts",
	"src/app/transcricoes/page.tsx",
	"src/app/edit/revisao/page.tsx",
	"src/features/edit/review/server.ts",
	"src/features/edit/review/actions.ts",
	"src/features/media/campaign-media.ts",
	"src/features/campaigns/campaign-cover-media.ts",
	"src/features/campaigns/campaign-cover-service.ts",
	"src/features/world-explorer/world-entity-media-actions.ts",
	"src/features/edit/sessions/session-cover-media.ts",
	"src/features/sessions/model.ts",
	"src/app/edit/[campaignSlug]/processamento/page.tsx",
	"src/app/edit/[campaignSlug]/transcricoes/page.tsx",
	"src/app/edit/[campaignSlug]/revisao/page.tsx",
	"src/features/edit/navigation-entry.ts",
	"src/components/public-navigation-model.ts",
];

function fixture(files = {}) {
	const root = mkdtempSync(join(tmpdir(), "tda-campaign-isolation-"));
	for (const path of requiredFiles) {
		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, files[path] ?? "export const campaignAware = true;\n");
	}
	return root;
}

test("readiness is green only when every scanned boundary is campaign-aware", () => {
	const root = fixture();
	try {
		const result = scanCampaignIsolationReadiness(root);
		assert.equal(result.ready, true);
		assert.deepEqual(result.blockers, []);
		assert.equal(result.synthetic, true);
		assert.equal(result.productionMutation, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("global campaign authority blocks activation and points to owning issues", () => {
	const root = fixture({
		"src/app/edit/sessoes/page.tsx": "listEditSessionLibrary(CAMPAIGN_SLUG);\n",
		"src/features/lore/repository.ts": "const CAMPAIGN_SLUG = \"yuhara-main\";\nclient.eq(\"slug\", CAMPAIGN_SLUG);\n",
		"src/features/edit/sessions/session-cover-media.ts": "export const campaign = CAMPAIGN_SLUG;\n",
	});
	try {
		const result = scanCampaignIsolationReadiness(root);
		assert.equal(result.ready, false);
		assert.deepEqual(result.blockers.map((b) => b.issue), [1129, 1131, 1135]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing campaign media rollout files keep activation closed", () => {
	const root = fixture();
	rmSync(join(root, "src/features/media/campaign-media.ts"));
	try {
		const result = scanCampaignIsolationReadiness(root);
		const media = result.blockers.find((b) => b.issue === 1135);
		assert.ok(media);
		assert.ok(media.matches.some((m) => m.reason === "missing_file"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing boundary files fail closed instead of disappearing from the gate", () => {
	const root = fixture();
	rmSync(join(root, "src/app/edit/[campaignSlug]/revisao/page.tsx"));
	try {
		const result = scanCampaignIsolationReadiness(root);
		const nav = result.blockers.find((b) => b.issue === 1136);
		assert.ok(nav);
		assert.ok(nav.matches.some((m) => m.reason === "missing_file"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("SAFE_CAMPAIGN_SLUG validators are not mistaken for implicit global campaign authority", () => {
	const root = fixture({
		"src/features/edit/review/server.ts":
			'const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;\nexport function load(campaignSlug) { return SAFE_CAMPAIGN_SLUG.test(campaignSlug); }\n',
		"src/features/edit/review/actions.ts":
			'const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;\nexport function mutate(campaignSlug) { return SAFE_CAMPAIGN_SLUG.test(campaignSlug); }\n',
	});
	try {
		const result = scanCampaignIsolationReadiness(root);
		assert.equal(
			result.blockers.some((blocker) => blocker.issue === 1133),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("processing regression is a blocker even when another rollout slice is pending", () => {
	const root = fixture({
		"src/app/edit/processamento/page.tsx": "import { CAMPAIGN_SLUG } from \"@/features/sessions/model\";\n",
	});
	try {
		const result = scanCampaignIsolationReadiness(root);
		assert.ok(result.blockers.some((b) => b.issue === 1128));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});


test("CLI --json output stays machine-parseable", () => {
	const script = new URL("./campaign-isolation-readiness.mjs", import.meta.url);
	const stdout = execFileSync(process.execPath, [script.pathname, "--json"], {
		encoding: "utf8",
	});
	assert.doesNotThrow(() => JSON.parse(stdout));
	assert.equal(stdout.endsWith("\n"), true);
	assert.equal(stdout.endsWith("\\n"), false);
});
