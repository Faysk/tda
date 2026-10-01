import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");

export const NEGATIVE_CASES = [
	{
		id: "wrong_campaign",
		evidence: [{
			path: "src/features/edit/permissions/mutation.test.ts",
			contains: "denies a forged sibling campaign before persistence",
		}],
	},
	{
		id: "missing_grant",
		evidence: [{
			path: "src/features/edit/permissions/mutation.test.ts",
			contains: "denies anonymous and unauthorized actors before persistence",
		}],
	},
	{
		id: "stale_grant",
		evidence: [{
			path: "src/features/edit/review/actions.test.ts",
			contains: "fails a stale tab immediately after permission revocation",
		}],
	},
	{
		id: "session_only_grant_does_not_escalate",
		evidence: [{
			path: "supabase/tests/campaign_authorization.sql",
			contains: "session/resource scope was treated as campaign authority",
		}],
	},
	{
		id: "wrong_resource_owner",
		evidence: [{
			path: "src/features/world-explorer/world-entity-media.test.ts",
			contains: "only exposes verified public R2 assets for the matching campaign and entity",
		}],
	},
	{
		id: "archived_target",
		evidence: [{
			path: "supabase/tests/campaign_authorization.sql",
			contains: "archived campaign accepted normal access-directory operation",
		}],
	},
	{
		id: "forged_client_campaign_hints",
		evidence: [{
			path: "tests/campaign-isolation.spec.ts",
			contains: "forged query, cookie and localStorage campaign hints are never authority",
		}],
	},
	{
		id: "reused_idempotency_key_wrong_campaign",
		evidence: [{
			path: "src/features/edit/processing/submission-recovery.test.ts",
			contains: "never reuses a pending idempotency key across campaigns with the same session/source/profile",
		}],
	},
	{
		id: "cross_campaign_entity_relation",
		evidence: [{
			path: "supabase/tests/world_graph_authoring_atomic.sql",
			contains: "cross-campaign entity relation endpoint was accepted",
		}],
	},
	{
		id: "cross_campaign_participant",
		evidence: [{
			path: "supabase/tests/campaign_registry.sql",
			contains: "cross-campaign participant character binding was accepted",
		}],
	},
	{
		id: "session_move_incompatible_dependencies",
		evidence: [{
			path: "supabase/tests/session_campaign_move.sql",
			contains: "dependent session did not fail closed",
		}],
	},
	{
		id: "stale_world_publish",
		evidence: [{
			path: "supabase/tests/world_edit_lease_atomic.sql",
			contains: "conflicted publish must preserve lease/draft and published winner",
		}],
	},
];

export const SURFACE_COVERAGE = [
	{ id: "public_sessions", evidence: ["tests/campaign-isolation.spec.ts", "tests/campaign-directory.spec.ts"] },
	{ id: "auth_discovery", evidence: ["supabase/tests/campaign_authorization.sql", "src/features/campaigns/authorized.test.ts"] },
	{ id: "processing", evidence: ["src/features/edit/processing/campaign-validation.test.ts", "src/features/edit/processing/submission-recovery.test.ts"] },
	{ id: "edit_sessions_move", evidence: ["tools/session-campaign-move-db.py", "src/features/edit/sessions/canonical-route-contract.test.ts"] },
	{ id: "transcripts_review", evidence: ["src/features/transcripts/statistics/server.test.ts", "src/features/edit/review/actions.test.ts"] },
	{ id: "world", evidence: ["tools/world-layout-db.py", "src/features/world-explorer/world-campaign.test.ts"] },
	{ id: "permissions", evidence: ["src/features/edit/permissions/mutation.test.ts", "src/features/edit/permissions/query.test.ts"] },
	{ id: "media", evidence: ["src/features/media/campaign-media.test.ts", "src/features/campaigns/campaign-cover-media.test.ts"] },
	{ id: "lore", evidence: ["src/features/lore/campaign-context.test.ts", "src/features/lore/standalone-link-repository.test.ts"] },
	{ id: "lembra", evidence: ["src/features/lembra/campaign-classification.test.ts", "tools/lembra-db.py"] },
];

function normalizeEvidence(evidence) {
	return typeof evidence === "string" ? { path: evidence } : evidence;
}

export function validateCampaignIsolationEvidence(entries, root = DEFAULT_ROOT) {
	const missingEvidence = [];
	const missingAnchors = [];
	for (const entry of entries) {
		for (const rawEvidence of entry.evidence) {
			const evidence = normalizeEvidence(rawEvidence);
			const absolutePath = resolve(root, evidence.path);
			if (!existsSync(absolutePath)) {
				missingEvidence.push(evidence.path);
				continue;
			}
			if (
				typeof evidence.contains === "string" &&
				!readFileSync(absolutePath, "utf8").includes(evidence.contains)
			) {
				missingAnchors.push({
					id: entry.id,
					path: evidence.path,
				});
			}
		}
	}
	return {
		missingEvidence: [...new Set(missingEvidence)],
		missingAnchors: missingAnchors.filter(
			(item, index, all) =>
				all.findIndex(
					(candidate) =>
						candidate.id === item.id && candidate.path === item.path,
				) === index,
		),
	};
}

export function buildCampaignIsolationMatrix(root = DEFAULT_ROOT) {
	const ids = NEGATIVE_CASES.map((item) => item.id);
	const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
	const validation = validateCampaignIsolationEvidence(
		[...NEGATIVE_CASES, ...SURFACE_COVERAGE],
		root,
	);
	return {
		schema: "tda.campaign-isolation-matrix.v2",
		negativeCaseCount: NEGATIVE_CASES.length,
		negativeCaseIds: ids,
		surfaceCoverageCount: SURFACE_COVERAGE.length,
		surfaceIds: SURFACE_COVERAGE.map((item) => item.id),
		duplicateIds: [...new Set(duplicateIds)],
		missingEvidence: validation.missingEvidence,
		missingAnchors: validation.missingAnchors,
		complete:
			NEGATIVE_CASES.length === 12 &&
			duplicateIds.length === 0 &&
			validation.missingEvidence.length === 0 &&
			validation.missingAnchors.length === 0,
	};
}

function main() {
	const result = buildCampaignIsolationMatrix();
	if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	else console.log(
		`CAMPAIGN_ISOLATION_MATRIX negatives=${result.negativeCaseCount} surfaces=${result.surfaceCoverageCount} complete=${result.complete} missingAnchors=${result.missingAnchors.length}`,
	);
	if (process.argv.includes("--require-complete") && !result.complete) process.exitCode = 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
