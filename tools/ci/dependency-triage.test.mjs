import assert from "node:assert/strict";
import test from "node:test";
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
  assert.throws(() => batchTriage([a,a]), /Duplicate/);
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
