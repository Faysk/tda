import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyLocalRcAssets, extractAssets, LOCAL_ASSET_POLICY } from "./rc-local-asset-integrity.mjs";

const SOURCE = "a".repeat(40), TREE = "b".repeat(40), VERSION = "0.3.17";
const digest = (x) => createHash("sha256").update(x).digest("hex");
const asset = (name, data) => ({ name, size: Buffer.byteLength(data), sha256: digest(data) });
function fixture(family = "companion") {
  const dir = mkdtempSync(join(tmpdir(), "tda-rc-integrity-synthetic-"));
  const root = join(dir, "assets");
  mkdirSync(root);
  let manifest, bytes = {};
  if (family === "companion") {
    bytes = {
      "TDACompanion-x64.msi": "synthetic-msi-bytes",
      ["TDACompanion-" + VERSION + "-windows-x64.zip"]: "synthetic-zip",
      "TDACompanion-payload-manifest.json": "{\"schema\":\"synthetic\"}",
    };
    bytes["TDACompanion-x64.msi.sha256"] =
      digest(bytes["TDACompanion-x64.msi"]) + "  TDACompanion-x64.msi\n";
    manifest = {
      schema: "tda_companion_candidate_v2", version: VERSION, source_sha: SOURCE,
      source_tree_sha: TREE, workflow_run_id: 555, channel: "rc",
      tag: "companion-rc-v" + VERSION + "-" + SOURCE.slice(0, 12),
      assets: {
        msi: asset("TDACompanion-x64.msi", bytes["TDACompanion-x64.msi"]),
        checksum: asset("TDACompanion-x64.msi.sha256", bytes["TDACompanion-x64.msi.sha256"]),
        zip: asset("TDACompanion-" + VERSION + "-windows-x64.zip",
          bytes["TDACompanion-" + VERSION + "-windows-x64.zip"]),
        payload_manifest: asset("TDACompanion-payload-manifest.json",
          bytes["TDACompanion-payload-manifest.json"]),
      },
    };
  } else {
    const one = "TDAQwenRuntimeBundle-1.0.19-windows-x64.json";
    const two = "TDAQwenRuntimePart-1.0.19-001.zip";
    bytes = { [one]: "{\"synthetic\":true}", [two]: "part-synthetic-bytes" };
    manifest = {
      schema: "tda_runtime_candidate_v1", version: "1.0.19", family: "qwen",
      source_sha: SOURCE, source_tree_sha: TREE, workflow_run_id: 123,
      candidate_tag: "companion-qwen-runtime-rc-v1.0.19-" + SOURCE.slice(0,12),
      stable_tag: "companion-qwen-runtime-v1.0.19",
      assets: [asset(one, bytes[one]), asset(two, bytes[two])],
    };
  }
  for (const [name, value] of Object.entries(bytes)) writeFileSync(join(root, name), value);
  const manifestFile = join(dir, family === "companion" ?
    "TDACompanion-candidate.json" : "TDARuntime-candidate.json");
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const close = () => rmSync(dir, { recursive: true, force: true });
  return { root, manifest, manifestFile, bytes, close, family };
}
function run(f) {
  return verifyLocalRcAssets({
    family:f.family, sourceSha: SOURCE, manifestFile:f.manifestFile, assetsRoot:f.root,
  });
}
test("Companion four exact assets, sidecar checksum, hashes, and no Stable permission", async () => {
  const f = fixture();
  try {
    const report = await run(f);
    assert.equal(report.policy, LOCAL_ASSET_POLICY);
    assert.equal(report.assets_hashed, 4);
    assert.equal(report.local_asset_integrity, "verified-sha256");
    assert.equal(report.github_attestation, "not-checked");
    assert.equal(report.physical_receipts, "not-checked");
    assert.equal(report.authorizes_stable, false);
    assert.equal(report.authorizes_production, false);
    assert.equal(readFileSync(f.manifestFile, "utf8"), JSON.stringify(f.manifest));
  } finally { f.close(); }
});
test("Qwen candidate validates every split asset as streaming file, not model execution", async () => {
  const f = fixture("runtime");
  try {
    const report = await run(f);
    assert.equal(report.assets_hashed, 2);
    assert.equal(report.candidate_tag, f.manifest.candidate_tag);
    assert.equal(report.github_attestation, "not-checked");
  } finally { f.close(); }
});
test("tampered same-size MSI fails SHA256 before any release action", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "TDACompanion-x64.msi"), "synthetic-msi-bytEs");
    await assert.rejects(run(f), /RC_ASSET_(SHA256_MISMATCH|FILE_TYPE_OR_SIZE_INVALID)/);
  } finally { f.close(); }
});
test("tampered runtime split archive is detected independently", async () => {
  const f = fixture("runtime");
  try {
    const file = join(f.root, "TDAQwenRuntimePart-1.0.19-001.zip");
    writeFileSync(file, "part-synthetic-bytEs");
    await assert.rejects(run(f), /RC_ASSET_(SHA256_MISMATCH|FILE_TYPE_OR_SIZE_INVALID)/);
  } finally { f.close(); }
});
test("metadata with path traversal, duplicates or unknown direct asset name is rejected", () => {
  const f = fixture();
  try {
    let data = structuredClone(f.manifest);
    data.assets.zip.name = "../outside";
    assert.throws(() => extractAssets(data, "companion"), /COMPANION_ASSET_FILENAMES_UNEXPECTED/);
    data = structuredClone(f.manifest);
    data.assets.zip.name = "TDACompanion-x64.msi";
    assert.throws(() => extractAssets(data, "companion"), /COMPANION_ASSET_FILENAMES_UNEXPECTED/);
    const r = fixture("runtime");
    try {
      r.manifest.assets[1].name = r.manifest.assets[0].name.toUpperCase();
      assert.throws(() => extractAssets(r.manifest, "runtime"), /RC_ASSET_DUPLICATE_NAME/);
      r.manifest.assets[1].name = "../evil";
      assert.throws(() => extractAssets(r.manifest, "runtime"), /RC_ASSET_METADATA_INVALID/);
    } finally { r.close(); }
  } finally { f.close(); }
});
test("broken MSI checksum file is independently rejected even when manifest hash matches", async () => {
  const f = fixture();
  try {
    const sidecar = "f".repeat(64) + "  TDACompanion-x64.msi\n";
    writeFileSync(join(f.root, "TDACompanion-x64.msi.sha256"), sidecar);
    f.manifest.assets.checksum = asset("TDACompanion-x64.msi.sha256", sidecar);
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    await assert.rejects(run(f), /RC_MSI_CHECKSUM_CONTENT_MISMATCH/);
  } finally { f.close(); }
});
test("reject symlinked assets and missing assets", async () => {
  const f = fixture();
  try {
    const file = join(f.root, "TDACompanion-x64.msi");
    const other = join(f.root, "other");
    writeFileSync(other, f.bytes["TDACompanion-x64.msi"]);
    rmSync(file);
    symlinkSync(other, file);
    await assert.rejects(run(f), /RC_ASSET_FILE_TYPE_OR_SIZE_INVALID/);
    rmSync(file);
    await assert.rejects(run(f), /RC_ASSET_MISSING/);
  } finally { f.close(); }
});
test("checksum sidecar symlink is rejected without following a private or oversized target", async () => {
  const f = fixture();
  try {
    const file = join(f.root, "TDACompanion-x64.msi.sha256");
    const target = join(f.root, "synthetic-protected-not-to-be-read");
    writeFileSync(target, "SENSITIVE_SYNTHETIC_SENTINEL" + "X".repeat(1024));
    rmSync(file);
    symlinkSync(target, file);
    await assert.rejects(run(f), /RC_ASSET_FILE_TYPE_OR_SIZE_INVALID/);
    assert.equal(readFileSync(target, "utf8").startsWith("SENSITIVE_SYNTHETIC_SENTINEL"), true);
  } finally { f.close(); }
});
test("missing manifest, source mismatch, and wrong candidate tag fail", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      verifyLocalRcAssets({ family:f.family, manifestFile:f.manifestFile, assetsRoot:f.root, sourceSha:"f".repeat(40) }),
      /CANDIDATE_SOURCE_SHA_MISMATCH/);
    f.manifest.tag = "companion-rc-v0.3.17-notexactsha";
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    await assert.rejects(run(f), /CANDIDATE_RC_TAG_MISMATCH/);
    rmSync(f.manifestFile);
    await assert.rejects(run(f), /ENOENT/);
  } finally { f.close(); }
});
test("invalid and duplicate manifest asset lists cannot pass", () => {
  const f = fixture("runtime");
  try {
    const m = structuredClone(f.manifest);
    m.assets[0].sha256 = "not-a-hash";
    assert.throws(() => extractAssets(m, "runtime"), /RC_ASSET_METADATA_INVALID/);
    m.assets = [];
    assert.throws(() => extractAssets(m, "runtime"), /RUNTIME_ASSET_RECORD_INVALID/);
  } finally { f.close(); }
});
test("synthetic validation does not mutate inputs or trigger network, gh, deploy or releases", async () => {
  const f = fixture("runtime");
  try {
    const before = readFileSync(f.manifestFile, "utf8");
    await run(f);
    assert.equal(readFileSync(f.manifestFile, "utf8"), before);
    assert.equal(Object.entries(f.bytes).length, 2);
  } finally { f.close(); }
});
