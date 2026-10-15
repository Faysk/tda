import { pathToFileURL } from "node:url";
import { verifyRcFromAuthenticatedSignerRun } from "./rc-signer-run-verify.mjs";
import { verifyLocalRcAssets } from "./rc-local-asset-integrity.mjs";

// Read-only operator diagnostic. It never uploads files, launches model code,
// signs bundles, edits a release, dispatches an Action or promotes Stable.
// This is NOT a publication gate or permission decision.
export const AUDIT_POLICY = "tda-rc-combined-evidence-v1";
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
function validInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("RC_AUDIT_ARGUMENTS_INVALID");
  const { family, manifestFile, assetsRoot, sourceSha, signerRunId } = input;
  if (!["companion", "runtime"].includes(family) ||
      typeof manifestFile !== "string" || !manifestFile ||
      typeof assetsRoot !== "string" || !assetsRoot ||
      !SHA.test(sourceSha ?? "") ||
      !Number.isSafeInteger(signerRunId) || signerRunId <= 0)
    throw new Error("RC_AUDIT_ARGUMENTS_INVALID");
}
function checkReports(signed, local, input) {
  const candidate = signed?.candidate;
  const signer = signed?.signer;
  if (signed?.run_metadata !== "verified-readonly-github-api" ||
      signed?.github_attestation !== "verified-by-gh-at-workflow-digest" ||
      signed?.unique_attestation_signer_run !== "not-verified" ||
      signed?.authorizes_stable !== false || signed?.authorizes_production !== false ||
      candidate?.result !== "verified-github-attestation" ||
      candidate?.permits_promotion !== false ||
      candidate?.other_release_assets !== "not-checked" ||
      candidate?.physical_acceptance !== "not-checked" ||
      signer?.signer_run_id !== input.signerRunId ||
      signer?.repository !== "Faysk/tda" ||
      !SHA.test(signer?.signer_workflow_sha ?? "") ||
      candidate?.signer_workflow_source_sha !== signer.signer_workflow_sha ||
      candidate?.candidate_source_sha !== input.sourceSha ||
      candidate?.family !== input.family ||
      !HASH.test(candidate?.manifest_sha256 ?? ""))
    throw new Error("RC_AUDIT_SIGNED_MANIFEST_PROOF_INVALID");
  if (local?.policy !== "tda-rc-local-integrity-v1" ||
      local?.family !== input.family ||
      local?.source_sha !== input.sourceSha ||
      local?.local_asset_integrity !== "verified-sha256" ||
      local?.github_attestation !== "not-checked" ||
      local?.physical_receipts !== "not-checked" ||
      local?.authorizes_stable !== false || local?.authorizes_production !== false ||
      !Number.isSafeInteger(local?.assets_hashed) || local.assets_hashed <= 0 ||
      !Number.isSafeInteger(local?.total_bytes_hashed) || local.total_bytes_hashed <= 0 ||
      !HASH.test(local?.manifest_sha256 ?? ""))
    throw new Error("RC_AUDIT_ASSET_PROOF_INVALID");
  // Critical anti-swap invariant: same manifest bytes must be checked by
  // signature verifier and the second pass enumerating all release assets.
  if (candidate.manifest_sha256 !== local.manifest_sha256)
    throw new Error("RC_AUDIT_SIGNED_MANIFEST_CHANGED_BETWEEN_CHECKS");
  if (!candidate.candidate_tag || candidate.candidate_tag !== local.candidate_tag)
    throw new Error("RC_AUDIT_CANDIDATE_TAG_MISMATCH");
}
export async function auditRcCandidate(input, {
  verifySigner = verifyRcFromAuthenticatedSignerRun,
  verifyAssets = verifyLocalRcAssets,
} = {}) {
  validInput(input);
  // Serial ordering is deliberate; a local second pass recomputes manifest
  // digest to detect substitutions after cryptographic verification.
  const signed = await verifySigner(input);
  const local = await verifyAssets(input);
  checkReports(signed, local, input);
  return {
    schema_version: 1, policy: AUDIT_POLICY, candidate_family: input.family,
    source_sha: input.sourceSha, candidate_tag: local.candidate_tag,
    signer_workflow_sha: signed.signer.signer_workflow_sha,
    signer_run_id_observed: signed.signer.signer_run_id,
    manifest_sha256: signed.candidate.manifest_sha256,
    checked_assets: local.assets_hashed, bytes_hashed: local.total_bytes_hashed,
    checks: {
      github_signer_run_metadata: "verified",
      signed_manifest_at_workflow_digest: "verified",
      all_local_manifest_assets: "verified-sha256",
      manifest_unchanged_between_checks: true,
    },
    unique_signer_run_attribution: "not-verified",
    physical_acceptance: "not-checked",
    authenticode: "not-checked",
    remote_release_state: "not-checked",
    authorizes_stable: false, authorizes_production: false,
    decision: "manual-review-required",
  };
}
async function main() {
  if (process.argv.length !== 7) throw new Error(
    "Usage: node tools/ci/rc-evidence-audit.mjs companion|runtime candidate.json local-assets-dir trusted-source-sha rc-signer-run-id");
  const [, , family, manifestFile, assetsRoot, sourceSha, textId] = process.argv;
  if (!/^[1-9]\d*$/.test(textId) || !Number.isSafeInteger(Number(textId)))
    throw new Error("RC_AUDIT_SIGNER_ID_INVALID");
  const result = await auditRcCandidate({
    family, manifestFile, assetsRoot, sourceSha, signerRunId: Number(textId),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
