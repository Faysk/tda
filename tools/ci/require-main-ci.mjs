import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REQUIRED_MAIN_CI_JOBS = Object.freeze([
  "classify-changes", "workflow-contract", "validate", "ci-gate", "required-ci",
]);

export function sameMainCiRun(run, sha, repository) {
  return /^[a-f0-9]{40}$/.test(sha || "") &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "") &&
    Number.isSafeInteger(run?.id) && run.id > 0 && run.name === "CI" &&
    run.path === ".github/workflows/ci.yml" && run.head_sha === sha &&
    run.head_branch === "main" && run.event === "push" &&
    run.head_repository?.full_name === repository;
}

export function completeMainCiJobs(page) {
  if (!Number.isSafeInteger(page?.total_count) || !Array.isArray(page.jobs) ||
      page.total_count !== page.jobs.length || page.jobs.length < REQUIRED_MAIN_CI_JOBS.length)
    return false;
  if (!page.jobs.every((job) => job?.status === "completed" &&
      ["success", "skipped"].includes(job.conclusion))) return false;
  return REQUIRED_MAIN_CI_JOBS.every((name) => {
    const matches = page.jobs.filter((job) => job.name === name);
    return matches.length === 1 && matches[0].conclusion === "success";
  });
}

export function latestMainCiReceipt(page, jobsById, sha, repository) {
  if (!Number.isSafeInteger(page?.total_count) || !Array.isArray(page.workflow_runs) ||
      page.total_count !== page.workflow_runs.length) return null;
  const latest = page.workflow_runs.filter((run) => sameMainCiRun(run, sha, repository))
    .sort((a, b) => b.id - a.id)[0];
  return latest?.status === "completed" && latest.conclusion === "success" &&
    completeMainCiJobs(jobsById?.[latest.id]) ? latest : null;
}

function api(path) {
  return JSON.parse(execFileSync("gh", ["api", "--method", "GET", path], {
    encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  }));
}

function main() {
  const sha = process.env.SOURCE_SHA;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[a-f0-9]{40}$/.test(sha || "") ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || ""))
    throw new Error("EXACT_MAIN_CI_REQUIRED: invalid source identity");
  // Do not filter completed runs: a newer pending/failed run invalidates old green.
  const page = api(`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`);
  const latest = (page.workflow_runs || []).filter((run) => sameMainCiRun(run, sha, repository))
    .sort((a, b) => b.id - a.id)[0];
  if (latest?.status !== "completed" || latest.conclusion !== "success")
    throw new Error("EXACT_MAIN_CI_REQUIRED: latest run not successful");
  const jobs = api(`repos/${repository}/actions/runs/${latest.id}/jobs?per_page=100&filter=latest`);
  const receipt = latestMainCiReceipt(page, { [latest.id]: jobs }, sha, repository);
  if (!receipt) throw new Error("EXACT_MAIN_CI_REQUIRED: incomplete or ambiguous evidence");
  console.log(`EXACT_MAIN_CI_OK sha=${sha} run=${receipt.id}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
