from __future__ import annotations

from pathlib import Path
import hashlib
import json
from dataclasses import replace

import pytest

from tda_companion.local_review import LocalReviewError, open_review, save_review
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)
from tda_companion.transcription_runs import write_completed_run


def _document(source_sha: str, text: str = "Texto original") -> TranscriptDocument:
    first = TranscriptSegment(
        id="1-0",
        start=0.0,
        end=1.0,
        text=text,
        words=(TranscriptWord(text="Texto", start=0.0, end=0.4, confidence=0.9),),
    )
    second = TranscriptSegment(
        id="1-1",
        start=1.2,
        end=2.2,
        text="Segunda fala",
        words=(TranscriptWord(text="Segunda", start=1.2, end=1.6, confidence=0.8),),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1-Alice.flac",
        source_sha256="a" * 64,
        duration_seconds=3.0,
        segments=(first, second),
    )
    return TranscriptDocument(
        recording_id="recording",
        source_sha256=source_sha,
        language="pt",
        engine=TranscriptEngine(
            engine="faster-whisper",
            model="large-v3",
            profile="whisper-detailed",
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="test",
        ),
        tracks=(track,),
        stats=stats_for_tracks((track,), processing_seconds=2.0),
        warnings=("LOW_CONFIDENCE",),
    )


def _package(tmp_path: Path) -> tuple[Path, str, dict]:
    source_sha = "b" * 64
    source_id = f"craig-{source_sha}"
    package_root = tmp_path / source_id
    package_root.mkdir()
    run = write_completed_run(
        package_root,
        _document(source_sha),
        job_id="job-review",
        attempt=1,
    )
    return package_root, source_id, run


def test_open_review_creates_derived_draft_without_mutating_raw_run(tmp_path: Path):
    package_root, source_id, run = _package(tmp_path)
    transcript = package_root / "runs" / run["run_id"] / "transcript.json"
    raw_before = transcript.read_bytes()

    review = open_review(
        package_root,
        source_id=source_id,
        run_id=run["run_id"],
    )
    assert review["stats"]["audio_work_seconds"] == 3.0
    assert review["stats"]["session_duration_seconds"] == 3.0
    assert review["lineage"]["execution_lineage"] is None

    assert review["schema_version"] == "tda_local_review_v1"
    assert review["source_id"] == source_id
    assert review["run_id"] == run["run_id"]
    assert review["base_transcript_sha256"] == run["transcript_sha256"]
    assert review["draft_revision"] == 0
    assert review["status"] == "draft"
    assert review["review"] == {
        "reviewed_segments": 0,
        "total_segments": 2,
        "review_percent": 0.0,
        "edited_segments": 0,
        "word_count": 4,
        "warning_count": 1,
    }
    assert review["sync"] == {"status": "not_configured"}
    assert [item["segment_id"] for item in review["segments"]] == ["1-0", "1-1"]
    assert transcript.read_bytes() == raw_before
    assert (package_root / "revisions" / run["run_id"] / "draft.json").is_file()


def test_save_review_is_atomic_recoverable_and_keeps_run_immutable(
    monkeypatch,
    tmp_path: Path,
):
    package_root, source_id, run = _package(tmp_path)
    transcript = package_root / "runs" / run["run_id"] / "transcript.json"
    raw_before = transcript.read_bytes()
    opened = open_review(package_root, source_id=source_id, run_id=run["run_id"])
    segments = [dict(item) for item in opened["segments"]]
    segments[0]["text"] = "Texto corrigido"
    segments[0]["speaker"] = "Sense"
    segments[0]["reviewed"] = True

    saved = save_review(
        package_root,
        source_id=source_id,
        run_id=run["run_id"],
        value={
            "expected_draft_revision": 0,
            "status": "reviewed",
            "segments": segments,
        },
    )

    assert saved["draft_revision"] == 1
    assert saved["status"] == "reviewed"
    assert saved["review"]["reviewed_segments"] == 1
    assert saved["review"]["edited_segments"] == 1
    assert saved["segments"][0]["text"] == "Texto corrigido"
    assert saved["segments"][0]["speaker"] == "Sense"
    assert transcript.read_bytes() == raw_before

    reopened = open_review(package_root, source_id=source_id, run_id=run["run_id"])
    assert reopened["draft_revision"] == 1
    assert reopened["draft_sha256"] == saved["draft_sha256"]
    assert reopened["segments"][0]["text"] == "Texto corrigido"

    import tda_companion.local_review as review_module

    original_replace = review_module.os.replace

    def fail_replace(source, target):
        if str(target).endswith("draft.json"):
            raise OSError("synthetic disk failure")
        return original_replace(source, target)

    monkeypatch.setattr(review_module.os, "replace", fail_replace)
    changed = [dict(item) for item in reopened["segments"]]
    changed[1]["reviewed"] = True
    with pytest.raises(OSError, match="synthetic disk failure"):
        save_review(
            package_root,
            source_id=source_id,
            run_id=run["run_id"],
            value={
                "expected_draft_revision": 1,
                "status": "reviewed",
                "segments": changed,
            },
        )

    monkeypatch.setattr(review_module.os, "replace", original_replace)
    after_failure = open_review(
        package_root,
        source_id=source_id,
        run_id=run["run_id"],
    )
    assert after_failure["draft_revision"] == 1
    assert after_failure["draft_sha256"] == saved["draft_sha256"]
    assert not list((package_root / "revisions" / run["run_id"]).glob("*.partial"))


