import assert from "node:assert/strict";
import test from "node:test";
import { auditRcCandidate, AUDIT_POLICY } from "./rc-evidence-audit.mjs";

const SHA = "a".repeat(40), SIGNER = "b".repeat(40), DIGEST = "c".repeat(64);
const args = () => ({
  family: "companion", manifestFile: "/fixtures/TDACompanion-candidate.json",
  assetsRoot: "/fixtures/assets", sourceSha: SHA, signerRunId: 1542,
});
const signer = () => ({
  run_metadata: "verified-readonly-github-api",
  github_attestation: "verified-by-gh-at-workflow-digest",
  unique_attestation_signer_run: "not-verified",
  authorizes_stable: false, authorizes_production: false,
  signer: { signer_run_id: 1542, signer_workflow_sha: SIGNER, repository: "Faysk/tda" },
  candidate: {
    result: "verified-github-attestation", family: "companion",
    candidate_source_sha: SHA, signer_workflow_source_sha: SIGNER,
    manifest_sha256: DIGEST, candidate_tag: "companion-rc-v0.3.17-" + SHA.slice(0, 12),
    permits_promotion: false, physical_acceptance: "not-checked",
    other_release_assets: "not-checked",
  },
});
const asset = () => ({
  policy: "tda-rc-local-integrity-v1", family: "companion", source_sha: SHA,
  candidate_tag: "companion-rc-v0.3.17-" + SHA.slice(0, 12),
  manifest_sha256: DIGEST, assets_hashed: 4, total_bytes_hashed: 9123,
  local_asset_integrity: "verified-sha256", github_attestation: "not-checked",
  physical_receipts: "not-checked", authorizes_stable: false, authorizes_production: false,
});
const invoke = (editSigner = (x) => x, editAssets = (x) => x) =>
  auditRcCandidate(args(), {
    verifySigner: async () => editSigner(signer()),
    verifyAssets: async () => editAssets(asset()),
  });
