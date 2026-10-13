import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { auditRcCandidate } from "./rc-evidence-audit.mjs";
import { extractAssets } from "./rc-local-asset-integrity.mjs";

// #1667 — read-only, optional **metadata snapshot** of a published public RC.
// Metadata is mutable GitHub API information, not an attestation, git tag-ref
// proof, physical acceptance receipt or permission to promote a release.
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const TAG = /^(?:companion-rc-v\d+\.\d+\.\d+|companion-(?:qwen|whisper)-runtime-rc-v\d+\.\d+\.\d+)-[a-f0-9]{12}$/;
export const PUBLIC_RC_POLICY = "tda-public-rc-metadata-v1";

function exactAsset(value) {
  return value && typeof value.name === "string" && /^[A-Za-z0-9._-]+$/.test(value.name) &&
    value.name !== "." && value.name !== ".." && !value.name.includes("..") &&
    Number.isSafeInteger(value.size) && value.size > 0 && HASH.test(value.sha256 ?? "");
}
export function verifyPublishedRcMetadata({ release, tag, sourceSha, expectedAssets }) {
  if (!TAG.test(tag ?? "") || !SHA.test(sourceSha ?? "") ||
      !tag.endsWith("-" + sourceSha.slice(0, 12)) ||
      !Array.isArray(expectedAssets) || expectedAssets.length < 2 ||
      expectedAssets.length > 65 || !expectedAssets.every(exactAsset))
    throw new Error("RC_REMOTE_EXPECTATIONS_INVALID");
  if (!release || typeof release !== "object" || Array.isArray(release) ||
      !Number.isSafeInteger(release.id) || release.id <= 0 ||
      release.tag_name !== tag || release.target_commitish !== sourceSha ||
      release.draft !== false || release.prerelease !== true ||
      !Number.isFinite(Date.parse(release.published_at ?? "")))
    throw new Error("RC_REMOTE_RELEASE_IDENTITY_INVALID");
  const metadata = release.assets;
  if (!Array.isArray(metadata) || metadata.length !== expectedAssets.length)
    throw new Error("RC_REMOTE_ASSET_SET_MISMATCH");
  const expected = new Map();
  for (const a of expectedAssets) {
    const key = a.name.toLowerCase();
    if (expected.has(key)) throw new Error("RC_REMOTE_EXPECTED_DUPLICATE_NAME");
    expected.set(key, a);
  }
  const observed = new Map();
  for (const a of metadata) {
    if (!a || typeof a.name !== "string" ||
        !Number.isSafeInteger(a.id) || a.id <= 0 ||
        a.state !== "uploaded" ||
        !Number.isSafeInteger(a.size) || a.size <= 0 ||
        !/^sha256:[a-f0-9]{64}$/.test(a.digest ?? ""))
      throw new Error("RC_REMOTE_ASSET_METADATA_INVALID");
    const key = a.name.toLowerCase();
    if (observed.has(key)) throw new Error("RC_REMOTE_DUPLICATE_ASSET");
    observed.set(key, a);
  }
  for (const [key, row] of expected) {
    const asset = observed.get(key);
    if (!asset || asset.name !== row.name || asset.size !== row.size ||
        asset.digest !== "sha256:" + row.sha256)
      throw new Error("RC_REMOTE_ASSET_MISMATCH:" + row.name);
  }
  return {
    schema_version: 1, policy: PUBLIC_RC_POLICY, tag, source_sha: sourceSha,
    release_id: release.id, published_at: release.published_at,
    assets_matched: expectedAssets.length,
    release_metadata: "verified-against-github-readonly-api",
    git_tag_object_target: "not-checked",
    release_immutability: "not-proven",
    physical_acceptance: "not-checked",
    authorizes_stable: false, authorizes_production: false,
  };
}