def test_stale_review_save_conflicts_without_overwrite(tmp_path: Path):
    package_root, source_id, run = _package(tmp_path)
    opened = open_review(package_root, source_id=source_id, run_id=run["run_id"])
    first = [dict(item) for item in opened["segments"]]
    first[0]["text"] = "Vencedor"
    saved = save_review(
        package_root,
        source_id=source_id,
        run_id=run["run_id"],
        value={
            "expected_draft_revision": 0,
            "status": "draft",
            "segments": first,
        },
    )

    stale = [dict(item) for item in opened["segments"]]
    stale[0]["text"] = "Perdedor"
    with pytest.raises(LocalReviewError, match="LOCAL_REVIEW_DRAFT_CONFLICT"):
        save_review(
            package_root,
            source_id=source_id,
            run_id=run["run_id"],
            value={
                "expected_draft_revision": 0,
                "status": "draft",
                "segments": stale,
            },
        )

    current = open_review(package_root, source_id=source_id, run_id=run["run_id"])
    assert current["draft_revision"] == saved["draft_revision"]
    assert current["segments"][0]["text"] == "Vencedor"


def test_segment_identity_and_timing_are_not_editable(tmp_path: Path):
    package_root, source_id, run = _package(tmp_path)
    opened = open_review(package_root, source_id=source_id, run_id=run["run_id"])

    for patch, code in [
        ({"segment_id": "other"}, "LOCAL_REVIEW_SEGMENT_IDENTITY_MISMATCH"),
        ({"start": 99.0}, "LOCAL_REVIEW_SEGMENT_TIMING_IMMUTABLE"),
        ({"end": 99.0}, "LOCAL_REVIEW_SEGMENT_TIMING_IMMUTABLE"),
    ]:
        segments = [dict(item) for item in opened["segments"]]
        segments[0].update(patch)
        with pytest.raises(LocalReviewError, match=code):
            save_review(
                package_root,
                source_id=source_id,
                run_id=run["run_id"],
                value={
                    "expected_draft_revision": 0,
                    "status": "draft",
                    "segments": segments,
                },
            )


def test_two_runs_keep_independent_review_drafts(tmp_path: Path):
    source_sha = "c" * 64
    source_id = f"craig-{source_sha}"
    package_root = tmp_path / source_id
    package_root.mkdir()
    first = write_completed_run(
        package_root,
        _document(source_sha, "Run A"),
        job_id="job-a",
        attempt=1,
    )
    second = write_completed_run(
        package_root,
        _document(source_sha, "Run B"),
        job_id="job-b",
        attempt=1,
    )

    a = open_review(package_root, source_id=source_id, run_id=first["run_id"])
    b = open_review(package_root, source_id=source_id, run_id=second["run_id"])
    edited = [dict(item) for item in a["segments"]]
    edited[0]["text"] = "Somente A"
    save_review(
        package_root,
        source_id=source_id,
        run_id=first["run_id"],
        value={
            "expected_draft_revision": 0,
            "status": "draft",
            "segments": edited,
        },
    )

    current_b = open_review(package_root, source_id=source_id, run_id=second["run_id"])
    assert current_b["draft_revision"] == 0
    assert current_b["segments"][0]["text"] == b["segments"][0]["text"] == "Run B"


def test_tampered_base_run_cannot_be_reviewed(tmp_path: Path):
    package_root, source_id, run = _package(tmp_path)
    transcript = package_root / "runs" / run["run_id"] / "transcript.json"
    payload = bytearray(transcript.read_bytes())
    payload[-2] = ord(" ")
    transcript.write_bytes(bytes(payload))

    with pytest.raises(LocalReviewError, match="LOCAL_REVIEW_BASE_RUN_INVALID"):
        open_review(package_root, source_id=source_id, run_id=run["run_id"])


