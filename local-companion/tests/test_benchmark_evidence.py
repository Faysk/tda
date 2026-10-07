from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from tda_companion.benchmark_bundles import (
    BENCHMARK_PROFILES,
    benchmark_id_for,
    benchmark_sample_descriptor,
    benchmark_sample_identity,
    benchmark_root,
    finalize_benchmark_bundle,
    write_benchmark_profile,
)
from tda_companion.benchmark_evidence import (
    BenchmarkEvidenceError,
    derived_artifact,
    public_bundle_summary,
    transcript_snapshot,
    write_private_evidence_zip,
)
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)

SOURCE_SHA = "b" * 64
SOURCE_ID = "craig-" + SOURCE_SHA
TRACK_SHA = "a" * 64


def _package():
    return SimpleNamespace(
        source_sha256=SOURCE_SHA,
        tracks=(SimpleNamespace(number=1, sha256=TRACK_SHA),),
    )


def _metrics() -> dict:
    return {
        "version": "engine_processing_v1",
        "stage_seconds": {
            "runtime_validation": 0.0,
            "checkpoint_scan": 0.0,
            "model_prepare": 0.0,
            "model_load": 0.0,
            "transcription": 30.0,
            "alignment_and_energy": 0.0,
            "consolidation": 0.0,
        },
        "total_processing_seconds": 30.0,
        "external_preparation_included": False,
        "total_tracks": 1,
        "fresh_asr_tracks": 1,
        "text_checkpoint_reused_tracks": 0,
        "completed_checkpoint_reused_tracks": 0,
        "fresh_audio_work_seconds": 300.0,
        "reused_audio_work_seconds": 0.0,
        "fresh_calibration_eligible": True,
    }


def _document(profile_id: str) -> TranscriptDocument:
    word = TranscriptWord(
        text="Olá, Cête!",
        start=1.0,
        end=1.4,
        confidence=0.99,
    )
    segment = TranscriptSegment(
        id=f"{profile_id}-segment",
        start=1.0,
        end=2.5,
        text=f"Olá, Cête! fala de {profile_id}",
        words=(word,),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="private-source-name.flac",
        source_sha256=TRACK_SHA,
        duration_seconds=300.0,
        segments=(segment,),
    )
    engine = "faster-whisper" if profile_id.startswith("whisper-") else "qwen3"
    return TranscriptDocument(
        recording_id="fixture",
        source_sha256=SOURCE_SHA,
        language="pt",
        engine=TranscriptEngine(
            engine=engine,
            model=f"model-{profile_id}",
            profile=profile_id,
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="test-revision",
        ),
        tracks=(track,),
        stats=stats_for_tracks(
            (track,),
            processing_seconds=30.0,
            processing_metrics=_metrics(),
        ),
        warnings=("ALIGNMENT_FALLBACK:test",) if profile_id == "qwen-fast" else (),
        created_at="2026-10-03T12:00:00.000Z",
    )


def _lineage(profile_id: str) -> dict:
    family = "whisper" if profile_id.startswith("whisper-") else "qwen"
    return {
        "schema_version": "tda_execution_lineage_v1",
        "companion_version": "0.3.18",
        "runtime_family": family,
        "runtime_version": "1.0.0",
        "runtime_artifact": {
            "runtime_id": "whisper-ctranslate2" if family == "whisper" else "qwen3-transformers",
            "version": "1.0.0",
            "worker_sha256": "c" * 64,
            "archive_sha256": "d" * 64,
        },
        "device": "cuda:0",
        "compute_type": "float16",
        "gpu": {
            "vendor": "NVIDIA",
            "index": 0,
            "model": "Synthetic GPU",
            "vram_total_bytes": 8 * 1024**3,
            "compute_capability": "8.9",
            "driver_version": "synthetic",
        },
    }