async function manifestSnapshot(file) {
  const path = resolve(file);
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || st.size < 2 || st.size > 1024 * 1024)
    throw new Error("RC_REMOTE_MANIFEST_TYPE_OR_SIZE_INVALID");
  let fd;
  try {
    fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const pre = await fd.stat();
    if (!pre.isFile() || pre.size !== st.size ||
        (st.ino && pre.ino && st.ino !== pre.ino))
      throw new Error("RC_REMOTE_MANIFEST_CHANGED");
    const bytes = await fd.readFile();
    const post = await fd.stat();
    if (bytes.length !== pre.size || !post.isFile() || post.size !== pre.size)
      throw new Error("RC_REMOTE_MANIFEST_CHANGED_DURING_READ");
    let manifest;
    try { manifest = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error("RC_REMOTE_MANIFEST_JSON_INVALID"); }
    return { manifest, size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally { await fd?.close(); }
}
function publicRelease(tag, runner = execFileSync) {
  // The supplied tag must have passed the RC pattern before this call.
  let release;
  try {
    release = JSON.parse(runner("gh",
      ["api", "repos/Faysk/tda/releases/tags/" + tag],
      { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 }));
  } catch { throw new Error("RC_REMOTE_RELEASE_LOOKUP_FAILED"); }
  return release;
}

export function verifyRcGitTagReference({ tag, sourceSha, githubGet = execFileSync }) {
  if (!TAG.test(tag ?? "") || !SHA.test(sourceSha ?? "") ||
      !tag.endsWith("-" + sourceSha.slice(0, 12)))
    throw new Error("RC_GIT_TAG_INPUT_INVALID");
  function fetchGit(path) {
    try {
      return JSON.parse(githubGet("gh", ["api", path],
        { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 }));
    } catch { throw new Error("RC_GIT_TAG_API_UNAVAILABLE"); }
  }
  const root = fetchGit("repos/Faysk/tda/git/ref/tags/" + tag);
  if (root?.ref !== "refs/tags/" + tag || !root?.object)
    throw new Error("RC_GIT_TAG_REF_IDENTITY_INVALID");
  let object = root.object, depth = 0;
  const observedTags = new Set();
  while (object?.type === "tag") {
    if (!SHA.test(object?.sha ?? "") || observedTags.has(object.sha) || ++depth > 4)
      throw new Error("RC_GIT_TAG_PEEL_INVALID");
    observedTags.add(object.sha);
    const tagged = fetchGit("repos/Faysk/tda/git/tags/" + object.sha);
    if (tagged?.sha !== object.sha || !tagged?.object)
      throw new Error("RC_GIT_TAG_OBJECT_INVALID");
    object = tagged.object;
  }
  if (object?.type !== "commit" || object?.sha !== sourceSha)
    throw new Error("RC_GIT_TAG_TARGET_SHA_MISMATCH");
  return {
    ref: "refs/tags/" + tag, commit_sha: sourceSha, peeled_tag_depth: depth,
    git_ref_target: "verified-at-fetch", git_tag_immutability: "not-proven",
  };
}

export async function auditPublishedRc(input, {
  verifyCombined = auditRcCandidate,
  githubGet = execFileSync,
} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.manifestFile !== "string" || !input.manifestFile)
    throw new Error("RC_REMOTE_INPUT_INVALID");
  const combined = await verifyCombined(input);
  const { candidate_tag: tag, source_sha: sourceSha, manifest_sha256: trustedDigest } = combined ?? {};
  if (!TAG.test(tag ?? "") || !SHA.test(sourceSha ?? "") ||
      !HASH.test(trustedDigest ?? "") || sourceSha !== input.sourceSha ||
      combined?.authorizes_stable !== false ||
      combined?.authorizes_production !== false ||
      combined?.decision !== "manual-review-required" ||
      combined?.checks?.manifest_unchanged_between_checks !== true)
    throw new Error("RC_REMOTE_COMBINED_EVIDENCE_INVALID");
  const snapshot = await manifestSnapshot(input.manifestFile);
  if (snapshot.sha256 !== trustedDigest)
    throw new Error("RC_REMOTE_MANIFEST_CHANGED_AFTER_COMBINED_AUDIT");
  const assets = extractAssets(snapshot.manifest, input.family);
  const expectedAssets = [
    { name: basename(input.manifestFile), size: snapshot.size, sha256: snapshot.sha256 },
    ...assets.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
  ];
  const release = publicRelease(tag, githubGet);
  const metadata = verifyPublishedRcMetadata({ release, tag, sourceSha, expectedAssets });
  const gitRef = verifyRcGitTagReference({ tag, sourceSha, githubGet });
  return {
    schema_version: 1, policy: "tda-public-rc-triple-evidence-v1",
    combined_audit: combined, public_release_metadata: metadata,
    git_tag_reference: gitRef,
    remote_release_state: "matched-release-and-tag-ref-at-fetch",
    git_tag_object_target: "verified-at-fetch",
    release_immutability: "not-proven",
    unique_signer_run_attribution: "not-verified",
    physical_acceptance: "not-checked",
    authorizes_stable: false, authorizes_production: false,
    decision: "manual-review-required",
  };
}
async function main() {
  if (process.argv.length !== 7) throw new Error(
    "Usage: node tools/ci/rc-public-release-audit.mjs companion|runtime candidate.json local-assets-dir trusted-source-sha signer-rc-run-id");
  const [, , family, manifestFile, assetsRoot, sourceSha, rawId] = process.argv;
  if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId)))
    throw new Error("RC_REMOTE_SIGNER_RUN_ID_INVALID");
  const result = await auditPublishedRc({
    family, manifestFile, assetsRoot, sourceSha, signerRunId: Number(rawId),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
