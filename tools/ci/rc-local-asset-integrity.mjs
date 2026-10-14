import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifestIdentity } from "./rc-attestation-consumer.mjs";

// #1667 — read-only local hash companion to attestation verification.
// It does NOT download assets, verify a Sigstore attestation, inspect installed
// GPUs/Windows, approve promotion, mutate release metadata or execute installers.
const HEX64 = /^[a-f0-9]{64}$/;
const SAFE_FILE = /^TDA[A-Za-z0-9._-]+$/;
const COMPANION_KEYS = ["msi", "checksum", "zip", "payload_manifest"];
const MAX_ASSETS = 64;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_CHECKSUM_BYTES = 512;
export const LOCAL_ASSET_POLICY = "tda-rc-local-integrity-v1";

function exactSha(row) {
  return row && typeof row === "object" && !Array.isArray(row) &&
    typeof row.sha256 === "string" && HEX64.test(row.sha256) &&
    Number.isSafeInteger(row.size) && row.size > 0 &&
    typeof row.name === "string" && SAFE_FILE.test(row.name) &&
    row.name === basename(row.name) && !row.name.includes("..");
}
export function extractAssets(manifest, family) {
  let rows;
  if (family === "companion") {
    if (!manifest?.assets || typeof manifest.assets !== "object" ||
      Array.isArray(manifest.assets) ||
      Object.keys(manifest.assets).sort().join(",") !== COMPANION_KEYS.slice().sort().join(","))
      throw new Error("COMPANION_ASSET_RECORD_INVALID");
    rows = COMPANION_KEYS.map((key) => ({ key, ...manifest.assets[key] }));
    if (rows[0]?.name !== "TDACompanion-x64.msi" ||
        rows[1]?.name !== "TDACompanion-x64.msi.sha256" ||
        rows[2]?.name !== "TDACompanion-" + manifest.version + "-windows-x64.zip" ||
        rows[3]?.name !== "TDACompanion-payload-manifest.json")
      throw new Error("COMPANION_ASSET_FILENAMES_UNEXPECTED");
  } else if (family === "runtime") {
    if (!Array.isArray(manifest?.assets) || !manifest.assets.length ||
        manifest.assets.length > MAX_ASSETS)
      throw new Error("RUNTIME_ASSET_RECORD_INVALID");
    rows = manifest.assets.map((item) => ({ ...item }));
  } else throw new Error("RC_FAMILY_UNKNOWN");
  if (rows.length > MAX_ASSETS || rows.some((r) => !exactSha(r)))
    throw new Error("RC_ASSET_METADATA_INVALID");
  const seen = new Set();
  for (const item of rows) {
    const lower = item.name.toLowerCase();
    if (seen.has(lower)) throw new Error("RC_ASSET_DUPLICATE_NAME");
    seen.add(lower);
  }
  if (family === "runtime") {
    // Enforce the producer's actual asset shape; merely hashing an arbitrary
    // subset of a signed candidate would falsely claim "all assets checked".
    if (manifest.family === "whisper") {
      const archive = "TDAWhisperRuntime-" + manifest.version + "-windows-x64.zip";
      if (rows.length !== 2 || rows[0].name !== archive ||
          rows[1].name !== archive + ".sha256")
        throw new Error("RUNTIME_WHISPER_ASSET_SET_INCOMPLETE");
    } else if (manifest.family === "qwen") {
      const bundle = "TDAQwenRuntimeBundle-" + manifest.version + "-windows-x64.json";
      if (rows.length < 2 || rows.length > 17 || rows[0].name !== bundle)
        throw new Error("RUNTIME_QWEN_ASSET_SET_INCOMPLETE");
      for (let i = 1; i < rows.length; i++) {
        const expected = "TDAQwenRuntime-" + manifest.version +
          "-windows-x64.zip.part" + String(i).padStart(3, "0");
        if (rows[i].name !== expected)
          throw new Error("RUNTIME_QWEN_PART_SEQUENCE_INVALID");
      }
    } else throw new Error("RUNTIME_FAMILY_UNKNOWN");
  }
  return rows;
}
async function sha256RegularFile(file, expectedSize) {
  // A file descriptor with O_NOFOLLOW and fstat prevents simple symlink
  // replacement. Only explicit local assets are opened; no recursion/globbing.
  let descriptor;
  try {
    const pre = await lstat(file);
    if (!pre.isFile() || pre.isSymbolicLink() || pre.size !== expectedSize)
      throw new Error("RC_ASSET_FILE_TYPE_OR_SIZE_INVALID");
    descriptor = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await descriptor.stat();
    if (!stat.isFile() || stat.size !== expectedSize ||
        (pre.ino && stat.ino && pre.ino !== stat.ino))
      throw new Error("RC_ASSET_FILE_CHANGED_OR_INVALID");
    const hash = createHash("sha256");
    const stream = descriptor.createReadStream({ autoClose: false, highWaterMark: 1024 * 1024 });
    for await (const block of stream) hash.update(block);
    const end = await descriptor.stat();
    if (!end.isFile() || end.size !== expectedSize) throw new Error("RC_ASSET_CHANGED_DURING_READ");
    return hash.digest("hex");
  } finally {
    await descriptor?.close();
  }
}
async function confirmCompanionChecksum(root, byName, msiDigest) {
  const row = byName.get("TDACompanion-x64.msi.sha256");
  if (!row || row.size > MAX_CHECKSUM_BYTES) throw new Error("RC_MSI_CHECKSUM_SIZE_INVALID");
  const path = join(root, row.name);
  let descriptor;
  let content;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== row.size)
      throw new Error("RC_MSI_CHECKSUM_FILE_INVALID");
    descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const actual = await descriptor.stat();
    if (!actual.isFile() || actual.size !== row.size ||
        (before.ino && actual.ino && before.ino !== actual.ino))
      throw new Error("RC_MSI_CHECKSUM_FILE_CHANGED");
    // Safe after checking against MAX_CHECKSUM_BYTES; do not re-read an
    // unchecked path with readFile() (symlink/race/unbounded-read concern).
    content = await descriptor.readFile({ encoding: "utf8" });
  } finally { await descriptor?.close(); }
  const match = /^([a-f0-9]{64})\s+\*?TDACompanion-x64\.msi\r?\n?$/.exec(content);
  if (!match || match[1] !== msiDigest)
    throw new Error("RC_MSI_CHECKSUM_CONTENT_MISMATCH");
}
export async function verifyLocalRcAssets({ family, manifestFile, assetsRoot, sourceSha }) {
  const name = family === "companion" ? "TDACompanion-candidate.json" :
    family === "runtime" ? "TDARuntime-candidate.json" : null;
  if (!name || basename(manifestFile) !== name || !/^[a-f0-9]{40}$/.test(sourceSha ?? ""))
    throw new Error("RC_CANDIDATE_INPUT_INVALID");
  const file = resolve(manifestFile);
  const root = resolve(assetsRoot);
  const manifestStat = await lstat(file);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() ||
      manifestStat.size < 2 || manifestStat.size > MAX_MANIFEST_BYTES)
    throw new Error("RC_MANIFEST_SIZE_OR_TYPE_INVALID");
  let manifestBytes, manifestDescriptor;
  try {
    manifestDescriptor = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await manifestDescriptor.stat();
    if (!opened.isFile() || opened.size !== manifestStat.size ||
        (manifestStat.ino && opened.ino && manifestStat.ino !== opened.ino))
      throw new Error("RC_MANIFEST_CHANGED_OR_INVALID");
    manifestBytes = await manifestDescriptor.readFile();
    const after = await manifestDescriptor.stat();
    if (!after.isFile() || after.size !== opened.size ||
        manifestBytes.length !== opened.size)
      throw new Error("RC_MANIFEST_CHANGED_DURING_READ");
  } finally { await manifestDescriptor?.close(); }
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch { throw new Error("RC_MANIFEST_JSON_INVALID"); }
  validateManifestIdentity(manifest, { family, sourceSha });
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("RC_ASSETS_ROOT_INVALID");
  const assets = extractAssets(manifest, family);
  const byName = new Map(assets.map((x) => [x.name, x]));
  let total = 0;
  for (const item of assets) {
    let actual;
    try { actual = await sha256RegularFile(join(root, item.name), item.size); }
    catch (error) {
      if (error?.code === "ENOENT") throw new Error("RC_ASSET_MISSING:" + item.name);
      throw error;
    }
    if (actual !== item.sha256) throw new Error("RC_ASSET_SHA256_MISMATCH:" + item.name);
    total += item.size;
    if (!Number.isSafeInteger(total)) throw new Error("RC_ASSETS_TOTAL_SIZE_OVERFLOW");
  }
  if (family === "companion")
    await confirmCompanionChecksum(root, byName, manifest.assets.msi.sha256);
  return {
    policy: LOCAL_ASSET_POLICY, family,
    source_sha: sourceSha, candidate_tag: family === "companion" ? manifest.tag : manifest.candidate_tag,
    assets_hashed: assets.length, total_bytes_hashed: total,
    manifest_sha256: manifestSha256,
    local_asset_integrity: "verified-sha256",
    github_attestation: "not-checked", physical_receipts: "not-checked",
    authorizes_stable: false, authorizes_production: false,
  };
}
async function main() {
  if (process.argv.length !== 6)
    throw new Error("Usage: node tools/ci/rc-local-asset-integrity.mjs companion|runtime rc-candidate.json local-assets-directory trusted-candidate-source-sha");
  const [, , family, manifestFile, assetsRoot, sourceSha] = process.argv;
  const report = await verifyLocalRcAssets({ family, manifestFile, assetsRoot, sourceSha });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
