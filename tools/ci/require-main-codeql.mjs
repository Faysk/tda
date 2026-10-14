import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Release gate for the *post-merge* push/main commit, not an earlier PR head.
// A workflow-level success alone is insufficient if matrix jobs were skipped.
export const REQUIRED_CODEQL_MAIN_JOBS = Object.freeze([
  "analyze (javascript-typescript)",
  "analyze (python)",
]);

export function isExactMainCodeqlRun(run, sha, repository) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) &&
    typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) &&
    run != null && Number.isSafeInteger(run.id) && run.id > 0 &&
    run.name === "CodeQL" && run.path === ".github/workflows/codeql.yml" &&
    run.head_sha === sha && run.head_branch === "main" &&
    run.head_repository?.full_name === repository &&
    run.event === "push" && run.status === "completed" &&
    run.conclusion === "success";
}

export function codeqlMainMatrixSucceeded(jobs) {
  if (!Array.isArray(jobs)) return false;
  return REQUIRED_CODEQL_MAIN_JOBS.every((required) =>
    jobs.some((job) => job?.name === required &&
      job.status === "completed" && job.conclusion === "success"));
}

export function findExactMainCodeqlReceipt(runs, jobsById, sha, repository) {
  if (!Array.isArray(runs) || !jobsById || typeof jobsById !== "object") return null;
  return runs.find((run) =>
    isExactMainCodeqlRun(run, sha, repository) &&
    codeqlMainMatrixSucceeded(jobsById[String(run.id)])) || null;
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
    `/repos/${repository}/actions/workflows/codeql.yml/runs?head_sha=${sha}&event=push&status=completed&per_page=100`);
  const candidates = (payload.workflow_runs || [])
    .filter((run) => isExactMainCodeqlRun(run, sha, repository));
  const jobsById = Object.create(null);
  for (const run of candidates) {
    const jobPayload = githubApi(
      `/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`);
    jobsById[String(run.id)] = jobPayload.jobs;
    if (codeqlMainMatrixSucceeded(jobPayload.jobs)) break;
  }
  const receipt = findExactMainCodeqlReceipt(candidates, jobsById, sha, repository);
  if (!receipt) throw new Error("PRODUCTION_EXACT_MAIN_CODEQL_REQUIRED");
  console.log(`PRODUCTION_EXACT_MAIN_CODEQL_OK sha=${sha} run=${receipt.id} jobs=${REQUIRED_CODEQL_MAIN_JOBS.join(",")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
