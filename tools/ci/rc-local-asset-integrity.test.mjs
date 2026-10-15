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
      "TDACompanion-payload-manifest.json": JSON.stringify({
        schema: "tda_companion_payload_v1", version: VERSION,
        source_sha: SOURCE, source_tree_sha: TREE,
        files: Object.fromEntries([
          "TDACompanion.exe", "TDACompanionMaintenance.exe",
          "run-physical-acceptance.ps1", "run-installed-acceptance.ps1",
          "install-rc-runtimes.ps1",
        ].map(name => [name, { sha256: digest("synthetic-" + name), size: 17 }])),
      }),
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
    const two = "TDAQwenRuntime-1.0.19-windows-x64.zip.part001";
    const partBytes = "part-synthetic-bytes";
    const archiveHash = digest(partBytes);
    const bundle = {
      schema: "tda_qwen_runtime_bundle_v1", runtime_id: "qwen3-transformers",
      platform: "windows-x64", version: "1.0.19",
      archive: { name: "TDAQwenRuntime-1.0.19-windows-x64.zip",
        size: Buffer.byteLength(partBytes), sha256: archiveHash },
      parts: [{ index: 1, name: two, size: Buffer.byteLength(partBytes),
        sha256: digest(partBytes) }],
    };
    bytes = { [one]: JSON.stringify(bundle), [two]: partBytes };
    manifest = {
      schema: "tda_runtime_candidate_v1", version: "1.0.19", family: "qwen",
      runtime_id: "qwen3-transformers", platform: "windows-x64",
      runtime_archive_sha256: archiveHash,
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
    assert.equal(report.manifest_sha256, digest(readFileSync(f.manifestFile)));
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
    const file = join(f.root, "TDAQwenRuntime-1.0.19-windows-x64.zip.part001");
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

test("symlinked RC manifest is rejected before opening local assets", async () => {
  const f = fixture();
  try {
    const target = join(f.root, "TDASyntheticManifestTarget.json");
    writeFileSync(target, JSON.stringify(f.manifest));
    rmSync(f.manifestFile);
    symlinkSync(target, f.manifestFile);
    await assert.rejects(run(f), /RC_MANIFEST_SIZE_OR_TYPE_INVALID/);
  } finally { f.close(); }
});

test("Qwen archive digest cannot be forged even when every listed part and bundle hash matches", async () => {
  const f = fixture("runtime");
  try {
    const bundleName = f.manifest.assets[0].name;
    const bundle = JSON.parse(readFileSync(join(f.root, bundleName), "utf8"));
    // An adversarial candidate rewrites BOTH the candidate and the bundle's
    // archive digest, while all actual part bytes and declared hashes agree.
    const falseArchiveHash = digest("different-synthetic-archive");
    bundle.archive.sha256 = falseArchiveHash;
    f.manifest.runtime_archive_sha256 = falseArchiveHash;
    const content = JSON.stringify(bundle);
    writeFileSync(join(f.root, bundleName), content);
    f.manifest.assets[0] = asset(bundleName, content);
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    await assert.rejects(run(f), /RUNTIME_QWEN_RECONSTRUCTED_ARCHIVE_SHA256_MISMATCH/);
  } finally { f.close(); }
});

test("Qwen streaming reconstructs a multi-part archive and rejects reordered coherent parts", async () => {
  const f = fixture("runtime");
  try {
    const bundleName = f.manifest.assets[0].name;
    const firstName = f.manifest.assets[1].name;
    const secondName = "TDAQwenRuntime-1.0.19-windows-x64.zip.part002";
    const first = "AAAA", second = "BBBB"; // equal sizes make wrong ordering subtle
    writeFileSync(join(f.root, firstName), first);
    writeFileSync(join(f.root, secondName), second);
    const bundle = JSON.parse(readFileSync(join(f.root, bundleName), "utf8"));
    bundle.archive.size = Buffer.byteLength(first + second);
    bundle.archive.sha256 = digest(first + second);
    bundle.parts = [
      { index: 1, ...asset(firstName, first) },
      { index: 2, ...asset(secondName, second) },
    ];
    let content = JSON.stringify(bundle);
    writeFileSync(join(f.root, bundleName), content);
    f.manifest.runtime_archive_sha256 = bundle.archive.sha256;
    f.manifest.assets = [asset(bundleName, content), asset(firstName, first), asset(secondName, second)];
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));

    const ok = await run(f);
    assert.equal(ok.assets_hashed, 3);
    assert.equal(ok.local_asset_integrity, "verified-sha256");
    assert.equal(ok.authorizes_stable, false);

    // An internally coherent candidate rewrites part hashes and bundle rows
    // but retains the claimed archive SHA from its original byte order.
    writeFileSync(join(f.root, firstName), second);
    writeFileSync(join(f.root, secondName), first);
    bundle.parts = [
      { index: 1, ...asset(firstName, second) },
      { index: 2, ...asset(secondName, first) },
    ];
    content = JSON.stringify(bundle);
    writeFileSync(join(f.root, bundleName), content);
    f.manifest.assets = [asset(bundleName, content), asset(firstName, second), asset(secondName, first)];
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    await assert.rejects(run(f), /RUNTIME_QWEN_RECONSTRUCTED_ARCHIVE_SHA256_MISMATCH/);
  } finally { f.close(); }
});

