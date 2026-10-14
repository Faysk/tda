import assert from "node:assert/strict";
import test from "node:test";
import { classifyDependencyDiff, renderRiskMarkdown, versionKind, pythonPins, parseDiffRange } from "./bot-dependency-risk.mjs";

const npm = (prod = {}, dev = {}) => JSON.stringify({ dependencies: prod, devDependencies: dev });

test("versions classify patch/minor/major and unknown conservatively", () => {
  assert.equal(versionKind("^1.2.3", "^1.2.4"), "patch");
  assert.equal(versionKind("1.2.3", "1.3.0"), "minor");
  assert.equal(versionKind("1.2.3", "2.0.0"), "major");
  assert.equal(versionKind("workspace:*", "file:./lib"), "unknown");
  assert.equal(versionKind("1.2.3", "1.2.3"), "same");
});

test("changes of npm range operator remain high risk even when version changes", () => {
  for (const [before, after] of [
    ["~1.2.3", "^1.2.4"],
    ["1.2.3", "^1.2.4"],
    ["^1.2.3", "~1.2.4"],
    ["^1.2.3", "1.2.4"],
    ["v1.2.3", "1.2.4"],
  ]) {
    assert.equal(versionKind(before, after), "unknown", before + " -> " + after);
    const report = classifyDependencyDiff({
      oldNpm: npm({ "tiny-lib": before }),
      newNpm: npm({ "tiny-lib": after }),
      paths: ["package.json", "pnpm-lock.yaml"],
    });
    assert.equal(report.risk, "high", before + " -> " + after);
    assert.equal(report.findings[0].kind, "unknown");
  }
  assert.equal(versionKind("^1.2.3", "^1.2.4"), "patch");
  assert.equal(versionKind("~1.2.3", "~1.2.4"), "patch");
  assert.equal(versionKind("^1.2.4", "^1.2.3"), "downgrade");
  assert.equal(versionKind("1.9.9", "2.0.0"), "major");
  assert.equal(versionKind("^1.2.4-beta.1", "^1.2.4"), "unknown");
});

test("patch and major downgrades are high-risk, not routine updates", () => {
  assert.equal(versionKind("1.2.5", "1.2.4"), "downgrade");
  assert.equal(versionKind("2.0.0", "1.99.99"), "downgrade");
  assert.equal(versionKind("1.9.9", "2.0.0"), "major");
  const report = classifyDependencyDiff({
    oldNpm: npm({ "tiny-lib": "1.2.5" }),
    newNpm: npm({ "tiny-lib": "1.2.4" }),
    paths: ["package.json", "pnpm-lock.yaml"],
  });
  assert.equal(report.risk, "high");
  assert.equal(report.findings[0].kind, "downgrade");
  assert.equal(report.recommendation, "human-review-required");
});

test("package.json lifecycle scripts and engine changes are classified high even without version changes", () => {
  const before = JSON.stringify({ name: "tda", scripts: { build: "next build" },
    engines: { node: ">=20" }, devDependencies: { prettier: "3.6.0" } });
  const changed = JSON.stringify({ name: "tda", scripts: { build: "node custom-build.js" },
    engines: { node: ">=22" }, devDependencies: { prettier: "3.6.0" } });
  const report = classifyDependencyDiff({ oldNpm: before, newNpm: changed, paths: ["package.json"] });
  assert.equal(report.risk, "high");
  assert.deepEqual(report.findings.map((x) => x.kind), ["manifest-unclassified"]);
  assert.equal(report.recommendation, "human-review-required");
  const absent = classifyDependencyDiff({ oldNpm: null, newNpm: changed, paths: ["package.json"] });
  assert.equal(absent.risk, "high");
  assert.ok(absent.findings.some((x) => x.kind === "manifest-unclassified"));

  const pinOnly = classifyDependencyDiff({
    oldNpm: JSON.stringify({ devDependencies: { prettier: "3.6.0" }, name: "tda" }),
    newNpm: JSON.stringify({ name: "tda", devDependencies: { prettier: "3.6.1" } }),
    paths: ["package.json"],
  });
  assert.equal(pinOnly.risk, "low");
  assert.ok(pinOnly.findings.every((x) => x.kind !== "manifest-unclassified"));
});

