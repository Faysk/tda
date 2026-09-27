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


test("Production has exactly one automatic controller after the operational hold", () => {
  const active = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  const retired = readFileSync(join(workflowRoot, "production.yml"), "utf8");

  assert.match(active, /name:\s*Production CD/);
  assert.match(active, /workflow_run:/);
  assert.match(active, /workflows:\s*\[CI\]/);
  assert.match(active, /branches:\s*\[main\]/);
  assert.match(active, /types:\s*\[completed\]/);
  assert.match(active, /workflow_dispatch:/);

  assert.match(retired, /workflow_dispatch:/);
  assert.equal(retired.includes("workflow_run:"), false);
  assert.equal(retired.includes("push:"), false);
});
