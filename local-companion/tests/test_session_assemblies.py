from __future__ import annotations

import hashlib

import pytest

from tda_companion.session_assemblies import (
    SessionAssemblyError,
    assembly_dependency_for_run,
    build_session_assembly,
    list_session_assemblies,
    load_session_assembly,
    load_session_assembly_transcript,
)
from tda_companion.session_assembly_review import (
    ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT,
    SessionAssemblyReviewError,
    open_assembly_review,
    save_assembly_review,
)
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptStats,
    TranscriptTrack,
)
from tda_companion.transcription_runs import run_id_for, write_completed_run


def source_id(seed: int) -> str:
    return f"craig-{seed:064x}"


def stage_run(data_root, seed: int, *, job_suffix: str = "a", start: float = 1.0, text: str = "fala"):
    source = source_id(seed)
    root = data_root / "staging" / source
    root.mkdir(parents=True, exist_ok=True)
    job_id = f"job-{seed}-{job_suffix}"
    document = TranscriptDocument(
        recording_id=f"recording-{seed}",
        source_sha256=source.removeprefix("craig-"),
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="synthetic",
            profile="whisper-turbo",
            device="cpu",
        ),
        tracks=(
            TranscriptTrack(
                number=1,
                speaker=f"Speaker {seed}",
                source_filename=f"{seed}.flac",
                source_sha256=hashlib.sha256(f"track-{seed}".encode()).hexdigest(),
                duration_seconds=10.0,
                timeline_offset_seconds=0.0,
                segments=(
                    TranscriptSegment(
                        id=f"segment-{job_suffix}",
                        start=start,
                        end=start + 1.0,
                        text=text,
                    ),
                ),
            ),
        ),
        stats=TranscriptStats(
            audio_work_seconds=10.0,
            session_duration_seconds=10.0,
            processing_seconds=1.0,
            word_count=0,
            segment_count=1,
            track_count=1,
        ),
    )
    manifest = write_completed_run(
        root,
        document,
        job_id=job_id,
        attempt=1,
        source_id=source,
    )
    return source, root, manifest["run_id"]


def workspace_for(runs):
    parts = []
    for ordinal, (source, _root, run_id) in enumerate(runs):
        parts.append(
            {
                "part_id": f"{ordinal + 1:032x}",
                "source_id": source,
                "ordinal": ordinal,
                "selected_run_id": run_id,
                "timeline_mode": "manual",
                "session_offset_seconds": float(ordinal * 10),
                "trim_start_seconds": 0.0,
                "trim_end_seconds": None,
                "gap_confirmed": False,
                "overlap_resolution": None,
                "overlap_boundary_seconds": None,
                "relation_to_previous": "first" if ordinal == 0 else "contiguous",
            }
        )
    return {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": len(parts),
        "ordering_mode": "manual",
        "parts": parts,
        "timeline": {
            "policy_version": "tda_session_timeline_v1",
            "segment_boundary_policy": "segment_start_owner_v1",
            "fingerprint_sha256": hashlib.sha256(
                repr([(row["source_id"], row["session_offset_seconds"]) for row in parts]).encode()
            ).hexdigest(),
            "state": "ready",
        },
    }


def participant_mapping(runs, *, approval_blocked: bool = False):
    observations = []
    observation_ids = []
    for ordinal, (source, _root, _run_id) in enumerate(runs):
        observation_id = hashlib.sha256(f"{source}:1".encode()).hexdigest()[:32]
        observation_ids.append(observation_id)
        observations.append(
            {
                "observation_id": observation_id,
                "source_id": source,
                "track_number": 1,
                "raw_speaker": f"Speaker {ordinal + 1}",
                "username": None,
                "discriminator": None,
                "discord_id": "111",
            }
        )
    canonical = repr([(row["source_id"], row["track_number"]) for row in observations])
    return {
        "schema_version": "tda_session_participant_mapping_v1",
        "policy": "strong_discord_or_manual_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "workspace_revision": len(runs),
        "mapping_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
        "approval_blocked": approval_blocked,
        "observations": observations,
        "participants": [
            {
                "participant_id": "a" * 32,
                "resolution": "discord_id",
                "profile_id": None,
                "display_speaker": "Renan",
                "observation_ids": observation_ids,
            }
        ],
        "conflicts": [],
        "manual_assignments": [],
    }