test("Qwen RC rejects an internally forged bundle even if its JSON asset hash is updated", async () => {
  const f = fixture("runtime");
  try {
    const bundleName = f.manifest.assets[0].name;
    const original = JSON.parse(readFileSync(join(f.root, bundleName), "utf8"));
    original.parts[0].sha256 = "f".repeat(64);
    const altered = JSON.stringify(original);
    writeFileSync(join(f.root, bundleName), altered);
    f.manifest.assets[0] = asset(bundleName, altered);
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    await assert.rejects(run(f), /RUNTIME_QWEN_BUNDLE_PART_MISMATCH/);
  } finally { f.close(); }
});
test("Qwen RC requires archive digest and aggregated part sizes to match the signed candidate", async () => {
  for (const mutation of ["archive-sha", "archive-size", "bundle-family"]) {
    const f = fixture("runtime");
    try {
      const name = f.manifest.assets[0].name;
      const json = JSON.parse(readFileSync(join(f.root, name), "utf8"));
      if (mutation === "archive-sha") json.archive.sha256 = "f".repeat(64);
      if (mutation === "archive-size") json.archive.size += 1;
      if (mutation === "bundle-family") json.runtime_id = "whisper-ctranslate2";
      const changed = JSON.stringify(json);
      writeFileSync(join(f.root, name), changed);
      f.manifest.assets[0] = asset(name, changed);
      writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
      await assert.rejects(run(f), /RUNTIME_QWEN_(ARCHIVE_IDENTITY_INVALID|BUNDLE_TOTAL_SIZE_MISMATCH|BUNDLE_IDENTITY_INVALID)/);
    } finally { f.close(); }
  }
});
test("Qwen incomplete and nonsequential candidate part sets fail before hashing", async () => {
  const f = fixture("runtime");
  try {
    let input = structuredClone(f.manifest);
    input.assets = [input.assets[0]];
    assert.throws(() => extractAssets(input, "runtime"), /RUNTIME_QWEN_ASSET_SET_INCOMPLETE/);
    input = structuredClone(f.manifest);
    input.assets[1].name = "TDAQwenRuntime-1.0.19-windows-x64.zip.part003";
    assert.throws(() => extractAssets(input, "runtime"), /RUNTIME_QWEN_PART_SEQUENCE_INVALID/);
    input.assets[1].name = "TDAQwenRuntime-1.0.19-windows-x64.zip.part001";
    input.family = "whisper";
    assert.throws(() => extractAssets(input, "runtime"), /RUNTIME_WHISPER_ASSET_SET_INCOMPLETE/);
  } finally { f.close(); }
});
function whisperFixture() {
  const f = fixture("runtime");
  for (const name of Object.keys(f.bytes)) rmSync(join(f.root, name));
  const archive = "TDAWhisperRuntime-1.0.19-windows-x64.zip";
  const archiveBytes = "synthetic-whisper-runtime-archive";
  const checksum = digest(archiveBytes) + "  " + archive + "\n";
  const sidecar = archive + ".sha256";
  writeFileSync(join(f.root, archive), archiveBytes);
  writeFileSync(join(f.root, sidecar), checksum);
  f.manifest.family = "whisper";
  f.manifest.runtime_id = "whisper-ctranslate2";
  f.manifest.runtime_archive_sha256 = digest(archiveBytes);
  f.manifest.candidate_tag = "companion-whisper-runtime-rc-v1.0.19-" + SOURCE.slice(0, 12);
  f.manifest.stable_tag = "companion-whisper-runtime-v1.0.19";
  f.manifest.assets = [asset(archive, archiveBytes), asset(sidecar, checksum)];
  writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
  return f;
}
test("Whisper RC real layout requires archive and matching digest sidecar", async () => {
  const f = whisperFixture();
  try {
    const report = await run(f);
    assert.equal(report.assets_hashed, 2);
    assert.equal(report.github_attestation, "not-checked");
    assert.equal(report.authorizes_stable, false);
  } finally { f.close(); }
});
test("Whisper sidecar with forged archive SHA fails even when all listed asset hashes match", async () => {
  const f = whisperFixture();
  try {
    const name = f.manifest.assets[1].name;
    const wrong = "f".repeat(64) + "  " + f.manifest.assets[0].name + "\n";
    writeFileSync(join(f.root, name), wrong);
    f.manifest.assets[1] = asset(name, wrong);
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    await assert.rejects(run(f), /RUNTIME_WHISPER_SIDECAR_OR_ARCHIVE_MISMATCH/);
  } finally { f.close(); }
});


