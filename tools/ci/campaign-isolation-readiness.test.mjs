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
	"src/app/mundo/page.tsx",
	"src/features/world-explorer/world-edit-actions.ts",
	"src/features/world-explorer/layout-repository.ts",
	"src/features/world-explorer/world-graph-actions.ts",
	"src/features/world-explorer/world-layout-session-actions.ts",
	"src/features/lore/repository.ts",
	"src/app/transcricoes/page.tsx",
	"src/app/edit/revisao/page.tsx",
	"src/features/edit/review/server.ts",
	"src/features/edit/review/actions.ts",
	"src/features/world-explorer/world-entity-media-actions.ts",
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

test("global campaign authority blocks activation and points to the owning issue", () => {
	const root = fixture({
		"src/app/edit/sessoes/page.tsx":
			'import { CAMPAIGN_SLUG } from "@/features/sessions/model";\nlistEditSessionLibrary(CAMPAIGN_SLUG);\n',
		"src/features/lore/repository.ts":
			'const CAMPAIGN_SLUG = "yuhara-main";\nclient.eq("slug", CAMPAIGN_SLUG);\n',
	});
	try {
		const result = scanCampaignIsolationReadiness(root);
		assert.equal(result.ready, false);
		assert.deepEqual(
			result.blockers.map((blocker) => blocker.issue),
			[1129, 1131],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing boundary files fail closed instead of disappearing from the gate", () => {
	const root = fixture();
	const missing = join(root, "src/features/edit/review/actions.ts");
	rmSync(missing);
	try {
		const result = scanCampaignIsolationReadiness(root);
		const review = result.blockers.find((blocker) => blocker.issue === 1133);
		assert.ok(review);
		assert.ok(
			review.matches.some(
				(match) =>
					match.path === "src/features/edit/review/actions.ts" &&
					match.reason === "missing_file",
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("processing regression is treated as a blocker even if later slices are still pending", () => {
	const root = fixture({
		"src/app/edit/processamento/page.tsx":
			'import { CAMPAIGN_SLUG } from "@/features/sessions/model";\n',
	});
	try {
		const result = scanCampaignIsolationReadiness(root);
		assert.ok(result.blockers.some((blocker) => blocker.issue === 1128));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
