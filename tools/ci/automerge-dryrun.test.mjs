import assert from "node:assert/strict";
import test from "node:test";
import { POLICY_VERSION, evaluateAutoMergeDryRun, evaluateBatch } from "./automerge-dryrun.mjs";

const SHA = "a".repeat(40);
const full = () => ({
  pr: { number: 1700, author: "dependabot[bot]", state: "open", draft: false,
    repo: "Faysk/tda", head_repo: "Faysk/tda", base: "main", head_sha: SHA, mergeable: true },
  paths: ["package.json", "pnpm-lock.yaml"],
  dependencies: [{ ecosystem: "npm", name: "prettier", scope: "devDependencies",
    from: "3.1.2", to: "3.1.3" }],
  checks: { head_sha: SHA, complete: true, jobs:
    ["required-ci", "ci-gate", "workflow-contract", "validate", "CodeQL"].map(
      (name) => ({ name, sha: SHA, conclusion: "success" })) },
  lock_integrity: "verified-exact",
  advisories: { status: "clear-verified", head_sha: SHA },
  branch_protection: { status: "admin-verified", head_sha: SHA },
  approvals: { reviewed_by_owner: true, opt_in_to_future_policy: true },
  freshness: { status: "success", head_sha: SHA },
});
const check = (change) => {
  const input = full();
  change?.(input);
  return evaluateAutoMergeDryRun(input);
};
const denial = (fn, code) => {
  const decision = check(fn);
  assert.equal(decision.outcome, "blocked", code);
  assert.equal(decision.authorized_to_merge, false, code);
  assert.equal(decision.action, "no-merge-dry-run", code);
  assert.ok(decision.reasons.includes(code), JSON.stringify(decision));
};

test("strict hypothetical tool patch is never an authorization to merge", () => {
  const d = check();
  assert.equal(d.policy_version, POLICY_VERSION);
  assert.equal(d.outcome, "hypothetical-low-risk-candidate");
  assert.equal(d.authorized_to_merge, false);
  assert.equal(d.remote_policy_attested, false);
  assert.equal(d.action, "no-merge-dry-run");
  assert.deepEqual(d.reasons, []);
});

test("rejects stale SHA and duplicate, failed or skipped required checks", () => {
  denial((d) => { d.checks.head_sha = "b".repeat(40); }, "checks-incomplete-or-stale");
  denial((d) => { d.checks.complete = false; }, "checks-incomplete-or-stale");
  for (const state of ["failure", "skipped", "cancelled", "pending", null]) {
    denial((d) => { d.checks.jobs[0].conclusion = state; }, "checks-failed-skipped-duplicated-or-foreign");
  }
  denial((d) => { d.checks.jobs.push({ ...d.checks.jobs[0] }); },
    "checks-failed-skipped-duplicated-or-foreign");
  denial((d) => { d.checks.jobs.pop(); }, "required-check-missing");
});

test("never trusts fork origins, non-Dependabot author or stale PR", () => {
  denial((d) => { d.pr.head_repo = "someone/fork"; }, "untrusted-repository-or-base");
  denial((d) => { d.pr.repo = "not-tda/tda"; }, "untrusted-repository-or-base");
  denial((d) => { d.pr.author = "human"; }, "not-dependabot");
  denial((d) => { d.pr.head_sha = "not-sha"; }, "missing-exact-sha");
  denial((d) => { d.pr.state = "closed"; }, "not-open-reviewable");
  denial((d) => { d.pr.draft = true; }, "not-open-reviewable");
  denial((d) => { d.pr.mergeable = null; }, "not-verified-mergeable");
});

test("denies high-impact packages even for patch and green checks", () => {
  for (const name of ["next", "react", "@supabase/supabase-js", "@aws-sdk/client-s3",
    "fastapi", "ctranslate2", "torch", "faster-whisper", "actions/checkout"]) {
    denial((d) => { d.dependencies[0].name = name; }, "non-allowlisted-or-nonpatch-dependency");
  }
});

