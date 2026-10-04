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
                "physical_interval_state": "first" if ordinal == 0 else "manual",
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
            "policy_version": "tda_session_timeline_v2",
            "segment_boundary_policy": "segment_start_owner_v1",
            "strategy": "manual_offsets",
            "wall_clock": "unavailable",
            "unknown_interval_count": 0,
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
    assert first["inputs_sha256"] == first["assembly_id"]
    assert first["timing_policy_version"] == "tda_session_timeline_v2"
    assert first["canonicalization_version"] == "tda_session_assembly_canonical_v2"
    assert first["timeline_strategy"] == "manual_offsets"
    assert first["wall_clock"] == "unavailable"
    assert first["unknown_interval_count"] == 0
    assert first["segment_boundary_policy"] == "segment_start_owner_v1"
    assert first["participant_mapping_schema_version"] == "tda_session_participant_mapping_v1"
    assert first["participant_mapping_policy"] == "strong_discord_or_manual_v1"
    assert len(first["timeline_fingerprint_sha256"]) == 64
    assert len(first["participant_mapping_sha256"]) == 64

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


def test_session_assembly_projects_trusted_wall_clock_per_real_part(tmp_path):
    data_root = tmp_path / "Data"
    first = stage_run(data_root, 1, start=2.5, text="trusted")
    second = stage_run(data_root, 2, start=1.0, text="untrusted")
    runs = [first, second]
    workspace = workspace_for(runs)
    workspace["parts"][0].update(
        source_start_time="2026-09-12T23:59:59+01:00",
        source_start_confidence="trusted_absolute",
        source_start_utc="2026-09-12T22:59:59Z",
    )
    workspace["parts"][1].update(
        source_start_time="00:10:00",
        source_start_confidence="ambiguous",
        source_start_utc=None,
    )

    value = build(data_root, runs, workspace=workspace)
    _, transcript = load_session_assembly_transcript(
        data_root, "campaign-a", "session-a", value["assembly_id"]
    )
    by_text = {row["text"]: row for row in transcript["segments"]}

    assert by_text["trusted"]["absolute_start"] == "2026-09-13T00:00:01.500+01:00"
    assert by_text["trusted"]["absolute_end"] == "2026-09-13T00:00:02.500+01:00"
    assert by_text["trusted"]["absolute_time_state"] == "trusted_absolute"
    assert by_text["trusted"]["absolute_time_source"] == first[0]

    assert by_text["untrusted"]["absolute_start"] is None
    assert by_text["untrusted"]["absolute_end"] is None
    assert by_text["untrusted"]["absolute_time_state"] == "unavailable"
    assert by_text["untrusted"]["absolute_time_source"] is None


def test_assembly_review_preserves_absolute_time_provenance_and_rejects_tampering(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1, start=2.0)]
    workspace = workspace_for(runs)
    workspace["parts"][0].update(
        source_start_time="2026-09-12T23:59:59+01:00",
        source_start_confidence="trusted_absolute",
        source_start_utc="2026-09-12T22:59:59Z",
    )
    assembly = build(data_root, runs, workspace=workspace)
    base = open_assembly_review(
        data_root, "campaign-a", "session-a", assembly["assembly_id"], base_only=True
    )
    segment = base["segments"][0]
    assert segment["absolute_start"] == "2026-09-13T00:00:01.000+01:00"
    assert segment["absolute_time_state"] == "trusted_absolute"
    assert segment["absolute_time_source"] == runs[0][0]

    tampered = [dict(row) for row in base["segments"]]
    tampered[0]["absolute_start"] = "2026-09-13T00:01:01.000+01:00"
    with pytest.raises(
        SessionAssemblyReviewError,
        match="SESSION_ASSEMBLY_REVIEW_SEGMENT_PROVENANCE_IMMUTABLE",
    ):
        save_assembly_review(
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
                "segments": tampered,
            },
        )


