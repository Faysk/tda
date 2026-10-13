import assert from "node:assert/strict";
import test from "node:test";
import { validateSignerRun, verifyRcFromAuthenticatedSignerRun } from "./rc-signer-run-verify.mjs";

const REPO = "Faysk/tda";
const SHA = "1".repeat(40), SOURCE = "2".repeat(40);
const runId = 13579;
const workflows = {
  companion: ["Companion RC", ".github/workflows/companion-rc.yml"],
  runtime: ["Runtime RC", ".github/workflows/runtime-rc.yml"],
};
function fixture(family = "companion") {
  const [name, path] = workflows[family];
  return {
    id: runId, name, path, event: "workflow_run", head_branch: "main",
    status: "completed", conclusion: "success", head_sha: SHA,
    head_repository: { full_name: REPO }, repository: { full_name: REPO },
    run_attempt: 1,
  };
}
function check(mutate, family = "companion") {
  const row = fixture(family);
  mutate?.(row);
  return validateSignerRun(row, { family, signerRunId: runId });
}
test("successful Companion RC run resolves signer SHA without trusting manifest or user-supplied SHA", () => {
  const result = check();
  assert.equal(result.signer_workflow_sha, SHA);
  assert.equal(result.signer_run_id, runId);
  assert.equal(result.signer_workflow, workflows.companion[1]);
});
test("runtime signer dispatch on main and path qualified with refs/heads/main can be validated", () => {
  const signer = check((row) => {
    row.event = "workflow_dispatch";
    row.path += "@refs/heads/main";
    row.run_attempt = 2;
  }, "runtime");
  assert.equal(signer.signer_attempt, 2);
  assert.equal(signer.signer_workflow, workflows.runtime[1]);
});
test("rejects wrong run id, SHA, missing run attempt and malformed inputs", () => {
  assert.throws(() => check((row) => { row.id = 44; }), /SIGNER_RUN_ID_MISMATCH/);
  assert.throws(() => check((row) => { row.head_sha = "bad"; }), /SIGNER_WORKFLOW_SHA_INVALID/);
  assert.throws(() => check((row) => { row.run_attempt = null; }), /SIGNER_RUN_ATTEMPT_INVALID/);
  assert.throws(() => validateSignerRun(null, { family: "companion", signerRunId: runId }), /SIGNER_RUN_RESPONSE_INVALID/);
  assert.throws(() => validateSignerRun(fixture(), { family: "companion", signerRunId: 0 }), /SIGNER_RUN_ID_INVALID/);
});
test("different repository or fork cannot masquerade as RC signer", () => {
  for (const field of ["repository", "head_repository"]) {
    assert.throws(() => check((row) => { row[field].full_name = "outside/fork"; }),
      /SIGNER_REPOSITORY_ORIGIN_INVALID/);
  }
  assert.throws(() => check((row) => { row.head_repository = null; }),
    /SIGNER_REPOSITORY_ORIGIN_INVALID/);
});
test("wrong workflow or path, even with identical SHA, cannot masquerade as RC signer", () => {
  assert.throws(() => check((row) => { row.name = "CI"; }), /SIGNER_WORKFLOW_IDENTITY_MISMATCH/);
  assert.throws(() => check((row) => { row.path = ".github/workflows/ci.yml"; }),
    /SIGNER_WORKFLOW_IDENTITY_MISMATCH/);
  assert.throws(() => check((row) => { row.path += "@refs/heads/feature"; }),
    /SIGNER_WORKFLOW_IDENTITY_MISMATCH/);
});
test("unapproved trigger, branch or run status blocks verifier", () => {
  for (const event of ["push", "pull_request", "pull_request_target", null])
    assert.throws(() => check((row) => { row.event = event; }), /SIGNER_EVENT_OR_BRANCH_UNTRUSTED/);
  assert.throws(() => check((row) => { row.head_branch = "feature"; }),
    /SIGNER_EVENT_OR_BRANCH_UNTRUSTED/);
  for (const [status, conclusion] of [
    ["queued", null], ["in_progress", null], ["completed", "failure"],
    ["completed", "cancelled"], ["completed", "skipped"],
  ]) assert.throws(() => check((row) => { row.status = status; row.conclusion = conclusion; }),
    /SIGNER_RUN_NOT_SUCCESSFUL/);
});
function runner(run, log) {
  return (binary, args, options) => {
    log.push([binary, args, options]);
    assert.equal(binary, "gh");
    assert.deepEqual(args, ["api", "repos/" + REPO + "/actions/runs/" + runId]);
    return JSON.stringify(run);
  };
}
function passed(manifest, expected) {
  assert.equal(manifest.signerSha, expected);
  return {
    result: "verified-github-attestation", permits_promotion: false,
    candidate_source_sha: manifest.sourceSha,
    signer_workflow_source_sha: manifest.signerSha,
  };
}
test("read-only API run lookup supplies digest to official signed verifier; no merge permission", () => {
  const seen = [], writes = [];
  const result = verifyRcFromAuthenticatedSignerRun(
    { family: "runtime", signerRunId: runId, manifestFile: "TDARuntime-candidate.json", sourceSha: SOURCE },
    runner(fixture("runtime"), seen),
    (args) => { writes.push(args); return passed(args, SHA); },
  );
  assert.deepEqual(seen[0][1], ["api", "repos/" + REPO + "/actions/runs/" + runId]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].signerSha, SHA);
  assert.equal(result.authorizes_stable, false);
  assert.equal(result.authorizes_production, false);
  assert.equal(result.run_identity, "verified-readonly-github-api");
  assert.equal(result.github_attestation, "verified-by-gh");
  assert.equal(result.other_assets, "not-checked");
  assert.equal(result.physical_acceptance, "not-checked");
});
test("no verifier invocation when API metadata fails, run is spoofed or status failed", () => {
  const attempt = (run, command) => verifyRcFromAuthenticatedSignerRun(
    { family: "companion", signerRunId: runId, manifestFile: "TDACompanion-candidate.json", sourceSha: SOURCE },
    command || runner(run, []),
    () => { throw new Error("VERIFIER_MUST_NOT_RUN"); },
  );
  assert.throws(() => attempt({ ...fixture(), conclusion: "failure" }), /SIGNER_RUN_NOT_SUCCESSFUL/);
  assert.throws(() => attempt({ ...fixture(), head_sha: "incorrect" }), /SIGNER_WORKFLOW_SHA_INVALID/);
  assert.throws(() => attempt(null, () => { throw new Error("GH_UNAVAILABLE"); }),
    /SIGNER_RUN_METADATA_UNAVAILABLE/);
  assert.throws(() => attempt(null, () => "not-json"), /SIGNER_RUN_METADATA_UNAVAILABLE/);
});
test("forged 'verified' response is rejected unless every identity matches", () => {
  for (const response of [
    null,
    { result: "unverified", permits_promotion: false, candidate_source_sha: SOURCE, signer_workflow_source_sha: SHA },
    { result: "verified-github-attestation", permits_promotion: true, candidate_source_sha: SOURCE, signer_workflow_source_sha: SHA },
    { result: "verified-github-attestation", permits_promotion: false, candidate_source_sha: "f".repeat(40), signer_workflow_source_sha: SHA },
    { result: "verified-github-attestation", permits_promotion: false, candidate_source_sha: SOURCE, signer_workflow_source_sha: "f".repeat(40) },
  ]) {
    assert.throws(() => verifyRcFromAuthenticatedSignerRun(
      { family: "companion", signerRunId: runId, manifestFile: "TDACompanion-candidate.json", sourceSha: SOURCE },
      runner(fixture(), []), () => response), /SIGNER_RUN_ATTESTATION_RESULT_INCONSISTENT/);
  }
});
test("unknown family and run ID are denied without an API call", () => {
  assert.throws(() => verifyRcFromAuthenticatedSignerRun(
    { family: "unknown", signerRunId: runId }, () => { throw new Error("SHOULD_NOT_CALL"); }),
    /SIGNER_FAMILY_UNKNOWN/);
  assert.throws(() => verifyRcFromAuthenticatedSignerRun(
    { family: "runtime", signerRunId: NaN }, () => { throw new Error("SHOULD_NOT_CALL"); }),
    /SIGNER_RUN_ID_INVALID/);
});