test("pre-release and ambiguous npm constraints never masquerade as safe patches", () => {
  assert.equal(versionKind("1.2.3-beta.1", "1.2.3"), "unknown");
  assert.equal(versionKind("1.2.3", "1.2.4-rc.1"), "unknown");
  assert.equal(versionKind("^1.2.3", "~1.2.3"), "unknown");
  assert.equal(versionKind("1.2.3", "1.2.4suffix"), "unknown");
  const report = classifyDependencyDiff({
    oldNpm: npm({ "tiny-lib": "1.2.3-beta.1" }),
    newNpm: npm({ "tiny-lib": "1.2.3" }),
    paths: ["package.json", "pnpm-lock.yaml"],
  });
  assert.equal(report.risk, "high");
  assert.equal(report.findings[0].kind, "unknown");
});

test("new package additions and Dependabot policy edits are high-risk", () => {
  const added = classifyDependencyDiff({
    oldNpm: npm(),
    newNpm: npm({ "unreviewed-package": "1.0.0" }),
    paths: ["package.json", "pnpm-lock.yaml"],
  });
  assert.equal(added.risk, "high");
  assert.equal(added.findings[0].kind, "added");

  const policy = classifyDependencyDiff({ paths: [".github/dependabot.yml"] });
  assert.equal(policy.risk, "high");
  assert.equal(policy.findings[0].kind, "bot-configuration");
  assert.equal(policy.recommendation, "human-review-required");
});

test("critical Web libraries trigger high risk and never an approval", () => {
  const report = classifyDependencyDiff({
    oldNpm: npm({ next: "15.1.0", "@supabase/supabase-js": "2.10.0", "@aws-sdk/client-s3": "3.1.0" }),
    newNpm: npm({ next: "15.2.0", "@supabase/supabase-js": "2.11.0", "@aws-sdk/client-s3": "3.1.1" }),
    paths: ["package.json"],
  });
  assert.equal(report.risk, "high");
  assert.equal(report.recommendation, "human-review-required");
  assert.deepEqual(report.findings.map((x) => x.name).sort(),
    ["next", "@supabase/supabase-js", "@aws-sdk/client-s3"].sort());
  assert.equal(report.checks, "not-queried");
  assert.equal(report.advisories, "not-queried");
});

test("direct manifest patch is low while direct test runner changes are medium (lock not assessed)", () => {
  const report = classifyDependencyDiff({
    oldNpm: npm({ "tiny-lib": "1.1.0" }, { "@playwright/test": "1.60.0" }),
    newNpm: npm({ "tiny-lib": "1.1.1" }, { "@playwright/test": "1.60.1" }),
    paths: ["package.json"],
  });
  assert.equal(report.risk, "medium");
  assert.equal(report.findings.find((x) => x.name === "tiny-lib").level, "low");
  assert.equal(report.findings.find((x) => x.name === "@playwright/test").level, "medium");
});

test("direct patch cannot conceal an unexamined npm or Python transitive lock", () => {
  const oldNpm = npm({ "small-library": "1.0.0" });
  const newNpm = npm({ "small-library": "1.0.1" });
  const alone = classifyDependencyDiff({ oldNpm, newNpm, paths: ["package.json"] });
  assert.equal(alone.risk, "low");
  const withLock = classifyDependencyDiff({
    oldNpm, newNpm, paths: ["package.json", "pnpm-lock.yaml"],
  });
  assert.equal(withLock.risk, "high");
  assert.ok(withLock.findings.some((f) => f.kind === "patch" && f.level === "low"));
  assert.ok(withLock.findings.some((f) =>
    f.kind === "lock-unreviewed" && f.level === "high" && f.ecosystem === "npm"));

  const oldPython = '[project]\ndependencies = [\n  "tiny-lib==1.0.0",\n]';
  const newPython = oldPython.replace("1.0.0", "1.0.1");
  const python = classifyDependencyDiff({
    oldPython, newPython,
    paths: ["local-companion/pyproject.toml", "local-companion/requirements-test.lock"],
  });
  assert.equal(python.risk, "high");
  assert.ok(python.findings.some((f) => f.kind === "patch"));
  assert.ok(python.findings.some((f) =>
    f.kind === "lock-unreviewed" && f.level === "high" && f.ecosystem === "pip"));
});

