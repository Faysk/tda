import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { codeqlMainMatrixSucceeded, completeCodeqlJobsPage, findExactMainCodeqlReceipt, isExactMainCodeqlRun } from "./require-main-codeql.mjs";

const workflowRoot = join(process.cwd(), ".github", "workflows");
const workflows = readdirSync(workflowRoot)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({
    name,
    text: readFileSync(join(workflowRoot, name), "utf8"),
  }));

test("dependency triage executes default-branch code with read-only permissions", () => {
  const text = readFileSync(join(workflowRoot, "dependency-triage.yml"), "utf8");
  assert.match(text, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /security-events: read/);
  assert.doesNotMatch(text, /:\s*write\b|secrets\.|pull_request_target|repository_dispatch/);
  assert.doesNotMatch(text, /ref:.*(?:head_sha|head_ref|pull_requests)/);
  assert.match(text, /head_repository\.full_name == github\.repository/);
});

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

// This is a source-level guard only: it cannot establish the effective
// Vercel Git integration setting or bypass/approval policy on the service.
function vercelLocalPolicyViolations(config) {
  const issues = [];
  if (config?.git?.deploymentEnabled !== false)
    issues.push("Git auto-deployment must remain disabled");
  if (config?.framework !== "nextjs")
    issues.push("Vercel framework changed");
  if (config?.installCommand !== "corepack pnpm install --frozen-lockfile")
    issues.push("Vercel install must keep frozen dependency lock");
  if (config?.buildCommand !== "pnpm build")
    issues.push("Vercel build command must stay reviewed");
  return issues;
}

// Checked-in Vercel packaging allowlist only; remote project settings and
// effective uploads still require independent verification.
function vercelIgnorePolicyViolations(source) {
  const rules = String(source).split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const violations = [];
  for (const pattern of [".git", ".env*", "node_modules", ".next"]) {
    if (!rules.includes(pattern))
      violations.push("missing Vercel exclusion: " + pattern);
  }
  // Deliberately permit only the already reviewed public template exception.
  // Other negations could accidentally re-include secrets or local artifacts.
  for (const rule of rules) {
    if (rule.startsWith("!") && rule !== "!.env.example")
      violations.push("unreviewed Vercel negated exclusion: " + rule);
  }
  return violations;
}

test("Node version pin files remain exactly synchronized", () => {
  const nodeVersion = readFileSync(join(process.cwd(), ".node-version"), "utf8").trim();
  const nvmVersion = readFileSync(join(process.cwd(), ".nvmrc"), "utf8").trim();
  assert.match(nodeVersion, /^\d+\.\d+\.\d+$/, "Node runtime must be exact");
  assert.equal(nvmVersion, nodeVersion,
    ".nvmrc and .node-version must not diverge between developer and CI runtimes");
  assert.notEqual(nodeVersion.replace(/\d+$/, (n) => String(Number(n) + 1)), nvmVersion,
    "synthetic patch-level drift must be detected without pinning a specific future version");
});

test("explicit pnpm workflow versions and manager lock follow packageManager", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager);
  assert.ok(match, "packageManager must pin exact pnpm");
  const expected = match[1];
  for (const workflow of workflows) {
    const setups = workflow.text.matchAll(/^\s*(?:-\s*)?uses:\s*pnpm\/action-setup@[^\n]*$/gm);
    for (const setup of setups) {
      const step = workflow.text.slice(setup.index + setup[0].length).split(/\n\s*- (?:name|uses|run):/, 1)[0];
      const version = /^\s+version:\s*([^\s#]+)/m.exec(step)?.[1];
      if (version) assert.equal(version, expected, `${workflow.name}: pnpm drift`);
    }
  }
  const lock = readFileSync(join(process.cwd(), "pnpm-lock.yaml"), "utf8");
  const manager = /packageManagerDependencies:\s+pnpm:\s+specifier: ([\d.]+)\s+version: ([\d.]+)/.exec(lock);
  assert.ok(manager, "package-manager lock identity missing");
  assert.equal(manager[1], expected);
  assert.equal(manager[2], expected);
});

