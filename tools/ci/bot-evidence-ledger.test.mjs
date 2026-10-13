import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEvidence, renderEvidenceMarkdown } from "./bot-evidence-ledger.mjs";

const repo = "Faysk/tda";
const sha = "0123456789abcdef0123456789abcdef01234567";
const jobs = ["classify-changes", "workflow-contract", "validate", "ci-gate", "required-ci"];
function fixture() {
  const pr = { number: 1647, state: "open", user: { login: "dependabot[bot]" },
    head: { sha, repo: { full_name: repo } } };
  const run = { id: 88, name: "CI", path: ".github/workflows/ci.yml", event: "pull_request", status: "completed",
    conclusion: "success", head_sha: sha, head_repository: { full_name: repo },
    pull_requests: [{ number: 1647 }] };
  const codeql = { id: 91, name: "CodeQL", path: ".github/workflows/codeql.yml",
    event: "pull_request", status: "completed", conclusion: "success",
    head_sha: sha, head_repository: { full_name: repo },
    pull_requests: [{ number: 1647 }] };
  return { repository: repo, pr, run, codeqlRuns: [codeql],
    jobs: jobs.map((name) => ({ name, status: "completed", conclusion: "success" })),
    completeJobs: true };
}
const check = (mutate = (x) => x) => evaluateEvidence(mutate(fixture()));

test("full exact-SHA checks give only advisory readiness", () => {
  const result = check();
  assert.equal(result.state, "ready-for-human-review");
  assert.equal(result.approval, "human-required");
  assert.equal(result.production, "not-authorized");
  assert.equal(result.codeql, "success");
  assert.match(renderEvidenceMarkdown(result), /never automatic merge approval/);
});

test("stale SHA, fork, unknown author, wrong event or PR identity fail closed", () => {
  const variants = [
    (x) => { x.pr.head.sha = "a".repeat(40); },
    (x) => { x.pr.head.repo.full_name = "external/fork"; },
    (x) => { x.pr.user.login = "someone"; },
    (x) => { x.run.event = "push"; },
    (x) => { x.run.path = ".github/workflows/spoofed-ci.yml"; },
    (x) => { x.run.pull_requests = [{ number: 777 }]; },
    (x) => { x.run.head_repository.full_name = "foreign/repo"; },
    (x) => { x.run.head_sha = "not-a-sha"; },
  ];
  for (const alter of variants) {
    const result = check((x) => { alter(x); return x; });
    assert.equal(result.state, "invalid-identity");
    assert.ok(result.reasons.length > 0);
  }
});

test("old success cannot rescue the current failed or skipped required job", () => {
  for (const status of ["failure", "skipped", "cancelled", "neutral", "timed_out"]) {
    const result = check((x) => {
      x.jobs.find((j) => j.name === "required-ci").conclusion = status;
      return x;
    });
    assert.equal(result.state, "blocked", status);
    assert.equal(result.required_jobs["required-ci"], status);
  }
});

test("missing/duplicate jobs and incomplete pagination are never approved", () => {
  assert.equal(check((x) => { x.jobs = x.jobs.filter((j) => j.name !== "ci-gate"); return x; }).state, "blocked");
  assert.equal(check((x) => { x.jobs.push({ name: "ci-gate", status: "completed", conclusion: "success" }); return x; }).state, "blocked");
  assert.equal(check((x) => { x.completeJobs = false; return x; }).state, "pending-or-unknown");
});

test("CI failure overrides pending CodeQL, but uncompleted checks stay unknown", () => {
  const broken = check((x) => { x.run.conclusion = "failure"; x.codeqlRuns = []; return x; });
  assert.equal(broken.state, "blocked");
  const pending = check((x) => {
    x.jobs.find((j) => j.name === "required-ci").status = "in_progress";
    x.codeqlRuns[0].status = "in_progress";
    return x;
  });
  assert.equal(pending.state, "pending-or-unknown");
});

test("CodeQL failure blocks; missing or stale CodeQL stays unknown", () => {
  assert.equal(check((x) => { x.codeqlRuns[0].conclusion = "failure"; return x; }).state, "blocked");
  assert.equal(check((x) => { x.codeqlRuns = []; return x; }).state, "pending-or-unknown");
  assert.equal(check((x) => { x.codeqlRuns[0].head_sha = "f".repeat(40); return x; }).state, "pending-or-unknown");
});

test("latest exact CodeQL run supersedes old success on same SHA", () => {
  const result = check((x) => {
    x.codeqlRuns.push({ ...x.codeqlRuns[0], id: 100, created_at: "2026-10-13T21:00:00Z",
      conclusion: "failure" });
    x.codeqlRuns[0].created_at = "2026-10-13T20:00:00Z";
    return x;
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.codeql, "failure");
});

test("untrusted PR metadata cannot inject Markdown tables or impersonate a green CI", () => {
  const result = check();
  result.head_sha = "abc|def\n### passed";
  const output = renderEvidenceMarkdown(result);
  assert.equal(output.includes("abc|def"), false);
  assert.equal(output.includes("\n### passed"), false);
});

test("partial CodeQL evidence cannot confer readiness", () => {
  const report = check((x) => { x.completeCodeql = false; return x; });
  assert.equal(report.state, "pending-or-unknown");
  assert.equal(report.codeql_complete, false);
});
