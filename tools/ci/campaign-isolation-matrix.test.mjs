import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildCampaignIsolationMatrix,
	validateCampaignIsolationEvidence,
} from "./campaign-isolation-matrix.mjs";

test("critical negative matrix is complete and backed by runnable semantic evidence", () => {
	const matrix = buildCampaignIsolationMatrix();
	assert.equal(matrix.negativeCaseCount, 12);
	assert.deepEqual(matrix.negativeCaseIds, [
		"wrong_campaign",
		"missing_grant",
		"stale_grant",
		"session_only_grant_does_not_escalate",
		"wrong_resource_owner",
		"archived_target",
		"forged_client_campaign_hints",
		"reused_idempotency_key_wrong_campaign",
		"cross_campaign_entity_relation",
		"cross_campaign_participant",
		"session_move_incompatible_dependencies",
		"stale_world_publish",
	]);
	assert.equal(matrix.surfaceCoverageCount, 11);
	assert.deepEqual(matrix.duplicateIds, []);
	assert.deepEqual(matrix.missingEvidence, []);
	assert.deepEqual(matrix.missingAnchors, []);
	assert.equal(matrix.complete, true);
});

test("semantic evidence fails closed when the negative assertion disappears from an existing file", () => {
	const root = mkdtempSync(join(tmpdir(), "tda-campaign-matrix-"));
	try {
		const path = join(root, "negative.test.ts");
		writeFileSync(path, 'test("unrelated", () => {});\n');
		const entries = [{
			id: "synthetic_negative",
			evidence: [{ path: "negative.test.ts", contains: "critical negative assertion" }],
		}];

		assert.deepEqual(validateCampaignIsolationEvidence(entries, root), {
			missingEvidence: [],
			missingAnchors: [{ id: "synthetic_negative", path: "negative.test.ts" }],
		});

		writeFileSync(path, '// critical negative assertion\ntest("negative", () => {});\n');
		assert.deepEqual(validateCampaignIsolationEvidence(entries, root), {
			missingEvidence: [],
			missingAnchors: [],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
