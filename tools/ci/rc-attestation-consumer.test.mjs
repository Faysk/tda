import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  SIGNERS, POLICY, validateExpected, validateManifestIdentity,
  attestationArguments, validateVerifiedResponse, verifyRcManifest,
} from "./rc-attestation-consumer.mjs";

const sourceSha = "a".repeat(40);
const signerSha = "b".repeat(40);
const treeSha = "c".repeat(40);
const name = "TDACompanion-candidate.json";
function record(content, filename = name) {
  const dirname = mkdtempSync(join(tmpdir(), "tda-attest-synthetic-"));
  const file = join(dirname, filename);
  const bytes = JSON.stringify(content);
  writeFileSync(file, bytes);
  return { file, close: () => rmSync(dirname, { force: true, recursive: true }) };
}
const companion = () => ({ source_sha: sourceSha, source_tree_sha: treeSha, version: "0.3.17" });
const runtime = () => ({ source_sha: sourceSha, source_tree_sha: treeSha, version: "1.0.19", family: "qwen" });
function attested(file, edit = (x) => x) {
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  const envelope = [{ verificationResult: { statement: {
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: file.split("/").at(-1), digest: { sha256: hash } }],
  } } }];
  return JSON.stringify(edit(envelope));
}
function withFixture(content, filename, fn) {
  const { file, close } = record(content, filename);
  try { return fn(file); } finally { close(); }
}

