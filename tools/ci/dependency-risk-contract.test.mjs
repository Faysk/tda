import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd(), ".github", "workflows");
const ci = readFileSync(join(root, "ci.yml"), "utf8");
const isolation = readFileSync(join(root, "campaign-isolation.yml"), "utf8");
const optional = ["statistics-e2e", "permissions-e2e", "transcript-edit-e2e"];
const gateNames = ["STATISTICS", "PERMISSIONS", "TRANSCRIPT_EDIT"];
const deps = ["package.json", "pnpm-lock.yaml"];

function block(source, name) {
  const marker = "  " + name + ":\n";
  assert.ok(source.includes(marker), "missing section " + name);
  return source.split(marker)[1].split(/\n(?=  [a-z][a-z0-9-]*:)/)[0];
}

test("dependency changes run path-sensitive browser E2Es", () => {
  for (const job of optional) {
    const condition = block(ci, job).split("\n").find((line) => line.trimStart().startsWith("if: ${{"));
    assert.ok(condition, "missing condition " + job);
    for (const dep of deps) assert.ok(condition.includes("\x27" + dep + "\x27"), job + ": " + dep);
  }
});

test("CI aggregation matches dependencies and fails closed on required E2E", () => {
  const aggregator = block(ci, "ci-gate");
  for (const gate of gateNames) {
    const envLine = aggregator.split("\n").find((line) => line.includes(gate + "_RELEVANT:"));
    assert.ok(envLine, "missing aggregator relevance " + gate);
    for (const dep of deps) assert.ok(envLine.includes("\x27" + dep + "\x27"), gate + ": " + dep);
    assert.ok(aggregator.includes("test \"$" + gate + "_RESULT\" = \"success\""), "required failure must not become skipped: " + gate);
  }
});

test("campaign isolation triggers on dependency changes in PR and main", () => {
  for (const event of ["pull_request", "push"]) {
    const trigger = block(isolation, event);
    for (const dep of deps) assert.ok(trigger.includes("\x22" + dep + "\x22"), event + ": " + dep);
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
