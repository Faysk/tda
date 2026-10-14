import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd(), ".github", "workflows");
const ci = readFileSync(join(root, "ci.yml"), "utf8");
const isolation = readFileSync(join(root, "campaign-isolation.yml"), "utf8");
const optional = ["statistics-e2e", "permissions-e2e", "transcript-edit-e2e"];
const gateNames = ["STATISTICS", "PERMISSIONS", "TRANSCRIPT_EDIT"];
// Changing a dependency installer config can affect browser auth, statistics,
// transcript editing and campaign isolation without touching package.json.
const deps = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs"];
const ciPatchPath = "patches/";
const campaignPatchGlob = "patches/**";
const globalWeb = ["next.config.ts", ".node-version", ".nvmrc", ".github/workflows/ci.yml", "src/proxy.ts", "vercel.json", ".vercelignore", "vitest.config.ts", "tsconfig.json"];
const allOptionalPaths = [...deps, ciPatchPath, ...globalWeb];
const jobToGate = new Map([
  ["statistics-e2e", "STATISTICS"], ["permissions-e2e", "PERMISSIONS"],
  ["transcript-edit-e2e", "TRANSCRIPT_EDIT"],
]);
const selector = (path) => "contains(needs.classify-changes.outputs.files_json, '" + path + "')";
function conditionFor(job, workflow = ci) {
  const line = block(workflow, job).split("\n").find((row) => row.trimStart().startsWith("if: ${{"));
  assert.ok(line, "missing condition " + job);
  return line;
}
function relevanceFor(gate, workflow = ci) {
  const aggregator = block(workflow, "ci-gate");
  const line = aggregator.split("\n").find((row) => row.includes(gate + "_RELEVANT:"));
  assert.ok(line, "missing aggregator relevance " + gate);
  return line;
}

function block(source, name) {
  const marker = "  " + name + ":\n";
  assert.ok(source.includes(marker), "missing section " + name);
  return source.split(marker)[1].split(/\n(?=  [a-z][a-z0-9-]*:)/)[0];
}

test("dependency changes run path-sensitive browser E2Es", () => {
  for (const job of optional) {
    const condition = conditionFor(job);
    for (const dep of allOptionalPaths)
      assert.ok(condition.includes(selector(dep)), job + ": missing " + dep);
  }
});

test("CI aggregation matches dependencies and fails closed on required E2E", () => {
  const aggregator = block(ci, "ci-gate");
  for (const gate of gateNames) {
    const envLine = relevanceFor(gate);
    for (const dep of allOptionalPaths)
      assert.ok(envLine.includes(selector(dep)), gate + ": missing " + dep);
    assert.ok(aggregator.includes("test \"$" + gate + "_RESULT\" = \"success\""), "required failure must not become skipped: " + gate);
  }
});

test("campaign isolation triggers on dependency changes in PR and main", () => {
  for (const event of ["pull_request", "push"]) {
    const trigger = block(isolation, event);
    for (const dep of [...deps, campaignPatchGlob, ...globalWeb])
      assert.ok(trigger.includes('"' + dep + '"'), event + ": " + dep);
  }
});

function assertOptionalGateParity(workflow) {
  for (const [job, gate] of jobToGate) {
    const condition = conditionFor(job, workflow);
    const relevance = relevanceFor(gate, workflow);
    for (const path of allOptionalPaths) {
      const token = selector(path);
      assert.ok(condition.includes(token), job + ": missing gate " + path);
      assert.ok(relevance.includes(token), gate + ": missing relevance " + path);
    }
  }
}

test("CI optional job and gate relevance remain synchronized under adversarial mutations", () => {
  assertOptionalGateParity(ci);
  const token = selector(".pnpmfile.cjs");
  const jobsOnlyChanged = ci.replace(token, "false");
  assert.notEqual(jobsOnlyChanged, ci);
  assert.throws(() => assertOptionalGateParity(jobsOnlyChanged),
    /statistics-e2e: missing gate \.pnpmfile\.cjs/);
  const section = ci.indexOf("  ci-gate:");
  assert.ok(section > 0);
  const relevanceOnlyChanged = ci.slice(0, section) +
    ci.slice(section).replace(selector("patches/"), "false");
  assert.notEqual(relevanceOnlyChanged, ci);
  assert.throws(() => assertOptionalGateParity(relevanceOnlyChanged),
    /STATISTICS: missing relevance patches\//);
});


test("security-critical global Next/Node/CI config edits cannot skip optional E2Es", () => {
  assertOptionalGateParity(ci);
  const riskPaths = [".github/workflows/ci.yml", "next.config.ts", ".node-version", ".nvmrc", "src/proxy.ts", "vercel.json", ".vercelignore", "vitest.config.ts", "tsconfig.json"];
  for (const path of riskPaths) {
    const token = selector(path);
    const altered = ci.replace(token, "false");
    assert.notEqual(altered, ci, "must have a live selector for " + path);
    assert.throws(() => assertOptionalGateParity(altered),
      /statistics-e2e: missing gate/, "deleting selector must fail closed: " + path);
  }
  for (const event of ["pull_request", "push"]) {
    const trigger = block(isolation, event);
    for (const path of riskPaths)
      assert.ok(trigger.includes('"' + path + '"'), event + ": missing " + path);
  }
});

test("dependency locks do not trigger Companion MSI merely by changing pnpm", async () => {
  const { classifyPaths } = await import("./classify-changes.mjs");
  const result = classifyPaths(["pnpm-lock.yaml"]);
  assert.equal(result.companion, false);
  for (const flag of ["navigation", "db", "processing", "lembra", "sessions", "media"]) {
    assert.equal(result[flag], true, flag);
  }
});
