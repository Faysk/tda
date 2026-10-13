import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "Faysk/tda";
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
export const SIGNERS = Object.freeze({
  companion: "Faysk/tda/.github/workflows/companion-rc.yml",
  runtime: "Faysk/tda/.github/workflows/runtime-rc.yml",
});
export const POLICY = "tda-rc-attestation-v1";

// This is an opt-in, READ-ONLY consumer tool; it does NOT change release gates.
// Expected signer workflow digest must be established independently of the candidate, using trusted RC GitHub Actions
// workflow run. It may differ from candidate.source_sha in manual RC dispatches.
export function validateExpected({ family, sourceSha, signerSha, manifestName }) {
  if (!Object.hasOwn(SIGNERS, family)) throw new Error("UNKNOWN_RC_FAMILY");
  if (!SHA.test(sourceSha ?? "") || !SHA.test(signerSha ?? ""))
    throw new Error("EXPECTED_SHA_INVALID");
  const expectedName = family === "companion" ? "TDACompanion-candidate.json" : "TDARuntime-candidate.json";
  if (manifestName !== expectedName) throw new Error("CANDIDATE_FILENAME_UNEXPECTED");
  return expectedName;
}
export function validateManifestIdentity(manifest, { family, sourceSha }) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new Error("CANDIDATE_MANIFEST_INVALID");
  const schema = family === "companion" ? "tda_companion_candidate_v2" : "tda_runtime_candidate_v1";
  if (manifest.schema !== schema) throw new Error("CANDIDATE_SCHEMA_MISMATCH");
  if (manifest.source_sha !== sourceSha) throw new Error("CANDIDATE_SOURCE_SHA_MISMATCH");
  if (!SHA.test(manifest.source_tree_sha ?? "")) throw new Error("CANDIDATE_TREE_SHA_INVALID");
  if (family === "runtime" && !["qwen", "whisper"].includes(manifest.family))
    throw new Error("RUNTIME_FAMILY_UNKNOWN");
  if (typeof manifest.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version))
    throw new Error("CANDIDATE_VERSION_UNKNOWN");
  if (!Number.isSafeInteger(manifest.workflow_run_id) || manifest.workflow_run_id <= 0)
    throw new Error("CANDIDATE_BUILD_RUN_ID_INVALID");
  const prefix = sourceSha.slice(0, 12);
  const expectedTag = family === "companion" ?
    "companion-rc-v" + manifest.version + "-" + prefix :
    "companion-" + manifest.family + "-runtime-rc-v" + manifest.version + "-" + prefix;
  if ((family === "companion" ? manifest.tag : manifest.candidate_tag) !== expectedTag)
    throw new Error("CANDIDATE_RC_TAG_MISMATCH");
  if (family === "companion" && manifest.channel !== "rc")
    throw new Error("CANDIDATE_CHANNEL_MISMATCH");
  if (family === "runtime" &&
      manifest.stable_tag !== "companion-" + manifest.family + "-runtime-v" + manifest.version)
    throw new Error("RUNTIME_STABLE_TAG_MISMATCH");
  return manifest;
}
export function attestationArguments(filePath, { family, sourceSha, signerSha }) {
  validateExpected({ family, sourceSha, signerSha, manifestName: basename(filePath) });
  return ["attestation", "verify", filePath, "--repo", REPO,
    "--signer-workflow", SIGNERS[family], "--signer-digest", signerSha,
    "--predicate-type", "https://slsa.dev/provenance/v1",
    "--deny-self-hosted-runners", "--format", "json"];
}
export function validateVerifiedResponse(response, { expectedDigest, manifestName }) {
  if (!HASH.test(expectedDigest) || typeof manifestName !== "string") throw new Error("EXPECTED_SUBJECT_INVALID");
  if (!Array.isArray(response) || response.length === 0) throw new Error("NO_VERIFIED_ATTESTATIONS");
  for (const row of response) {
    const statement = row?.verificationResult?.statement;
    if (statement?.predicateType !== "https://slsa.dev/provenance/v1") continue;
    const subjects = statement?.subject;
    if (!Array.isArray(subjects)) continue;
    if (subjects.some((subject) => subject?.name === manifestName &&
        subject?.digest?.sha256 === expectedDigest)) return true;
  }
  throw new Error("VERIFIED_SUBJECT_OR_PREDICATE_MISMATCH");
}
export function verifyRcManifest({ family, manifestFile, sourceSha, signerSha }, runner = execFileSync) {
  const absoluteFile = resolve(manifestFile);
  const filename = basename(absoluteFile);
  validateExpected({ family, sourceSha, signerSha, manifestName: filename });
  const stat = statSync(absoluteFile);
  if (!stat.isFile() || stat.size < 2 || stat.size > 1024 * 1024)
    throw new Error("CANDIDATE_MANIFEST_SIZE_INVALID");
  const bytes = readFileSync(absoluteFile);
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("CANDIDATE_MANIFEST_JSON_INVALID"); }
  validateManifestIdentity(manifest, { family, sourceSha });
  const digest = createHash("sha256").update(bytes).digest("hex");
  let verified;
  try {
    // execFileSync invokes gh directly (shell: false), checks its exit code,
    // and gh verifies the signed statement and signer workflow certificate; --signer-digest pins githubWorkflowSHA, not sourceRepositoryDigest.
    const output = runner("gh", attestationArguments(absoluteFile, { family, sourceSha, signerSha }),
      { encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
    verified = JSON.parse(output);
  } catch {
    throw new Error("GITHUB_ATTESTATION_VERIFICATION_FAILED");
  }
  validateVerifiedResponse(verified, { expectedDigest: digest, manifestName: filename });
  return {
    schema_version: 1, policy: POLICY, result: "verified-github-attestation",
    family, candidate_source_sha: sourceSha, signer_workflow_source_sha: signerSha,
    manifest_name: filename, manifest_sha256: digest,
    permits_promotion: false, physical_acceptance: "not-checked",
    other_release_assets: "not-checked", production: "not-authorized",
  };
}
function main() {
  const [family, manifestFile, sourceSha, signerSha] = process.argv.slice(2);
  if (process.argv.length !== 6) {
    throw new Error("Usage: node tools/ci/rc-attestation-consumer.mjs companion|runtime candidate-manifest.json candidate-source-sha signer-workflow-run-head-sha");
  }
  const value = verifyRcManifest({ family, manifestFile, sourceSha, signerSha });
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