test("public historical GitHub run metadata shape is supported for Companion and Runtime RC", () => {
  // Read-only public API snapshots reviewed on 2026-10-14:
  // https://github.com/Faysk/tda/actions/runs/38456813611
  // https://github.com/Faysk/tda/actions/runs/37838272496
  const samples = [
    {
      family: "companion", id: 38456813611, name: "Companion RC",
      event: "workflow_run", path: ".github/workflows/companion-rc.yml",
      head_sha: "256e45b5ffddc1196b149f7c29c0da8eb3e0998e",
    },
    {
      family: "runtime", id: 37838272496, name: "Runtime RC",
      event: "workflow_dispatch", path: ".github/workflows/runtime-rc.yml",
      head_sha: "1066d58d8128fa6cf0c8342535ff14c4fb08aa04",
    },
  ];
  for (const sample of samples) {
    const evidence = validateSignerRun({
      id: sample.id, name: sample.name, event: sample.event,
      head_branch: "main", path: sample.path, head_sha: sample.head_sha,
      status: "completed", conclusion: "success", run_attempt: 1,
      repository: { full_name: REPO }, head_repository: { full_name: REPO },
    }, { family: sample.family, signerRunId: sample.id });
    assert.equal(evidence.signer_workflow_sha, sample.head_sha);
    assert.equal(evidence.signer_run_id, sample.id);
  }
});