def build(data_root, runs, *, mapping=None, workspace=None, before_commit=None):
    value = workspace or workspace_for(runs)
    mapping = mapping or participant_mapping(runs)
    return build_session_assembly(
        data_root,
        value,
        mapping,
        {source: root for source, root, _run_id in runs},
        run_visible=lambda _root, _manifest: True,
        before_commit=before_commit,
    )


@pytest.mark.parametrize("count", [1, 2, 3, 20])
def test_session_assembly_builds_bounded_parts_deterministically(tmp_path, count):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, seed) for seed in range(1, count + 1)]
    first = build(data_root, runs)
    repeated = build(data_root, runs)

    assert repeated["assembly_id"] == first["assembly_id"]
    assert repeated["transcript_sha256"] == first["transcript_sha256"]
    assert len(first["parts"]) == count
    assert first["segment_count"] == count

    listing = list_session_assemblies(data_root, "campaign-a", "session-a")
    assert [row["assembly_id"] for row in listing["assemblies"]] == [first["assembly_id"]]

    manifest, transcript = load_session_assembly_transcript(
        data_root, "campaign-a", "session-a", first["assembly_id"]
    )
    assert manifest["transcript_sha256"] == first["transcript_sha256"]
    assert [row["part_ordinal"] for row in transcript["segments"]] == list(range(count))
    assert len({row["assembly_segment_id"] for row in transcript["segments"]}) == count


def test_switching_only_one_selected_run_creates_new_assembly_and_preserves_old(tmp_path):
    data_root = tmp_path / "Data"
    first_source = stage_run(data_root, 1, job_suffix="a", text="antes")
    second = stage_run(data_root, 2, job_suffix="a", text="estavel")
    runs = [first_source, second]
    original = build(data_root, runs)

    replacement = stage_run(data_root, 1, job_suffix="b", text="depois")
    changed_runs = [replacement, second]
    changed = build(data_root, changed_runs)

    assert changed["assembly_id"] != original["assembly_id"]
    assert changed["parts"][0]["run_id"] == replacement[2]
    assert changed["parts"][1]["run_id"] == second[2]
    old = load_session_assembly(
        data_root, "campaign-a", "session-a", original["assembly_id"], verify_transcript=True
    )
    assert old["parts"][0]["run_id"] == first_source[2]
    assert old["parts"][1]["run_id"] == second[2]


def test_unresolved_timeline_missing_run_and_incomplete_mapping_fail_closed(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1)]
    unresolved = workspace_for(runs)
    unresolved["timeline"]["state"] = "overlap_unresolved"
    with pytest.raises(SessionAssemblyError, match="SESSION_ASSEMBLY_TIMELINE_NOT_READY"):
        build(data_root, runs, workspace=unresolved)

    missing = workspace_for(runs)
    missing["parts"][0]["selected_run_id"] = "run-missing-a1"
    with pytest.raises(SessionAssemblyError, match="SESSION_ASSEMBLY_RUN_INVALID"):
        build(data_root, runs, workspace=missing)

    bad_mapping = participant_mapping(runs)
    bad_mapping["participants"] = []
    with pytest.raises(SessionAssemblyError, match="SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INCOMPLETE"):
        build(data_root, runs, mapping=bad_mapping)


def test_crash_after_transcript_before_commit_marker_never_lists_partial(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1)]

    def fail():
        raise RuntimeError("synthetic crash")

    with pytest.raises(RuntimeError, match="synthetic crash"):
        build(data_root, runs, before_commit=fail)

    assert list_session_assemblies(data_root, "campaign-a", "session-a")["assemblies"] == []


