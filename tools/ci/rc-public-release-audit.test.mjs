import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPublishedRcMetadata, auditPublishedRc, PUBLIC_RC_POLICY } from "./rc-public-release-audit.mjs";

const SRC = "a".repeat(40);
const TREE = "b".repeat(40);
const TAG = "companion-rc-v0.3.17-" + SRC.slice(0, 12);
const hash = (v) => createHash("sha256").update(v).digest("hex");
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "tda-rc-public-synthetic-"));
  const filename = join(dir, "TDACompanion-candidate.json");
  const assets = {
    msi: { name: "TDACompanion-x64.msi", size: 5, sha256: "1".repeat(64) },
    checksum: { name: "TDACompanion-x64.msi.sha256", size: 86, sha256: "2".repeat(64) },
    zip: { name: "TDACompanion-0.3.17-windows-x64.zip", size: 7, sha256: "3".repeat(64) },
    payload_manifest: { name: "TDACompanion-payload-manifest.json", size: 8, sha256: "4".repeat(64) },
  };
  const manifest = {
    schema: "tda_companion_candidate_v2", version: "0.3.17",
    source_sha: SRC, source_tree_sha: TREE, workflow_run_id: 123,
    channel: "rc", tag: TAG, assets,
  };
  const bytes = JSON.stringify(manifest);
  writeFileSync(filename, bytes);
  const expectedAssets = [
    { name: "TDACompanion-candidate.json", size: Buffer.byteLength(bytes), sha256: hash(bytes) },
    ...Object.values(assets),
  ];
  const release = {
    id: 101, tag_name: TAG, target_commitish: SRC, draft: false, prerelease: true,
    published_at: "2026-10-13T20:00:00Z",
    assets: expectedAssets.map((x, i) => ({
      id: 200 + i, name: x.name, size: x.size, digest: "sha256:" + x.sha256,
      state: "uploaded",
    })),
  };
  const combined = {
    source_sha: SRC, candidate_tag: TAG, manifest_sha256: hash(bytes),
    authorizes_stable: false, authorizes_production: false, decision: "manual-review-required",
    checks: { manifest_unchanged_between_checks: true },
  };
  return { dir, filename, manifest, expectedAssets, release, combined,
    close: () => rmSync(dir, { recursive: true, force: true }) };
}
const opts = (f) => ({ release:f.release, tag: TAG, sourceSha:SRC, expectedAssets:f.expectedAssets });
function checkMutation(mutate, regex) {
  const f=fixture();
  try { mutate(f); assert.throws(()=>verifyPublishedRcMetadata(opts(f)), regex); }
  finally { f.close(); }
}
test("published RC metadata validates exact candidate+asset digests without release authority", () => {
  const f = fixture();
  try {
    const result = verifyPublishedRcMetadata(opts(f));
    assert.equal(result.policy, PUBLIC_RC_POLICY);
    assert.equal(result.assets_matched, 5);
    assert.equal(result.release_metadata, "verified-against-github-readonly-api");
    assert.equal(result.git_tag_object_target, "not-checked");
    assert.equal(result.release_immutability, "not-proven");
    assert.equal(result.authorizes_stable, false);
    assert.equal(result.authorizes_production, false);
  } finally { f.close(); }
});
test("rejects unpublished draft, Stable, stale source, mutable tags and invalid release identity", () => {
  for (const mutate of [
    (f) => { f.release.draft = true; },
    (f) => { f.release.prerelease = false; },
    (f) => { f.release.tag_name += "-different"; },
    (f) => { f.release.target_commitish = "f".repeat(40); },
    (f) => { f.release.id = null; },
    (f) => { f.release.published_at = null; },
  ]) checkMutation(mutate, /RC_REMOTE_RELEASE_IDENTITY_INVALID/);
});
test("rejects renamed, missing, extra or case-duplicate release asset", () => {
  checkMutation((f)=> { f.release.assets.pop(); }, /RC_REMOTE_ASSET_SET_MISMATCH/);
  checkMutation((f)=> { f.release.assets.push({ ...f.release.assets[0], id: 900 }); },
    /RC_REMOTE_ASSET_SET_MISMATCH/);
  checkMutation((f)=> { f.release.assets[1].name="TDAForged-x64.msi"; },
    /RC_REMOTE_ASSET_MISMATCH/);
  checkMutation((f)=> { f.release.assets[1].name=f.release.assets[0].name.toUpperCase(); },
    /RC_REMOTE_DUPLICATE_ASSET/);
});
test("digest tampering and same-size asset substitution fail; no inferred integrity", () => {
  checkMutation((f)=> { f.release.assets[1].digest="sha256:"+"f".repeat(64); },
    /RC_REMOTE_ASSET_MISMATCH/);
  checkMutation((f)=> { f.release.assets[1].size+=1; },
    /RC_REMOTE_ASSET_MISMATCH/);
  checkMutation((f)=> { f.release.assets[0].digest=null; },
    /RC_REMOTE_ASSET_METADATA_INVALID/);
  checkMutation((f)=> { f.release.assets[0].state="new"; },
    /RC_REMOTE_ASSET_METADATA_INVALID/);
  checkMutation((f)=> { f.release.assets[0].id=-1; },
    /RC_REMOTE_ASSET_METADATA_INVALID/);
});
test("invalid manifest expectations/duplicate names cannot be reported as remote success", () => {
  const f=fixture();
  try {
    assert.throws(()=>verifyPublishedRcMetadata({ ...opts(f), tag:"../bad" }),
      /RC_REMOTE_EXPECTATIONS_INVALID/);
    assert.throws(()=>verifyPublishedRcMetadata({ ...opts(f), sourceSha:"unknown" }),
      /RC_REMOTE_EXPECTATIONS_INVALID/);
    assert.throws(()=>verifyPublishedRcMetadata({ ...opts(f), sourceSha:"f".repeat(40) }),
      /RC_REMOTE_EXPECTATIONS_INVALID/);
    f.expectedAssets[1].name=f.expectedAssets[0].name.toUpperCase();
    assert.throws(()=>verifyPublishedRcMetadata(opts(f)),
      /RC_REMOTE_EXPECTED_DUPLICATE_NAME/);
  } finally { f.close(); }
});
const audit = (f, runnerOverride) => auditPublishedRc(
  { family:"companion", sourceSha:SRC, manifestFile:f.filename,
    assetsRoot:f.dir, signerRunId:321 },
  { verifyCombined:()=>f.combined, githubGet: runnerOverride || ((exe, args, options)=>{
    assert.equal(exe, "gh");
    assert.deepEqual(args, ["api", "repos/Faysk/tda/releases/tags/" + TAG]);
    assert.equal(options.encoding, "utf8");
    return JSON.stringify(f.release);
  }) });