// CI consumes .node-version, developers often consume .nvmrc, and Vercel
// project metadata sets a major Node version separately. Guard only checked-in
// sources here; remote Vercel enforcement is not established by this test.
function nodeRuntimePinViolations(nodeVersion, nvmrc, engine) {
  const issues = [];
  const left = String(nodeVersion).trim();
  const right = String(nvmrc).trim();
  if (!/^\d+\.\d+\.\d+$/.test(left))
    issues.push(".node-version must be an exact semver");
  if (!/^\d+\.\d+\.\d+$/.test(right))
    issues.push(".nvmrc must be an exact semver");
  if (left !== right)
    issues.push("nvm and CI Node pins disagree");
  const major = left.split(".")[0];
  if (engine !== major + ".x")
    issues.push("package.json engines.node must match pinned Node major");
  return issues;
}

test("nvm and CI Node versions match the package engine major", () => {
  const nodeVersion = readFileSync(join(process.cwd(), ".node-version"), "utf8");
  const nvmrc = readFileSync(join(process.cwd(), ".nvmrc"), "utf8");
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  assert.deepEqual(nodeRuntimePinViolations(nodeVersion, nvmrc, manifest.engines?.node), []);
});

test("runtime version pin drift and malformed pins fail the checked-in contract", () => {
  for (const [nodeVersion, nvmrc, engine] of [
    ["24.20.0", "24.21.0", "24.x"],
    ["24.20.0", "24.20.0", "25.x"],
    ["24", "24.20.0", "24.x"],
    ["24.20.0", "lts/*", "24.x"],
  ]) assert.notDeepEqual(nodeRuntimePinViolations(nodeVersion, nvmrc, engine), []);
});

test("Vercel packaging excludes environment files and local build output", () => {
  const source = readFileSync(join(process.cwd(), ".vercelignore"), "utf8");
  assert.deepEqual(vercelIgnorePolicyViolations(source), []);
});

test("Vercel ignore policy rejects synthetic env exposure and unreviewed re-inclusions", () => {
  const source = readFileSync(join(process.cwd(), ".vercelignore"), "utf8");
  for (const variant of [
    source.replace(/^\.env\*$/m, ""),
    source.replace(/^node_modules$/m, ""),
    source + "\n!.env.local\n",
    source + "\n!.env*\n",
    source + "\n!src/secret\n",
  ]) {
    assert.notDeepEqual(vercelIgnorePolicyViolations(variant), []);
  }
});

test("Vercel repo config cannot enable Git auto-deploy or mutable install scripts", () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
  assert.deepEqual(vercelLocalPolicyViolations(vercel), []);
});

