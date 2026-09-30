import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const files = [
  ".github/workflows/ci.yml",
  "tests/processing/multi-recording-session.spec.ts",
  "src/features/edit/processing/session-assembly-review.tsx",
  "src/features/edit/processing/session-assembly-publication-client.ts",
  "src/features/edit/processing/session-intent-storage.ts",
  "src/features/transcript-review/session-assembly-markdown.ts",
  "src/features/transcript-review/markdown-contract.ts",
];

const content = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));

const requiredEvidence = [
  [".github/workflows/ci.yml", "single ZIP uses the same session journey"],
  [".github/workflows/ci.yml", "trusted midnight stays visible"],
  [".github/workflows/ci.yml", "stale Markdown import"],
  ["tests/processing/multi-recording-session.spec.ts", "single ZIP uses the same session journey"],
  ["tests/processing/multi-recording-session.spec.ts", "trusted midnight stays visible"],
  ["tests/processing/multi-recording-session.spec.ts", "stale Markdown import"],
  ["tests/processing/multi-recording-session.spec.ts", "Trecho 1 corrigido no Markdown"],
  ["tests/processing/multi-recording-session.spec.ts", "tda_transcript_publication_request_v2"],
  ["tests/processing/multi-recording-session.spec.ts", "{ width: 390, height: 844 }"],
  ["tests/processing/multi-recording-session.spec.ts", "{ width: 1440, height: 900 }"],
  ["tests/processing/multi-recording-session.spec.ts", "{ width: 1920, height: 1080 }"],
  ["tests/processing/multi-recording-session.spec.ts", "{ width: 720, height: 450 }"],
  ["src/features/edit/processing/session-assembly-review.tsx", "SESSION_ASSEMBLY_REVIEW_DRAFT_CONFLICT"],
  ["src/features/edit/processing/session-assembly-review.tsx", "tda.processing.sessionAssemblyPublication.v1"],
  ["src/features/edit/processing/session-assembly-publication-client.ts", "prepareMultiSourceCanonicalPublication"],
  ["src/features/edit/processing/session-assembly-publication-client.ts", "/api/transcript-publications/receipt"],
  ["src/features/transcript-review/session-assembly-markdown.ts", "SESSION_ASSEMBLY_MARKDOWN_SEGMENT_MISMATCH"],
  ["src/features/transcript-review/markdown-contract.ts", "TRANSCRIPT_MARKDOWN_MAX_BYTES"],
];

for (const [path, marker] of requiredEvidence) {
  if (!content.get(path)?.includes(marker)) {
    throw new Error(`SESSION_WORKFLOW_GATE_EVIDENCE_MISSING:${path}:${marker}`);
  }
}

const forbiddenPathPatterns = [
  /C:\\Users\\/iu,
  /\/Users\/[A-Za-z0-9._-]+\//u,
  /\/home\/[A-Za-z0-9._-]+\//u,
  /AppData\\Local/iu,
];

for (const [path, value] of content) {
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(value)) {
      throw new Error(`SESSION_WORKFLOW_GATE_PRIVATE_PATH:${path}:${pattern.source}`);
    }
  }
}

const forbiddenSensitivePatterns = [
  /authorization\s*[:=]\s*["']?\s*bearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\bcookie\s*[:=]\s*["'][^"'\r\n]{8,}["']/iu,
  /(?:access|refresh|api)[_-]?token\s*[:=]\s*["'][^"'\r\n]{8,}["']/iu,
  /https?:\/\/(?:[A-Za-z0-9-]+\.)+(?:internal|lan|home)(?=[:/]|$)/iu,
];

const artifactTextExtensions = new Set([".md", ".txt", ".json", ".log"]);
function scanRuntimeArtifacts(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const path = `${root}/${entry}`;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      scanRuntimeArtifacts(path);
      continue;
    }
    const extension = entry.slice(entry.lastIndexOf(".")).toLowerCase();
    if (!artifactTextExtensions.has(extension)) continue;
    const value = readFileSync(path, "utf8");
    for (const pattern of [...forbiddenPathPatterns, ...forbiddenSensitivePatterns]) {
      if (pattern.test(value)) {
        throw new Error(`SESSION_WORKFLOW_GATE_PRIVATE_ARTIFACT:${path}:${pattern.source}`);
      }
    }
  }
}

for (const [path, value] of content) {
  for (const pattern of forbiddenSensitivePatterns) {
    if (pattern.test(value)) {
      throw new Error(`SESSION_WORKFLOW_GATE_SECRET_LITERAL:${path}:${pattern.source}`);
    }
  }
}
scanRuntimeArtifacts("test-results");

function typeBlock(source, typeName) {
  const declaration = `type ${typeName} =`;
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`SESSION_WORKFLOW_GATE_TYPE_MISSING:${typeName}`);
  const end = source.indexOf("}>;", start);
  if (end < 0) throw new Error(`SESSION_WORKFLOW_GATE_TYPE_UNBOUNDED:${typeName}`);
  return source.slice(start, end + 3);
}

const handoffRecovery = typeBlock(
  content.get("src/features/edit/processing/session-assembly-review.tsx") ?? "",
  "PendingPublication",
);
for (const forbidden of ["text:", "speaker:", "context:", "glossary:", "segments:"]) {
  if (handoffRecovery.includes(forbidden)) {
    throw new Error(`SESSION_WORKFLOW_GATE_HANDOFF_RECOVERY_PRIVATE_FIELD:${forbidden}`);
  }
}

const sessionReceipt = typeBlock(
  content.get("src/features/edit/processing/session-intent-storage.ts") ?? "",
  "SessionIntentReceipt",
);
for (const forbidden of ["context:", "glossary:"]) {
  if (sessionReceipt.includes(forbidden)) {
    throw new Error(`SESSION_WORKFLOW_GATE_SESSION_RECEIPT_PRIVATE_FIELD:${forbidden}`);
  }
}
for (const required of ["contextSha256:", "glossarySha256:"]) {
  if (!sessionReceipt.includes(required)) {
    throw new Error(`SESSION_WORKFLOW_GATE_SESSION_RECEIPT_HASH_MISSING:${required}`);
  }
}

console.log("SESSION_WORKFLOW_GATE_OK");