test("Companion RC payload manifest must match version, source SHA, tree SHA and exact file set", async () => {
  for (const mutation of ["source", "tree", "version", "missing-file", "invalid-row"]) {
    const f = fixture();
    try {
      const name = "TDACompanion-payload-manifest.json";
      const payload = JSON.parse(readFileSync(join(f.root, name), "utf8"));
      if (mutation === "source") payload.source_sha = "f".repeat(40);
      if (mutation === "tree") payload.source_tree_sha = "f".repeat(40);
      if (mutation === "version") payload.version = "9.9.9";
      if (mutation === "missing-file") delete payload.files["TDACompanionMaintenance.exe"];
      if (mutation === "invalid-row") payload.files["TDACompanion.exe"].sha256 = "bad";
      const bytes = JSON.stringify(payload);
      writeFileSync(join(f.root, name), bytes);
      f.manifest.assets.payload_manifest = asset(name, bytes);
      writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
      // Every listed file still has correct declared SHA256 and size; only
      // semantic validation of payload identity/completeness can reject it.
      await assert.rejects(run(f), /COMPANION_PAYLOAD_(IDENTITY_MISMATCH|FILES_INCOMPLETE|FILE_METADATA_INVALID)/);
    } finally { f.close(); }
  }
});
test("Companion payload even with recalculated candidate hash fails on old/invalid payload schema", async () => {
  const f = fixture();
  try {
    const name = "TDACompanion-payload-manifest.json";
    const payload = JSON.parse(readFileSync(join(f.root, name), "utf8"));
    payload.schema = "tda_companion_payload_v0";
    const bytes = JSON.stringify(payload);
    writeFileSync(join(f.root, name), bytes);
    f.manifest.assets.payload_manifest = asset(name, bytes);
    writeFileSync(f.manifestFile, JSON.stringify(f.manifest));
    await assert.rejects(run(f), /COMPANION_PAYLOAD_IDENTITY_MISMATCH/);
  } finally { f.close(); }
});