def test_overlap_boundary_uses_segment_start_owner_without_fuzzy_dedupe(tmp_path):
    data_root = tmp_path / "Data"
    earlier = stage_run(data_root, 1, start=9.0, text="earlier")
    later = stage_run(data_root, 2, start=3.0, text="later")
    runs = [earlier, later]
    workspace = workspace_for(runs)
    workspace["parts"][1].update(
        session_offset_seconds=5.0,
        relation_to_previous="overlap",
        overlap_resolution="prefer_later_from",
        overlap_boundary_seconds=8.0,
    )
    workspace["timeline"]["fingerprint_sha256"] = "f" * 64
    value = build(data_root, runs, workspace=workspace)
    _, transcript = load_session_assembly_transcript(
        data_root, "campaign-a", "session-a", value["assembly_id"]
    )
    assert [row["text"] for row in transcript["segments"]] == ["later"]
    assert transcript["segments"][0]["start"] == 8.0


def test_run_dependency_fails_closed_after_assembly_commit(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1)]
    assert assembly_dependency_for_run(data_root, runs[0][0], runs[0][2]) is None
    assembly = build(data_root, runs)
    dependency = assembly_dependency_for_run(data_root, runs[0][0], runs[0][2])
    assert dependency == {
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "assembly_id": assembly["assembly_id"],
    }


def test_assembly_review_binds_exact_assembly_and_requires_saved_draft_for_approval(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1)]
    assembly = build(data_root, runs)
    base = open_assembly_review(
        data_root, "campaign-a", "session-a", assembly["assembly_id"], base_only=True
    )
    assert base["base"]["kind"] == "session_assembly"
    assert base["base"]["assembly_id"] == assembly["assembly_id"]
    assert base["persistence"] == "ephemeral_base"

    segments = [dict(row, reviewed=True) for row in base["segments"]]
    saved = save_assembly_review(
        data_root,
        "campaign-a",
        "session-a",
        assembly["assembly_id"],
        {
            "snapshot_contract": ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT,
            "expected": {
                "persistence": "ephemeral_base",
                "base_transcript_sha256": base["base"]["transcript_sha256"],
            },
            "status": "reviewed",
            "segments": segments,
        },
    )
    assert saved["draft_revision"] == 1
    assert saved["approval_current"] is False

    approved = save_assembly_review(
        data_root,
        "campaign-a",
        "session-a",
        assembly["assembly_id"],
        {
            "snapshot_contract": ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT,
            "expected": {
                "persistence": "persisted",
                "draft_revision": saved["draft_revision"],
                "draft_sha256": saved["draft_sha256"],
            },
            "status": "approved_local",
            "segments": saved["segments"],
        },
    )
    assert approved["status"] == "approved_local"
    assert approved["approval_current"] is True
    assert approved["base"]["assembly_id"] == assembly["assembly_id"]


def test_participant_ambiguity_allows_build_but_blocks_assembly_approval(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1)]
    assembly = build(data_root, runs, mapping=participant_mapping(runs, approval_blocked=True))
    base = open_assembly_review(
        data_root, "campaign-a", "session-a", assembly["assembly_id"]
    )
    saved = save_assembly_review(
        data_root,
        "campaign-a",
        "session-a",
        assembly["assembly_id"],
        {
            "snapshot_contract": ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT,
            "expected": {
                "persistence": "ephemeral_base",
                "base_transcript_sha256": base["base"]["transcript_sha256"],
            },
            "status": "reviewed",
            "segments": base["segments"],
        },
    )
    with pytest.raises(SessionAssemblyReviewError, match="SESSION_ASSEMBLY_REVIEW_APPROVAL_BLOCKED"):
        save_assembly_review(
            data_root,
            "campaign-a",
            "session-a",
            assembly["assembly_id"],
            {
                "snapshot_contract": ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT,
                "expected": {
                    "persistence": "persisted",
                    "draft_revision": saved["draft_revision"],
                    "draft_sha256": saved["draft_sha256"],
                },
                "status": "approved_local",
                "segments": saved["segments"],
            },
        )
