import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { verifyRcManifest } from "./rc-attestation-consumer.mjs";

// #1667: read-only GitHub Actions signer-run identity lookup. This is a
// separate CLI so the original attest-only interface is not silently changed.
// A caller-provided run ID is NEVER evidence by itself; inspect its GitHub
// metadata and use its actual head SHA for gh's --signer-digest restriction.
const REPO = "Faysk/tda";
const SHA = /^[a-f0-9]{40}$/;
const POLICY = "tda-rc-authenticated-signer-run-v1";
const WORKFLOWS = Object.freeze({
  companion: { name: "Companion RC", path: ".github/workflows/companion-rc.yml" },
  runtime: { name: "Runtime RC", path: ".github/workflows/runtime-rc.yml" },
});
export function validateSignerRun(run, { family, signerRunId }) {
  const expected = WORKFLOWS[family];
  if (!expected) throw new Error("SIGNER_FAMILY_UNKNOWN");
  if (!Number.isSafeInteger(signerRunId) || signerRunId <= 0)
    throw new Error("SIGNER_RUN_ID_INVALID");
  if (!run || typeof run !== "object" || Array.isArray(run))
    throw new Error("SIGNER_RUN_RESPONSE_INVALID");
  if (run.id !== signerRunId) throw new Error("SIGNER_RUN_ID_MISMATCH");
  if (run.name !== expected.name ||
      ![expected.path, expected.path + "@refs/heads/main"].includes(run.path))
    throw new Error("SIGNER_WORKFLOW_IDENTITY_MISMATCH");
  if (run.head_branch !== "main" ||
      !["workflow_run", "workflow_dispatch"].includes(run.event))
    throw new Error("SIGNER_EVENT_OR_BRANCH_UNTRUSTED");
  if (run.status !== "completed" || run.conclusion !== "success")
    throw new Error("SIGNER_RUN_NOT_SUCCESSFUL");
  if (!SHA.test(run.head_sha ?? ""))
    throw new Error("SIGNER_WORKFLOW_SHA_INVALID");
  if (run.repository?.full_name !== REPO ||
      run.head_repository?.full_name !== REPO)
    throw new Error("SIGNER_REPOSITORY_ORIGIN_INVALID");
  if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0)
    throw new Error("SIGNER_RUN_ATTEMPT_INVALID");
  return Object.freeze({
    repository: REPO, signer_run_id: signerRunId, signer_attempt: run.run_attempt,
    signer_workflow: expected.path, signer_workflow_sha: run.head_sha,
  });
}
export function verifyRcFromAuthenticatedSignerRun(
  { family, manifestFile, sourceSha, signerRunId }, runner = execFileSync,
  verifyCandidate = verifyRcManifest,
) {
  if (!WORKFLOWS[family]) throw new Error("SIGNER_FAMILY_UNKNOWN");
  if (!Number.isSafeInteger(signerRunId) || signerRunId <= 0)
    throw new Error("SIGNER_RUN_ID_INVALID");
  let run;
  try {
    // This endpoint is GET-only. No workflow dispatch, release mutation or
    // API write call is possible from this wrapper's argument construction.
    const raw = runner("gh",
      ["api", "repos/" + REPO + "/actions/runs/" + signerRunId],
      { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
    run = JSON.parse(raw);
  } catch {
    throw new Error("SIGNER_RUN_METADATA_UNAVAILABLE");
  }
  const signer = validateSignerRun(run, { family, signerRunId });
  const manifestEvidence = verifyCandidate(
    { family, manifestFile, sourceSha, signerSha: signer.signer_workflow_sha },
    runner,
  );
  if (manifestEvidence?.result !== "verified-github-attestation" ||
      manifestEvidence?.permits_promotion !== false ||
      manifestEvidence?.candidate_source_sha !== sourceSha ||
      manifestEvidence?.signer_workflow_source_sha !== signer.signer_workflow_sha)
    throw new Error("SIGNER_RUN_ATTESTATION_RESULT_INCONSISTENT");
  return {
    schema_version: 1, policy: POLICY,
    signer, candidate: manifestEvidence,
    run_identity: "verified-readonly-github-api",
    github_attestation: "verified-by-gh",
    authorizes_stable: false, authorizes_production: false,
    physical_acceptance: "not-checked", other_assets: "not-checked",
  };
}
function main() {
  if (process.argv.length !== 6) throw new Error(
    "Usage: node tools/ci/rc-signer-run-verify.mjs companion|runtime candidate.json trusted-candidate-source-sha signer-rc-run-id");
  const [, , family, manifestFile, sourceSha, runId] = process.argv;
  if (!/^[1-9]\d*$/.test(runId) || !Number.isSafeInteger(Number(runId)))
    throw new Error("SIGNER_RUN_ID_INVALID");
  const result = verifyRcFromAuthenticatedSignerRun({
    family, manifestFile, sourceSha, signerRunId: Number(runId),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
