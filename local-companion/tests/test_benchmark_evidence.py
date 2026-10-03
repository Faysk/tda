from __future__ import annotations

import json
import zipfile

import pytest

from tda_companion.benchmark_evidence import (
    BenchmarkEvidenceError,
    benchmark_event_row,
    benchmark_id_for,
    commit_profile_artifact,
    derived_artifact,
    finalize_bundle,
    public_bundle_summary,
    transcript_snapshot,
    write_private_evidence_zip,
    write_profile_payload,
)
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    stats_for_tracks,
)


PROFILES = (
    "whisper-turbo",
    "whisper-detailed",
    "qwen-fast",
    "qwen-quality",
)


def document(profile_id: str, source_sha256: str) -> TranscriptDocument:
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="private-source-name.flac",
        source_sha256="b" * 64,
        duration_seconds=300.0,
        timeline_offset_seconds=0.0,
        segments=(
            TranscriptSegment(
                id=f"{profile_id}-segment",
                start=1.0,
                end=2.5,
                text=f"fala de {profile_id}",
            ),
        ),
    )
    engine = "whisper" if profile_id.startswith("whisper-") else "qwen3"
    return TranscriptDocument(
        recording_id="fixture",
        source_sha256=source_sha256,
        language="pt",
        engine=TranscriptEngine(
            engine=engine,
            model=f"model-{profile_id}",
            profile=profile_id,
            device="cuda",
            compute_type="float16",
            alignment="native",
        ),
        tracks=(track,),
        stats=stats_for_tracks((track,), processing_seconds=10.0),
        created_at="2026-10-03T12:00:00.000Z",
    )


def commit_bundle(tmp_path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    job_id = "fixture-job"
    attempt = 1
    benchmark_id = benchmark_id_for(job_id, attempt)
    source_sha256 = "a" * 64
    sample_identity = "c" * 64
    manifests = []

    for index, profile_id in enumerate(PROFILES):
        doc = document(profile_id, source_sha256)
        lineage = {
            "schema_version": "tda_execution_lineage_v1",
            "runtime_family": "whisper" if profile_id.startswith("whisper-") else "qwen",
            "runtime_version": "fixture",
            "device": "cuda",
            "gpu": {"vendor": "NVIDIA", "model": "Synthetic GPU"},
        }
        artifact = write_profile_payload(
            data_root,
            doc,
            benchmark_id=benchmark_id,
            job_id=job_id,
            attempt=attempt,
            source_id="source-fixture",
            sample_identity_sha256=sample_identity,
            sample_seconds=300.0,
            execution_lineage=lineage,
        )
        receipt = {
            "profile_id": profile_id,
            "execution_lineage": lineage,
            **artifact,
        }
        manifests.append(
            commit_profile_artifact(
                data_root,
                benchmark_id=benchmark_id,
                job_id=job_id,
                attempt=attempt,
                source_id="source-fixture",
                sample_identity_sha256=sample_identity,
                sample_seconds=300.0,
                profile_receipt=receipt,
                event_rows=(
                    benchmark_event_row(
                        benchmark_id=benchmark_id,
                        attempt=attempt,
                        profile_id=profile_id,
                        seq=index,
                        event_type="stage",
                        payload={
                            "stage": "transcription",
                            "path": "C:/private/source.flac",
                            "text": "private transcript text",
                        },
                    ),
                ),
            )
        )

    finalize_bundle(
        data_root,
        benchmark_id=benchmark_id,
        job_id=job_id,
        attempt=attempt,
        source_id="source-fixture",
        source_sha256=source_sha256,
        sample_identity_sha256=sample_identity,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="contexto privado",
        glossary="glossário privado",
        profile_manifests=manifests,
    )
    return data_root, benchmark_id


def test_bundle_is_verified_and_snapshot_is_lazy_readable(tmp_path):
    data_root, benchmark_id = commit_bundle(tmp_path)

    summary = public_bundle_summary(data_root, benchmark_id)
    assert summary["integrity"] == "verified"
    assert summary["profile_order"] == list(PROFILES)
    assert summary["formats"] == ["json", "txt", "vtt", "srt"]

    snapshot = transcript_snapshot(data_root, benchmark_id, "qwen-fast")
    assert snapshot["sample_identity_sha256"] == "c" * 64
    assert snapshot["segments"][0]["text"] == "fala de qwen-fast"
    assert snapshot["segments"][0]["timing_precision"] == "segment"

    txt, txt_type, _ = derived_artifact(data_root, benchmark_id, "qwen-fast", "txt")
    vtt, vtt_type, _ = derived_artifact(data_root, benchmark_id, "qwen-fast", "vtt")
    srt, srt_type, _ = derived_artifact(data_root, benchmark_id, "qwen-fast", "srt")
    assert b"[00:00:01.000] Alice" in txt
    assert txt_type.startswith("text/plain")
    assert vtt.startswith(b"WEBVTT\n")
    assert b"00:00:01.000 --> 00:00:02.500" in vtt
    assert vtt_type.startswith("text/vtt")
    assert b"00:00:01,000 --> 00:00:02,500" in srt
    assert srt_type.startswith("application/x-subrip")


def test_private_zip_is_deterministic_named_and_contains_no_audio(tmp_path):
    data_root, benchmark_id = commit_bundle(tmp_path)
    first = tmp_path / "first.zip"
    second = tmp_path / "second.zip"

    write_private_evidence_zip(data_root, benchmark_id, first)
    write_private_evidence_zip(data_root, benchmark_id, second)

    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as archive:
        names = archive.namelist()
        assert any(name.endswith("/benchmark.json") for name in names)
        assert any(name.endswith("/profiles/qwen-fast/transcript.json") for name in names)
        assert any(name.endswith("/profiles/qwen-fast/transcript.vtt") for name in names)
        assert any(name.endswith("/profiles/qwen-fast/events.jsonl") for name in names)
        assert not any(name.lower().endswith((".flac", ".wav", ".mp3", ".ogg")) for name in names)
        assert not any("private-source-name" in name for name in names)
        events_name = next(name for name in names if name.endswith("/profiles/qwen-fast/events.jsonl"))
        events = archive.read(events_name).decode("utf-8")
        assert "C:/private/source.flac" not in events
        assert "private transcript text" not in events


def test_bundle_fails_closed_after_canonical_transcript_tampering(tmp_path):
    data_root, benchmark_id = commit_bundle(tmp_path)
    transcript = (
        data_root
        / "benchmarks"
        / benchmark_id
        / "profiles"
        / "qwen-fast"
        / "transcript.json"
    )
    value = json.loads(transcript.read_text(encoding="utf-8"))
    value["tracks"][0]["segments"][0]["text"] = "tampered"
    transcript.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ARTIFACT_INTEGRITY_FAILED"):
        public_bundle_summary(data_root, benchmark_id)
