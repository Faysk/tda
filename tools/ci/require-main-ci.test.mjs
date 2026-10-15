import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { REQUIRED_MAIN_CI_JOBS, latestMainCiReceipt } from "./require-main-ci.mjs";

const sha = "a".repeat(40), repository = "Faysk/tda";
const run = { id: 10, name: "CI", path: ".github/workflows/ci.yml", head_sha: sha,
  head_branch: "main", event: "push", head_repository: { full_name: repository },
  status: "completed", conclusion: "success" };
const jobs = REQUIRED_MAIN_CI_JOBS.map((name) => ({ name, status: "completed", conclusion: "success" }));
const evaluate = (runs, rows = jobs, count = rows.length, total = runs.length) =>
  latestMainCiReceipt({ total_count: total, workflow_runs: runs },
    Object.fromEntries(runs.map((r) => [r.id, { total_count: count, jobs: rows }])), sha, repository);

test("exact main CI requires current successful core jobs and complete pagination", () => {
  assert.equal(evaluate([run]).id, run.id);
  assert.equal(evaluate([run], jobs, jobs.length + 1), null);
  assert.equal(evaluate([run], jobs, jobs.length, 101), null);
  assert.equal(evaluate([run], jobs.slice(1)), null);
  assert.equal(evaluate([run], [...jobs, jobs[0]]), null);
});

test("newer pending or failed main CI cannot reuse old successful receipt", () => {
  for (const newer of [{ status: "in_progress", conclusion: null },
    { status: "completed", conclusion: "failure" }])
    assert.equal(evaluate([run, { ...run, id: 11, ...newer }]), null);
});

test("wrong source, workflow, event or repository does not authorize publication", () => {
  for (const mutation of [{ head_sha: "b".repeat(40) }, { event: "pull_request" },
    { head_branch: "feature" }, { path: ".github/workflows/other.yml" },
    { head_repository: { full_name: "other/fork" } }, { id: "10" }])
    assert.equal(evaluate([{ ...run, ...mutation }]), null);
});

test("failed optional jobs and skipped core checks block the receipt", () => {
  assert.equal(evaluate([run], [...jobs, { name: "navigation-e2e", status: "completed", conclusion: "failure" }]), null);
  assert.equal(evaluate([run], jobs.map((job, i) => i ? job : { ...job, conclusion: "skipped" })), null);
  assert.equal(evaluate([run], [...jobs, { name: "unaffected-domain", status: "completed", conclusion: "skipped" }]).id, run.id);
});

test("both controllers check latest CI before production credentials or builds", () => {
  for (const [file, boundary] of [["production-cd.yml", "Require explicit human Production approval"],
    ["deploy-main-preview.yml", "Pull the existing Production environment"]]) {
    const source = readFileSync(`.github/workflows/${file}`, "utf8");
    const guard = source.indexOf("node tools/ci/require-main-ci.mjs");
    assert.ok(guard > 0 && guard < source.indexOf(boundary));
  }
});
