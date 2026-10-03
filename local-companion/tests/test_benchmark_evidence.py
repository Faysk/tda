from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from tda_companion.benchmark_evidence import (
    BenchmarkEvidenceError,
    PROFILES,
    benchmark_id_for,
    finalize_bundle,
    load_bundle,
    normalize_telemetry_samples,
    private_export_zip,
    verified_profile_bytes,
    write_profile_artifact,
    write_profile_events,
    write_profile_telemetry,
)
from tda_companion.benchmark_quality import normalize_text, quality_summary, save_reference
from tda_companion.engine_metrics import EngineMeasurement
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)


def _lineage(profile: str) -> dict:
    family = "whisper" if profile.startswith("whisper-") else "qwen"
    return {
        "schema_version": "tda_execution_lineage_v1",
        "companion_version": "test",
        "runtime_family": family,
        "runtime_version": "1.2.3",
        "runtime_artifact": {
            "runtime_id": f"{family}-test",
            "version": "1.2.3",
            "worker_sha256": "1" * 64,
            "archive_sha256": "2" * 64,
        },
        "device": "cuda:0",
        "execution_device": {
            "kind": "cuda",
            "physical_uuid": "GPU-test",
            "pci_bus_id": "0000:01:00.0",
        },
        "compute_type": "float16",
        "gpu": {
            "vendor": "NVIDIA",
            "index": 0,
            "logical_index": 0,
            "uuid": "GPU-test",
            "pci_bus_id": "0000:01:00.0",
            "model": "Synthetic GPU",
            "vram_total_bytes": 8 * 1024**3,
            "compute_capability": "8.9",
            "driver_version": "test-driver",
        },
    }


def _document(profile: str, text: str, source_sha: str = "a" * 64) -> TranscriptDocument:
    word = TranscriptWord(text=text.split()[0], start=1.0, end=1.2, confidence=0.99)
    segment = TranscriptSegment(
        id="1-0",
        start=1.0,
        end=2.0,
        text=text,
        words=(word,),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1-Alice.flac",
        source_sha256="b" * 64,
        duration_seconds=300.0,
        segments=(segment,),
    )
    timer = EngineMeasurement(lambda _event: None, clock=lambda: 10.0)
    processing = timer.finish((track,))
    stats = stats_for_tracks(
        (track,),
        processing_seconds=30.0,
        processing_metrics=processing,
    )
    return TranscriptDocument(
        recording_id="synthetic",
        source_sha256=source_sha,
        language="pt",
        engine=TranscriptEngine(
            engine="faster-whisper" if profile.startswith("whisper-") else "qwen3",
            model="synthetic-model",
            profile=profile,
            device="cuda:0",
            compute_type="float16",
            alignment="native",
            model_revision="synthetic-revision",
        ),
        tracks=(track,),
        stats=stats,
    )


def _complete_bundle(tmp_path: Path, texts: dict[str, str] | None = None):
    job_id = "benchmark-test"
    attempt = 1
    sample_sha = "c" * 64
    benchmark_id = benchmark_id_for(job_id, attempt)
    for profile in PROFILES:
        doc = _document(profile, (texts or {}).get(profile, f"texto {profile}"))
        write_profile_artifact(
            tmp_path,
            doc,
            benchmark_id=benchmark_id,
            job_id=job_id,
            attempt=attempt,
            profile_id=profile,
            sample_identity_sha256=sample_sha,
            sample_seconds=300.0,
            execution_lineage=_lineage(profile),
        )
        write_profile_events(
            tmp_path,
            benchmark_id,
            profile,
            [
                {
                    "schema_version": "tda_benchmark_event_v1",
                    "seq": 0,
                    "at": "2026-10-03T00:00:00.000Z",
                    "relative_ms": 0,
                    "benchmark_id": benchmark_id,
                    "attempt": attempt,
                    "profile_id": profile,
                    "sample_identity_sha256": sample_sha,
                    "type": "ready",
                    "stage": None,
                    "code": "WORKER_READY",
                    "data": {},
                }
            ],
        )
        telemetry = normalize_telemetry_samples(
            [
                {
                    "sampled_at": "2026-10-03T00:00:01Z",
                    "host": {"os": "SECRET-HOST", "cpu": "SECRET-CPU"},
                    "cpu": {"utilization_percent": 42.0},
                    "memory": {"used_bytes": 1024, "total_bytes": 2048, "percent": 50.0},
                    "gpus": [
                        {
                            "uuid": "GPU-test",
                            "name": "Synthetic GPU",
                            "utilization_percent": 75,
                            "memory_used_bytes": 4096,
                            "memory_total_bytes": 8192,
                            "temperature_c": 60,
                            "power_w": 100,
                        }
                    ],
                }
            ],
            lineage=_lineage(profile),
            interval_ms=1000,
        )
        assert "SECRET" not in json.dumps(telemetry)
        write_profile_telemetry(tmp_path, benchmark_id, profile, telemetry)

    bundle = finalize_bundle(
        tmp_path,
        benchmark_id=benchmark_id,
        job_id=job_id,
        attempt=attempt,
        source_id="craig-" + "a" * 64,
        sample_identity_sha256=sample_sha,
        sample_seconds=300.0,
        context="private context",
        glossary="Valyndra",
        execution_mode="prepared_artifacts_fresh_worker_per_profile_v1",
    )
    return benchmark_id, bundle


