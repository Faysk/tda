import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const requiredJobs = ["classify-changes", "workflow-contract", "validate", "ci-gate", "required-ci"];
const requiredCodeqlJobs = ["analyze (python)", "analyze (javascript-typescript)"];

function safe(value) {
  return String(value ?? "").replace(/[\r\n|]/g, " ").replaceAll(String.fromCharCode(96), "'").slice(0, 160);
}
function exactSha(value) { return /^[0-9a-f]{40}$/.test(value ?? ""); }
function sameRepo(run, repo) { return run?.head_repository?.full_name === repo; }
function samePr(run, num) {
  return Array.isArray(run?.pull_requests) && run.pull_requests.some((p) => p?.number === num);
}
// Compare observed workflow bases against two independent GET snapshots of
// main. Any missing identity or read race stays unknown; an established
// mismatch is stale. Neither outcome grants merge/release permission.
export function checkMainBaseFreshness({ repository, pr, ciRun, codeqlRun, mainBeforeSha, mainAfterSha }) {
  const unknown = { status: "unknown", current_main_sha: exactSha(mainAfterSha) ? mainAfterSha : null };
  if (!exactSha(mainBeforeSha) || !exactSha(mainAfterSha) ||
      mainBeforeSha !== mainAfterSha) return unknown;
  const ciPrs = ciRun?.pull_requests;
  const codeqlPrs = codeqlRun?.pull_requests;
  if (!Array.isArray(ciPrs) || ciPrs.length !== 1 ||
      !Array.isArray(codeqlPrs) || codeqlPrs.length !== 1 ||
      ciPrs[0]?.number !== pr?.number || codeqlPrs[0]?.number !== pr?.number)
    return unknown;
  const rows = [pr?.base, ciPrs[0]?.base, codeqlPrs[0]?.base];
  if (rows.some((r) => !exactSha(r?.sha) || typeof r?.ref !== "string"))
    return unknown;
  if (rows.some((r) => r.ref !== "main") ||
      pr?.base?.repo?.full_name !== repository ||
      rows.some((r) => r.sha !== mainAfterSha))
    return { status: "stale-base", current_main_sha: mainAfterSha };
  return { status: "verified-current-main", current_main_sha: mainAfterSha };
}
function jobState(jobs, name) {
  const rows = jobs.filter((j) => j?.name === name);
  if (rows.length !== 1) return rows.length ? "ambiguous" : "missing";
  return rows[0].status === "completed" ? (rows[0].conclusion || "unknown") : "pending";
}
function latestCodeqlRun(runs, repo, sha, prNumber) {
  const list = (runs || []).filter((r) =>
    r?.event === "pull_request" && r?.head_sha === sha &&
    sameRepo(r, repo) && samePr(r, prNumber) &&
    (r?.path || "").endsWith("/codeql.yml"));
  if (!list.length) return null;
  list.sort((a, b) => (a.run_started_at || a.created_at || "").localeCompare(b.run_started_at || b.created_at || "") ||
    (a.id || 0) - (b.id || 0));
  const latest = list[list.length - 1];
  return latest;
}
export function evaluateEvidence({
  repository, pr, run, jobs = [], codeqlRuns = [], codeqlJobs = [],
  codeqlJobsRunId = null, completeJobs = true, completeCodeql = true,
  completeCodeqlJobs = false, mainBeforeSha = null, mainAfterSha = null,
}) {
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
  const latestCodeql = latestCodeqlRun(codeqlRuns, repository, sha, prNumber);
  const baseFreshness = checkMainBaseFreshness({
    repository, pr, ciRun: run, codeqlRun: latestCodeql, mainBeforeSha, mainAfterSha,
  });
  const codeql = !latestCodeql ? "missing" :
    latestCodeql.status === "completed" ? (latestCodeql.conclusion || "unknown") : "pending";
  const codeqlJobsCurrent = Number.isSafeInteger(latestCodeql?.id) &&
    latestCodeql.id > 0 && codeqlJobsRunId === latestCodeql.id && completeCodeqlJobs;
  const codeqlRequired = Object.fromEntries(requiredCodeqlJobs.map((name) =>
    [name, codeqlJobsCurrent ? jobState(codeqlJobs, name) : "unknown"]));
  const codeqlRequiredFailed = codeql === "success" && codeqlJobsCurrent &&
    Object.values(codeqlRequired).some((state) => state !== "success" && state !== "pending");
  const codeqlRequiredPending = codeql === "success" &&
    (!codeqlJobsCurrent || Object.values(codeqlRequired).includes("pending"));
  const ci = run?.status === "completed" ? (run?.conclusion || "unknown") : "pending";
  let state = "core-ci-verified-external-checks-unverified";
  if (failures.length) state = "invalid-identity";
  else if ((ci !== "success" && ci !== "pending") ||
    Object.values(required).some((value) => !["success", "pending"].includes(value)) ||
    !["success", "pending", "missing"].includes(codeql) ||
    codeqlRequiredFailed || baseFreshness.status === "stale-base") state = "blocked";
  else if (!completeJobs || !completeCodeql || ci === "pending" || Object.values(required).includes("pending") ||
    codeql === "pending" || codeql === "missing" || codeqlRequiredPending ||
    baseFreshness.status !== "verified-current-main") state = "pending-or-unknown";
  return {
    schema_version: 1, repository, pr_number: prNumber, head_sha: sha,
    ci_run_id: run?.id, ci, required_jobs: required, codeql, state,
    codeql_run_id: latestCodeql?.id ?? null, codeql_required_jobs: codeqlRequired,
    base_freshness: baseFreshness.status, current_main_sha: baseFreshness.current_main_sha,
    ci_tested_base_sha: run?.pull_requests?.length === 1 ? run.pull_requests[0]?.base?.sha ?? null : null,
    codeql_tested_base_sha: latestCodeql?.pull_requests?.length === 1 ?
      latestCodeql.pull_requests[0]?.base?.sha ?? null : null,
    reasons: failures, approval: "human-required", production: "not-authorized",
    external_checks: "not-queried", branch_protection: "not-verified", freshness: "not-queried",
    jobs_observed: jobs.length, jobs_complete: completeJobs, codeql_complete: completeCodeql,
    codeql_jobs_complete: codeqlJobsCurrent,
  };
}
export function renderEvidenceMarkdown(evidence) {
  const lines = [
    "## Dependabot evidence ledger — read-only",
    "- PR: #" + safe(evidence.pr_number) + "; source SHA: " + safe(evidence.head_sha),
    "- CI run: " + safe(evidence.ci_run_id) + "; CI: " + safe(evidence.ci),
    "- CodeQL: " + safe(evidence.codeql) + "; run: " + safe(evidence.codeql_run_id),
    "- Required CodeQL language jobs complete on exact run: " + safe(evidence.codeql_jobs_complete),
    "- Main base freshness: " + safe(evidence.base_freshness) +
      " (main " + safe(evidence.current_main_sha) +
      "; CI base " + safe(evidence.ci_tested_base_sha) +
      "; CodeQL base " + safe(evidence.codeql_tested_base_sha) + ")",
    "- State: **" + safe(evidence.state) + "** (never automatic merge approval)",
    "- Human review: **required**; Production/Stable: **not authorized**.",
    "- External checks, dependency freshness and branch protections: **not verified** by this ledger.",
    "- Identity/provenance errors: " + (evidence.reasons.map(safe).join(", ") || "none"),
    "",
    "| Required job | Verified conclusion |", "| --- | --- |",
  ];
  for (const [key, value] of Object.entries(evidence.required_jobs))
    lines.push("| " + safe(key) + " | " + safe(value) + " |");
  for (const [key, value] of Object.entries(evidence.codeql_required_jobs))
    lines.push("| CodeQL: " + safe(key) + " | " + safe(value) + " |");
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
  function mainShaReadOnly() {
    try {
      const row = api("repos/" + repo + "/branches/main");
      return exactSha(row?.commit?.sha) ? row.commit.sha : null;
    } catch { return null; }
  }
  // First read precedes all potentially long paginated CI/CodeQL calls.
  const mainBeforeSha = mainShaReadOnly();
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
  // A green CodeQL workflow can hide a skipped/missing matrix language.
  // Query only the selected same-repository PR+SHA workflow run, read-only.
  const selected = latestCodeqlRun(codeql, repo, run.head_sha, prNumber);
  let codeqlJobs = [], completeCodeqlJobs = false;
  if (Number.isSafeInteger(selected?.id) && selected.id > 0) {
    try {
      ({ jobs: codeqlJobs, completeJobs: completeCodeqlJobs } = collectJobs(repo, selected.id));
    } catch {
      // Fail closed as unknown when Actions API is inaccessible or paginated
      // incompletely; never reuse a previous run's language results.
      process.stderr.write("CodeQL job-level evidence unavailable; reporting unknown.\n");
    }
  }
  // Second read must agree with the first. A moving main invalidates the
  // local observation window; branch protection and merge readiness are
  // outside this read-only ledger's authority.
  const mainAfterSha = mainShaReadOnly();
  const evidence = evaluateEvidence({ repository: repo, pr, run, jobs, completeJobs,
    codeqlRuns: codeql, completeCodeql, codeqlJobs, completeCodeqlJobs,
    codeqlJobsRunId: selected?.id ?? null, mainBeforeSha, mainAfterSha });
  const markdown = renderEvidenceMarkdown(evidence);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  if (evidence.state === "invalid-identity") throw new Error("DEPENDABOT_EVIDENCE_IDENTITY_MISMATCH");
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
