import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function readWorkflowSources(root = join(process.cwd(), ".github", "workflows")) {
  return Object.fromEntries(readdirSync(root).filter((file) => /\.ya?ml$/i.test(file))
    .map((file) => [file, readFileSync(join(root, file), "utf8")]));
}

// Structural regression alarms: these tests do NOT prove remote protection,
// secure tokens, or release correctness. Stateful release controls remain in
// their original workflows and existing exact-SHA policy tests.
const required = {
  "deploy-preview.yml": [
    "github.event.workflow_run.event == 'pull_request'",
    'pr.get("state") == "open"',
    'head.get("sha") == os.environ["SOURCE_SHA"]',
    'repo.get("full_name") == os.environ["GITHUB_REPOSITORY"]',
    "PREVIEW_EXACT_SUCCESSFUL_CI_REQUIRED",
    "persist-credentials: false",
  ],
  "deploy-main-preview.yml": [
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    "MAIN_PREVIEW_EXACT_SUCCESSFUL_CI_REQUIRED",
    'if [[ "$SOURCE_SHA" != "$CURRENT_SHA" ]]',
    "persist-credentials: false",
  ],
  "companion-rc.yml": [
    "value.get('event') != 'push'",
    "value.get('head_branch') != 'main'",
    "AUTO_RC_TRIGGER_NOT_MAIN_PUSH",
    "AUTO_RC_TRIGGER_SOURCE_MISMATCH",
    "persist-credentials: false",
  ],
  "runtime-rc.yml": [
    '[[ "$TRIGGER_EVENT" == "push" && "$TRIGGER_BRANCH" == "main" ]]',
    "AUTO_RUNTIME_TRIGGER_NOT_MAIN_PUSH",
    "AUTO_RUNTIME_SOURCE_NOT_MAIN_ANCESTOR",
    "persist-credentials: false",
  ],
  "production-cd.yml": [
    "github.event_name == 'workflow_dispatch'",
    "APPROVE_PREVIEW_FOR_PRODUCTION",
    "PRODUCTION_EXACT_MAIN_CI_REQUIRED",
    "PRODUCTION_SUCCESSFUL_MAIN_PREVIEW_RUN_REQUIRED",
    "PRODUCTION_APPROVED_PREVIEW_IDENTITY_INVALID",
    "Refusing stale/arbitrary Production release",
  ],
};

const ordered = {
  "deploy-preview.yml": [
    ["Require current same-repository PR head", "Start immutable remote Preview deployment"],
    ["Require successful CI for exact current PR head", "Start immutable remote Preview deployment"],
  ],
  "deploy-main-preview.yml": [
    ["Resolve exact current main with successful CI", "Pull the existing Production environment"],
  ],
  "companion-rc.yml": [
    ["Resolve exact validated artifact source", "Download exact validated Windows artifact"],
  ],
  "runtime-rc.yml": [
    ["Resolve trusted source and trigger", "Require exact source and safe automatic ancestry"],
  ],
  "production-cd.yml": [
    ["Require explicit human Production approval", "Pull Production configuration"],
    ["Require successful exact-SHA Main Preview deployment", "Pull Production configuration"],
  ],
};

export function auditBotTrust(sources) {
  const violations = [];
  for (const [file, value] of Object.entries(sources)) {
    const content = String(value);
    if (/^\s*pull_request_target\s*:/m.test(content)) violations.push(file + ": forbidden pull_request_target");
    if (/\bsecrets:\s*inherit\b/.test(content)) violations.push(file + ": forbidden secrets inheritance");
    if (/\bpermissions:\s*write-all\b/.test(content)) violations.push(file + ": forbidden write-all");
  }
  for (const [file, markers] of Object.entries(required)) {
    const content = sources[file];
    if (typeof content !== "string") { violations.push(file + ": missing workflow"); continue; }
    for (const marker of markers) {
      if (!content.includes(marker)) violations.push(file + ": missing trust gate " + marker);
    }
    for (const [before, after] of ordered[file] ?? []) {
      if (content.indexOf(before) < 0 || content.indexOf(after) < 0 || content.indexOf(before) >= content.indexOf(after)) {
        violations.push(file + ": untrusted execution order " + before + " -> " + after);
      }
    }
  }
  const production = sources["production-cd.yml"];
  if (typeof production === "string" && (/^\s*workflow_run\s*:/m.test(production) || /^\s*push\s*:/m.test(production))) {
    violations.push("production-cd.yml: forbidden automatic Production trigger");
  }
  return violations.sort();
}
