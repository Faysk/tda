import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// #1663 is an offline, deterministic triage summarizer.
// It deliberately has no gh CLI, tokens, comments, HTTP calls or notification side effects.
export const TRIAGE_POLICY_VERSION = "2026-10-13-triage-v1";
const allowedSeverities = new Set(["critical", "high", "medium", "low"]);

function sha(value) { return typeof value === "string" && /^[0-9a-f]{40}$/.test(value); }
function safe(value) {
  return String(value ?? "").replace(/[\r\n|]/g, " ").replaceAll(String.fromCharCode(96), "'").slice(0, 180);
}
function riskReason(input) {
  const pr = input?.pr || {};
  const sameSha = sha(pr.head_sha);
  if (pr.state !== "open" || !sameSha || pr.repo !== "Faysk/tda" ||
      pr.head_repo !== "Faysk/tda" || pr.author !== "dependabot[bot]") return {
    classification: "stale", cause: "invalid-current-pr-identity",
    evidence: "PR state, origin, author or current SHA unverified",
  };
  if (input.advisory?.status === "confirmed" &&
      input.advisory.head_sha === pr.head_sha &&
      ["critical", "high"].includes(input.advisory.severity)) {
    return {
      classification: "security-critical", cause: "confirmed-high-severity-advisory",
      evidence: "Verified advisory severity " + input.advisory.severity + " at exact PR head",
    };
  }
  if (input.advisory?.status === "confirmed" &&
      input.advisory.head_sha === pr.head_sha &&
      ["medium", "low"].includes(input.advisory.severity)) {
    return {
      classification: "needs-human", cause: "confirmed-advisory-requires-review",
      evidence: "Known advisory requires owner review; passing tests are not clearance",
    };
  }
  if (input.lock?.status === "direct-lock-mismatch" &&
      input.lock.head_sha === pr.head_sha) {
    return {
      classification: "blocked-by-lock", cause: "direct-lock-mismatch",
      evidence: "Manifest and direct test lock disagree at PR head; refresh deterministic lock",
    };
  }
  if (input.ci?.head_sha === pr.head_sha &&
      ["failure", "timed_out", "cancelled"].includes(input.ci?.conclusion)) {
    return {
      classification: "failed-tests", cause: "ci-not-success",
      evidence: "CI is " + input.ci.conclusion + " at PR head; diagnose failed job before retry",
    };
  }
  if (!input.advisory || input.advisory.status === "unknown" ||
      input.advisory.status === "unavailable" ||
      input.advisory.head_sha !== pr.head_sha ||
      !["confirmed", "clear-verified"].includes(input.advisory.status) ||
      (input.advisory.status === "confirmed" && !allowedSeverities.has(input.advisory.severity))) {
    return { classification: "needs-human", cause: "security-evidence-unknown",
      evidence: "Advisory data missing, stale or unverified; never infer secure" };
  }
  if (input.lock?.status !== "consistent-verified" ||
      input.lock?.head_sha !== pr.head_sha) {
    return { classification: "needs-human", cause: "lock-evidence-unknown",
      evidence: "Cannot establish reproducible dependency lock at this PR head" };
  }
  if (input.ci?.head_sha !== pr.head_sha || input.ci?.conclusion !== "success" ||
      input.codeql?.head_sha !== pr.head_sha || input.codeql?.conclusion !== "success" ||
      input.ci?.complete !== true) {
    return { classification: "needs-human", cause: "ci-codeql-evidence-incomplete",
      evidence: "CI or CodeQL success cannot be proven at exact current SHA" };
  }
  return { classification: "ready-for-review", cause: "ci-and-security-evidence-current",
    evidence: "Core CI and CodeQL success; additional required checks, approvals and branch rules remain external" };
}
export function triageDependencyPr(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Expected one PR snapshot");
  const pr = input.pr || {};
  const number = Number.isInteger(pr.number) && pr.number > 0 ? pr.number : null;
  const verdict = riskReason(input);
  // Fingerprint changes when the underlying advisory or failing-job cause
  // changes, but never keys on delivery order, run attempt, or timestamps.
  const advisory = input.advisory?.status === "confirmed" && input.advisory.head_sha === pr.head_sha ?
    input.advisory : null;
  const advisoryId = typeof advisory?.id === "string" && /^[A-Za-z0-9-]{1,80}$/.test(advisory.id) ?
    advisory.id : "unknown-advisory";
  const failedJobs = input.ci?.head_sha === pr.head_sha && Array.isArray(input.ci.failed_jobs) ?
    [...new Set(input.ci.failed_jobs.filter((n) => typeof n === "string" &&
      /^[A-Za-z0-9_-]{1,100}$/.test(n)))].sort() : [];
  const seed = [
    TRIAGE_POLICY_VERSION, "Faysk/tda", number ?? "unknown", sha(pr.head_sha) ? pr.head_sha : "missing",
    verdict.classification, verdict.cause, advisory?.severity ?? "no-confirmed-advisory",
    advisory ? advisoryId : "", ...failedJobs,
  ].join(":");
  const fingerprint = createHash("sha256").update(seed).digest("hex");
  return {
    schema_version: 1,
    policy: TRIAGE_POLICY_VERSION,
    repository: "Faysk/tda",
    pr_number: number,
    head_sha: sha(pr.head_sha) ? pr.head_sha : null,
    classification: verdict.classification,
    cause: verdict.cause,
    evidence: verdict.evidence,
    fingerprint,
    advisory_clearance_verified: input.advisory?.status === "clear-verified" &&
      input.advisory.head_sha === pr.head_sha,
    action: "manual-investigation-only",
    permits_merge: false,
    permits_release: false,
  };
}
export function batchTriage(inputs) {
  if (!Array.isArray(inputs) || inputs.length > 100) throw new TypeError("Expected up to 100 snapshots");
  const out = inputs.map((x) => triageDependencyPr(x));
  if (out.some((x) => x.pr_number === null)) throw new Error("Unknown PR number");
  const seen = new Map();
  for (const x of out) {
    const previous = seen.get(x.pr_number);
    // Idempotent event re-delivery: same PR + same fingerprint is one record.
    if (previous && previous.fingerprint !== x.fingerprint)
      throw new Error("Conflicting snapshots for PR: " + x.pr_number);
    seen.set(x.pr_number, x);
  }
  return [...seen.values()].sort((a, b) => a.pr_number - b.pr_number);
}
export function markdownDigest(records) {
  const sorted = [...records].sort((a, b) => (a.pr_number ?? 0) - (b.pr_number ?? 0));
  const lines = [
    "## Dependabot triage — offline advisory report",
    "No issues, PR comments, checks, labels, emails, merges or deployments were changed.",
    "Advisory information is only as trustworthy as the supplied snapshot.",
    "",
    "| PR | Classification | Cause | Head SHA | Fingerprint |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of sorted) {
    lines.push("| " + [r.pr_number, r.classification, r.cause, r.head_sha || "unknown",
      r.fingerprint.slice(0, 16)].map(safe).join(" | ") + " |");
  }
  return lines.join("\n") + "\n";
}
function main() {
  if (process.argv.length !== 3 || !process.argv[2].endsWith(".json")) {
    throw new Error("Usage: node tools/ci/dependency-triage.mjs <synthetic-snapshots.json>");
  }
  const content = readFileSync(process.argv[2], "utf8");
  if (content.length > 1024 * 1024) throw new Error("Fixture too large");
  const snapshots = JSON.parse(content);
  const records = batchTriage(Array.isArray(snapshots) ? snapshots : [snapshots]);
  process.stdout.write(markdownDigest(records));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