test("pnpm workspace allowBuilds and npm registry configuration changes are high-risk", () => {
  for (const path of ["pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs", "patches/transitive-lib.patch"]) {
    const report = classifyDependencyDiff({ paths: [path] });
    assert.equal(report.risk, "high");
    assert.equal(report.recommendation, "human-review-required");
    assert.equal(report.findings[0].kind, "package-manager-configuration");
    assert.equal(report.findings[0].name, path);
    assert.match(renderRiskMarkdown(report), /Package-manager/);
  }
});

test("pnpm lifecycle hook/patch-only edits never appear as no-change", () => {
  const hooks = classifyDependencyDiff({ paths: [".pnpmfile.cjs"] });
  const patched = classifyDependencyDiff({ paths: ["patches/unrs-resolver.patch"] });
  for (const row of [hooks, patched]) {
    assert.equal(row.risk, "high");
    assert.equal(row.recommendation, "human-review-required");
    assert.equal(row.findings[0].kind, "package-manager-configuration");
  }
  const unrelated = classifyDependencyDiff({ paths: ["docs/guide.patch"] });
  assert.equal(unrelated.risk, "none");
});

test("a transitive-only npm lock update stays high-risk and reviewable", () => {
  const manifest = npm({ next: "16.1.0" });
  const report = classifyDependencyDiff({ oldNpm: manifest, newNpm: manifest, paths: ["pnpm-lock.yaml"] });
  assert.equal(report.risk, "high");
  assert.equal(report.findings[0].kind, "lock-unreviewed");
  assert.match(renderRiskMarkdown(report, "origin/main...abc123"), /not queried/);
});

test("a Python direct pin drift names Companion and a lock-only change remains unsafe", () => {
  const older = '[project]\ndependencies = [\n  "fastapi==0.142.4",\n  "ctranslate2==4.8.2",\n]';
  const newer = '[project]\ndependencies = [\n  "fastapi==0.143.0",\n  "ctranslate2==4.8.3",\n]';
  assert.equal(pythonPins(older).get("fastapi").pin, "0.142.4");
  const report = classifyDependencyDiff({
    oldPython: older, newPython: newer, paths: ["local-companion/pyproject.toml"],
  });
  assert.equal(report.risk, "high");
  assert.equal(report.findings.length, 2);
  const lockReport = classifyDependencyDiff({ oldPython: newer, newPython: newer,
    paths: ["local-companion/requirements-test.lock"] });
  assert.equal(lockReport.findings[0].kind, "lock-unreviewed");
});

test("unparsed Python manifest edits never disappear from the risk report", () => {
  const oldPython = '[project]\ndependencies = [\n  "fastapi==0.142.4",\n]';
  const newPython = '[project]\ndependencies = [\n  "fastapi==0.143.0",\n  "optional-lib>=1.2",\n]';
  const report = classifyDependencyDiff({
    oldPython, newPython, paths: ["local-companion/pyproject.toml"],
  });
  assert.equal(report.risk, "high");
  assert.ok(report.findings.some((x) => x.kind === "manifest-unclassified"));
  assert.ok(report.findings.some((x) => x.name === "fastapi"));

  const metadataOnly = classifyDependencyDiff({
    oldPython: "[project]\\nname = 'companion'",
    newPython: "[project]\\nname = 'companion'\\nrequires-python = '>=3.12'",
    paths: ["local-companion/pyproject.toml"],
  });
  assert.equal(metadataOnly.risk, "high");
  assert.equal(metadataOnly.findings[0].kind, "manifest-unclassified");

  const missingManifest = classifyDependencyDiff({
    oldPython: null, newPython, paths: ["local-companion/pyproject.toml"],
  });
  assert.equal(missingManifest.risk, "high");
  assert.ok(missingManifest.findings.some((x) => x.kind === "manifest-unclassified"));

  const exactOnly = classifyDependencyDiff({
    oldPython, newPython: oldPython.replace("0.142.4", "0.143.0"),
    paths: ["local-companion/pyproject.toml"],
  });
  assert.equal(exactOnly.findings.length, 1);
  assert.ok(exactOnly.findings.every((x) => x.kind !== "manifest-unclassified"));
});

