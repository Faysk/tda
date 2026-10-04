import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	parseProductionEnv,
	verifySessionCampaignMoveProductionHealth,
} from "./session-campaign-move-production-health.mjs";

const PROJECT_REF = "dmrqnbdvbkfqzctcerbx";
const URL = `https://${PROJECT_REF}.supabase.co`;
const SECRET = "s".repeat(64);
const ACCESS_TOKEN = "sbp_" + "a".repeat(48);

function healthy() {
	return {
		schema: "tda.session-campaign-move-release-health.v1",
		ok: true,
		contractVersion: 2,
		registryDriftCount: 0,
		grants: {
			legacyCommitServiceRole: false,
			legacyCommitAuthenticated: false,
			legacyCommitAnon: false,
			preflightServiceRole: true,
			preflightAuthenticated: false,
			preflightAnon: false,
			v2CommitServiceRole: true,
			v2CommitAuthenticated: false,
			v2CommitAnon: false,
			registryHelperServiceRole: false,
		},
	};
}

function fetcher(payload = healthy(), status = 200, seen = []) {
	return async (url, init) => {
		seen.push({ url: String(url), init });
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => payload,
		};
	};
}

test("parses only the two required Production variables without shell evaluation", () => {
	const parsed = parseProductionEnv(
		[
			"# generated",
			`SUPABASE_URL="${URL}"`,
			`SUPABASE_SECRET_KEY='${SECRET}'`,
			"OTHER=$(echo PRIVATE_TRANSCRIPT_SENTINEL)",
		].join("\n"),
	);
	assert.deepEqual(parsed, {
		SUPABASE_URL: URL,
		SUPABASE_SECRET_KEY: SECRET,
	});
});

test("uses the Management API read-only query when the PAT is available and never logs credentials", async () => {
	const seen = [];
	const lines = [];
	const result = await verifySessionCampaignMoveProductionHealth({
		supabaseUrl: URL,
		secretKey: "[SENSITIVE]",
		accessToken: ACCESS_TOKEN,
		projectRef: PROJECT_REF,
		phase: "pre_promote",
		fetchImpl: fetcher([{ health: healthy() }], 201, seen),
		logger: (line) => lines.push(line),
	});
	assert.equal(result.ok, true);
	assert.equal(seen.length, 1);
	assert.equal(
		seen[0].url,
		`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
	);
	assert.equal(seen[0].init.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
	assert.deepEqual(JSON.parse(seen[0].init.body), {
		query: "select public.session_campaign_move_release_health() as health",
		read_only: true,
	});
	assert.equal(lines.join("\n").includes(ACCESS_TOKEN), false);
	assert.equal(lines.join("\n").includes(SECRET), false);
	assert.equal(lines.join("\n").includes(URL), false);
});

test("falls back to service-role PostgREST when a Management API token is unavailable", async () => {
	const seen = [];
	const result = await verifySessionCampaignMoveProductionHealth({
		supabaseUrl: URL,
		secretKey: SECRET,
		projectRef: PROJECT_REF,
		phase: "canonical",
		fetchImpl: fetcher(healthy(), 200, seen),
		logger: () => {},
	});
	assert.equal(result.ok, true);
	assert.equal(
		seen[0].url,
		`${URL}/rest/v1/rpc/session_campaign_move_release_health`,
	);
	assert.equal(seen[0].init.headers.apikey, SECRET);
});

test("fails closed for drift, grant regression and wrong project", async () => {
	await assert.rejects(
		verifySessionCampaignMoveProductionHealth({
			supabaseUrl: URL,
			secretKey: SECRET,
			accessToken: ACCESS_TOKEN,
			projectRef: PROJECT_REF,
			phase: "canonical",
			fetchImpl: fetcher({ ...healthy(), registryDriftCount: 1 }),
			logger: () => {},
		}),
		/registry drift/u,
	);

	const grantRegression = healthy();
	grantRegression.grants.legacyCommitServiceRole = true;
	await assert.rejects(
		verifySessionCampaignMoveProductionHealth({
			supabaseUrl: URL,
			secretKey: SECRET,
			accessToken: ACCESS_TOKEN,
			projectRef: PROJECT_REF,
			phase: "canonical",
			fetchImpl: fetcher(grantRegression),
			logger: () => {},
		}),
		/legacy service-role commit/u,
	);

	await assert.rejects(
		verifySessionCampaignMoveProductionHealth({
			supabaseUrl: "https://other.supabase.co",
			secretKey: SECRET,
			accessToken: ACCESS_TOKEN,
			projectRef: PROJECT_REF,
			phase: "canonical",
			fetchImpl: fetcher(),
			logger: () => {},
		}),
		/governed Production project/u,
	);
});

test("Production workflow gates promotion and records canonical health", () => {
	const workflow = fs.readFileSync(".github/workflows/production-cd.yml", "utf8");
	const pre = workflow.indexOf("Verify session campaign move database health before promotion");
	const promote = workflow.indexOf("id: promote");
	const post = workflow.indexOf("Verify session campaign move database health after promotion");
	const recovery = workflow.indexOf("Record post-promotion recovery action");

	assert.ok(pre >= 0, "pre-promotion campaign move health must be wired");
	assert.ok(promote > pre, "campaign move DB health must gate promotion");
	assert.ok(post > promote, "canonical campaign move DB health must follow promotion");
	assert.ok(recovery > post, "post-promotion failure must enter recovery guidance");
	assert.match(workflow, /session-campaign-move-production-health\.mjs/u);
	assert.match(workflow, /trap 'rm -f "\$HEALTH_ENV_FILE"' EXIT/u);
});
