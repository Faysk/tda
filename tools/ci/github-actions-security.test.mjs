import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workflowRoot = join(process.cwd(), ".github", "workflows");
const workflows = readdirSync(workflowRoot)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({
    name,
    text: readFileSync(join(workflowRoot, name), "utf8"),
  }));

test("all remote GitHub Actions use immutable 40-character commit SHAs", () => {
  const violations = [];
  for (const workflow of workflows) {
    const lines = workflow.text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*([^#\s]+)/);
      if (!match) continue;
      const value = match[1];
      if (value.startsWith("./")) continue;
      if (value.startsWith("docker://")) {
        violations.push(`${workflow.name}:${index + 1} mutable Docker action ${value}`);
        continue;
      }
      const separator = value.lastIndexOf("@");
      const ref = separator >= 0 ? value.slice(separator + 1) : "";
      if (!/^[a-f0-9]{40}$/i.test(ref)) {
        violations.push(`${workflow.name}:${index + 1} ${value}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("pull-request CI never inherits deployment secrets", () => {
  const ci = readFileSync(join(workflowRoot, "ci.yml"), "utf8");
  assert.equal(ci.includes("secrets: inherit"), false);
  assert.equal(ci.includes("VERCEL_TOKEN"), false);
  assert.equal(ci.includes("deploy-preview.yml"), false);
});

test("privileged Preview workflow does not execute repository install/build scripts locally", () => {
  const preview = readFileSync(join(workflowRoot, "deploy-preview.yml"), "utf8");
  assert.match(preview, /workflow_run:/);
  assert.match(preview, /workflows:\s*\[CI\]/);
  assert.equal(preview.includes("pnpm install"), false);
  assert.equal(preview.includes("vercel pull"), false);
  assert.equal(preview.includes("vercel build"), false);
  assert.match(preview, /persist-credentials:\s*false/);
  assert.match(preview, /repo\.get\("full_name"\) == os\.environ\["GITHUB_REPOSITORY"\]/);
  assert.match(preview, /PREVIEW_EXACT_SUCCESSFUL_CI_REQUIRED/);
  assert.match(preview, /head_sha=\$SOURCE_SHA/);
});


test("Production publication is deliberate and cannot be triggered by push or CI", () => {
  const active = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  const retired = readFileSync(join(workflowRoot, "production.yml"), "utf8");
  assert.match(active, /name:\s*Production CD/);
  assert.match(active, /workflow_dispatch:/);
  assert.equal(active.includes("workflow_run:"), false);
  assert.equal(active.includes("push:"), false);
  assert.match(active, /source_sha:[\s\S]*?required:\s*true/);
  assert.match(active, /if:\s*\$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
  assert.equal(retired.includes("workflow_run:"), false);
  assert.equal(retired.includes("push:"), false);
});

test("deliberate Production release retains exact main provenance and staged promotion", () => {
  const active = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  assert.match(active, /SOURCE_SHA="\$\{REQUESTED_SHA:\?An exact validated source_sha is required\}"/);
  assert.match(active, /if \[\[ "\$SOURCE_SHA" != "\$CURRENT_SHA" \]\]/);
  assert.match(active, /Refusing stale\/arbitrary Production release/);
  assert.match(active, /pr\.base\?\.ref === "main"/);
  assert.match(active, /pr\.merge_commit_sha === sha/);
  assert.match(active, /PRODUCTION_EXACT_MAIN_CI_REQUIRED/);
  assert.match(active, /run\.head_sha === process\.env\.SOURCE_SHA/);
  assert.match(active, /run\.head_branch === "main"/);
  assert.match(active, /run\.event === "push"/);
  assert.match(active, /run\.conclusion === "success"/);
  assert.match(active, /--skip-domain/);
  assert.match(active, /vercel promote/);
});
test("legacy 0.3.1 recovery ignores generated documentation catalog churn", () => {
  const legacyRecovery = readFileSync(
    join(workflowRoot, "companion-legacy-031-recovery.yml"),
    "utf8",
  );

  assert.match(legacyRecovery, /pull_request:/);
  assert.match(
    legacyRecovery,
    /tools\/acceptance\/verify-legacy-031-recovery\.ps1/,
  );
  assert.match(
    legacyRecovery,
    /\.github\/workflows\/companion-legacy-031-recovery\.yml/,
  );
  assert.match(legacyRecovery, /docs\/operations\/local-companion\.md/);
  assert.equal(legacyRecovery.includes("docs/documentation/catalog.md"), false);
  assert.match(legacyRecovery, /workflow_dispatch:/);
});