test("combined provenance + hash proof + read-only GitHub release GET yields metadata snapshot only", async () => {
  const f=fixture();
  try {
    const report=await audit(f);
    assert.equal(report.policy, "tda-public-rc-triple-evidence-v1");
    assert.equal(report.remote_release_state, "matched-exact-published-prerelease-metadata");
    assert.equal(report.public_release_metadata.assets_matched, 5);
    assert.equal(report.git_tag_object_target, "not-checked");
    assert.equal(report.unique_signer_run_attribution, "not-verified");
    assert.equal(report.physical_acceptance, "not-checked");
    assert.equal(report.authorizes_stable, false);
    assert.equal(report.authorizes_production, false);
  } finally { f.close(); }
});
test("manifest changed after signed+local audit cannot lead to remote release request", async () => {
  const f=fixture();
  try {
    f.manifest.version="0.3.18";
    writeFileSync(f.filename, JSON.stringify(f.manifest));
    await assert.rejects(audit(f, ()=>{ throw new Error("SHOULD_NOT_CALL_GH"); }),
      /RC_REMOTE_MANIFEST_CHANGED_AFTER_COMBINED_AUDIT/);
  } finally { f.close(); }
});
test("manifest symlink is rejected before contacting GitHub releases API", async () => {
  const f=fixture();
  try {
    const target=join(f.dir,"TDASyntheticSource.json");
    writeFileSync(target, readFileSync(f.filename));
    rmSync(f.filename);
    symlinkSync(target, f.filename);
    await assert.rejects(audit(f, ()=>{ throw new Error("SHOULD_NOT_CALL_GH"); }),
      /RC_REMOTE_MANIFEST_TYPE_OR_SIZE_INVALID/);
  } finally { f.close(); }
});
test("partial or promoted 'combined' evidence is not accepted before GitHub lookup", async () => {
  for (const mutate of [
    (f)=>{ f.combined.authorizes_stable=true; },
    (f)=>{ f.combined.authorizes_production=true; },
    (f)=>{ f.combined.decision="automatic-merge"; },
    (f)=>{ f.combined.source_sha="f".repeat(40); },
    (f)=>{ f.combined.candidate_tag="../../malicious"; },
    (f)=>{ f.combined.checks.manifest_unchanged_between_checks=false; },
  ]) {
    const f=fixture();
    try {
      mutate(f);
      await assert.rejects(audit(f, ()=>{ throw new Error("SHOULD_NOT_CALL_GH"); }),
        /RC_REMOTE_COMBINED_EVIDENCE_INVALID/);
    } finally { f.close(); }
  }
});
test("GitHub REST 403/timeout/non-JSON always fails closed, without deployment", async () => {
  const f=fixture();
  try {
    await assert.rejects(audit(f, ()=>{throw new Error("HTTP403");}),
      /RC_REMOTE_RELEASE_LOOKUP_FAILED/);
    await assert.rejects(audit(f, ()=>"<html>blocked</html>"),
      /RC_REMOTE_RELEASE_LOOKUP_FAILED/);
  } finally { f.close(); }
});
test("public 2026 Companion RC release JSON API fields conform to expected schema", () => {
  // Snapshot of GET /repos/Faysk/tda/releases/tags/companion-rc-v0.3.26-b72eb1ffd316
  // Source: public GitHub Release metadata, 2026-10-08 (not actual artifact bytes).
  const expected = [
    { name:"TDACompanion-0.3.26-windows-x64.zip", size:41315335,
      sha256:"0ce4687ccaacf9fd3de751806644ceeb7c9e258de39018f5c7ca92fc368f5c22" },
    { name:"TDACompanion-candidate.json", size:836,
      sha256:"c2fb8ba35a95cde6869ac129f177c19608a5ef0600d58c4d0d1c909439ecd2ea" },
    { name:"TDACompanion-payload-manifest.json", size:777,
      sha256:"6ad518fbe3832f1b787857c8c3b6e15fff3221378e41beb84fa89429401fe402" },
    { name:"TDACompanion-x64.msi", size:43433983,
      sha256:"38cf05570dbf5bf042d6bba21617c15fedca715950492f325d3eebfcab90884a" },
    { name:"TDACompanion-x64.msi.sha256", size:86,
      sha256:"296af52194450f52aadbd263ef4f51a33d8fc2601ab943d02b9afa7191b9298b" },
  ];
  const release = {
    id:406426070, tag_name:"companion-rc-v0.3.26-b72eb1ffd316",
    target_commitish:"b72eb1ffd316e0c371d5d121899e56a9c8b844e3",
    draft:false, prerelease:true, published_at:"2026-10-08T04:53:12Z",
    assets:expected.map((a,i)=>({
      name:a.name, size:a.size, digest:"sha256:"+a.sha256,
      id:[620766049,620766051,620766047,620766048,620766050][i], state:"uploaded",
    })),
  };
  const outcome=verifyPublishedRcMetadata({
    release, tag:release.tag_name, sourceSha:release.target_commitish, expectedAssets:expected,
  });
  assert.equal(outcome.assets_matched, 5);
  assert.equal(outcome.release_immutability, "not-proven");
});
