import assert from "node:assert/strict";
import test from "node:test";
import { collectDependencyTriage, directLockMismatches, renderCollectedTriage, triageConfiguration } from "./dependency-triage-collector.mjs";
import { triageDependencyPr, batchTriage, markdownDigest, TRIAGE_POLICY_VERSION } from "./dependency-triage.mjs";

const SHA = "e".repeat(40);
const good = () => ({
  pr: { repo: "Faysk/tda", head_repo: "Faysk/tda", author: "dependabot[bot]",
    number: 1700, state: "open", head_sha: SHA },
  advisory: { status: "clear-verified", head_sha: SHA },
  ci: { conclusion: "success", head_sha: SHA, complete: true },
  codeql: { conclusion: "success", head_sha: SHA },
  lock: { status: "consistent-verified", head_sha: SHA },
});
const triage = (modify) => {
  const row = good();
  modify?.(row);
  return triageDependencyPr(row);
};
test("success only yields review label, never merge or production authorization", () => {
  const d = triage();
  assert.equal(d.classification, "ready-for-review");
  assert.equal(d.action, "manual-investigation-only");
  assert.equal(d.permits_merge, false);
  assert.equal(d.permits_release, false);
  assert.equal(d.policy, TRIAGE_POLICY_VERSION);
});
test("confirmed critical/high advisories outrank ordinary CI failure and cooldown", () => {
  for (const severity of ["critical", "high"]) {
    const r = triage((d) => {
      d.advisory = { status: "confirmed", head_sha: SHA, severity };
      d.ci.conclusion = "failure";
    });
    assert.equal(r.classification, "security-critical");
    assert.equal(r.cause, "confirmed-high-severity-advisory");
  }
});
test("confirmed medium/low advisory never produces ready-for-review", () => {
  for (const severity of ["medium", "low"]) {
    const r = triage((d) => { d.advisory = { status: "confirmed", head_sha: SHA, severity }; });
    assert.equal(r.classification, "needs-human");
    assert.equal(r.cause, "confirmed-advisory-requires-review");
  }
});
test("direct lock mismatch wins over ordinary CI failure; no false CVE label", () => {
  const r = triage((d) => {
    d.lock.status = "direct-lock-mismatch";
    d.ci.conclusion = "failure";
  });
  assert.equal(r.classification, "blocked-by-lock");
  assert.equal(r.cause, "direct-lock-mismatch");
  assert.equal(r.advisory_clearance_verified, true);
});
test("CI navigation regression is failed-tests, not security-critical", () => {
  const r = triage((d) => { d.ci.conclusion = "failure"; });
  assert.equal(r.classification, "failed-tests");
  assert.equal(r.cause, "ci-not-success");
});
test("closed, forked, stale and non-Dependabot PRs never carry a ready state", () => {
  const modifications = [
    (d) => { d.pr.state = "closed"; },
    (d) => { d.pr.head_repo = "another/tda"; },
    (d) => { d.pr.author = "someone"; },
    (d) => { d.pr.head_sha = "bad"; },
    (d) => { d.pr.repo = "fake/tda"; },
  ];
  for (const modify of modifications) {
    const r = triage(modify);
    assert.equal(r.classification, "stale", JSON.stringify(r));
  }
});
test("unavailable, stale or unsupported advisory evidence stays unknown", () => {
  for (const status of ["unknown", "unavailable", null]) {
    const r = triage((d) => { d.advisory.status = status; });
    assert.equal(r.classification, "needs-human");
    assert.equal(r.cause, "security-evidence-unknown");
    assert.equal(r.advisory_clearance_verified, false);
  }
  assert.equal(triage((d) => { d.advisory.head_sha = "f".repeat(40); }).classification, "needs-human");
});
test("CI/CodeQL and lock drift cannot be laundered by unrelated green run", () => {
  assert.equal(triage((d) => { d.ci.head_sha = "f".repeat(40); }).classification, "needs-human");
  assert.equal(triage((d) => { d.codeql.head_sha = "f".repeat(40); }).classification, "needs-human");
  assert.equal(triage((d) => { d.lock.head_sha = "f".repeat(40); }).classification, "needs-human");
  assert.equal(triage((d) => { d.ci.complete = false; }).classification, "needs-human");
});
test("duplicate deliveries use one idempotent fingerprint; changed SHA/cause rekeys", () => {
  const first = triage();
  assert.equal(first.fingerprint, triage().fingerprint);
  const differentHead = triage((d) => {
    d.pr.head_sha = "f".repeat(40);
    d.advisory.head_sha = d.pr.head_sha;
    d.ci.head_sha = d.pr.head_sha;
    d.codeql.head_sha = d.pr.head_sha;
    d.lock.head_sha = d.pr.head_sha;
  });
  assert.notEqual(first.fingerprint, differentHead.fingerprint);
  const newCause = triage((d) => { d.lock.status = "direct-lock-mismatch"; });
  assert.notEqual(first.fingerprint, newCause.fingerprint);
  assert.notEqual(first.classification, newCause.classification);
});
test("fingerprint changes for advisory severity/id and failing-job cause, not event order", () => {
  const a = triage((d) => { d.advisory = { status: "confirmed", head_sha: SHA, severity: "high", id: "GHSA-aaaa-bbbb-cccc" }; });
  const b = triage((d) => { d.advisory = { status: "confirmed", head_sha: SHA, severity: "critical", id: "GHSA-aaaa-bbbb-cccc" }; });
  const c = triage((d) => { d.advisory = { status: "confirmed", head_sha: SHA, severity: "high", id: "CVE-2026-1234" }; });
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  const fail = (arr) => triage((d) => {
    d.ci.conclusion = "failure";
    d.ci.failed_jobs = arr;
  }).fingerprint;
  assert.equal(fail(["processing-e2e", "navigation-e2e"]), fail(["navigation-e2e", "processing-e2e"]));
  assert.notEqual(fail(["processing-e2e"]), fail(["navigation-e2e"]));
});