test("known RC signer workflows and strict source identity", () => {
  assert.equal(SIGNERS.companion, "Faysk/tda/.github/workflows/companion-rc.yml");
  assert.equal(SIGNERS.runtime, "Faysk/tda/.github/workflows/runtime-rc.yml");
  assert.equal(validateExpected({ family: "companion", manifestName: name, sourceSha, signerSha }), name);
  assert.throws(() => validateExpected({ family: "unknown", manifestName: name, sourceSha, signerSha }), /UNKNOWN_RC_FAMILY/);
  assert.throws(() => validateExpected({ family: "companion", manifestName: "x.json", sourceSha, signerSha }), /CANDIDATE_FILENAME_UNEXPECTED/);
  assert.throws(() => validateExpected({ family: "companion", manifestName: name, sourceSha: "main", signerSha }), /EXPECTED_SHA_INVALID/);
});
test("gh verify command pinned to repo, RC workflow, signer run SHA and provenance predicate", () => {
  const args = attestationArguments("/tmp/" + name, { family: "companion", sourceSha, signerSha });
  assert.deepEqual(args, ["attestation", "verify", "/tmp/" + name, "--repo", "Faysk/tda",
    "--signer-workflow", "Faysk/tda/.github/workflows/companion-rc.yml",
    "--source-digest", signerSha, "--predicate-type", "https://slsa.dev/provenance/v1",
    "--deny-self-hosted-runners", "--format", "json"]);
  assert.deepEqual(attestationArguments("/tmp/TDARuntime-candidate.json",
    { family: "runtime", sourceSha, signerSha }).slice(5, 7), ["Faysk/tda", "--signer-workflow"]);
});
test("verified mock can validate candidate manifest only and never grant release", () => {
  withFixture(companion(), name, (file) => {
    const calls = [];
    const mock = (exe, args, opts) => {
      calls.push({ exe, args, opts });
      return attested(file);
    };
    const v = verifyRcManifest({ family: "companion", manifestFile: file, sourceSha, signerSha }, mock);
    assert.equal(v.result, "verified-github-attestation");
    assert.equal(v.policy, POLICY);
    assert.equal(v.permits_promotion, false);
    assert.equal(v.production, "not-authorized");
    assert.equal(v.physical_acceptance, "not-checked");
    assert.equal(v.other_release_assets, "not-checked");
    assert.equal(calls[0].exe, "gh");
    assert.equal(calls[0].opts.shell, undefined);
    assert.equal(calls[0].args.includes(signerSha), true);
  });
});
test("Qwen/Whisper manifest identity is explicit and separate from signer commit", () => {
  for (const family of ["qwen", "whisper"]) {
    withFixture({ ...runtime(), family }, "TDARuntime-candidate.json", (file) => {
      const v = verifyRcManifest({ family: "runtime", manifestFile: file, sourceSha, signerSha },
        () => attested(file));
      assert.equal(v.family, "runtime");
      assert.equal(v.candidate_source_sha, sourceSha);
      assert.equal(v.signer_workflow_source_sha, signerSha);
      assert.notEqual(v.candidate_source_sha, v.signer_workflow_source_sha);
    });
  }
});
test("refuse invalid manifest source, tree, version, family or wrong filename before gh call", () => {
  const cases = [
    [ { ...companion(), source_sha: "d".repeat(40) }, name, "companion", /CANDIDATE_SOURCE_SHA_MISMATCH/ ],
    [ { ...companion(), source_tree_sha: "x" }, name, "companion", /CANDIDATE_TREE_SHA_INVALID/ ],
    [ { ...companion(), version: "tip" }, name, "companion", /CANDIDATE_VERSION_UNKNOWN/ ],
    [ { ...runtime(), family: "cuda" }, "TDARuntime-candidate.json", "runtime", /RUNTIME_FAMILY_UNKNOWN/ ],
    [ companion(), "TDACompanion-altered.json", "companion", /CANDIDATE_FILENAME_UNEXPECTED/ ],
  ];
  for (const [m, filename, family, expected] of cases) {
    withFixture(m, filename, (file) => {
      assert.throws(() => verifyRcManifest({ family, manifestFile: file, sourceSha, signerSha },
        () => { throw new Error("must not run gh"); }), expected);
    });
  }
  assert.throws(() => validateManifestIdentity([], { family: "companion", sourceSha }), /MANIFEST_INVALID/);
});
test("missing, empty, malformed or mismatched attestation cannot pass policy", () => {
  withFixture(companion(), name, (file) => {
    const opts = { family: "companion", manifestFile: file, sourceSha, signerSha };
    for (const answer of ["[]", "null", "{}", "not-json"]) {
      assert.throws(() => verifyRcManifest(opts, () => answer), /ATTESTATION|SUBJECT/);
    }
    assert.throws(() => verifyRcManifest(opts, () => { throw new Error("API unavailable"); }),
      /GITHUB_ATTESTATION_VERIFICATION_FAILED/);
    assert.throws(() => verifyRcManifest(opts, () => attested(file, (rows) => {
      rows[0].verificationResult.statement.subject[0].digest.sha256 = "f".repeat(64);
      return rows;
    })), /VERIFIED_SUBJECT_OR_PREDICATE_MISMATCH/);
    assert.throws(() => verifyRcManifest(opts, () => attested(file, (rows) => {
      rows[0].verificationResult.statement.predicateType = "https://spdx.dev/Document/v2.3";
      return rows;
    })), /VERIFIED_SUBJECT_OR_PREDICATE_MISMATCH/);
  });
});
test("rejects stale other-subjects, empty signer, path confusion and incorrect hash length", () => {
  const opts = { expectedDigest: "a".repeat(64), manifestName: name };
  const data = JSON.parse(attested("/tmp/" + name));
  data[0].verificationResult.statement.subject[0].digest.sha256 = "b".repeat(64);
  assert.throws(() => validateVerifiedResponse(data, opts), /VERIFIED_SUBJECT_OR_PREDICATE_MISMATCH/);
  data[0].verificationResult.statement.subject[0].digest.sha256 = opts.expectedDigest;
  data[0].verificationResult.statement.subject[0].name = "../other.json";
  assert.throws(() => validateVerifiedResponse(data, opts), /VERIFIED_SUBJECT_OR_PREDICATE_MISMATCH/);
  assert.throws(() => validateVerifiedResponse(data, { ...opts, expectedDigest: "invalid" }), /EXPECTED_SUBJECT_INVALID/);
});
test("supply-chain tool does not look at releases, alter files or claim physical acceptance", () => {
  withFixture(companion(), name, (file) => {
    const old = readFileSync(file, "utf8");
    const result = verifyRcManifest({ family: "companion", manifestFile: file, sourceSha, signerSha },
      () => attested(file));
    assert.equal(readFileSync(file, "utf8"), old);
    assert.equal(result.other_release_assets, "not-checked");
    assert.equal(result.physical_acceptance, "not-checked");
    assert.equal(result.permits_promotion, false);
  });
});
