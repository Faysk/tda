import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const config = readFileSync(join(root, ".github", "dependabot.yml"), "utf8");
const codeql = readFileSync(join(root, ".github", "workflows", "codeql.yml"), "utf8");

function ecosystem(name) {
  const marker = `  - package-ecosystem: ${name}\n`;
  const start = config.indexOf(marker);
  assert.ok(start >= 0, `missing ${name} ecosystem`);
  const end = config.indexOf("\n  - package-ecosystem:", start + marker.length);
  return config.slice(start, end < 0 ? undefined : end);
}

test("critical npm integration updates are not buried inside low-risk groups", () => {
  const npm = ecosystem("npm");
  assert.match(npm, /production-lowrisk:/);
  assert.match(npm, /development-lowrisk:/);
  for (const name of ["next", "@supabase/*", "@aws-sdk/*", "react", "react-dom", "@xyflow/react", "@playwright/*", "@types/node", "typescript", "vitest"]) {
    assert.ok(npm.includes(`- "${name}"`), `critical package absent from group exclusion: ${name}`);
  }
  assert.equal(npm.includes("update-types:\n          - major"), false);
  assert.match(npm, /timezone: Europe\/Lisbon/);
  assert.match(npm, /interval: weekly/);
});

test("custom Companion lock requires isolated Python updates and remains daily", () => {
  const pip = ecosystem("pip");
  assert.match(pip, /interval: daily/);
  assert.match(pip, /companion-test-tooling:/);
  assert.equal(pip.includes("companion-runtime:"), false);
  assert.equal(pip.includes('patterns:\n          - "*"'), false);
  assert.equal(pip.includes("fastapi"), false);
  assert.match(pip, /timezone: Europe\/Lisbon/);
});

test("CodeQL update grouping covers version and security updates", () => {
  const actions = ecosystem("github-actions");
  assert.match(actions, /codeql-actions:\n\s+applies-to: version-updates/);
  assert.match(actions, /codeql-security:\n\s+applies-to: security-updates/);
  assert.equal((actions.match(/"github\/codeql-action\/\*"/g) || []).length, 2);
  assert.match(actions, /interval: weekly/);
  assert.match(actions, /timezone: Europe\/Lisbon/);
});

test("CodeQL init and analyze stay on the same immutable SHA and version", () => {
  const refs = [...codeql.matchAll(/uses:\s+github\/codeql-action\/(init|analyze)@([a-f\d]{40})\s+# v([\d.]+)/g)];
  assert.equal(refs.length, 2);
  assert.deepEqual(new Set(refs.map(([,name]) => name)), new Set(["init", "analyze"]));
  assert.equal(new Set(refs.map(([, , sha]) => sha)).size, 1);
  assert.equal(new Set(refs.map(([, , , version]) => version)).size, 1);
});
