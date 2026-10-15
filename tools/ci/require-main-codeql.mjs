import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Release gate for the *post-merge* push/main commit, not an earlier PR head.
// A workflow-level success alone is insufficient if matrix jobs were skipped.
export const REQUIRED_CODEQL_MAIN_JOBS = Object.freeze([
  "analyze (javascript-typescript)",
  "analyze (python)",
]);

export function isSameMainCodeqlRun(run, sha, repository) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) &&
    typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
    run != null && Number.isSafeInteger(run.id) && run.id > 0 &&
    run.name === "CodeQL" && run.path === ".github/workflows/codeql.yml" &&
    run.head_sha === sha && run.head_branch === "main" &&
    run.head_repository?.full_name === repository &&
    run.event === "push";
}

export function isExactMainCodeqlRun(run, sha, repository) {
  return isSameMainCodeqlRun(run, sha, repository) &&
    run.status === "completed" && run.conclusion === "success";
}

export function codeqlMainMatrixSucceeded(jobs) {
  // Only the expected exact two language jobs may authorize Production.
  // A duplicate/contradictory job or an unknown extra job must fail closed.
  if (!Array.isArray(jobs) || jobs.length !== REQUIRED_CODEQL_MAIN_JOBS.length)
    return false;
  return REQUIRED_CODEQL_MAIN_JOBS.every((required) =>
    jobs.filter((job) => job?.name === required).length === 1 &&
    jobs.some((job) => job?.name === required &&
      job.status === "completed" && job.conclusion === "success"));
}

export function completeCodeqlJobsPage(page) {
  // The REST jobs API is paginated; a truncated first page is not evidence.
  return Number.isSafeInteger(page?.total_count) &&
    page.total_count === REQUIRED_CODEQL_MAIN_JOBS.length &&
    Array.isArray(page.jobs) &&
    page.jobs.length === page.total_count &&
    codeqlMainMatrixSucceeded(page.jobs);
}

export function findExactMainCodeqlReceipt(runs, jobsById, sha, repository) {
  if (!Array.isArray(runs) || !jobsById || typeof jobsById !== "object") return null;
  // Old green runs must never override a newer pending/failed run
  // for the same push/main source. GitHub run IDs increase with creation.
  const latest = runs.filter((run) => isSameMainCodeqlRun(run, sha, repository))
    .sort((a, b) => b.id - a.id)[0];
  return latest && isExactMainCodeqlRun(latest, sha, repository) &&
    codeqlMainMatrixSucceeded(jobsById[String(latest.id)]) ? latest : null;
}

function githubApi(path) {
  return JSON.parse(execFileSync("gh", ["api", path], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  }));
}

function main() {
  const sha = process.env.SOURCE_SHA || "";
  const repository = process.env.GITHUB_REPOSITORY || "";
  if (!/^[0-9a-f]{40}$/.test(sha) ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("PRODUCTION_EXACT_MAIN_CODEQL_REQUIRED: invalid commit/repository");

  const payload = githubApi(
    `/repos/${repository}/actions/workflows/codeql.yml/runs?head_sha=${sha}&event=push&per_page=100`);
  const candidates = (payload.workflow_runs || [])
    .filter((run) => isSameMainCodeqlRun(run, sha, repository))
    .sort((a, b) => b.id - a.id);
  const latest = candidates[0];
  if (!isExactMainCodeqlRun(latest, sha, repository))
    throw new Error("PRODUCTION_EXACT_MAIN_CODEQL_REQUIRED: latest run not successful");
  const jobPayload = githubApi(
    `/repos/${repository}/actions/runs/${latest.id}/jobs?per_page=100`);
  if (!completeCodeqlJobsPage(jobPayload))
    throw new Error("PRODUCTION_EXACT_MAIN_CODEQL_REQUIRED: matrix jobs incomplete or ambiguous");
  const receipt = findExactMainCodeqlReceipt(candidates,
    { [String(latest.id)]: jobPayload.jobs }, sha, repository);
  if (!receipt) throw new Error("PRODUCTION_EXACT_MAIN_CODEQL_REQUIRED");
  console.log(`PRODUCTION_EXACT_MAIN_CODEQL_OK sha=${sha} run=${receipt.id} jobs=${REQUIRED_CODEQL_MAIN_JOBS.join(",")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