test("batch sorts by PR and rejects collisions; digest never contains raw events", () => {
  const a = good(), b = good();
  a.pr.number = 1647;
  b.pr.number = 1643;
  b.ci.conclusion = "failure";
  b.pr.email = "private-actor@example.invalid";
  b.private_payload = "PRIVATE_CAMPAIGN_SYNTHETIC_SENTINEL";
  const results = batchTriage([a,b]);
  assert.deepEqual(results.map(x=>x.pr_number), [1643,1647]);
  assert.deepEqual(batchTriage([a,a]), [triageDependencyPr(a)]);
  const conflicting = good();
  conflicting.pr.number = a.pr.number;
  conflicting.ci.conclusion = "failure";
  assert.throws(() => batchTriage([a,conflicting]), /Conflicting snapshots/);
  const digest = markdownDigest(results);
  assert.match(digest, /1643/);
  assert.match(digest, /failed-tests/);
  assert.ok(!digest.includes("private-actor@example.invalid"));
  assert.ok(!digest.includes("PRIVATE_CAMPAIGN_SYNTHETIC_SENTINEL"));
  assert.ok(results.every(x=>!x.permits_merge && !x.permits_release));
});
test("eight synthetic historical PR scenarios are classified and never merged", () => {
  const snapshots = [1643,1644,1645,1646,1647,1648,1649,1650].map(number => {
    const d = good();
    d.pr.number = number;
    if ([1648,1649].includes(number)) d.pr.state = "closed";
    if (number === 1647) d.lock.status = "direct-lock-mismatch";
    else d.ci.conclusion = "failure";
    return d;
  });
  const result = batchTriage(snapshots);
  assert.equal(result.length, 8);
  assert.equal(result.find(x=>x.pr_number===1647).classification, "blocked-by-lock");
  assert.equal(result.find(x=>x.pr_number===1648).classification, "stale");
  assert.ok(result.every(x=>x.action==="manual-investigation-only"));
});

test("matrix job names remain distinct causes without rendering untrusted names", () => {
	const one = good(),
		two = good();
	one.ci = {
		head_sha: SHA,
		conclusion: "failure",
		failed_jobs: ["companion / synthetic (windows-latest)"],
	};
	two.ci = {
		...one.ci,
		failed_jobs: ["companion / synthetic (ubuntu-latest)"],
	};
	assert.notEqual(
		triageDependencyPr(one).fingerprint,
		triageDependencyPr(two).fingerprint,
	);
	assert.equal(
		triageDependencyPr(one).fingerprint,
		triageDependencyPr(structuredClone(one)).fingerprint,
	);
});

const directManifest =
	'[project]\ndependencies = ["fastapi==0.143.1",]\n[project.optional-dependencies]\ntest = ["pytest==9.1.1"]\nasr = ["ctranslate2==4.8.3"]\n';
