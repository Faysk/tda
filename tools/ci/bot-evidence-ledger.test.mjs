import assert from "node:assert/strict";
import test from "node:test";
import { checkMainBaseFreshness, evaluateEvidence, renderEvidenceMarkdown } from "./bot-evidence-ledger.mjs";

const repo = "Faysk/tda";
const sha = "0123456789abcdef0123456789abcdef01234567";
const mainSha = "1234567890abcdef1234567890abcdef12345678";
const otherSha = "abcdef0123456789abcdef0123456789abcdef01";
const base = () => ({ ref: "main", sha: mainSha });
const jobs = ["classify-changes", "workflow-contract", "validate", "ci-gate", "required-ci"];
function fixture() {
  const pr = { number: 1647, state: "open", user: { login: "dependabot[bot]" },
    head: { sha, repo: { full_name: repo } },
    base: { ...base(), repo: { full_name: repo } } };
  const run = { id: 88, name: "CI", path: ".github/workflows/ci.yml", event: "pull_request", status: "completed",
    conclusion: "success", head_sha: sha, head_repository: { full_name: repo },
    pull_requests: [{ number: 1647, base: base() }] };
  const codeql = { id: 91, name: "CodeQL", path: ".github/workflows/codeql.yml",
    event: "pull_request", status: "completed", conclusion: "success",
    head_sha: sha, head_repository: { full_name: repo },
    pull_requests: [{ number: 1647, base: base() }] };
  return { repository: repo, pr, run, codeqlRuns: [codeql],
    codeqlJobs: ["analyze (python)", "analyze (javascript-typescript)"].map((name) =>
      ({ name, status: "completed", conclusion: "success" })),
    codeqlJobsRunId: 91, completeCodeqlJobs: true,
    mainBeforeSha: mainSha, mainAfterSha: mainSha,
    jobs: jobs.map((name) => ({ name, status: "completed", conclusion: "success" })),
    completeJobs: true };
}
const check = (mutate = (x) => x) => evaluateEvidence(mutate(fixture()));