def test_session_assembly_identity_includes_absolute_time_authority(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1)]
    first_workspace = workspace_for(runs)
    first_workspace["parts"][0].update(
        source_start_time="2026-09-12T22:34:23+01:00",
        source_start_confidence="trusted_absolute",
        source_start_utc="2026-09-12T21:34:23Z",
    )
    first = build(data_root, runs, workspace=first_workspace)

    shifted_workspace = workspace_for(runs)
    shifted_workspace["parts"][0].update(
        source_start_time="2026-09-12T22:35:23+01:00",
        source_start_confidence="trusted_absolute",
        source_start_utc="2026-09-12T21:35:23Z",
    )
    shifted = build(data_root, runs, workspace=shifted_workspace)

    assert shifted["assembly_id"] != first["assembly_id"]
    assert shifted["transcript_sha256"] != first["transcript_sha256"]



def test_sequence_assembly_provenance_changes_identity_without_mutating_source_runs(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1), stage_run(data_root, 2), stage_run(data_root, 3)]
    base = workspace_for(runs)
    base["timeline"].update(
        strategy="user_confirmed_sequence",
        wall_clock="partial",
        unknown_interval_count=1,
    )
    for index, row in enumerate(base["parts"]):
        row["timeline_mode"] = "sequence"
        row["physical_interval_state"] = (
            "first" if index == 0 else "trusted_absolute" if index == 1 else "unknown"
        )
        row["session_offset_seconds"] = float(index * 10)
    base["timeline"]["fingerprint_sha256"] = hashlib.sha256(
        b"sequence-order-a"
    ).hexdigest()

    first = build(data_root, runs, workspace=base)
    first_sources = [
        (row["source_id"], row["source_sha256"], row["run_id"], row["transcript_sha256"])
        for row in first["parts"]
    ]
    assert first["timeline_strategy"] == "user_confirmed_sequence"
    assert first["wall_clock"] == "partial"
    assert first["unknown_interval_count"] == 1
    assert first["parts"][2]["physical_interval_state"] == "unknown"

    reordered = workspace_for([runs[1], runs[0], runs[2]])
    reordered["timeline"].update(
        strategy="user_confirmed_sequence",
        wall_clock="partial",
        unknown_interval_count=1,
        fingerprint_sha256=hashlib.sha256(b"sequence-order-b").hexdigest(),
    )
    for index, row in enumerate(reordered["parts"]):
        row["timeline_mode"] = "sequence"
        row["physical_interval_state"] = (
            "first" if index == 0 else "trusted_absolute" if index == 1 else "unknown"
        )
        row["session_offset_seconds"] = float(index * 10)

    changed = build(data_root, [runs[1], runs[0], runs[2]], workspace=reordered)
    assert changed["assembly_id"] != first["assembly_id"]
    assert load_session_assembly(
        data_root,
        "campaign-a",
        "session-a",
        first["assembly_id"],
        verify_transcript=True,
    )["assembly_id"] == first["assembly_id"]

    changed_by_source = {
        row["source_id"]: (
            row["source_sha256"],
            row["run_id"],
            row["transcript_sha256"],
        )
        for row in changed["parts"]
    }
    for source_id_value, source_sha, run_id, transcript_sha in first_sources:
        assert changed_by_source[source_id_value] == (
            source_sha,
            run_id,
            transcript_sha,
        )


def test_sequence_fingerprint_change_creates_new_immutable_assembly(tmp_path):
    data_root = tmp_path / "Data"
    runs = [stage_run(data_root, 1), stage_run(data_root, 2)]
    workspace = workspace_for(runs)
    workspace["timeline"].update(
        strategy="user_confirmed_sequence",
        wall_clock="unavailable",
        unknown_interval_count=1,
        fingerprint_sha256=hashlib.sha256(b"sequence-v1").hexdigest(),
    )
    for index, row in enumerate(workspace["parts"]):
        row["timeline_mode"] = "sequence"
        row["physical_interval_state"] = "first" if index == 0 else "unknown"

    first = build(data_root, runs, workspace=workspace)
    changed_workspace = {
        **workspace,
        "parts": [dict(row) for row in workspace["parts"]],
        "timeline": {
            **workspace["timeline"],
            "fingerprint_sha256": hashlib.sha256(b"sequence-v2").hexdigest(),
        },
    }
    second = build(data_root, runs, workspace=changed_workspace)

    assert second["assembly_id"] != first["assembly_id"]
    assert first["transcript_sha256"] == second["transcript_sha256"]
    listing = list_session_assemblies(data_root, "campaign-a", "session-a")
    assert {row["assembly_id"] for row in listing["assemblies"]} == {
        first["assembly_id"],
        second["assembly_id"],
    }
