import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditRcAttestationPair, auditRcAttestationProducer } from "./rc-provenance-policy.mjs";

const companion = readFileSync(".github/workflows/companion-rc.yml", "utf8");
const runtime = readFileSync(".github/workflows/runtime-rc.yml", "utf8");
function rejected(family, original, changed, expected) {
  const errors = auditRcAttestationProducer(family, changed);
  assert.ok(errors.some(x => x.includes(expected)), JSON.stringify(errors));
  assert.notEqual(changed, original);
}
test("existing RC producer workflows pin action and attest all subjects before publishing", () => {
  assert.deepEqual(auditRcAttestationPair(companion, runtime), []);
});
test("dropping Companion MSI, checksum, ZIP, payload or candidate manifest is a CI regression", () => {
  for (const subject of ["dist/TDACompanion-x64.msi", "dist/TDACompanion-x64.msi.sha256",
    "dist/TDACompanion-*-windows-x64.zip", "dist/TDACompanion-payload-manifest.json",
    "dist/TDACompanion-candidate.json"]) {
    const original = "\n            " + subject + "\n";
    rejected("companion", companion, companion.replace(original, "\n            dist/FORGED.bin\n"),
      "companion-subject-missing:");
  }
});
test("floating action pin and removal of token scopes cannot pass", () => {
  rejected("companion", companion,
    companion.replace(/actions\/attest@[0-9a-f]{40}/, "actions/attest@main"),
    "companion-unpinned-attest-action");
  rejected("runtime", runtime,
    runtime.replace(/actions\/attest@[0-9a-f]{40}/, "actions/attest@v4"),
    "runtime-asset-unpinned-attest-action");
  rejected("runtime", runtime, runtime.replace("  attestations: write\n", "  attestations: read\n"),
    "missing-attestations-write");
  rejected("companion", companion, companion.replace("  id-token: write\n", "  id-token: read\n"),
    "missing-id-token-write");
});
test("Companion attestation must execute before release create", () => {
  const start = companion.indexOf("      - name: Attest exact Companion candidate bytes\n");
  const end = companion.indexOf("      - name: Detect existing RC\n", start);
  const step = companion.slice(start, end);
  const moved = companion.slice(0, start) + companion.slice(end) + "\n" + step;
  rejected("companion", companion, moved, "companion-attest-not-before-publish");
});
test("Runtime checksum subjects, manifest subjects, and proper order are required", () => {
  rejected("runtime", runtime,
    runtime.replace("subject-checksums: dist/TDARuntime-candidate-checksums.txt",
      "subject-checksums: dist/WRONG.txt"),
    "runtime-asset-attest-checksums-missing");
  rejected("runtime", runtime,
    runtime.replace("subject-path: dist/TDARuntime-candidate.json",
      "subject-path: dist/WRONG.json"),
    "runtime-manifest-subject-missing");
  rejected("runtime", runtime,
    runtime.replace("      - name: Attest runtime candidate manifest\n",
      "      - name: Removed runtime candidate signing\n"),
    "runtime-manifest-attest-step-missing");
  const start = runtime.indexOf("      - name: Attest runtime candidate manifest\n");
  const end = runtime.indexOf("      - name: Publish or verify immutable prerelease\n", start);
  const step = runtime.slice(start, end);
  const moved = runtime.slice(0, start) + runtime.slice(end) + "\n" + step;
  rejected("runtime", runtime, moved, "runtime-checksums-and-attest-order-invalid");
});
test("reject unknown producer class, not silently audit an arbitrary workflow", () => {
  assert.throws(() => auditRcAttestationProducer("stable", companion), TypeError);
  assert.throws(() => auditRcAttestationProducer("runtime", null), TypeError);
});
