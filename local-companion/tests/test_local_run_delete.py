from __future__ import annotations

from pathlib import Path

import pytest

from tda_companion.local_run_delete import (
    LocalRunDeleteError,
    delete_completed_run,
    load_delete_tombstone,
    maintain_deleted_runs,
    run_deleted_local,
)
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)
from tda_companion.transcription_runs import (
    list_runs,
    maintain_legacy_transcripts,
    write_compatibility_mirror,
    write_completed_run,
)


def _document(source_sha: str, profile: str, text: str) -> TranscriptDocument:
    segment = TranscriptSegment(
        id="1-0",
        start=0.0,
        end=1.0,
        text=text,
        words=(TranscriptWord(text=text, start=0.0, end=0.8, confidence=0.9),),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1-Alice.flac",
        source_sha256="a" * 64,
        duration_seconds=2.0,
        segments=(segment,),
    )
    return TranscriptDocument(
        recording_id="recording",
        source_sha256=source_sha,
        language="pt",
        engine=TranscriptEngine(
            engine="faster-whisper",
            model="test",
            profile=profile,
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="test",
        ),
        tracks=(track,),
        stats=stats_for_tracks((track,), processing_seconds=1.0),
    )


def _package(tmp_path: Path):
    source_sha = "b" * 64
    source_id = f"craig-{source_sha}"
    package_root = tmp_path / source_id
    package_root.mkdir()
    first = write_completed_run(
        package_root,
        _document(source_sha, "whisper-detailed", "primeiro"),
        job_id="job-one",
        attempt=1,
    )
    second = write_completed_run(
        package_root,
        _document(source_sha, "qwen-quality", "segundo"),
        job_id="job-two",
        attempt=1,
    )
    return package_root, source_id, first, second


def test_delete_one_run_preserves_sibling_and_repoints_compatibility_mirror(tmp_path: Path):
    package_root, source_id, first, second = _package(tmp_path)
    write_compatibility_mirror(package_root, first["run_id"])
    (package_root / "revisions" / first["run_id"]).mkdir(parents=True)
    (package_root / "revisions" / first["run_id"] / "draft.json").write_text("{}", encoding="utf-8")
    marked: list[tuple[str, str, str]] = []

    receipt = delete_completed_run(
        package_root,
        source_id=source_id,
        run_id=first["run_id"],
        transcript_sha256=first["transcript_sha256"],
        mark_result_deleted=lambda job_id, run_id, digest: marked.append(
            (job_id, run_id, digest)
        ),
    )

    assert receipt == {
        "schema_version": "tda_local_run_delete_receipt_v1",
        "source_id": source_id,
        "run_id": first["run_id"],
        "transcript_sha256": first["transcript_sha256"],
        "deleted": True,
        "review_deleted": True,
        "cloud_changed": False,
    }
    assert marked == [("job-one", first["run_id"], first["transcript_sha256"])]
    assert not (package_root / "runs" / first["run_id"]).exists()
    assert not (package_root / "revisions" / first["run_id"]).exists()
    assert (package_root / "runs" / second["run_id"] / "run.json").is_file()
    assert [item["run_id"] for item in list_runs(package_root, verify_content=True)] == [
        second["run_id"]
    ]
    assert (package_root / "transcript.json").read_bytes() == (
        package_root / "runs" / second["run_id"] / "transcript.json"
    ).read_bytes()
    assert run_deleted_local(package_root, first["run_id"], first["transcript_sha256"])


def test_delete_is_idempotent_and_startup_maintenance_does_not_resurrect_run(tmp_path: Path):
    data_root = tmp_path / "Data"
    staging = data_root / "staging"
    staging.mkdir(parents=True)
    package_root, source_id, first, _second = _package(staging)
    write_compatibility_mirror(package_root, first["run_id"])

    first_receipt = delete_completed_run(
        package_root,
        source_id=source_id,
        run_id=first["run_id"],
        transcript_sha256=first["transcript_sha256"],
    )
    second_receipt = delete_completed_run(
        package_root,
        source_id=source_id,
        run_id=first["run_id"],
        transcript_sha256=first["transcript_sha256"],
    )

    assert second_receipt == first_receipt
    assert maintain_deleted_runs(data_root)["failed"] == 0
    maintain_legacy_transcripts(data_root)
    assert first["run_id"] not in {
        item["run_id"] for item in list_runs(package_root, verify_content=True)
    }
    tombstone = load_delete_tombstone(package_root, first["run_id"])
    assert tombstone is not None
    assert tombstone["transcript_sha256"] == first["transcript_sha256"]


def test_delete_rejects_stale_digest_without_writing_tombstone(tmp_path: Path):
    package_root, source_id, first, _second = _package(tmp_path)

    with pytest.raises(LocalRunDeleteError, match="LOCAL_RUN_DELETE_STALE"):
        delete_completed_run(
            package_root,
            source_id=source_id,
            run_id=first["run_id"],
            transcript_sha256="0" * 64,
        )

    assert load_delete_tombstone(package_root, first["run_id"]) is None
    assert (package_root / "runs" / first["run_id"] / "run.json").is_file()


@pytest.mark.skipif(not hasattr(Path, "is_symlink"), reason="symlink support unavailable")
def test_delete_rejects_revision_symlink_escape(tmp_path: Path):
    package_root, source_id, first, _second = _package(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    revisions = package_root / "revisions"
    revisions.mkdir()
    link = revisions / first["run_id"]
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation unavailable")

    with pytest.raises(LocalRunDeleteError, match="LOCAL_RUN_DELETE_REVISION_UNSAFE"):
        delete_completed_run(
            package_root,
            source_id=source_id,
            run_id=first["run_id"],
            transcript_sha256=first["transcript_sha256"],
        )

    assert (package_root / "runs" / first["run_id"] / "run.json").is_file()
    assert not (outside / "draft.json").exists()
