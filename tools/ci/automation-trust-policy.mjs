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

// Every newly introduced write scope must be added by a reviewed policy PR.
// This allowlist documents *declared* YAML permissions, not actual effective grants.
const approvedWrites = {
  "codeql.yml": ["security-events"],
  "companion-0316-production-validation-stable.yml": ["contents"],
  "companion-039-recovery-stable.yml": ["contents"],
  "companion-promote.yml": ["contents"],
  "companion-rc.yml": ["contents", "id-token", "attestations", "artifact-metadata"],
  "deploy-main-preview.yml": ["contents", "deployments"],
  "deploy-preview.yml": ["deployments"],
  "issue-structure-governance.yml": ["issues"],
  "label-governance.yml": ["issues"],
  "production-cd.yml": ["contents", "deployments"],
  "qwen-1012-production-validation-stable.yml": ["contents"],
  "qwen-1012-stable-bootstrap.yml": ["actions"],
  "qwen-runtime-package.yml": ["actions"],
  "rollback.yml": ["deployments"],
  "runtime-promote.yml": ["contents"],
  "runtime-rc.yml": ["contents", "actions", "id-token", "attestations", "artifact-metadata"],
};

// This structural guard also catches YAML flow-style declarations. It is
// not a full YAML parser and does not replace GitHub server-side enforcement.
function inlineTriggers(content) {
  const found = new Set();
  for (const match of content.matchAll(/^\s*["']?on["']?:\s*(?:\[([^\]\r\n]*)\]|\{([^\r\n]*)\}|(["']?[a-z_]+["']?))\s*(?:#.*)?$/gm)) {
    const body = match[1] ?? match[2] ?? match[3] ?? "";
    for (const name of ["pull_request_target", "workflow_run", "push"]) {
      if (new RegExp("\\b" + name + "\\b").test(body)) found.add(name);
    }
  }
  return found;
}
function inlineWriteScopes(content) {
  const scopes = [];
  for (const match of content.matchAll(/^\s*permissions:\s*\{([^}\r\n]*)\}/gm)) {
    for (const entry of match[1].matchAll(/(?:^|,)\s*["']?([a-z][a-z0-9-]*)["']?\s*:\s*["']?write\b/g))
      scopes.push(entry[1]);
  }
  return scopes;
}

export function auditBotTrust(sources) {
  const violations = [];
  for (const [file, value] of Object.entries(sources)) {
    const content = String(value);
    const flowTriggers = inlineTriggers(content);
    if (/^\s*pull_request_target\s*:/m.test(content) || flowTriggers.has("pull_request_target"))
      violations.push(file + ": forbidden pull_request_target");
    if (/\bsecrets:\s*inherit\b/.test(content)) violations.push(file + ": forbidden secrets inheritance");
    if (/\bpermissions:\s*write-all\b/.test(content)) violations.push(file + ": forbidden write-all");
    const writeScopes = [
      ...[...content.matchAll(/^\s+([a-z][a-z0-9-]*):\s*write(?:\s*#.*)?$/gm)].map((m) => m[1]),
      ...inlineWriteScopes(content),
    ];
    for (const scope of writeScopes) {
      if (!approvedWrites[file]?.includes(scope))
        violations.push(file + ": unapproved write scope " + scope);
    }
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
  if (typeof production === "string" &&
      (/^\s*workflow_run\s*:/m.test(production) || /^\s*push\s*:/m.test(production) ||
       inlineTriggers(production).has("workflow_run") || inlineTriggers(production).has("push"))) {
    violations.push("production-cd.yml: forbidden automatic Production trigger");
  }
  return violations.sort();
}