def _commit_bundle(
    data_root: Path,
    job_id: str = "benchmark-job",
    attempt: int = 1,
    *,
    with_diagnostics: bool = False,
) -> dict:
    package = _package()
    identity = benchmark_sample_identity(package)
    receipts: list[dict] = []
    for profile_id in BENCHMARK_PROFILES:
        artifact = write_benchmark_profile(
            data_root,
            _document(profile_id),
            job_id=job_id,
            attempt=attempt,
            source_id=SOURCE_ID,
            sample_identity_sha256=identity,
            sample_seconds=300.0,
            execution_lineage=_lineage(profile_id),
        )
        if with_diagnostics:
            profile_root = (
                benchmark_root(data_root, artifact["benchmark_id"])
                / "profiles"
                / profile_id
            )
            (profile_root / "metrics.json").write_bytes(
                json.dumps(
                    {
                        "schema_version": "tda_benchmark_diagnostics_metrics_v1",
                        "profile_id": profile_id,
                        "gpu_average_percent": 42.0,
                        "telemetry": {
                            "captured_samples": 3, "coverage": 0.75,
                            "missing_reason": "coverage_gap",
                            "aggregates": {
                                "vram_peak_bytes": 4 * 1024 ** 3,
                                "vram_average_bytes": 3 * 1024 ** 3,
                            },
                        },
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            )
            (profile_root / "events.jsonl").write_text(
                json.dumps(
                    {
                        "seq": 1,
                        "profile_id": profile_id,
                        "event": "PROFILE_COMPLETED",
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n",
                encoding="utf-8",
            )
            (profile_root / "telemetry.jsonl").write_text(
                json.dumps(
                    {
                        "seq": 1,
                        "profile_id": profile_id,
                        "gpu_utilization_percent": 42.0,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n",
                encoding="utf-8",
            )
        receipts.append(
            {
                "profile_id": profile_id,
                "benchmark_id": artifact["benchmark_id"],
                "sample_identity_sha256": identity,
                "transcript_sha256": artifact["transcript_sha256"],
                "transcript_size_bytes": artifact["transcript_size_bytes"],
                "artifact_available": True,
                "execution_lineage": _lineage(profile_id),
            }
        )
    return finalize_benchmark_bundle(
        data_root,
        job_id=job_id,
        attempt=attempt,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA,
        sample=benchmark_sample_descriptor(package),
        sample_identity_sha256=identity,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="contexto privado",
        glossary="glossário privado",
        profile_receipts=receipts,
    )


def test_snapshot_and_derived_formats_read_only_from_canonical_bundle(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _commit_bundle(data_root)
    benchmark_id = bundle["benchmark_id"]

    summary = public_bundle_summary(data_root, benchmark_id)
    assert summary["integrity"] == "manifest_verified"
    assert summary["profile_order"] == list(BENCHMARK_PROFILES)
    assert summary["formats"] == ["json", "txt", "txt-plain", "vtt", "srt"]

    snapshot = transcript_snapshot(data_root, benchmark_id, "qwen-fast")
    assert snapshot["sample_identity_sha256"] == bundle["sample_identity_sha256"]
    assert snapshot["segments"][0]["text"].startswith("Olá, Cête!")
    assert snapshot["segments"][0]["timing_precision"] == "word"

    json_bytes, json_type, _ = derived_artifact(
        data_root, benchmark_id, "qwen-fast", "json"
    )
    txt, txt_type, _ = derived_artifact(data_root, benchmark_id, "qwen-fast", "txt")
    plain, plain_type, _ = derived_artifact(
        data_root, benchmark_id, "qwen-fast", "txt-plain"
    )
    vtt, vtt_type, _ = derived_artifact(data_root, benchmark_id, "qwen-fast", "vtt")
    srt, srt_type, _ = derived_artifact(data_root, benchmark_id, "qwen-fast", "srt")

    assert hashlib.sha256(json_bytes).hexdigest() == next(
        entry["transcript"]["sha256"]
        for entry in bundle["profiles"]
        if entry["profile_id"] == "qwen-fast"
    )
    assert json_type.startswith("application/json")
    assert b"[00:00:01.000] Alice" in txt
    assert txt_type.startswith("text/plain")
    assert b"[00:00:01.000]" not in plain
    assert plain.startswith("Alice\nOlá, Cête!".encode())
    assert plain_type.startswith("text/plain")
    assert vtt.startswith(b"WEBVTT\n")
    assert b"00:00:01.000 --> 00:00:02.500" in vtt
    assert vtt_type.startswith("text/vtt")
    assert b"00:00:01,000 --> 00:00:02,500" in srt
    assert srt_type.startswith("application/x-subrip")


def test_private_zip_is_deterministic_exact_and_contains_no_audio(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _commit_bundle(data_root)
    benchmark_id = bundle["benchmark_id"]
    first = tmp_path / "first.zip"
    second = tmp_path / "second.zip"

    write_private_evidence_zip(data_root, benchmark_id, first)
    write_private_evidence_zip(data_root, benchmark_id, second)

    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as archive:
        names = archive.namelist()
        prefix = f"TDA-Benchmark-{benchmark_id}"
        expected = {f"{prefix}/benchmark.json"}
        for profile_id in BENCHMARK_PROFILES:
            base = f"{prefix}/profiles/{profile_id}"
            expected.update(
                {
                    f"{base}/profile.json",
                    f"{base}/transcript.json",
                    f"{base}/transcript.txt",
                    f"{base}/transcript.vtt",
                    f"{base}/transcript.srt",
                    f"{base}/metrics.json",
                    f"{base}/events.jsonl",
                }
            )
        assert set(names) == expected
        assert not any(
            name.lower().endswith((".flac", ".wav", ".mp3", ".ogg"))
            for name in names
        )
        assert not any("private-source-name" in name for name in names)

        metrics = json.loads(
            archive.read(
                f"{prefix}/profiles/qwen-fast/metrics.json"
            )
        )
        assert metrics["measurement_mode"] == "canonical_bundle_derived_v1"
        assert metrics["processing_metrics"]["version"] == "engine_processing_v1"

        events = archive.read(
            f"{prefix}/profiles/qwen-fast/events.jsonl"
        ).decode("utf-8")
        assert "PROFILE_EVIDENCE_COMMITTED" in events
        assert "ALIGNMENT_FALLBACK" in events
        assert "glossário privado" not in events
        assert "contexto privado" not in events


def test_private_zip_preserves_bound_diagnostics_and_optional_telemetry(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _commit_bundle(data_root, job_id="diagnostics-job", with_diagnostics=True)
    benchmark_id = bundle["benchmark_id"]
    destination = tmp_path / "diagnostics.zip"

    summary = public_bundle_summary(data_root, benchmark_id)
    assert summary["telemetry_available"] is True
    snapshot = transcript_snapshot(data_root, benchmark_id, "qwen-fast")
    assert snapshot["telemetry"] == {
        "captured_samples": 3, "coverage": 0.75,
        "missing_reason": "coverage_gap",
        "vram_peak_bytes": 4 * 1024 ** 3,
        "vram_average_bytes": 3 * 1024 ** 3,
    }

    write_private_evidence_zip(data_root, benchmark_id, destination)
    with zipfile.ZipFile(destination) as archive:
        prefix = f"TDA-Benchmark-{benchmark_id}"
        for profile_id in BENCHMARK_PROFILES:
            profile_root = (
                benchmark_root(data_root, benchmark_id)
                / "profiles"
                / profile_id
            )
            base = f"{prefix}/profiles/{profile_id}"
            for filename in ("metrics.json", "events.jsonl", "telemetry.jsonl"):
                assert archive.read(f"{base}/{filename}") == (
                    profile_root / filename
                ).read_bytes()


def test_corrupted_canonical_transcript_fails_closed_on_read_and_export(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _commit_bundle(data_root, job_id="corrupt-job")
    benchmark_id = bundle["benchmark_id"]
    transcript = (
        benchmark_root(data_root, benchmark_id)
        / "profiles"
        / "qwen-fast"
        / "transcript.json"
    )
    payload = bytearray(transcript.read_bytes())
    payload[-2] ^= 1
    transcript.write_bytes(payload)

    with pytest.raises(
        BenchmarkEvidenceError,
        match="BENCHMARK_PROFILE_TRANSCRIPT_MISMATCH|BENCHMARK_PROFILE_TRANSCRIPT_INVALID",
    ):
        transcript_snapshot(data_root, benchmark_id, "qwen-fast")

    with pytest.raises(BenchmarkEvidenceError):
        write_private_evidence_zip(data_root, benchmark_id, tmp_path / "bad.zip")


def test_second_attempt_has_distinct_export_identity(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    first = _commit_bundle(data_root, job_id="retry-job", attempt=1)
    second = _commit_bundle(data_root, job_id="retry-job", attempt=2)

    assert first["benchmark_id"] == benchmark_id_for("retry-job", 1)
    assert second["benchmark_id"] == benchmark_id_for("retry-job", 2)
    assert first["benchmark_id"] != second["benchmark_id"]