test("requires two complementary proofs, never authorizes release or physical acceptance", async () => {
  const result = await invoke();
  assert.equal(result.policy, AUDIT_POLICY);
  assert.equal(result.checks.signed_manifest_at_workflow_digest, "verified");
  assert.equal(result.checks.all_local_manifest_assets, "verified-sha256");
  assert.equal(result.checks.manifest_unchanged_between_checks, true);
  assert.equal(result.unique_signer_run_attribution, "not-verified");
  assert.equal(result.physical_acceptance, "not-checked");
  assert.equal(result.authenticode, "not-checked");
  assert.equal(result.remote_release_state, "not-checked");
  assert.equal(result.authorizes_stable, false);
  assert.equal(result.authorizes_production, false);
  assert.equal(result.decision, "manual-review-required");
});
test("signer check executes before local full hashing; no asset read on signer failure", async () => {
  const actions = [];
  await assert.rejects(auditRcCandidate(args(), {
    verifySigner: () => { actions.push("signer"); throw new Error("SIGNATURE_INVALID"); },
    verifyAssets: () => { actions.push("assets"); return asset(); },
  }), /SIGNATURE_INVALID/);
  assert.deepEqual(actions, ["signer"]);
});
test("SHA or tag swap between verified signature and asset hash fails closed", async () => {
  await assert.rejects(invoke(undefined, (a) => { a.manifest_sha256 = "f".repeat(64); return a; }),
    /SIGNED_MANIFEST_CHANGED_BETWEEN_CHECKS/);
  await assert.rejects(invoke(undefined, (a) => { a.candidate_tag = "another"; return a; }),
    /CANDIDATE_TAG_MISMATCH/);
  await assert.rejects(invoke((s) => { s.candidate.manifest_sha256 = "0".repeat(64); return s; }),
    /SIGNED_MANIFEST_CHANGED_BETWEEN_CHECKS/);
});
test("fake green runner without cryptographically verified manifest cannot pass", async () => {
  for (const mutate of [
    (s) => { s.github_attestation = "not-checked"; },
    (s) => { s.run_metadata = "unknown"; },
    (s) => { s.candidate.result = "unverified"; },
    (s) => { s.candidate.permits_promotion = true; },
    (s) => { s.candidate.physical_acceptance = "verified"; },
    (s) => { s.candidate.other_release_assets = "verified"; },
    (s) => { s.signer.repository = "fork/untrusted"; },
    (s) => { s.signer.signer_run_id = 42; },
    (s) => { s.signer.signer_workflow_sha = "not-sha"; },
    (s) => { s.candidate.signer_workflow_source_sha = "f".repeat(40); },
    (s) => { s.candidate.candidate_source_sha = "f".repeat(40); },
    (s) => { s.candidate.family = "runtime"; },
  ]) await assert.rejects(invoke((s) => { mutate(s); return s; }),
    /RC_AUDIT_SIGNED_MANIFEST_PROOF_INVALID/);
});
test("misleading future promotion or run attribution reports are not accepted", async () => {
  for (const mutate of [
    (s) => { s.authorizes_stable = true; },
    (s) => { s.authorizes_production = true; },
    (s) => { s.unique_attestation_signer_run = "verified"; },
  ]) await assert.rejects(invoke((s) => { mutate(s); return s; }),
    /RC_AUDIT_SIGNED_MANIFEST_PROOF_INVALID/);
});
test("all local asset hashes must succeed and remain read-only", async () => {
  for (const mutate of [
    (x) => { x.local_asset_integrity = "missing"; },
    (x) => { x.assets_hashed = 0; },
    (x) => { x.total_bytes_hashed = -3; },
    (x) => { x.github_attestation = "verified"; },
    (x) => { x.physical_receipts = "verified"; },
    (x) => { x.authorizes_stable = true; },
    (x) => { x.source_sha = "f".repeat(40); },
    (x) => { x.family = "runtime"; },
    (x) => { x.manifest_sha256 = "bad"; },
  ]) await assert.rejects(invoke(undefined, (a) => { mutate(a); return a; }),
    /RC_AUDIT_ASSET_PROOF_INVALID/);
});
test("hashing any local asset failure rejects the combined audit", async () => {
  await assert.rejects(auditRcCandidate(args(), {
    verifySigner: () => signer(),
    verifyAssets: () => { throw new Error("RC_ASSET_SHA256_MISMATCH:MSI"); },
  }), /RC_ASSET_SHA256_MISMATCH:MSI/);
});
test("never accepts untrusted/missing request parameters or invalid signer run ID", async () => {
  for (const input of [
    {}, null, { ...args(), family: "unknown" },
    { ...args(), sourceSha: "main" }, { ...args(), sourceSha: "0".repeat(39) },
    { ...args(), signerRunId: 0 }, { ...args(), signerRunId: NaN },
    { ...args(), signerRunId: Number.MAX_SAFE_INTEGER + 1 },
    { ...args(), manifestFile: "" }, { ...args(), assetsRoot: null },
  ]) {
    await assert.rejects(auditRcCandidate(input, {
      verifySigner: () => { throw new Error("UNEXPECTED_SIDE_EFFECT"); },
    }), /RC_AUDIT_ARGUMENTS_INVALID/);
  }
});
test("provenance and manifest diff do not cause second gh invocation", async () => {
  const calls = [];
  const out = await auditRcCandidate(args(), {
    verifySigner: (input) => { calls.push(["signed", input.signerRunId]); return signer(); },
    verifyAssets: (input) => { calls.push(["hashed", input.assetsRoot]); return asset(); },
  });
  assert.deepEqual(calls, [["signed", 1542], ["hashed", "/fixtures/assets"]]);
  assert.equal(out.checked_assets, 4);
  assert.equal(out.bytes_hashed, 9123);
});
test("missing proofs and plain partial objects cannot be interpreted as complete", async () => {
  await assert.rejects(invoke(() => null), /RC_AUDIT_SIGNED_MANIFEST_PROOF_INVALID/);
  await assert.rejects(invoke(undefined, () => null), /RC_AUDIT_ASSET_PROOF_INVALID/);
  await assert.rejects(invoke(() => ({ github_attestation: "verified" })),
    /RC_AUDIT_SIGNED_MANIFEST_PROOF_INVALID/);
});
