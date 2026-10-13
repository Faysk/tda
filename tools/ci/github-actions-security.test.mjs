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
test("every main release candidate reaches Preview before an explicit Production approval", () => {
  const mainPreview = readFileSync(join(workflowRoot, "deploy-main-preview.yml"), "utf8");
  const production = readFileSync(join(workflowRoot, "production-cd.yml"), "utf8");
  assert.match(mainPreview, /workflow_run:/);
  assert.match(mainPreview, /workflows:\s*\[CI\]/);
  assert.match(mainPreview, /workflow_dispatch:/);
  assert.match(mainPreview, /head_branch == 'main'/);
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