test("full exact-SHA checks give only advisory readiness", () => {
  const result = check();
  assert.equal(result.state, "core-ci-verified-external-checks-unverified");
  assert.equal(result.approval, "human-required");
  assert.equal(result.production, "not-authorized");
  assert.equal(result.codeql, "success");
  assert.deepEqual(result.codeql_required_jobs, {
    "analyze (python)": "success", "analyze (javascript-typescript)": "success",
  });
  assert.equal(result.codeql_jobs_complete, true);
  assert.equal(result.base_freshness, "verified-current-main");
  assert.equal(result.external_checks, "not-queried");
  assert.equal(result.freshness, "not-queried");
  assert.equal(result.branch_protection, "not-verified");
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

test("CodeQL workflow success is insufficient when one required language is skipped or absent", () => {
  for (const status of ["skipped", "failure", "cancelled", "neutral", "timed_out"]) {
    const result = check((x) => {
      x.codeqlJobs.find((j) => j.name === "analyze (python)").conclusion = status;
      return x;
    });
    assert.equal(result.codeql, "success");
    assert.equal(result.state, "blocked", status);
    assert.equal(result.codeql_required_jobs["analyze (python)"], status);
  }
  const missing = check((x) => {
    x.codeqlJobs = x.codeqlJobs.filter((j) => j.name !== "analyze (python)");
    return x;
  });
  assert.equal(missing.state, "blocked");
  assert.equal(missing.codeql_required_jobs["analyze (python)"], "missing");
  const duplicate = check((x) => {
    x.codeqlJobs.push({ ...x.codeqlJobs[0] });
    return x;
  });
  assert.equal(duplicate.state, "blocked");
  assert.equal(duplicate.codeql_required_jobs["analyze (python)"], "ambiguous");
});

test("CodeQL job evidence must belong to latest matching run and include all pages", () => {
  const wrongRun = check((x) => { x.codeqlJobsRunId = 90; return x; });
  assert.equal(wrongRun.state, "pending-or-unknown");
  assert.equal(wrongRun.codeql_jobs_complete, false);
  const partial = check((x) => { x.completeCodeqlJobs = false; return x; });
  assert.equal(partial.state, "pending-or-unknown");
  const newRun = check((x) => {
    x.codeqlRuns[0].created_at = "2026-10-13T10:00:00Z";
    x.codeqlRuns.push({ ...x.codeqlRuns[0], id: 100,
      created_at: "2026-10-14T10:00:00Z" });
    return x;
  });
  assert.equal(newRun.codeql_run_id, 100);
  assert.equal(newRun.state, "pending-or-unknown");
  const refreshed = check((x) => {
    x.codeqlRuns[0].id = 100;
    x.codeqlJobsRunId = 100;
    return x;
  });
  assert.equal(refreshed.state, "core-ci-verified-external-checks-unverified");
});

test("CodeQL language jobs still running never report ready", () => {
  const value = check((x) => {
    x.codeqlJobs[0].status = "in_progress";
    x.codeqlJobs[0].conclusion = null;
    return x;
  });
  assert.equal(value.codeql_required_jobs["analyze (python)"], "pending");
  assert.equal(value.state, "pending-or-unknown");
  assert.match(renderEvidenceMarkdown(value), /CodeQL: analyze \(python\)/);
});

test("main advance blocks previous successful CI and CodeQL at unchanged head", () => {
  for (const edit of [
    (x) => { x.mainBeforeSha = otherSha; x.mainAfterSha = otherSha; },
    (x) => { x.pr.base.sha = otherSha; },
    (x) => { x.run.pull_requests[0].base.sha = otherSha; },
    (x) => { x.codeqlRuns[0].pull_requests[0].base.sha = otherSha; },
    (x) => { x.pr.base.ref = "feature"; },
    (x) => { x.pr.base.repo.full_name = "external/tda"; },
  ]) {
    const result = check((x) => { edit(x); return x; });
    assert.equal(result.base_freshness, "stale-base");
    assert.equal(result.state, "blocked");
    assert.equal(result.production, "not-authorized");
  }
});

test("main race, inaccessible API, or missing run/PR base is unknown rather than green", () => {
  for (const edit of [
    (x) => { x.mainBeforeSha = otherSha; },
    (x) => { x.mainAfterSha = null; },
    (x) => { x.mainBeforeSha = null; },
    (x) => { x.pr.base.sha = null; },
    (x) => { x.run.pull_requests[0].base.sha = null; },
    (x) => { x.codeqlRuns[0].pull_requests[0].base = {}; },
    (x) => { x.codeqlRuns[0].pull_requests = []; },
    (x) => { x.codeqlRuns[0].pull_requests.push({ number: 777, base: base() }); },
  ]) {
    const result = check((x) => { edit(x); return x; });
    assert.equal(result.base_freshness, "unknown");
    assert.equal(result.state, "pending-or-unknown");
  }
});

test("latest CodeQL run base must match current main even with older green run", () => {
  const result = check((x) => {
    x.codeqlRuns[0].created_at = "2026-10-12T10:00:00Z";
    x.codeqlRuns.push({ ...x.codeqlRuns[0], id: 100,
      created_at: "2026-10-14T10:00:00Z",
      pull_requests: [{ number: 1647, base: { ref: "main", sha: otherSha } }] });
    x.codeqlJobsRunId = 100;
    return x;
  });
  assert.equal(result.codeql_run_id, 100);
  assert.equal(result.base_freshness, "stale-base");
  assert.equal(result.state, "blocked");
});

test("base check is a read-only observation, not remote branch protection", () => {
  const value = check();
  assert.equal(value.branch_protection, "not-verified");
  assert.equal(value.freshness, "not-queried");
  assert.match(renderEvidenceMarkdown(value), /Main base freshness: verified-current-main/);
  const direct = checkMainBaseFreshness({
    repository: repo, pr: fixture().pr, ciRun: fixture().run,
    codeqlRun: fixture().codeqlRuns[0], mainBeforeSha: mainSha, mainAfterSha: mainSha,
  });
  assert.equal(direct.status, "verified-current-main");
});