def test_review_parses_exact_bytes_verified_even_if_path_changes(monkeypatch, tmp_path: Path):
    import tda_companion.transcription_runs as runs
    package, source_id, run = _package(tmp_path)
    path = package / "runs" / run["run_id"] / "transcript.json"
    original_read = runs._bounded_transcript

    def replace_after_read(target):
        payload = original_read(target)
        value = json.loads(payload)
        value["tracks"][0]["segments"][0]["text"] = "Different base"
        path.write_text(json.dumps(value), encoding="utf-8")
        return payload

    monkeypatch.setattr(runs, "_bounded_transcript", replace_after_read)
    review = open_review(package, source_id=source_id, run_id=run["run_id"])
    assert review["segments"][0]["text"] == "Texto original"
    assert review["base_transcript_sha256"] == run["transcript_sha256"]


def test_save_reads_one_base_snapshot(monkeypatch, tmp_path: Path):
    import tda_companion.local_review as reviews
    package, source_id, run = _package(tmp_path)
    opened = open_review(package, source_id=source_id, run_id=run["run_id"])
    original = reviews.load_verified_transcript_snapshot
    reads = []

    def count(*args):
        reads.append(args)
        return original(*args)

    monkeypatch.setattr(reviews, "load_verified_transcript_snapshot", count)
    save_review(package, source_id=source_id, run_id=run["run_id"], value={
        "expected_draft_revision": 0, "status": "draft", "segments": opened["segments"],
    })
    assert len(reads) == 1


def test_semantically_invalid_historical_run_fails_before_creating_draft(tmp_path: Path):
    package, source_id, run = _package(tmp_path)
    path = package / "runs" / run["run_id"] / "transcript.json"
    value = json.loads(path.read_bytes())
    value["stats"]["word_count"] = 999
    payload = json.dumps(value).encode()
    path.write_bytes(payload)
    run.update(origin="legacy_transcript_v1", transcript_sha256=hashlib.sha256(payload).hexdigest(), transcript_size_bytes=len(payload))
    (path.parent / "run.json").write_text(json.dumps(run))
    with pytest.raises(LocalReviewError, match="LOCAL_REVIEW_BASE_RUN_INVALID"):
        open_review(package, source_id=source_id, run_id=run["run_id"])
    assert not (package / "revisions").exists()


def test_reordered_save_is_noop_and_real_edits_use_immutable_base_order(tmp_path: Path):
    package, source_id, run = _package(tmp_path)
    opened = open_review(package, source_id=source_id, run_id=run["run_id"])
    reversed_segments = list(reversed(opened["segments"]))
    saved = save_review(package, source_id=source_id, run_id=run["run_id"], value={
        "expected_draft_revision": 0, "status": "draft", "segments": reversed_segments,
    })
    assert saved["draft_revision"] == opened["draft_revision"]
    assert saved["draft_sha256"] == opened["draft_sha256"]
    reversed_segments[0]["text"] = "Real edit"
    edited = save_review(package, source_id=source_id, run_id=run["run_id"], value={
        "expected_draft_revision": 0, "status": "draft", "segments": reversed_segments,
    })
    assert [row["segment_id"] for row in edited["segments"]] == ["1-0", "1-1"]
    assert edited["segments"][1]["text"] == "Real edit"
    assert edited["review"]["edited_segments"] == 1


@pytest.mark.parametrize("count", [0, 1, 999, 1000, 1001, 5000])
def test_warning_projection_preserves_factual_total(tmp_path: Path, count: int):
    package = tmp_path / "source"
    package.mkdir()
    document = replace(_document("a" * 64), warnings=tuple(f"WARNING_{i}" for i in range(count)))
    run = write_completed_run(package, document, job_id="warnings", attempt=1)
    review = open_review(package, source_id="source", run_id=run["run_id"])
    assert len(review["warnings"]) == min(count, 1000)
    assert review["review"]["warning_count"] == run["stats"]["warning_count"] == count
    assert review["warning_summary"] == {"total_count": count, "displayed_count": min(count, 1000), "truncated": count > 1000}


def test_editorial_word_count_uses_canonical_whitespace_without_rewrite(tmp_path: Path):
    package, source_id, run = _package(tmp_path)
    opened = open_review(package, source_id=source_id, run_id=run["run_id"])
    opened["segments"][0]["text"] = "a\u0085b\u001cc"
    saved = save_review(package, source_id=source_id, run_id=run["run_id"], value={
        "expected_draft_revision": 0, "status": "draft", "segments": opened["segments"],
    })
    assert saved["review"]["word_count"] == 4
    assert saved["segments"][0]["text"] == "a\u0085b\u001cc"
