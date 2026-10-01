import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStagingBaseUrl, runStagingSmoke } from "./campaign-staging-smoke.mjs";

test("staging smoke rejects insecure or credential-bearing origins", () => {
	assert.throws(() => normalizeStagingBaseUrl("http://preview.example.test"), /https/u);
	assert.throws(() => normalizeStagingBaseUrl("https://user:pass@preview.example.test"), /credentials/u);
});

test("staging smoke visits only the public contract and records sanitized results", async () => {
	const seen = [];
	const result = await runStagingSmoke({
		baseUrl: "https://preview.example.test",
		phase: "pre_activation",
		fetchImpl: async (url) => {
			seen.push(url.pathname);
			return { ok: true, status: 200 };
		},
	});
	assert.deepEqual(seen, ["/api/health", "/", "/campanhas", "/campanhas/sessoes"]);
	assert.equal(result.origin, "https://preview.example.test");
	assert.equal(result.publicOnly, true);
	assert.equal(result.containsCredentials, false);
});
