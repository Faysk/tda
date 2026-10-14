import assert from "node:assert/strict";
import test from "node:test";
import { auditBotTrust, readWorkflowSources } from "./automation-trust-policy.mjs";

const baseline = readWorkflowSources();
const mutate = (file, edit) => ({ ...baseline, [file]: edit(baseline[file]) });

test("the current workflow tree keeps the known privileged boundaries", () => {
  assert.deepEqual(auditBotTrust(baseline), []);
});

test("forbids untrusted PR-triggered privileged workflow entrypoints", () => {
  const withTarget = mutate("deploy-preview.yml", (value) =>
    value.replace("  workflow_run:", "  pull_request_target:\n  workflow_run:"));
  assert.match(auditBotTrust(withTarget).join("\n"), /forbidden pull_request_target/);
  const autoProduction = mutate("production-cd.yml", (value) =>
    value.replace("  workflow_dispatch:", "  workflow_run:\n  workflow_dispatch:"));
  assert.match(auditBotTrust(autoProduction).join("\n"), /forbidden automatic Production trigger/);
});

test("refuses removal of source PR origin, exact CI and push-main fences", () => {
  const cases = [
    ["deploy-preview.yml", 'repo.get("full_name") == os.environ["GITHUB_REPOSITORY"]'],
    ["deploy-preview.yml", "PREVIEW_EXACT_SUCCESSFUL_CI_REQUIRED"],
    ["deploy-main-preview.yml", "MAIN_PREVIEW_EXACT_SUCCESSFUL_CI_REQUIRED"],
    ["companion-rc.yml", "AUTO_RC_TRIGGER_NOT_MAIN_PUSH"],
    ["runtime-rc.yml", "AUTO_RUNTIME_TRIGGER_NOT_MAIN_PUSH"],
    ["production-cd.yml", "PRODUCTION_EXACT_MAIN_CI_REQUIRED"],
    ["production-cd.yml", "APPROVE_PREVIEW_FOR_PRODUCTION"],
  ];
  for (const [file, marker] of cases) {
    assert.ok(baseline[file].includes(marker), "missing baseline fixture " + file + ": " + marker);
    const modified = mutate(file, (value) => value.replaceAll(marker, "REMOVED_BY_SYNTHETIC_MUTATION"));
    assert.ok(auditBotTrust(modified).some((problem) => problem.startsWith(file + ":")), file + ": " + marker);
  }
});

test("rejects source checks moved below privileged Preview side effects", () => {
  const file = "deploy-preview.yml";
  const modified = mutate(file, (value) => value
    .replace("Require current same-repository PR head", "MOVED_VALIDATION_MARKER")
    .replace("Start immutable remote Preview deployment", "Require current same-repository PR head"));
  assert.match(auditBotTrust(modified).join("\n"), /untrusted execution order/);
});

test("rejects secret inheritance and write-all scope, without network calls", () => {
  const withInherit = mutate("ci.yml", (value) => value + "\nsecrets: inherit\n");
  assert.match(auditBotTrust(withInherit).join("\n"), /forbidden secrets inheritance/);
  const withWriteAll = mutate("ci.yml", (value) => value + "\npermissions: write-all\n");
  assert.match(auditBotTrust(withWriteAll).join("\n"), /forbidden write-all/);
});

test("missing protected controller is a failure, not an automatic bypass", () => {
  const { "runtime-rc.yml": omitted, ...rest } = baseline;
  assert.ok(typeof omitted === "string");
  assert.match(auditBotTrust(rest).join("\n"), /runtime-rc.yml: missing workflow/);
});

test("new privileged scopes are forbidden until reviewed and allowlisted", () => {
  const unsafeCI = mutate("ci.yml", (value) => value.replace("  contents: read", "  contents: write"));
  assert.match(auditBotTrust(unsafeCI).join("\n"), /ci\.yml: unapproved write scope contents/);
  const unsafePreview = mutate("deploy-preview.yml", (value) =>
    value.replace("  deployments: write", "  deployments: write\n  contents: write"));
  assert.match(auditBotTrust(unsafePreview).join("\n"), /deploy-preview\.yml: unapproved write scope contents/);
});


test("flow-style YAML cannot hide pull_request_target privileged entrypoint", () => {
  for (const trigger of [
    "on: [push, pull_request_target]",
    "on: { push: {}, pull_request_target: {} }",
    "on: pull_request_target",
    "on: ['push', 'pull_request_target']",
  ]) {
    const input = mutate("ci.yml", (v) =>
      v.replace("on:\n  push:\n    branches: [main]\n  pull_request:", trigger));
    const errors = auditBotTrust(input);
    assert.ok(errors.some((e) => e.includes("ci.yml: forbidden pull_request_target")),
      trigger + " : " + errors.join(" | "));
  }
});

test("unapproved write scopes are caught in inline permissions at workflow or job level", () => {
  for (const declaration of [
    "permissions: { contents: write }",
    "permissions: { contents: read, pull-requests: write }",
    'permissions: { "contents": "write", issues: read }',
  ]) {
    const input = mutate("ci.yml", (v) =>
      v.replace("permissions:\n  contents: read", declaration));
    assert.match(auditBotTrust(input).join("\n"), /ci\.yml: unapproved write scope (contents|pull-requests)/);
  }
  const allowed = mutate("codeql.yml", (v) =>
    v.replace("permissions:\n  contents: read\n  security-events: write",
      "permissions: { contents: read, security-events: write }"));
  assert.deepEqual(auditBotTrust(allowed), []);
});

test("Production rejects flow-style automatic push and workflow_run triggers", () => {
  for (const line of [
    "on: [workflow_dispatch, push]",
    "on: { workflow_dispatch: {}, workflow_run: {} }",
    "on: 'push'",
  ]) {
    const changed = mutate("production-cd.yml", (v) =>
      v.replace("on:\n  workflow_dispatch:", line + "\n  workflow_dispatch:"));
    assert.match(auditBotTrust(changed).join("\n"),
      /production-cd\.yml: forbidden automatic Production trigger/);
  }
});
