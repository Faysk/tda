import { readFileSync } from "node:fs";

const files = [
  "tests/processing/multi-recording-session.spec.ts",
  "local-companion/tests/test_session_workspaces.py",
  "local-companion/tests/test_session_timeline.py",
  "local-companion/tests/test_session_participants.py",
  "local-companion/tests/test_session_assemblies.py",
  "local-companion/tests/test_session_assembly_api.py",
  "src/features/transcript-publication/multi-source-canonical.test.ts",
  "supabase/tests/transcript_multi_source_provenance.sql",
];

const content = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));

const requiredEvidence = [
  ["tests/processing/multi-recording-session.spec.ts", "postedSources"],
  ["tests/processing/multi-recording-session.spec.ts", "dropAgentOnce"],
  ["tests/processing/multi-recording-session.spec.ts", "failNextSecondSourceEnqueue"],
  ["local-companion/tests/test_session_workspaces.py", "test_session_workspace_persists_parts_and_order_across_restart"],
  ["local-companion/tests/test_session_workspaces.py", "test_duplicate_source_attach_is_idempotent"],
  ["local-companion/tests/test_session_timeline.py", "overlap_unresolved"],
  ["local-companion/tests/test_session_participants.py", "test_reconnect_track_numbers_can_swap_without_swapping_people"],
  ["local-companion/tests/test_session_assemblies.py", "test_session_assembly_builds_bounded_parts_deterministically"],
  ["local-companion/tests/test_session_assemblies.py", "test_crash_after_transcript_before_commit_marker_never_lists_partial"],
  ["local-companion/tests/test_session_assemblies.py", "test_switching_only_one_selected_run_creates_new_assembly_and_preserves_old"],
  ["local-companion/tests/test_session_assemblies.py", "test_assembly_review_binds_exact_assembly"],
  ["src/features/transcript-publication/multi-source-canonical.test.ts", "unknown privacy-sensitive metadata"],
  ["supabase/tests/transcript_multi_source_provenance.sql", "ASSEMBLY_REPLAY_DUPLICATED_EVIDENCE"],
  ["supabase/tests/transcript_multi_source_provenance.sql", "ASSEMBLY_STALE_WRITE_LEFT_EVIDENCE"],
  ["supabase/tests/transcript_multi_source_provenance.sql", "ASSEMBLY_UNPUBLISH_DESTROYED_PROVENANCE"],
];

for (const [path, marker] of requiredEvidence) {
  if (!content.get(path)?.includes(marker)) {
    throw new Error(`MULTI_RECORDING_GATE_EVIDENCE_MISSING:${path}:${marker}`);
  }
}

const fixturePaths = [
  "tests/processing/multi-recording-session.spec.ts",
  "local-companion/tests/test_session_assemblies.py",
  "src/features/transcript-publication/multi-source-canonical.test.ts",
  "supabase/tests/transcript_multi_source_provenance.sql",
];

const forbidden = [
  /C:\\Users\\/iu,
  /\/Users\/[A-Za-z0-9._-]+\//u,
  /\/home\/[A-Za-z0-9._-]+\//u,
  /AppData\\Local/iu,
];

for (const path of fixturePaths) {
  const value = content.get(path) ?? "";
  for (const pattern of forbidden) {
    if (pattern.test(value)) {
      throw new Error(`MULTI_RECORDING_GATE_PRIVATE_PATH:${path}:${pattern.source}`);
    }
  }
}

console.log("MULTI_RECORDING_GATE_FIXTURES_OK");