const directLock = "fastapi==0.143.1\npytest==9.1.1\n";
const observedMain = "a".repeat(40);
function collectorApi({
	alerts = [],
	failAlerts = false,
	changedHead = false,
	lock = directLock,
	mainChanged = false,
} = {}) {
	let headReads = 0,
		mainReads = 0;
	const paths = [];
	const pr = {
		number: 1700,
		state: "open",
		user: { login: "dependabot[bot]" },
		head: { sha: SHA, repo: { full_name: "Faysk/tda" } },
	};
	const content = (text) => ({
		type: "file",
		size: text.length,
		encoding: "base64",
		content: Buffer.from(text).toString("base64"),
	});
	const api = (path) => {
		paths.push(path);
		if (path.endsWith("/branches/main"))
			return {
				commit: {
					sha: mainChanged && mainReads++ ? "b".repeat(40) : observedMain,
				},
			};
		if (path.includes("/dependabot/alerts?")) {
			if (failAlerts) throw Error("PRIVATE_ERROR_MUST_NOT_LEAK");
			return alerts;
		}
		if (path.includes("/pulls?")) return [pr];
		if (path.endsWith("/pulls/1700"))
			return changedHead && headReads++
				? { ...pr, head: { ...pr.head, sha: "c".repeat(40) } }
				: pr;
		if (path.includes("/actions/workflows/")) {
			const ci = path.includes("/ci.yml/");
			return {
				total_count: 1,
				workflow_runs: [
					{
						id: ci ? 10 : 11,
						name: ci ? "CI" : "CodeQL",
						path: `.github/workflows/${ci ? "ci" : "codeql"}.yml`,
						head_sha: SHA,
						event: "pull_request",
						head_repository: { full_name: "Faysk/tda" },
						status: "completed",
						conclusion: "success",
						pull_requests: [{ number: 1700, base: { sha: observedMain } }],
					},
				],
			};
		}
		if (path.includes("/jobs?"))
			return {
				total_count: 1,
				jobs: [
					{ name: "required-ci", status: "completed", conclusion: "success" },
				],
			};
		if (path.includes("/contents/local-companion/pyproject.toml?"))
			return content(directManifest);
		if (path.includes("/contents/local-companion/requirements-test.lock?"))
			return content(lock);
		throw Error("Unexpected read path");
	};
	return { api, paths };
}

test("collector uses bounded reads and never turns empty repo advisories into PR clearance", () => {
	const { api, paths } = collectorApi();
	const report = collectDependencyTriage(api);
	assert.equal(report.advisory_api_complete, true);
	assert.equal(report.records[0].classification, "needs-human");
	assert.equal(report.records[0].advisory_clearance_verified, false);
	assert.ok(paths.every((path) => path.startsWith("repos/Faysk/tda/")));
	assert.equal(report.permits_merge, false);
	assert.equal(report.permits_release, false);
	assert.deepEqual(
		collectDependencyTriage(collectorApi().api).records,
		report.records,
	);
});

test("collector prioritizes native critical alerts without inventing a PR-head binding", () => {
	const alerts = [
		{
			number: 3,
			state: "open",
			dependency: { package: { name: "next", ecosystem: "npm" } },
			security_advisory: {
				severity: "critical",
				ghsa_id: "GHSA-synthetic-fixture",
			},
		},
	];
	const report = collectDependencyTriage(collectorApi({ alerts }).api);
	assert.equal(report.native_alerts[0].classification, "security-critical");
	assert.equal(report.records[0].classification, "needs-human");
	assert.match(report.native_alerts[0].head_binding, /not-pr-head-verified/);
});

test("collector reports disabled APIs as observable unknown without disclosing their error", () => {
	const report = collectDependencyTriage(
		collectorApi({ failAlerts: true }).api,
	);
	assert.equal(report.advisory_api_complete, false);
	assert.ok(report.health.includes("advisories:unavailable"));
	assert.doesNotMatch(
		renderCollectedTriage(report),
		/PRIVATE_ERROR_MUST_NOT_LEAK/,
	);
	assert.equal(report.records[0].classification, "needs-human");
});

test("direct lock mismatch has actionable diagnosis while unsupported syntax stays unknown", () => {
	assert.deepEqual(directLockMismatches(directManifest, directLock), []);
	assert.equal(
		directLockMismatches(
			'[project]\ndependencies=["fastapi>=0.143"]',
			directLock,
		),
		null,
	);
	const report = collectDependencyTriage(
		collectorApi({ lock: directLock.replace("0.143.1", "0.142.4") }).api,
	);
	assert.equal(report.records[0].classification, "blocked-by-lock");
	assert.match(
		renderCollectedTriage(report),
		/refresh-companion-test-lock\.py --check/,
	);
});

test("head/base races never reuse evidence collected against an earlier identity", () => {
	for (const options of [{ changedHead: true }, { mainChanged: true }])
		assert.equal(
			collectDependencyTriage(collectorApi(options).api).records[0]
				.classification,
			"stale",
		);
});

test("digest clock accepts IANA configuration and does not invent an approved SLA", () => {
	const config = triageConfiguration({
		timeZone: "Europe/London",
		digestTime: "09:30",
	});
	assert.equal(config.time_zone, "Europe/London");
	assert.equal(config.sla_status, "proposed-not-owner-approved");
	assert.throws(() => triageConfiguration({ timeZone: "not/a-zone" }));
	assert.throws(() => triageConfiguration({ digestTime: "25:00" }), /INVALID/);
});
