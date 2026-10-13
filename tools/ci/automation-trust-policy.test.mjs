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
    const modified = mutate(file, (value) => value.replace(marker, "REMOVED_BY_SYNTHETIC_MUTATION"));
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