test("mode/symlink typechanges cannot disappear or parse symlink target as a manifest", () => {
  const npmManifest = classifyDependencyDiff({
    paths: ["package.json"], typeChangedPaths: ["package.json"],
    oldNpm: null, newNpm: null,
  });
  assert.equal(npmManifest.risk, "high");
  assert.ok(npmManifest.findings.some((f) => f.kind === "file-typechange"));
  assert.ok(npmManifest.findings.some((f) => f.kind === "manifest-unclassified"));
  assert.equal(npmManifest.recommendation, "human-review-required");

  const python = classifyDependencyDiff({
    paths: ["local-companion/pyproject.toml"],
    typeChangedPaths: ["local-companion/pyproject.toml"],
  });
  assert.equal(python.risk, "high");
  assert.ok(python.findings.some((f) => f.kind === "file-typechange"));

  const workflow = classifyDependencyDiff({
    paths: [".github/workflows/ci.yml"],
    typeChangedPaths: [".github/workflows/ci.yml"],
  });
  assert.equal(workflow.risk, "high");
  assert.ok(workflow.findings.some((f) => f.kind === "workflow"));
  assert.ok(workflow.findings.some((f) => f.kind === "file-typechange"));

  const unchanged = classifyDependencyDiff({ paths: [".github/workflows/ci.yml"] });
  assert.ok(unchanged.findings.every((f) => f.kind !== "file-typechange"));
});

test("workflow edits are always security-review candidates regardless of package diff", () => {
  const report = classifyDependencyDiff({ paths: [".github/workflows/runtime-rc.yml"] });
  assert.equal(report.risk, "high");
  assert.equal(report.findings[0].ecosystem, "github-actions");
  assert.match(renderRiskMarkdown(report), /permissions/);
});

test("malformed manifests fail closed; no changes produce no report", () => {
  assert.throws(() => classifyDependencyDiff({ newNpm: "{broken" }), SyntaxError);
  const report = classifyDependencyDiff({ oldNpm: npm(), newNpm: npm(), paths: ["docs/README.md"] });
  assert.equal(report.risk, "none");
  assert.equal(renderRiskMarkdown(report), "");
});

test("untrusted package names are escaped in generated Markdown", () => {
  const report = classifyDependencyDiff({ oldNpm: npm(), newNpm: npm({ "bad|name": "1.0.0" }),
    paths: ["package.json"] });
  const markdown = renderRiskMarkdown(report);
  assert.ok(!markdown.includes("bad|name"));
  assert.ok(markdown.includes("bad name"));
  assert.match(markdown, /human review required/);
});

test("three-dot diff uses merge-base, not current target branch tip", () => {
  const ancestor = "0123456789abcdef0123456789abcdef01234567";
  const parts = parseDiffRange("origin/main...f00abc", ancestor);
  assert.deepEqual(parts, { from: ancestor, to: "f00abc", threeDot: true });
  const twoDot = parseDiffRange("before..after", null);
  assert.deepEqual(twoDot, { from: "before", to: "after", threeDot: false });
});

test("rejects three-dot analysis without a verified merge-base", () => {
  assert.throws(() => parseDiffRange("origin/main...HEAD", null), /merge-base/);
  assert.throws(() => parseDiffRange("origin/main...HEAD", "bad-sha"), /merge-base/);
  assert.throws(() => parseDiffRange("one;rm -rf...two", "0123456789abcdef0123456789abcdef01234567"), /Git diff range/);
});
