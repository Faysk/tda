import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { trustedMainPreviewDeployments } from "./main-preview-deployments.mjs";

const sha = "ebca0fc5e9172c539bcf7e02f517c20d797ff183";
const manualDeployment = {
  id: 7091511646, sha, ref: "main", environment: "preview",
  creator: { login: "Faysk" },
  performed_via_github_app: { id: 15368, slug: "github-actions" },
};

test("accepts the Actions environment receipt for a manual dispatch actor", () => {
  assert.deepEqual(trustedMainPreviewDeployments([manualDeployment], sha), [manualDeployment]);
});

test("accepts a bot actor only with the same trusted Actions app provenance", () => {
  const receipt = { ...manualDeployment, creator: { login: "github-actions[bot]" } };
  assert.deepEqual(trustedMainPreviewDeployments([receipt], sha), [receipt]);
});

test("rejects missing or spoofed app provenance regardless of creator login", () => {
  for (const app of [null, undefined, { id: 1, slug: "github-actions" },
    { id: 15368, slug: "other-app" }, { id: "15368", slug: "github-actions" }]) {
    const receipt = { ...manualDeployment, creator: { login: "github-actions[bot]" },
      performed_via_github_app: app };
    assert.deepEqual(trustedMainPreviewDeployments([receipt], sha), []);
  }
});

test("rejects a different commit, environment, ref or invalid receipt identity", () => {
  for (const change of [{ sha: "a".repeat(40) }, { environment: "production" },
    { ref: "feature" }, { id: 0 }, { id: "7091511646" }]) {
    assert.deepEqual(trustedMainPreviewDeployments([{ ...manualDeployment, ...change }], sha), []);
  }
  for (const input of [null, {}, [null]]) assert.deepEqual(trustedMainPreviewDeployments(input, sha), []);
  assert.deepEqual(trustedMainPreviewDeployments([manualDeployment], "main"), []);
});

test("Production uses the provenance helper while preserving successful Preview gates", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/production-cd.yml", import.meta.url), "utf8");
  assert.match(workflow, /import \{ trustedMainPreviewDeployments \} from "\.\/tools\/ci\/main-preview-deployments\.mjs"/);
  assert.match(workflow, /trustedMainPreviewDeployments\(deployments, source\)/);
  assert.match(workflow, /PRODUCTION_SUCCESSFUL_MAIN_PREVIEW_RUN_REQUIRED/);
  assert.match(workflow, /latest\?\.state === "success"/);
  assert.match(workflow, /PRODUCTION_APPROVED_PREVIEW_IDENTITY_INVALID/);
});