test("only exact patch versions and devDependencies are considered hypothetically", () => {
  for (const version of ["3.2.0", "4.0.0", "^3.1.3", "3.1.2", "3.1.1", "workspace:*"]) {
    denial((d) => { d.dependencies[0].to = version; }, "non-allowlisted-or-nonpatch-dependency");
  }
  denial((d) => { d.dependencies[0].scope = "dependencies"; }, "non-allowlisted-or-nonpatch-dependency");
  denial((d) => { d.dependencies[0].ecosystem = "pip"; }, "non-allowlisted-or-nonpatch-dependency");
});

test("refuses unexpected paths, including CI, releases, DB and Windows", () => {
  for (const path of [".github/workflows/ci.yml", "src/app/page.tsx",
    "local-companion/pyproject.toml", "supabase/migrations/0001.sql",
    "tools/ci/automerge-dryrun.mjs"]) {
    denial((d) => { d.paths.push(path); }, "unexpected-change-path");
  }
  denial((d) => { d.paths = ["pnpm-lock.yaml"]; }, "manifest-lock-parity-unknown");
  denial((d) => { d.paths = ["package.json"]; }, "manifest-lock-parity-unknown");
  denial((d) => { d.paths = undefined; }, "changed-paths-unknown");
  denial((d) => { d.paths.push("../escape"); }, "changed-paths-unknown");
});

test("external advisories, branch admin controls, human consent and freshness fail closed", () => {
  denial((d) => { d.advisories.status = "unknown"; }, "advisories-unknown-or-stale");
  denial((d) => { d.advisories.head_sha = "b".repeat(40); }, "advisories-unknown-or-stale");
  denial((d) => { d.branch_protection.status = "403"; }, "branch-rules-not-proven");
  denial((d) => { d.branch_protection.head_sha = "b".repeat(40); }, "branch-rules-not-proven");
  denial((d) => { d.approvals.reviewed_by_owner = false; }, "human-consent-not-proven");
  denial((d) => { d.approvals.opt_in_to_future_policy = false; }, "human-consent-not-proven");
  denial((d) => { d.freshness.status = "failure"; }, "freshness-unknown-or-stale");
  denial((d) => { d.freshness.head_sha = "b".repeat(40); }, "freshness-unknown-or-stale");
  denial((d) => { d.lock_integrity = "unknown"; }, "lock-integrity-not-verified");
});

test("missing untrusted data produces blocked decision, not exceptions or guessed pass", () => {
  const result = evaluateAutoMergeDryRun({ pr: { number: 1 } });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.authorized_to_merge, false);
  assert.ok(result.reasons.includes("checks-unknown"));
  assert.ok(result.reasons.includes("dependency-diff-unknown"));
  assert.throws(() => evaluateAutoMergeDryRun(null), TypeError);
  assert.throws(() => evaluateAutoMergeDryRun([]), TypeError);
});

test("batched decisions are ordered, deterministic, and duplicate IDs rejected", () => {
  const a = full(), b = full();
  a.pr.number = 1647;
  b.pr.number = 1643;
  b.dependencies[0].name = "next";
  const decisions = evaluateBatch([a, b]);
  assert.deepEqual(decisions.map((d) => d.pr_number), [1643, 1647]);
  assert.equal(decisions[0].outcome, "blocked");
  assert.equal(decisions[1].outcome, "hypothetical-low-risk-candidate");
  assert.ok(decisions.every((d) => !d.authorized_to_merge));
  assert.throws(() => evaluateBatch([a, a]), /Duplicate/);
  assert.throws(() => evaluateBatch(Array(101).fill(a)), /Batch exceeds/);
});

test("the eight historical Dependabot scenarios all deny with synthetic evidence", () => {
  const scenarios = [1643, 1644, 1645, 1646, 1647, 1648, 1649, 1650].map((number) => {
    const row = full();
    row.pr.number = number;
    if (number === 1648 || number === 1649) row.pr.state = "closed";
    if (number === 1643 || number === 1647) row.dependencies[0].name = "next";
    row.checks.jobs[0].conclusion = "failure";
    return row;
  });
  const decisions = evaluateBatch(scenarios);
  assert.equal(decisions.length, 8);
  assert.ok(decisions.every((d) => d.outcome === "blocked" && d.authorized_to_merge === false));
});