test("Vercel policy rejects synthetic auto-deploy and install/build command drift", () => {
  const baseline = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
  const variants = [
    { ...baseline, git: { deploymentEnabled: true } },
    { ...baseline, git: {} },
    { ...baseline, installCommand: "pnpm install" },
    { ...baseline, buildCommand: "node arbitrary-build.js" },
    { ...baseline, framework: "other" },
  ];
  for (const variant of variants)
    assert.notDeepEqual(vercelLocalPolicyViolations(variant), []);
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
test("Production requires an exact post-merge main push CodeQL run with both passing language jobs", () => {
  const sha = "a".repeat(40);
  const repository = "Faysk/tda";
  const goodRun = {
    id: 123456, name: "CodeQL", path: ".github/workflows/codeql.yml",
    head_sha: sha, head_branch: "main",
    head_repository: { full_name: repository },
    event: "push", status: "completed", conclusion: "success",
  };
  const goodJobs = [
    { name: "analyze (javascript-typescript)", status: "completed", conclusion: "success" },
    { name: "analyze (python)", status: "completed", conclusion: "success" },
  ];
  assert.equal(isExactMainCodeqlRun(goodRun, sha, repository), true);
  assert.equal(codeqlMainMatrixSucceeded(goodJobs), true);
  assert.equal(findExactMainCodeqlReceipt([goodRun], { "123456": goodJobs }, sha, repository), goodRun);

  for (const override of [
    { head_sha: "b".repeat(40) },
    { head_branch: "feature" },
    { head_repository: { full_name: "attacker/repo" } },
    { event: "pull_request" },
    { event: "schedule" },
    { path: ".github/workflows/ci.yml" },
    { name: "Not CodeQL" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { id: -1 },
  ]) {
    const bad = { ...goodRun, ...override };
    assert.equal(isExactMainCodeqlRun(bad, sha, repository), false);
    assert.equal(findExactMainCodeqlReceipt([bad], { "123456": goodJobs }, sha, repository), null);
  }
  assert.equal(isExactMainCodeqlRun(goodRun, "invalid", repository), false);
});

test("CodeQL language matrix cannot pass with missing, skipped or failed jobs", () => {
  const js = { name: "analyze (javascript-typescript)", status: "completed", conclusion: "success" };
  const py = { name: "analyze (python)", status: "completed", conclusion: "success" };
  assert.equal(codeqlMainMatrixSucceeded([js, py]), true);
  for (const jobs of [
    [], [js], [py], [js, { ...py, conclusion: "failure" }],
    [js, { ...py, conclusion: "skipped" }],
    [js, { ...py, status: "queued" }],
    [{ ...js, name: "analyze (go)" }, py],
    [js, py, { ...py, conclusion: "failure" }],
    [js, py, { ...py }],
    [js, py, { name: "unexpected-extra", status: "completed", conclusion: "success" }],
    [js, js], [py, py],
    null, {},
  ]) assert.equal(codeqlMainMatrixSucceeded(jobs), false);
  assert.equal(codeqlMainMatrixSucceeded([py, js]), true, "matrix ordering is irrelevant");
});

test("CodeQL jobs API page must be complete, unambiguous, and exact before Production", () => {
  const js = { name: "analyze (javascript-typescript)", status: "completed", conclusion: "success" };
  const py = { name: "analyze (python)", status: "completed", conclusion: "success" };
  assert.equal(completeCodeqlJobsPage({ total_count: 2, jobs: [js, py] }), true);
  for (const page of [
    null, {}, { jobs: [js, py] }, { total_count: 3, jobs: [js, py] },
    { total_count: 2, jobs: [js] }, { total_count: "2", jobs: [js, py] },
    { total_count: 2, jobs: [js, py, { ...py, conclusion: "failure" }] },
    { total_count: 2, jobs: [js, { ...py, conclusion: "failure" }] },
    { total_count: 2, jobs: [js, js] }, { total_count: 2, jobs: [js, null] },
  ]) assert.equal(completeCodeqlJobsPage(page), false);
});

test("a newer incomplete or failed CodeQL run invalidates an older same-SHA green run", () => {
  const sha = "a".repeat(40);
  const repo = "Faysk/tda";
  const older = {
    id: 100, name: "CodeQL", path: ".github/workflows/codeql.yml",
    head_sha: sha, head_branch: "main", head_repository: { full_name: repo },
    event: "push", status: "completed", conclusion: "success",
  };
  const js = { name: "analyze (javascript-typescript)", status: "completed", conclusion: "success" };
  const py = { name: "analyze (python)", status: "completed", conclusion: "success" };
  const jobs = { "100": [js, py], "200": [js, py] };
  const newer = { ...older, id: 200, status: "in_progress", conclusion: null };
  assert.equal(findExactMainCodeqlReceipt([older, newer], jobs, sha, repo), null);
  assert.equal(findExactMainCodeqlReceipt([newer, older], jobs, sha, repo), null);
  assert.equal(findExactMainCodeqlReceipt([older, { ...newer, status: "completed",
    conclusion: "failure" }], jobs, sha, repo), null);
  assert.equal(findExactMainCodeqlReceipt([older, { ...newer, status: "completed",
    conclusion: "success" }], { ...jobs, "200": [js] }, sha, repo), null);
  assert.equal(findExactMainCodeqlReceipt([older, { ...newer, status: "completed",
    conclusion: "success" }], jobs, sha, repo)?.id, 200);
  assert.equal(findExactMainCodeqlReceipt([older, {
    ...newer, event: "pull_request",
  }], jobs, sha, repo)?.id, 100, "a PR run must not override a main push");
});

test("Production CodeQL fetch considers pending runs before evaluating latest receipt", () => {
  const source = readFileSync(join(process.cwd(), "tools/ci/require-main-codeql.mjs"), "utf8");
  assert.ok(source.includes("&event=push&per_page=100"));
  assert.equal(source.includes("&event=push&status=completed"), false);
  assert.ok(source.includes("latest run not successful"));
  assert.match(source, /if \(!completeCodeqlJobsPage\(jobPayload\)\)/);
});

test("Production checks the exact-main CodeQL matrix before human confirmation or deployment", () => {
  const prod = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  assert.match(prod, /node tools\/ci\/require-main-codeql\.mjs/);
  assert.ok(prod.indexOf("Require exact main CodeQL Python and JS/TS evidence") >
    prod.indexOf("Require successful CI for the exact main source"));
  assert.ok(prod.indexOf("Require exact main CodeQL Python and JS/TS evidence") <
    prod.indexOf("Require explicit human Production approval"));
  assert.ok(prod.indexOf("Require exact main CodeQL Python and JS/TS evidence") <
    prod.indexOf("Pull Production configuration"));
});

test("every main release candidate reaches Preview before an explicit Production approval", () => {
  const mainPreview = readFileSync(join(workflowRoot, "deploy-main-preview.yml"), "utf8");
  const production = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  assert.doesNotMatch(mainPreview, /^\s*workflow_run:/m);
  assert.doesNotMatch(mainPreview, /^\s*push:/m);
  assert.match(mainPreview, /workflow_dispatch:/);
  assert.match(mainPreview, /github.event_name == 'workflow_dispatch'/);
  assert.match(mainPreview, /MAIN_PREVIEW_EXACT_SUCCESSFUL_CI_REQUIRED/);
  assert.match(mainPreview, /SOURCE_SHA.*CURRENT_SHA/);
  assert.match(mainPreview, /environment:\s*\n\s+name: preview/);
  assert.match(mainPreview, /MAIN_PREVIEW_IDENTITY_OR_HEALTH_MISMATCH/);
  assert.match(mainPreview, /vercel pull --yes --environment=production/);
  assert.match(mainPreview, /vercel build --prod/);
  assert.match(mainPreview, /vercel deploy --prebuilt --prod --skip-domain/);
  assert.match(mainPreview, /health.environment !== "production"/);
  assert.match(mainPreview, /WRITE_STATUS.*403/);
  assert.match(production, /health.environment !== "production"/);
  assert.match(production, /const release = `prod-/);
  assert.equal(mainPreview.includes("vercel --prod"), false);
  assert.equal(mainPreview.includes("vercel promote"), false);
  assert.equal(mainPreview.includes("pnpm install"), false);
  assert.match(mainPreview, /persist-credentials:\s*false/);

  assert.match(production, /confirm:/);
  assert.match(production, /APPROVE_PREVIEW_FOR_PRODUCTION/);
  assert.match(production, /PRODUCTION_SUCCESSFUL_MAIN_PREVIEW_RUN_REQUIRED/);
  assert.match(production, /PRODUCTION_EXACT_MAIN_PREVIEW_DEPLOYMENT_REQUIRED/);
  assert.match(production, /PRODUCTION_APPROVED_PREVIEW_IDENTITY_INVALID/);
  assert.match(production, /environment=preview/);
  assert.match(production, /latest\?\.state === "success"/);
  assert.ok(production.indexOf("Require successful exact-SHA Main Preview deployment") <
    production.indexOf("Pull Production configuration"));
  assert.ok(production.indexOf("Reverify the approved Preview runtime before staging Production") <
    production.indexOf("Pull Production configuration"));
});

test("navigation regression failures upload a scoped synthetic Playwright trace", () => {
  const ci = readFileSync(join(workflowRoot, "ci.yml"), "utf8");
  const start = ci.indexOf("  navigation-e2e:\n");
  const end = ci.indexOf("\n  lembra-e2e:\n", start);
  assert.ok(start >= 0 && end > start, "navigation job boundary");
  const nav = ci.slice(start, end);
  const globalStep = nav.slice(nav.indexOf("      - name: Global navigation and shell contracts"),
    nav.indexOf("      - name: Shared campaign picker browser contract"));
  assert.ok(globalStep.includes("--trace=retain-on-failure"),
    "trace must be scoped to synthetic global navigation failure");
  const failedArtifact = nav.slice(nav.indexOf("      - name: Upload sanitized navigation failure artifacts"));
  assert.ok(failedArtifact.includes("if: ${{ failure() }}"));
  assert.ok(failedArtifact.includes("test-results/**/trace.zip"),
    "upload must include the actual Playwright failure trace");
  assert.equal(nav.includes("continue-on-error: true"), false);
  const playwright = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");
  assert.ok(playwright.includes('TDA_E2E_FIXTURES: "true"'));
  assert.ok(playwright.includes('TDA_READ_PUBLISHED_DATA: "false"'));
});

test("Main Preview requires latest same-SHA main CodeQL before Production-parity build", () => {
  const preview = readFileSync(join(workflowRoot, "deploy-main-preview.yml"), "utf8");
  assert.doesNotMatch(preview, /^\s*workflow_run:/m);
  assert.doesNotMatch(preview, /^\s*push:/m);
  assert.ok(preview.includes("github.event_name == 'workflow_dispatch'"));
  assert.ok(preview.includes("node tools/ci/require-main-ci.mjs"));
  assert.ok(preview.includes("MAIN_PREVIEW_EXACT_SUCCESSFUL_CI_REQUIRED"));
  assert.ok(preview.includes("Require exact-main CodeQL before Production-parity Preview"));
  assert.ok(preview.includes("node tools/ci/require-main-codeql.mjs"));
  assert.ok(preview.indexOf("Require exact-main CodeQL before Production-parity Preview") >
    preview.indexOf("Verify exact checkout and configure project"));
  assert.ok(preview.indexOf("Require exact-main CodeQL before Production-parity Preview") <
    preview.indexOf("Pull the existing Production environment"));
  assert.ok(preview.indexOf("Require exact-main CodeQL before Production-parity Preview") <
    preview.indexOf("vercel build --prod"));
  assert.ok(preview.indexOf("Require exact-main CodeQL before Production-parity Preview") <
    preview.indexOf("vercel deploy --prebuilt --prod --skip-domain"));
});

test("Web-only releases are semantic, channel-isolated and published after deploy proof", () => {
  const preview = readFileSync(join(workflowRoot, "deploy-main-preview.yml"), "utf8");
  const production = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  assert.match(preview, /contents: write/);
  assert.match(preview, /node tools\/ci\/web-release\.mjs bootstrap-production/);
  assert.match(preview, /node tools\/ci\/web-release\.mjs preview/);
  assert.ok(preview.indexOf("Smoke Production-parity staging") <
    preview.indexOf("node tools/ci/web-release.mjs preview"));
  assert.ok(preview.indexOf("Reject stale Preview") <
    preview.indexOf("node tools/ci/web-release.mjs preview"));
  assert.match(production, /node tools\/ci\/web-release\.mjs verify-preview/);
  assert.match(production, /node tools\/ci\/web-release\.mjs production/);
  assert.ok(production.indexOf("node tools/ci/web-release.mjs verify-preview") <
    production.indexOf("Pull Production configuration"));
  assert.ok(production.indexOf("Verify canonical Production after promotion") <
    production.indexOf("node tools/ci/web-release.mjs production"));
  assert.equal(production.includes('gh release create "$RELEASE_ID"'), false);
});

test("initial Web Production version is allowed only after verifying the canonical legacy release", () => {
  const release = readFileSync(join(process.cwd(), "tools", "ci", "web-release.mjs"), "utf8");
  assert.match(release, /const legacy = `prod-/);
  assert.match(release, /shaForTag\(repo, legacy\) !== sha/);
  assert.match(release, /releaseForTag\(repo, legacy\)\.tag_name !== legacy/);
  assert.match(release, /allowCanonicalBootstrap: true/);
  assert.match(release, /channel === "production" && !allowCanonicalBootstrap/);
});

test("Web release writes use a dedicated scoped token and block Production early if absent", () => {
  const preview = readFileSync(join(workflowRoot, "deploy-main-preview.yml"), "utf8");
  const production = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  assert.match(preview, /GH_TOKEN: \$\{\{ secrets\.WEB_RELEASE_TOKEN \}\}/);
  assert.match(preview, /Configure WEB_RELEASE_TOKEN in GitHub Environment preview/);
  assert.match(production, /RELEASE_PUBLISHER_TOKEN: \$\{\{ secrets\.WEB_RELEASE_TOKEN \}\}/);
  assert.match(production, /GH_TOKEN: \$\{\{ secrets\.WEB_RELEASE_TOKEN \}\}/);
  assert.ok(production.indexOf("Require Web release publisher before any Production side effects") <
    production.indexOf("Pull Production configuration"));
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


function auditBotReleaseFences(sources) {
  const violations = [];
  for (const name of ["production-cd.yml", "companion-promote.yml", "runtime-promote.yml"]) {
    const value = sources[name];
    if (!value) { violations.push(name + ": missing controlled release workflow"); continue; }
    const triggers = value.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1] || "";
    if (!/^  workflow_dispatch:/m.test(triggers)) violations.push(name + ": missing manual trigger");
    if (/^  (push|pull_request|pull_request_target|workflow_run|schedule):/m.test(triggers))
      violations.push(name + ": automated release trigger forbidden");
    if (!value.includes("persist-credentials: false"))
      violations.push(name + ": release checkout credential persistence");
  }
  const companion = sources["companion-promote.yml"] || "";
  const runtime = sources["runtime-promote.yml"] || "";
  for (const [file, value, receipt] of [
    ["companion-promote.yml", companion, "Require installed and physical receipt paths for this RC"],
    ["runtime-promote.yml", runtime, "Require exact physical acceptance receipt for this RC"],
  ]) {
    for (const marker of ['"$GITHUB_REF" == "refs/heads/main"', '"$CONFIRMATION" == "PROMOTE"',
      "gh release edit", receipt]) {
      if (!value.includes(marker)) violations.push(file + ": missing manual/receipt fence: " + marker);
    }
    if (value.indexOf(receipt) < 0 || value.indexOf("gh release edit") <= value.indexOf(receipt))
      violations.push(file + ": receipt must precede release mutation");
  }
  const production = sources["production-cd.yml"] || "";
  for (const marker of ["APPROVE_PREVIEW_FOR_PRODUCTION", "PRODUCTION_EXACT_MAIN_CI_REQUIRED",
    "PRODUCTION_SUCCESSFUL_MAIN_PREVIEW_RUN_REQUIRED", "PRODUCTION_APPROVED_PREVIEW_IDENTITY_INVALID",
    "Refusing stale/arbitrary Production release"]) {
    if (!production.includes(marker)) violations.push("production-cd.yml: missing " + marker);
  }
  for (const [file, version, marker] of [
    ["companion-039-recovery-stable.yml", "0.3.9", "BRIDGE_TRIGGER_NOT_MAIN_PUSH"],
    ["companion-0316-production-validation-stable.yml", "0.3.16", "PRODUCTION_VALIDATION_SOURCE_NOT_MAIN_ANCESTOR"],
    ["qwen-1012-production-validation-stable.yml", "1.0.12", "QWEN_PRODUCTION_VALIDATION_SOURCE_NOT_MAIN_ANCESTOR"],
  ]) {
    const value = sources[file] || "";
    if (!value.includes(version)) violations.push(file + ": missing exact legacy version");
    if (!value.includes(marker)) violations.push(file + ": missing exact-trigger/main ancestry fence");
    if (!value.includes("persist-credentials: false")) violations.push(file + ": credentials in checkout");
  }
  const bootstrap = sources["qwen-1012-stable-bootstrap.yml"] || "";
  const bootstrapTrigger = bootstrap.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1] || "";
  if (!bootstrapTrigger.includes("qwen-1012-stable-bootstrap.yml") ||
    !bootstrapTrigger.includes("branches: [main]") ||
    !bootstrapTrigger.includes("paths:")) violations.push("qwen bootstrap not self-file-scoped");
  if (!bootstrap.includes("EXPECTED_SOURCE_SHA:") || !bootstrap.includes("RUNTIME_RC_RUN_ID:"))
    violations.push("qwen bootstrap missing exact historic run and SHA");
  return violations.sort();
}

test("only verified manual general promotions and exact-version historical bridges can publish Stable", () => {
  const sources = Object.fromEntries(workflows.map(({ name, text }) => [name, text]));
  assert.deepEqual(auditBotReleaseFences(sources), []);
});

test("bot release policy rejects synthetic automatic Stable triggers and missing receipts", () => {
  const sources = Object.fromEntries(workflows.map(({ name, text }) => [name, text]));
  const changes = [
    ["production-cd.yml", (v) => v.replace("  workflow_dispatch:", "  push:\n    branches: [main]\n  workflow_dispatch:")],
    ["production-cd.yml", (v) => v.replace("persist-credentials: false", "persist-credentials: true")],
    ["companion-promote.yml", (v) => v.replace("  workflow_dispatch:", "  workflow_run:\n    workflows: [CI]\n  workflow_dispatch:")],
    ["runtime-promote.yml", (v) => v.replace('[[ "$CONFIRMATION" == "PROMOTE" ]]', '[[ "$CONFIRMATION" == "anything" ]]')],
    ["companion-promote.yml", (v) => v.replace("Require installed and physical receipt paths for this RC", "removed acceptance")],
    ["companion-039-recovery-stable.yml", (v) => v.replaceAll("0.3.9", "0.3.8")],
    ["qwen-1012-stable-bootstrap.yml", (v) => v.replace("      - '.github/workflows/qwen-1012-stable-bootstrap.yml'", "      - 'src/**'")],
  ];
  for (const [file, edit] of changes) {
    const mutated = { ...sources, [file]: edit(sources[file]) };
    assert.ok(auditBotReleaseFences(mutated).length > 0, "expected rejection for " + file);
  }
});


test("integrated bot and RC security suites remain wired exactly once to required CI", () => {
  const ci = readFileSync(join(workflowRoot, "ci.yml"), "utf8");
  const start = ci.indexOf("      - name: Validate change and Production release classifiers\n");
  const end = ci.indexOf("      - name: Validate direct Companion download verification\n", start);
  assert.ok(start !== -1 && end > start, "workflow-contract must run bot tests");
  const command = ci.slice(start, end);
  const expected = [
    "github-actions-security.test.mjs", "dependency-risk-contract.test.mjs",
    "bot-evidence-ledger.test.mjs", "automerge-dryrun.test.mjs",
    "dependency-triage.test.mjs", "rc-attestation-consumer.test.mjs",
    "rc-signer-run-verify.test.mjs",
    "rc-evidence-audit.test.mjs",
    "rc-public-release-audit.test.mjs",
    "rc-local-asset-integrity.test.mjs", "rc-provenance-policy.test.mjs",
    "bot-dependency-risk.test.mjs", "automation-trust-policy.test.mjs",
  ];
  assert.match(command, /run: >-\s+node --test\s+/);
  for (const file of expected) {
    const match = command.split("\n").filter((line) => line.trim() === "tools/ci/" + file);
    assert.equal(match.length, 1, "critical contract must be executed exactly once: " + file);
  }
  assert.equal(command.includes("continue-on-error: true"), false);
  assert.equal(ci.includes('node tools/ci/bot-dependency-risk.mjs "$RANGE"'), true,
    "dependency risk analysis must remain in classify-changes");
});


function evidenceObserverTrustViolations(text) {
  const issues = [];
  const grants = text.match(/^permissions:\n([\s\S]*?)(?=^\S|\Z)/m)?.[1] || "";
  const expected = ["  contents: read", "  actions: read", "  pull-requests: read"];
  const listed = grants.trimEnd().split("\n").filter((line) => line.trim());
  if (listed.join("\n") !== expected.join("\n"))
    issues.push("observer must keep only exact read-only permissions");
  if (/\b(?:pull_request_target|repository_dispatch):/.test(text))
    issues.push("observer must not accept arbitrary privileged trigger");
  if (/^\s+(?:permissions:|secrets:)/m.test(text.slice(text.indexOf("\njobs:") + 6)))
    issues.push("observer must not grant job-level privileges or secrets");
  if ((text.match(/uses:\s*actions\/checkout@/g) || []).length !== 1)
    issues.push("observer must use exactly one reviewed checkout");
  for (const marker of [
    "ref: \${{ github.event.repository.default_branch }}",
    "persist-credentials: false", "submodules: false", "lfs: false",
    "GH_TOKEN: \${{ github.token }}", "node tools/ci/bot-evidence-ledger.mjs",
  ]) if (!text.includes(marker)) issues.push("observer missing: " + marker);
  if (/github\.event\.(?:workflow_run\.head_sha|pull_request\.head\.sha)/.test(text))
    issues.push("observer must not use PR or workflow_run head checkout");
  if (/\b(?:gh\s+(?:pr\s+merge|release\s+(?:upload|edit|create)|workflow\s+run)|git\s+push)\b/.test(text))
    issues.push("observer must not mutate GitHub repository or releases");
  return issues;
}

test("privileged workflow_run observer never checks out untrusted PR code or gains write access", () => {
  const value = readFileSync(join(workflowRoot, "dependabot-evidence-ledger.yml"), "utf8");
  assert.deepEqual(evidenceObserverTrustViolations(value), []);
});

test("observer trust policy rejects synthetic PR checkout, write grants and publication operations", () => {
  const original = readFileSync(join(workflowRoot, "dependabot-evidence-ledger.yml"), "utf8");
  const changes = [
    (v) => v.replace("contents: read", "contents: write"),
    (v) => v.replace("ref: \${{ github.event.repository.default_branch }}",
      "ref: \${{ github.event.workflow_run.head_sha }}"),
    (v) => v.replace("persist-credentials: false", "persist-credentials: true"),
    (v) => v.replace("submodules: false", "submodules: true"),
    (v) => v.replace("  workflow_dispatch:", "  pull_request_target:\n  workflow_dispatch:"),
    (v) => v.replace("run: node tools/ci/bot-evidence-ledger.mjs",
      "run: gh pr merge --auto"),
    (v) => v.replace("  evidence:\n", "  evidence:\n    permissions:\n      contents: write\n"),
  ];
  for (const edit of changes) {
    const changed = edit(original);
    assert.notEqual(changed, original, "fixture failed to mutate");
    assert.notDeepEqual(evidenceObserverTrustViolations(changed), [],
      "expected synthetic observer trust boundary rejection");
  }
});
