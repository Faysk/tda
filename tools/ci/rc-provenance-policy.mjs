// #1667 — static producer-side attestation contract, not a release signer.
// Keep this check in CI so a future workflow edit cannot silently remove an RC
// subject while consumer tooling continues to claim meaningful provenance.
const ACTION = /uses:\s*actions\/attest@[0-9a-f]{40}\b/;
const COMMON_PERMISSIONS = ["id-token: write", "attestations: write"];
function attestationStep(yaml, name) {
  const marker = "      - name: " + name + "\n";
  const start = yaml.indexOf(marker);
  if (start < 0) return null;
  const next = yaml.indexOf("\n      - name:", start + marker.length);
  return yaml.slice(start, next < 0 ? yaml.length : next);
}
function reject(violations, condition, reason) { if (!condition) violations.push(reason); }
export function auditRcAttestationProducer(name, yaml) {
  if (!["companion", "runtime"].includes(name) || typeof yaml !== "string")
    throw new TypeError("RC_PRODUCER_INPUT_INVALID");
  const errors = [];
  for (const permission of COMMON_PERMISSIONS)
    reject(errors, yaml.includes("\n  " + permission + "\n"), "missing-" + permission.replace(/[: ]+/g, "-"));
  if (name === "companion") {
    const step = attestationStep(yaml, "Attest exact Companion candidate bytes");
    reject(errors, Boolean(step), "companion-attest-step-missing");
    if (step) {
      reject(errors, ACTION.test(step), "companion-unpinned-attest-action");
      reject(errors, step.includes("subject-path: |"), "companion-subject-path-missing");
      for (const file of [
        "dist/TDACompanion-x64.msi",
        "dist/TDACompanion-x64.msi.sha256",
        "dist/TDACompanion-*-windows-x64.zip",
        "dist/TDACompanion-payload-manifest.json",
        "dist/TDACompanion-candidate.json",
      ]) reject(errors, step.includes("\n            " + file + "\n"), "companion-subject-missing:" + file);
    }
    const pub = yaml.indexOf("      - name: Publish immutable prerelease candidate\n");
    const attest = yaml.indexOf("      - name: Attest exact Companion candidate bytes\n");
    reject(errors, pub >= 0 && attest >= 0 && attest < pub, "companion-attest-not-before-publish");
  } else {
    const assets = attestationStep(yaml, "Attest exact runtime asset digests without re-hashing multi-GB archives");
    const candidate = attestationStep(yaml, "Attest runtime candidate manifest");
    reject(errors, Boolean(assets), "runtime-asset-attest-step-missing");
    reject(errors, Boolean(candidate), "runtime-manifest-attest-step-missing");
    if (assets) {
      reject(errors, ACTION.test(assets), "runtime-asset-unpinned-attest-action");
      reject(errors, assets.includes("subject-checksums: dist/TDARuntime-candidate-checksums.txt"),
        "runtime-asset-attest-checksums-missing");
    }
    if (candidate) {
      reject(errors, ACTION.test(candidate), "runtime-manifest-unpinned-attest-action");
      reject(errors, candidate.includes("subject-path: dist/TDARuntime-candidate.json"),
        "runtime-manifest-subject-missing");
    }
    const generate = yaml.indexOf('Path("dist/TDARuntime-candidate-checksums.txt").write_text(');
    const attestA = yaml.indexOf("      - name: Attest exact runtime asset digests without re-hashing multi-GB archives\n");
    const attestM = yaml.indexOf("      - name: Attest runtime candidate manifest\n");
    const pub = yaml.indexOf("      - name: Publish or verify immutable prerelease\n");
    reject(errors, generate >= 0 && attestA >= 0 && attestM >= 0 && pub >= 0 &&
      generate < attestA && attestA < attestM && attestM < pub, "runtime-checksums-and-attest-order-invalid");
  }
  return [...new Set(errors)].sort();
}
export function auditRcAttestationPair(companion, runtime) {
  return [
    ...auditRcAttestationProducer("companion", companion),
    ...auditRcAttestationProducer("runtime", runtime),
  ].sort();
}
