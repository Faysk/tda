import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// #1662 intentionally has NO GitHub API write, merge, dispatch or token capability.
// JSON is untrusted evidence. Even if every gate passes, output stays a dry run.
export const POLICY_VERSION = "2026-10-13-dryrun-v1";
const lowRiskTools = new Set(["prettier", "eslint-config-prettier"]);
const required = new Set(["required-ci", "ci-gate", "workflow-contract", "validate", "CodeQL"]);

function sha(value) { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function patch(from, to) {
  const a = /^(\d+)\.(\d+)\.(\d+)$/.exec(from || "");
  const b = /^(\d+)\.(\d+)\.(\d+)$/.exec(to || "");
  return Boolean(a && b && a[1] === b[1] && a[2] === b[2] && Number(b[3]) > Number(a[3]));
}
function normalizedPaths(paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  if (!paths.every((p) => typeof p === "string" && p.length && !p.includes("\\") &&
      !p.startsWith("/") && !p.includes(".."))) return null;
  return [...new Set(paths)].sort();
}
function findings(row) {
  const problems = [];
  const add = (name) => problems.push(name);
  const pr = row?.pr || {};
  const head = pr.head_sha;
  if (pr.author !== "dependabot[bot]") add("not-dependabot");
  if (pr.state !== "open" || pr.draft !== false) add("not-open-reviewable");
  if (pr.repo !== "Faysk/tda" || pr.head_repo !== "Faysk/tda" || pr.base !== "main") add("untrusted-repository-or-base");
  if (!sha(head)) add("missing-exact-sha");
  if (pr.mergeable !== true) add("not-verified-mergeable");
  const paths = normalizedPaths(row?.paths);
  if (!paths) add("changed-paths-unknown");
  else if (paths.some((p) => !["package.json", "pnpm-lock.yaml"].includes(p))) add("unexpected-change-path");
  if (!paths?.includes("package.json") || !paths?.includes("pnpm-lock.yaml")) add("manifest-lock-parity-unknown");

  const dependencies = row?.dependencies;
  if (!Array.isArray(dependencies) || !dependencies.length) add("dependency-diff-unknown");
  else {
    for (const d of dependencies) {
      if (!d || d.ecosystem !== "npm" || d.scope !== "devDependencies" ||
          !lowRiskTools.has(d.name) || !patch(d.from, d.to)) {
        add("non-allowlisted-or-nonpatch-dependency");
        break;
      }
    }
  }
  if (row?.lock_integrity !== "verified-exact") add("lock-integrity-not-verified");
  const evidence = row?.checks || {};
  if (evidence.head_sha !== head || !sha(evidence.head_sha) || evidence.complete !== true)
    add("checks-incomplete-or-stale");
  if (!Array.isArray(evidence.jobs)) add("checks-unknown");
  else {
    const seen = new Set();
    for (const j of evidence.jobs) {
      if (typeof j?.name !== "string" || seen.has(j.name) || !sha(j.sha) ||
          j.sha !== head || j.conclusion !== "success") {
        add("checks-failed-skipped-duplicated-or-foreign");
        break;
      }
      seen.add(j.name);
    }
    if ([...required].some((job) => !seen.has(job))) add("required-check-missing");
  }
  if (row?.advisories?.status !== "clear-verified" ||
      row?.advisories?.head_sha !== head) add("advisories-unknown-or-stale");
  if (row?.branch_protection?.status !== "admin-verified" ||
      row?.branch_protection?.head_sha !== head) add("branch-rules-not-proven");
  if (row?.approvals?.reviewed_by_owner !== true ||
      row?.approvals?.opt_in_to_future_policy !== true) add("human-consent-not-proven");
  if (row?.freshness?.status !== "success" || row?.freshness?.head_sha !== head)
    add("freshness-unknown-or-stale");
  return [...new Set(problems)].sort();
}
export function evaluateAutoMergeDryRun(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Expected one input record");
  const reasons = findings(input);
  return {
    policy_version: POLICY_VERSION,
    pr_number: Number.isInteger(input.pr?.number) ? input.pr.number : null,
    head_sha: sha(input.pr?.head_sha) ? input.pr.head_sha : null,
    outcome: reasons.length ? "blocked" : "hypothetical-low-risk-candidate",
    action: "no-merge-dry-run",
    authorized_to_merge: false,
    remote_policy_attested: false,
    reasons,
    note: "Input JSON is unauthenticated; branch rules and reviewer identity require separate authoritative checks. No output grants release permission.",
  };
}
export function evaluateBatch(inputs) {
  if (!Array.isArray(inputs)) throw new TypeError("Expected an array of input records");
  if (inputs.length > 100) throw new RangeError("Batch exceeds 100 items");
  const numbers = new Set();
  const results = inputs.map((row) => evaluateAutoMergeDryRun(row));
  for (const row of results) {
    if (row.pr_number === null || numbers.has(row.pr_number)) throw new Error("Duplicate or invalid PR number");
    numbers.add(row.pr_number);
  }
  return results.sort((a, b) => a.pr_number - b.pr_number);
}

function main() {
  if (process.argv.length !== 3 || !process.argv[2].endsWith(".json")) {
    throw new Error("Usage: node tools/ci/automerge-dryrun.mjs <local-synthetic-input.json>");
  }
  const contents = readFileSync(process.argv[2], "utf8");
  if (contents.length > 1024 * 1024) throw new Error("Fixture too large");
  const json = JSON.parse(contents);
  process.stdout.write(JSON.stringify(Array.isArray(json) ? evaluateBatch(json) :
    evaluateAutoMergeDryRun(json), null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
