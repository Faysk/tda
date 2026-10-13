import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const requiredJobs = ["classify-changes", "workflow-contract", "validate", "ci-gate", "required-ci"];

function safe(value) {
  return String(value ?? "").replace(/[\r\n|]/g, " ").replaceAll(String.fromCharCode(96), "'").slice(0, 160);
}
function exactSha(value) { return /^[0-9a-f]{40}$/.test(value ?? ""); }
function sameRepo(run, repo) { return run?.head_repository?.full_name === repo; }
function samePr(run, num) {
  return Array.isArray(run?.pull_requests) && run.pull_requests.some((p) => p?.number === num);
}
function jobState(jobs, name) {
  const rows = jobs.filter((j) => j?.name === name);
  if (rows.length !== 1) return rows.length ? "ambiguous" : "missing";
  return rows[0].status === "completed" ? (rows[0].conclusion || "unknown") : "pending";
}
function codeqlState(runs, repo, sha, prNumber) {
  const list = (runs || []).filter((r) =>
    r?.event === "pull_request" && r?.head_sha === sha &&
    sameRepo(r, repo) && samePr(r, prNumber) &&
    (r?.path || "").endsWith("/codeql.yml"));
  if (!list.length) return "missing";
  list.sort((a, b) => (a.run_started_at || a.created_at || "").localeCompare(b.run_started_at || b.created_at || "") ||
    (a.id || 0) - (b.id || 0));
  const latest = list[list.length - 1];
  return latest.status === "completed" ? (latest.conclusion || "unknown") : "pending";
}
export function evaluateEvidence({ repository, pr, run, jobs = [], codeqlRuns = [], completeJobs = true, completeCodeql = true }) {
  const sha = run?.head_sha, prNumber = pr?.number, failures = [];
  if (!exactSha(sha)) failures.push("invalid-source-sha");
  if (run?.name !== "CI" || run?.event !== "pull_request") failures.push("wrong-trigger");
  if (!(run?.path || "").endsWith("/ci.yml")) failures.push("wrong-ci-workflow-file");
  if (!sameRepo(run, repository)) failures.push("foreign-workflow-origin");
  if (!Number.isInteger(prNumber) || prNumber < 1 || !samePr(run, prNumber))
    failures.push("ambiguous-pr-identity");
  if (pr?.state !== "open" || pr?.head?.sha !== sha || pr?.head?.repo?.full_name !== repository)
    failures.push("stale-or-foreign-pr-head");
  if (pr?.user?.login !== "dependabot[bot]") failures.push("not-dependabot-pr");
  const required = Object.fromEntries(requiredJobs.map((name) => [name, jobState(jobs, name)]));
  const codeql = codeqlState(codeqlRuns, repository, sha, prNumber);
  const ci = run?.status === "completed" ? (run?.conclusion || "unknown") : "pending";
  let state = "ready-for-human-review";
  if (failures.length) state = "invalid-identity";
  else if ((ci !== "success" && ci !== "pending") ||
    Object.values(required).some((value) => !["success", "pending"].includes(value)) ||
    !["success", "pending", "missing"].includes(codeql)) state = "blocked";
  else if (!completeJobs || !completeCodeql || ci === "pending" || Object.values(required).includes("pending") ||
    codeql === "pending" || codeql === "missing") state = "pending-or-unknown";
  return {
    schema_version: 1, repository, pr_number: prNumber, head_sha: sha,
    ci_run_id: run?.id, ci, required_jobs: required, codeql, state,
    reasons: failures, approval: "human-required", production: "not-authorized",
    jobs_observed: jobs.length, jobs_complete: completeJobs, codeql_complete: completeCodeql,
  };
}
export function renderEvidenceMarkdown(evidence) {
  const lines = [
    "## Dependabot evidence ledger — read-only",
    "- PR: #" + safe(evidence.pr_number) + "; source SHA: " + safe(evidence.head_sha),
    "- CI run: " + safe(evidence.ci_run_id) + "; CI: " + safe(evidence.ci),
    "- CodeQL: " + safe(evidence.codeql),
    "- State: **" + safe(evidence.state) + "** (never automatic merge approval)",
    "- Human review: **required**; Production/Stable: **not authorized**.",
    "- Identity/provenance errors: " + (evidence.reasons.map(safe).join(", ") || "none"),
    "",
    "| Required job | Verified conclusion |", "| --- | --- |",
  ];
  for (const [key, value] of Object.entries(evidence.required_jobs))
    lines.push("| " + safe(key) + " | " + safe(value) + " |");
  lines.push("", "Status is scoped to the named CI run and exact PR head, not historical green runs. Missing/skipped/ambiguous/stale results never confer readiness.", "");
  return lines.join("\n");
}
function api(path) {
  const raw = execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  return JSON.parse(raw);
}
function collectJobs(repo, runId) {
  const jobs = [];
  for (let page = 1; page <= 10; page++) {
    const path = "repos/" + repo + "/actions/runs/" + runId + "/jobs?per_page=100&page=" + page + "&filter=latest";
    const data = api(path);
    if (!Array.isArray(data.jobs)) throw new Error("JOBS_NOT_ARRAY");
    jobs.push(...data.jobs);
    if (jobs.length >= 1000) throw new Error("JOBS_PAGINATION_LIMIT");
    if (data.jobs.length < 100) return { jobs, completeJobs: data.total_count <= jobs.length };
  }
  throw new Error("JOBS_PAGINATION_LIMIT");
}
function main() {
  const repo = process.env.GITHUB_REPOSITORY, runId = process.env.SOURCE_RUN_ID;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "") || !/^\d+$/.test(runId || ""))
    throw new Error("REPOSITORY_OR_RUN_ID_INVALID");
  const run = api("repos/" + repo + "/actions/runs/" + runId);
  if (run.name !== "CI" || run.event !== "pull_request" || run.status !== "completed")
    throw new Error("NOT_EXACT_COMPLETED_PR_CI");
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) {
    const summary = "## Dependabot evidence ledger\n\nUnknown: CI run does not uniquely identify one PR; no readiness inferred.\n";
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(summary);
    return;
  }
  const prNumber = run.pull_requests[0]?.number;
  if (!Number.isInteger(prNumber)) throw new Error("PR_NUMBER_INVALID");
  const pr = api("repos/" + repo + "/pulls/" + prNumber);
  if (pr.user?.login !== "dependabot[bot]") {
    process.stdout.write("Not a Dependabot PR; no dependency evidence required.\n");
    return;
  }
  const { jobs, completeJobs } = collectJobs(repo, runId);
  const codeqlResponse = api("repos/" + repo + "/actions/workflows/codeql.yml/runs?head_sha=" +
    run.head_sha + "&event=pull_request&per_page=100");
  const codeql = codeqlResponse.workflow_runs || [];
  const completeCodeql = Number.isInteger(codeqlResponse.total_count) && codeqlResponse.total_count <= codeql.length;
  const evidence = evaluateEvidence({ repository: repo, pr, run, jobs, completeJobs, codeqlRuns: codeql, completeCodeql });
  const markdown = renderEvidenceMarkdown(evidence);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  if (evidence.state === "invalid-identity") throw new Error("DEPENDABOT_EVIDENCE_IDENTITY_MISMATCH");
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