def test_completed_bundle_is_hash_bound_queue_independent_and_contains_no_audio(tmp_path: Path):
    benchmark_id, receipt = _complete_bundle(tmp_path)
    manifest = load_bundle(tmp_path, benchmark_id)

    assert manifest["schema_version"] == "tda_benchmark_bundle_v1"
    assert manifest["profile_order"] == list(PROFILES)
    assert manifest["context"]["sha256"] == hashlib.sha256(b"private context").hexdigest()
    assert "private context" not in json.dumps(manifest)
    assert receipt["bundle_size_bytes"] > 0
    assert all(item["artifact_available"] for item in receipt["profiles"])

    archive = private_export_zip(tmp_path, benchmark_id)
    assert b"private context" not in archive
    import zipfile
    from io import BytesIO
    with zipfile.ZipFile(BytesIO(archive)) as value:
        names = value.namelist()
        assert any(name.endswith("/benchmark.json") for name in names)
        assert sum(name.endswith("/transcript.json") for name in names) == 4
        assert sum(name.endswith("/transcript.txt") for name in names) == 4
        assert sum(name.endswith("/transcript.vtt") for name in names) == 4
        assert sum(name.endswith("/transcript.srt") for name in names) == 4
        assert not any(name.lower().endswith((".flac", ".wav", ".mp3", ".ogg")) for name in names)


def test_tampered_transcript_fails_closed(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)
    path = tmp_path / "benchmarks" / benchmark_id / "profiles" / "qwen-fast" / "transcript.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["tracks"][0]["segments"][0]["text"] = "tampered"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )

    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ARTIFACT_INTEGRITY_FAILED"):
        load_bundle(tmp_path, benchmark_id)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ARTIFACT_INTEGRITY_FAILED"):
        verified_profile_bytes(tmp_path, benchmark_id, "qwen-fast", "transcript")


def test_symlinked_benchmark_artifact_is_rejected(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)
    transcript = tmp_path / "benchmarks" / benchmark_id / "profiles" / "qwen-quality" / "transcript.json"
    external = tmp_path / "external.json"
    external.write_bytes(transcript.read_bytes())
    transcript.unlink()
    try:
        transcript.symlink_to(external)
    except OSError:
        pytest.skip("symlink creation unavailable")
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_PATH_REPARSE_REJECTED"):
        load_bundle(tmp_path, benchmark_id)


def test_reference_metrics_use_versioned_unicode_normalization_and_micro_wer(tmp_path: Path):
    texts = {
        "whisper-turbo": "Olá mundo",
        "whisper-detailed": "Olá cruel mundo",
        "qwen-fast": "ola mundo",
        "qwen-quality": "Olá",
    }
    benchmark_id, _ = _complete_bundle(tmp_path, texts)

    saved = save_reference(
        tmp_path,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [{"track_number": 1, "speaker": "Alice", "text": "Olá mundo"}],
            "terms": ["mundo"],
        },
    )
    assert saved["revision"] == 1
    summary = quality_summary(tmp_path, benchmark_id)
    by_profile = {item["profile_id"]: item for item in summary["profiles"]}

    assert summary["quality_measured"] is True
    assert by_profile["whisper-turbo"]["overall"]["wer_normalized"] == 0.0
    assert by_profile["whisper-detailed"]["overall"]["insertions"] == 1
    assert by_profile["whisper-detailed"]["overall"]["wer_normalized"] == 0.5
    assert by_profile["qwen-fast"]["overall"]["substitutions"] == 1
    assert by_profile["qwen-fast"]["overall"]["wer_normalized"] == 0.5
    assert by_profile["qwen-quality"]["overall"]["deletions"] == 1
    assert by_profile["qwen-quality"]["overall"]["wer_normalized"] == 0.5
    assert normalize_text("  OLÁ…   Mundo! ") == "olá mundo"
    assert normalize_text("ação") != normalize_text("acao")


def test_reference_is_cas_versioned_and_quality_receipt_contains_no_reference_text(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)
    first = save_reference(
        tmp_path,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "profile_seed",
            "seed_profile_id": "whisper-turbo",
            "tracks": [{"track_number": 1, "speaker": "Alice", "text": "SEGREDO HUMANO"}],
        },
    )
    with pytest.raises(Exception, match="BENCHMARK_REFERENCE_REVISION_CONFLICT"):
        save_reference(
            tmp_path,
            benchmark_id,
            {
                "expected_revision": 0,
                "provenance": "manual",
                "seed_profile_id": None,
                "tracks": [{"track_number": 1, "speaker": "Alice", "text": "stale"}],
            },
        )
    quality = json.dumps(quality_summary(tmp_path, benchmark_id), ensure_ascii=False)
    assert first["revision"] == 1
    assert "SEGREDO HUMANO" not in quality
    assert "1-Alice.flac" not in quality
