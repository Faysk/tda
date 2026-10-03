from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import tda_companion.benchmark_evidence as benchmark_evidence

from tda_companion.api import create_app
from tda_companion.benchmark_evidence import (
    BenchmarkEvidenceError,
    PROFILES,
    benchmark_id_for,
    finalize_bundle,
    load_bundle,
    normalize_telemetry_samples,
    private_export_zip,
    sanitize_benchmark_message,
    telemetry_summary_from_bytes,
    verified_profile_bytes,
    write_profile_artifact,
    write_profile_events,
    write_failed_profile_diagnostics,
    write_profile_telemetry,
)
from tda_companion.benchmark_bundles import (
    benchmark_sample_descriptor as legacy_sample_descriptor,
    benchmark_sample_identity as legacy_sample_identity,
    finalize_benchmark_bundle as finalize_legacy_bundle,
    write_benchmark_profile as write_legacy_profile,
)

from tda_companion.benchmark_quality import (
    BenchmarkQualityError,
    normalize_text,
    quality_summary,
    save_reference,
)
from tda_companion.engine_metrics import EngineMeasurement
from tda_companion.store import Store
from tda_companion.worker_protocol import WorkerMessage
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptSegmentRef,
    TranscriptTrack,
    TranscriptTurn,
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
    if text:
        word = TranscriptWord(text=text.split()[0], start=1.0, end=1.2, confidence=0.99)
        segment = TranscriptSegment(
            id="1-0",
            start=1.0,
            end=2.0,
            text=text,
            words=(word,),
        )
        segments = (segment,)
        turns = (
            TranscriptTurn(
                id="turn-1",
                speaker="Alice",
                start=1.0,
                end=2.0,
                text=text,
                segments=(TranscriptSegmentRef(track_number=1, segment_id="1-0"),),
                overlaps_other_speaker=False,
            ),
        )
    else:
        segments = ()
        turns = ()
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1-Alice.flac",
        source_sha256="b" * 64,
        duration_seconds=300.0,
        segments=segments,
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
        turns=turns,
    )
def _complete_bundle(
    tmp_path: Path,
    texts: dict[str, str] | None = None,
    *,
    job_id: str = "benchmark-test",
    attempt: int = 1,
):
    sample_descriptor = {
        "schema": "tda_benchmark_sample_v1",
        "source_sha256": "a" * 64,
        "start_seconds": 0.0,
        "end_seconds": 300.0,
        "tracks": [{"number": 1, "sha256": "b" * 64}],
    }
    sample_sha = hashlib.sha256(
        json.dumps(
            sample_descriptor,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
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
                },
                {
                    "schema_version": "tda_benchmark_event_v1",
                    "seq": 1,
                    "at": "2026-10-03T00:00:01.000Z",
                    "relative_ms": 1000,
                    "benchmark_id": benchmark_id,
                    "attempt": attempt,
                    "profile_id": profile,
                    "sample_identity_sha256": sample_sha,
                    "type": "result",
                    "stage": None,
                    "code": "WORKER_RESULT",
                    "data": {},
                },
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
            elapsed_ms=3_000,
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
        sample_descriptor=sample_descriptor,
        context="private context",
        glossary="Valyndra",
        execution_mode="prepared_artifacts_fresh_worker_per_profile+async_telemetry_v2",
    )
    return benchmark_id, bundle


def _rewrite_bundle_manifest(tmp_path: Path, benchmark_id: str, mutate) -> None:
    path = tmp_path / "benchmarks" / benchmark_id / "benchmark.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    mutate(payload)
    unsigned = dict(payload)
    unsigned.pop("manifest_payload_sha256", None)
    payload["manifest_payload_sha256"] = hashlib.sha256(
        json.dumps(
            unsigned,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


def test_merged_1419_bundle_stays_readable_comparable_and_exportable(tmp_path: Path):
    job_id = "legacy-benchmark"
    attempt = 1
    source_id = "craig-" + "a" * 64
    package = SimpleNamespace(
        source_sha256="a" * 64,
        tracks=(SimpleNamespace(number=1, sha256="b" * 64),),
    )
    sample_identity = legacy_sample_identity(package)
    receipts = []
    for profile in PROFILES:
        artifact = write_legacy_profile(
            tmp_path,
            _document(profile, f"texto {profile}"),
            job_id=job_id,
            attempt=attempt,
            source_id=source_id,
            sample_identity_sha256=sample_identity,
            sample_seconds=300.0,
            execution_lineage=_lineage(profile),
        )
        receipts.append(
            {
                "profile_id": profile,
                "benchmark_id": artifact["benchmark_id"],
                "sample_identity_sha256": sample_identity,
                "transcript_sha256": artifact["transcript_sha256"],
                "transcript_size_bytes": artifact["transcript_size_bytes"],
                "artifact_available": True,
                "execution_lineage": _lineage(profile),
            }
        )
    legacy = finalize_legacy_bundle(
        tmp_path,
        job_id=job_id,
        attempt=attempt,
        source_id=source_id,
        source_sha256="a" * 64,
        sample=legacy_sample_descriptor(package),
        sample_identity_sha256=sample_identity,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="",
        glossary="",
        profile_receipts=receipts,
    )

    loaded = load_bundle(tmp_path, legacy["benchmark_id"])
    assert loaded["bundle_manifest_sha256"] == legacy["bundle_manifest_sha256"]
    assert json.loads(
        verified_profile_bytes(
            tmp_path,
            legacy["benchmark_id"],
            "qwen-fast",
            "transcript",
        )
    )["engine"]["profile"] == "qwen-fast"

    archive = private_export_zip(tmp_path, legacy["benchmark_id"])
    assert b"WEBVTT" in archive
    assert b"texto qwen-fast" in archive


def test_completed_bundle_is_hash_bound_queue_independent_and_contains_no_audio(tmp_path: Path):
    benchmark_id, receipt = _complete_bundle(tmp_path)
    manifest = load_bundle(tmp_path, benchmark_id)

    assert manifest["schema_version"] == "tda_benchmark_bundle_v1"
    assert manifest["profile_order"] == list(PROFILES)
    assert manifest["track_count"] == 1
    assert manifest["audio_work_seconds"] == 300.0
    assert len(manifest["manifest_payload_sha256"]) == 64
    assert manifest["context"]["sha256"] == hashlib.sha256(b"private context").hexdigest()
    assert "private context" not in json.dumps(manifest)
    assert receipt["bundle_size_bytes"] > 0
    assert all(item["artifact_available"] for item in receipt["profiles"])

    archive = private_export_zip(tmp_path, benchmark_id)
    assert archive == private_export_zip(tmp_path, benchmark_id)
    assert b"private context" not in archive
    for profile_id in PROFILES:
        first = verified_profile_bytes(tmp_path, benchmark_id, profile_id, "transcript")
        second = verified_profile_bytes(tmp_path, benchmark_id, profile_id, "transcript")
        assert first == second
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


def test_tampered_top_level_manifest_fails_before_artifact_read(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)
    path = tmp_path / "benchmarks" / benchmark_id / "benchmark.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["sample_identity_sha256"] = "d" * 64
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )

    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_MANIFEST_INTEGRITY_FAILED"):
        load_bundle(tmp_path, benchmark_id)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_MANIFEST_INTEGRITY_FAILED"):
        verified_profile_bytes(tmp_path, benchmark_id, "qwen-fast", "transcript")


def test_rehashed_manifest_cannot_rebind_existing_profile_artifacts(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)
    path = tmp_path / "benchmarks" / benchmark_id / "benchmark.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["sample_identity_sha256"] = "d" * 64
    unsigned = dict(payload)
    unsigned.pop("manifest_payload_sha256", None)
    payload["manifest_payload_sha256"] = hashlib.sha256(
        json.dumps(
            unsigned,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )

    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_PROFILE_MANIFEST_INVALID"):
        load_bundle(tmp_path, benchmark_id)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sha256", "0" * 64),
        ("size_bytes", 1),
    ],
)
def test_rehashed_artifact_descriptor_sha_or_size_fails_closed(
    tmp_path: Path,
    field: str,
    value,
):
    benchmark_id, _ = _complete_bundle(tmp_path)

    def mutate(payload):
        payload["profiles"][2]["artifacts"]["events"][field] = value

    _rewrite_bundle_manifest(tmp_path, benchmark_id, mutate)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ARTIFACT_INTEGRITY_FAILED"):
        load_bundle(tmp_path, benchmark_id)


@pytest.mark.parametrize(
    "relative",
    [
        "../outside.json",
        "profiles/qwen-fast/unexpected.json",
        "profiles/whisper-turbo/transcript.json",
    ],
)
def test_rehashed_artifact_descriptor_cannot_rebind_canonical_path(
    tmp_path: Path,
    relative: str,
):
    benchmark_id, _ = _complete_bundle(tmp_path)

    def mutate(payload):
        payload["profiles"][2]["artifacts"]["transcript"]["path"] = relative

    _rewrite_bundle_manifest(tmp_path, benchmark_id, mutate)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_MANIFEST_INVALID"):
        load_bundle(tmp_path, benchmark_id)


def test_rehashed_manifest_rejects_unexpected_artifact_name(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)

    def mutate(payload):
        payload["profiles"][0]["artifacts"]["surprise"] = dict(
            payload["profiles"][0]["artifacts"]["events"]
        )

    _rewrite_bundle_manifest(tmp_path, benchmark_id, mutate)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_MANIFEST_INVALID"):
        load_bundle(tmp_path, benchmark_id)


def test_mutated_profile_manifest_fails_closed(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)
    path = tmp_path / "benchmarks" / benchmark_id / "profiles" / "qwen-fast" / "profile.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["profile_id"] = "qwen-quality"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ARTIFACT_INTEGRITY_FAILED"):
        load_bundle(tmp_path, benchmark_id)


@pytest.mark.parametrize(
    ("artifact", "size"),
    [
        ("transcript.json", 16 * 1024 * 1024 + 1),
        ("events.jsonl", 8 * 1024 * 1024 + 1),
    ],
)
def test_oversized_json_and_jsonl_fail_before_parse(
    tmp_path: Path,
    artifact: str,
    size: int,
):
    benchmark_id, _ = _complete_bundle(tmp_path)
    path = tmp_path / "benchmarks" / benchmark_id / "profiles" / "qwen-fast" / artifact
    path.write_bytes(b"x" * size)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ARTIFACT_SIZE_INVALID"):
        load_bundle(tmp_path, benchmark_id)


@pytest.mark.parametrize("failed_name", ["transcript.json", "profile.json"])
def test_profile_atomic_write_failure_never_exposes_completed_bundle(
    monkeypatch,
    tmp_path: Path,
    failed_name: str,
):
    real_atomic_write = benchmark_evidence.atomic_write

    def fail_selected(path, payload):
        if Path(path).name == failed_name:
            raise RuntimeError("synthetic atomic failure")
        return real_atomic_write(path, payload)

    monkeypatch.setattr(benchmark_evidence, "atomic_write", fail_selected)
    benchmark_id = benchmark_id_for("benchmark-test", 1)
    with pytest.raises(RuntimeError, match="synthetic atomic failure"):
        _complete_bundle(tmp_path)
    assert not (tmp_path / "benchmarks" / benchmark_id / "benchmark.json").exists()


def test_top_level_manifest_is_last_and_failed_atomic_commit_is_not_comparable(
    monkeypatch,
    tmp_path: Path,
):
    real_atomic_write = benchmark_evidence.atomic_write
    writes: list[Path] = []

    def fail_top_level(path, payload):
        writes.append(Path(path).relative_to(tmp_path))
        if Path(path).name == "benchmark.json":
            raise RuntimeError("synthetic top-level replace failure")
        return real_atomic_write(path, payload)

    monkeypatch.setattr(benchmark_evidence, "atomic_write", fail_top_level)
    benchmark_id = benchmark_id_for("benchmark-test", 1)
    with pytest.raises(RuntimeError, match="synthetic top-level replace failure"):
        _complete_bundle(tmp_path)
    assert writes[-1] == Path("benchmarks") / benchmark_id / "benchmark.json"
    assert not (tmp_path / "benchmarks" / benchmark_id / "benchmark.json").exists()
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ARTIFACT_UNAVAILABLE"):
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
    assert normalize_text("ação") == normalize_text("ac\u0327a\u0303o")
    assert normalize_text("d'Artagnan-meio") == "d'artagnan-meio"
    assert normalize_text("ação") != normalize_text("acao")


def test_quality_receipts_bind_exact_manifest_and_are_deterministic_with_wer_over_100(tmp_path: Path):
    texts = {
        "whisper-turbo": "ação",
        "whisper-detailed": "ação",
        "qwen-fast": "ação extra extra extra",
        "qwen-quality": "",
    }
    benchmark_id, _ = _complete_bundle(tmp_path, texts)
    save_reference(
        tmp_path,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [{"track_number": 1, "speaker": "Alice", "text": "ação"}],
        },
    )

    first = quality_summary(tmp_path, benchmark_id)
    second = quality_summary(tmp_path, benchmark_id)
    assert json.dumps(first, ensure_ascii=False, sort_keys=True) == json.dumps(
        second,
        ensure_ascii=False,
        sort_keys=True,
    )

    by_profile = {item["profile_id"]: item for item in first["profiles"]}
    manifest_path = tmp_path / "benchmarks" / benchmark_id / "benchmark.json"
    expected_manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    for receipt in first["profiles"]:
        assert receipt["benchmark_manifest_sha256"] == expected_manifest_sha
        assert len(receipt["normalization_sha256"]) == 64
        assert "computed_at" not in receipt

    assert by_profile["qwen-fast"]["overall"]["insertions"] == 3
    assert by_profile["qwen-fast"]["overall"]["wer_normalized"] == 3.0
    assert by_profile["qwen-quality"]["overall"]["deletions"] == 1
    assert by_profile["qwen-quality"]["overall"]["wer_normalized"] == 1.0
    assert by_profile["qwen-quality"]["overall"]["cer_normalized"] == 1.0


def test_term_fidelity_counts_only_terms_present_in_the_human_reference(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(
        tmp_path,
        {
            "whisper-turbo": "Valyndra Valyndra",
            "whisper-detailed": "Valyndra Valyndra",
            "qwen-fast": "Valyndra Valindra",
            "qwen-quality": "Valyndra Valyndra",
        },
    )
    save_reference(
        tmp_path,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [{"track_number": 1, "speaker": "Alice", "text": "Valyndra Valyndra"}],
            "terms": ["Valyndra", "Ausente"],
        },
    )
    by_profile = {
        item["profile_id"]: item
        for item in quality_summary(tmp_path, benchmark_id)["profiles"]
    }
    fidelity = by_profile["qwen-fast"]["term_fidelity"]
    assert fidelity is not None
    assert fidelity["reference_occurrences"] == 2
    assert fidelity["hypothesis_occurrences"] == 1
    assert fidelity["correct_occurrences"] == 1
    assert fidelity["recall"] == 0.5
    assert fidelity["precision"] == 1.0


def test_level_two_reference_exposes_timing_speaker_overlap_and_provenance(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path, {profile: "Olá mundo" for profile in PROFILES})
    save_reference(
        tmp_path,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [
                {
                    "track_number": 1,
                    "speaker": "Alice",
                    "text": "Olá mundo",
                    "turns": [
                        {
                            "start": 1.1,
                            "end": 2.2,
                            "speaker": "Bob",
                            "text": "Olá mundo",
                            "overlaps_other_speaker": True,
                        }
                    ],
                }
            ],
        },
    )

    summary = quality_summary(tmp_path, benchmark_id)
    assert summary["reference"]["capability"] == "timed_turns"
    timing = summary["profiles"][0]["timing"]
    assert timing is not None
    assert timing["matched_turns"] == 1
    assert timing["unmatched_reference_turns"] == 0
    assert timing["unmatched_hypothesis_turns"] == 0
    assert timing["turn_coverage"] == 1.0
    assert timing["speaker_accuracy"] == 0.0
    assert timing["start_mae_seconds"] == pytest.approx(0.1)
    assert timing["end_mae_seconds"] == pytest.approx(0.2)
    assert timing["overlap_recall"] == 0.0
    assert timing["hypothesis_timing"]["alignment_backend"] == "native"
    assert timing["hypothesis_timing"]["timestamp_granularity"] == "segment_aligned"


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


def _rewrite_current_reference(tmp_path: Path, benchmark_id: str, mutate) -> None:
    root = tmp_path / "benchmarks" / benchmark_id / "reference"
    pointer_path = root / "current.json"
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    reference_path = root / f"reference-{pointer['revision']:06d}.json"
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    mutate(reference)
    encoded = json.dumps(
        reference,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    reference_path.write_bytes(encoded)
    pointer["reference_sha256"] = hashlib.sha256(encoded).hexdigest()
    pointer_path.write_text(
        json.dumps(pointer, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


@pytest.mark.parametrize("mutation", ["sample", "normalization"])
def test_reference_identity_and_normalization_mismatch_cannot_score(
    tmp_path: Path,
    mutation: str,
):
    benchmark_id, _ = _complete_bundle(tmp_path)
    save_reference(
        tmp_path,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [{"track_number": 1, "speaker": "Alice", "text": "texto"}],
        },
    )

    def mutate(reference):
        if mutation == "sample":
            reference["sample_identity_sha256"] = "0" * 64
        else:
            reference["normalization"]["schema_version"] = "tda_text_normalization_evil"

    _rewrite_current_reference(tmp_path, benchmark_id, mutate)
    with pytest.raises(BenchmarkQualityError, match="BENCHMARK_REFERENCE_IDENTITY_MISMATCH"):
        quality_summary(tmp_path, benchmark_id)


def test_quality_micro_aggregation_handles_missing_reference_track_deterministically(
    tmp_path: Path,
):
    texts = {profile: "um dois" for profile in PROFILES}
    benchmark_id, _ = _complete_bundle(tmp_path, texts)
    save_reference(
        tmp_path,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [
                {"track_number": 1, "speaker": "Alice", "text": "um dois"},
                {"track_number": 2, "speaker": "Bob", "text": "tres"},
            ],
        },
    )
    quality = quality_summary(tmp_path, benchmark_id)
    for profile in quality["profiles"]:
        assert [row["track_number"] for row in profile["per_track"]] == [1, 2]
        assert profile["per_track"][0]["wer_normalized"] == 0.0
        assert profile["per_track"][1]["deletions"] == 1
        assert profile["overall"]["aggregation"] == "micro"
        assert profile["overall"]["reference_words"] == 3
        assert profile["overall"]["deletions"] == 1
        assert profile["overall"]["wer_normalized"] == pytest.approx(1 / 3, abs=1e-8)


def test_reference_seed_profile_never_changes_scoring_algorithm(tmp_path: Path):
    texts = {profile: "Olá mundo" for profile in PROFILES}
    first_id, _ = _complete_bundle(tmp_path / "first", texts, job_id="seed-first")
    second_id, _ = _complete_bundle(tmp_path / "second", texts, job_id="seed-second")
    request = {
        "expected_revision": 0,
        "provenance": "profile_seed",
        "tracks": [{"track_number": 1, "speaker": "Alice", "text": "Olá mundo"}],
    }
    save_reference(
        tmp_path / "first",
        first_id,
        {**request, "seed_profile_id": "qwen-fast"},
    )
    save_reference(
        tmp_path / "second",
        second_id,
        {**request, "seed_profile_id": "whisper-turbo"},
    )
    first = quality_summary(tmp_path / "first", first_id)
    second = quality_summary(tmp_path / "second", second_id)
    first_metrics = [
        (item["profile_id"], item["overall"], item["term_fidelity"], item["timing"])
        for item in first["profiles"]
    ]
    second_metrics = [
        (item["profile_id"], item["overall"], item["term_fidelity"], item["timing"])
        for item in second["profiles"]
    ]
    assert first_metrics == second_metrics


def test_telemetry_without_sampler_is_explicit_and_null_safe():
    telemetry = normalize_telemetry_samples(
        [],
        lineage=_lineage("whisper-turbo"),
        interval_ms=1000,
        elapsed_ms=5000,
    )
    assert telemetry["expected_samples"] == 5
    assert telemetry["captured_samples"] == 0
    assert telemetry["coverage"] == 0.0
    assert telemetry["samples"] == []
    assert telemetry["aggregates"]["cpu_avg_percent"] is None
    assert telemetry["aggregates"]["gpu_utilization_peak_percent"] is None
    assert telemetry["aggregates"]["vram_peak_bytes"] is None


def test_telemetry_missing_nvml_fields_remains_explicitly_null():
    telemetry = normalize_telemetry_samples(
        [
            {
                "sampled_at": "2026-10-03T00:00:01Z",
                "cpu": {},
                "memory": {},
                "gpus": [
                    {
                        "uuid": "GPU-test",
                        "pci_bus_id": "0000:01:00.0",
                        "name": "Synthetic GPU",
                    }
                ],
            }
        ],
        lineage=_lineage("whisper-turbo"),
        interval_ms=1000,
        elapsed_ms=1000,
    )
    assert telemetry["captured_samples"] == 1
    assert telemetry["coverage"] == 1.0
    assert telemetry["aggregates"]["gpu_utilization_avg_percent"] is None
    assert telemetry["aggregates"]["gpu_utilization_peak_percent"] is None
    assert telemetry["aggregates"]["vram_peak_bytes"] is None
    assert telemetry["aggregates"]["temperature_max_c"] is None
    assert telemetry["aggregates"]["power_peak_w"] is None


def test_telemetry_jsonl_records_sampling_semantics_coverage_and_exact_gpu(tmp_path: Path):
    benchmark_id, _ = _complete_bundle(tmp_path)
    payload = verified_profile_bytes(tmp_path, benchmark_id, "whisper-turbo", "telemetry")
    rows = [json.loads(line) for line in payload.splitlines()]
    summary = telemetry_summary_from_bytes(payload)

    assert rows[0]["record_type"] == "summary"
    assert summary["sampling_mode"] == "daemon_thread_outside_engine_processing_timer_v1"
    assert summary["interval_ms"] == 1000
    assert summary["expected_samples"] == 3
    assert summary["captured_samples"] == 1
    assert summary["coverage"] == pytest.approx(1 / 3, abs=1e-6)
    assert summary["selected_gpu"]["uuid"] == "GPU-test"
    assert summary["selected_gpu"]["pci_bus_id"] == "0000:01:00.0"
    assert rows[1]["record_type"] == "sample"
    assert rows[1]["profile_id"] == "whisper-turbo"
    assert "host" not in rows[1]
    assert "SECRET" not in payload.decode("utf-8")


def test_telemetry_never_falls_back_to_wrong_gpu_when_exact_identity_is_present():
    telemetry = normalize_telemetry_samples(
        [
            {
                "sampled_at": "2026-10-03T00:00:01Z",
                "cpu": {"utilization_percent": 10},
                "memory": {"used_bytes": 100, "percent": 10},
                "gpus": [
                    {
                        "uuid": "GPU-wrong",
                        "pci_bus_id": "0000:02:00.0",
                        "name": "Synthetic GPU",
                        "utilization_percent": 99,
                        "memory_used_bytes": 999,
                    },
                    {
                        "uuid": "GPU-test",
                        "pci_bus_id": "0000:01:00.0",
                        "name": "Synthetic GPU",
                        "utilization_percent": 55,
                        "memory_used_bytes": 555,
                    },
                ],
            }
        ],
        lineage=_lineage("whisper-turbo"),
        interval_ms=1000,
        elapsed_ms=1000,
    )
    assert telemetry["aggregates"]["gpu_utilization_peak_percent"] == 55
    assert telemetry["aggregates"]["vram_peak_bytes"] == 555


def test_benchmark_event_sink_drops_speaker_paths_tokens_and_transcript_like_extras():
    message = WorkerMessage.create(
        job_id="benchmark-privacy",
        attempt=1,
        seq=7,
        type="event",
        payload={
            "code": "TRACK_STARTED",
            "stage": "transcription",
            "track": 1,
            "total_tracks": 2,
            "speaker": "SEGREDO TRANSCRITO Alice@example.com C:\\Users\\Alice",
            "Authorization": "Bearer super-secret",
            "cookie": "session=super-secret",
            "transcript": "frase privada que nunca deveria entrar no diagnóstico",
            "path": "/home/alice/private/session.flac",
        },
    )
    row = sanitize_benchmark_message(
        message,
        benchmark_id=benchmark_id_for("benchmark-privacy", 1),
        profile_id="qwen-fast",
        sample_identity_sha256="d" * 64,
        relative_ms=123,
    )
    assert row is not None
    encoded = json.dumps(row, ensure_ascii=False)
    assert row["code"] == "TRACK_STARTED"
    assert row["data"]["track"] == 1
    assert "speaker" not in row["data"]
    assert "Alice" not in encoded
    assert "Authorization" not in encoded
    assert "super-secret" not in encoded
    assert "frase privada" not in encoded
    assert "session.flac" not in encoded


def test_event_gate_bounds_count_and_payload_size():
    benchmark_id = benchmark_id_for("benchmark-event-bounds", 1)
    base = {
        "schema_version": "tda_benchmark_event_v1",
        "at": "2026-10-03T00:00:00.000Z",
        "relative_ms": 0,
        "benchmark_id": benchmark_id,
        "attempt": 1,
        "profile_id": "qwen-fast",
        "sample_identity_sha256": "d" * 64,
        "type": "event",
        "stage": "transcription",
        "code": "TRACK_STARTED",
        "data": {},
    }
    too_many = [{**base, "seq": index} for index in range(20_001)]
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_EVENT_COUNT_INVALID"):
        benchmark_evidence._event_jsonl(
            too_many,
            benchmark_id=benchmark_id,
            profile_id="qwen-fast",
            required_terminal="result",
        )

    allowed_keys = sorted(benchmark_evidence._BENCHMARK_EVENT_DATA_FIELDS)
    oversized_data = {key: "x" * 256 for key in allowed_keys if key not in {"stage"}}
    with pytest.raises(
        BenchmarkEvidenceError,
        match="BENCHMARK_EVENT_DATA_TOO_LARGE|BENCHMARK_EVENT_INVALID",
    ):
        benchmark_evidence._validated_event_row(
            {**base, "seq": 1, "data": oversized_data},
            benchmark_id=benchmark_id,
            profile_id="qwen-fast",
        )


def test_event_sink_rejects_non_monotonic_sequence(tmp_path: Path):
    benchmark_id = benchmark_id_for("benchmark-event-order", 1)
    profile = "qwen-fast"
    write_profile_artifact(
        tmp_path,
        _document(profile, "texto"),
        benchmark_id=benchmark_id,
        job_id="benchmark-event-order",
        attempt=1,
        profile_id=profile,
        sample_identity_sha256="d" * 64,
        sample_seconds=300.0,
        execution_lineage=_lineage(profile),
    )
    base = {
        "schema_version": "tda_benchmark_event_v1",
        "at": "2026-10-03T00:00:00.000Z",
        "relative_ms": 0,
        "benchmark_id": benchmark_id,
        "attempt": 1,
        "profile_id": profile,
        "sample_identity_sha256": "d" * 64,
        "type": "ready",
        "stage": None,
        "code": "WORKER_READY",
        "data": {},
    }
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_EVENT_SEQUENCE_INVALID"):
        write_profile_events(
            tmp_path,
            benchmark_id,
            profile,
            [{**base, "seq": 2}, {**base, "seq": 2}],
        )


def test_completed_profile_events_require_a_result_terminal_marker(tmp_path: Path):
    benchmark_id = benchmark_id_for("benchmark-terminal", 1)
    profile = "qwen-fast"
    write_profile_artifact(
        tmp_path,
        _document(profile, "texto"),
        benchmark_id=benchmark_id,
        job_id="benchmark-terminal",
        attempt=1,
        profile_id=profile,
        sample_identity_sha256="d" * 64,
        sample_seconds=300.0,
        execution_lineage=_lineage(profile),
    )
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_EVENT_TERMINAL_INVALID"):
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
                    "attempt": 1,
                    "profile_id": profile,
                    "sample_identity_sha256": "d" * 64,
                    "type": "ready",
                    "stage": None,
                    "code": "WORKER_READY",
                    "data": {},
                }
            ],
        )


def test_failed_profile_diagnostics_survive_without_completed_bundle(tmp_path: Path):
    benchmark_id = benchmark_id_for("benchmark-failed", 1)
    telemetry = normalize_telemetry_samples(
        [],
        lineage={},
        interval_ms=1000,
        elapsed_ms=2500,
    )
    failure = write_failed_profile_diagnostics(
        tmp_path,
        benchmark_id=benchmark_id,
        job_id="benchmark-failed",
        attempt=1,
        profile_id="whisper-turbo",
        sample_identity_sha256="e" * 64,
        terminal="error",
        failure_payload={"code": "WHISPER_RUNTIME_UNAVAILABLE", "stage": "benchmark_worker_launch"},
        events=[
            {
                "schema_version": "tda_benchmark_event_v1",
                "seq": 0,
                "at": "2026-10-03T00:00:00.000Z",
                "relative_ms": 10,
                "benchmark_id": benchmark_id,
                "attempt": 1,
                "profile_id": "whisper-turbo",
                "sample_identity_sha256": "e" * 64,
                "type": "error",
                "stage": "benchmark_worker_launch",
                "code": "WORKER_ERROR",
                "data": {"code": "WHISPER_RUNTIME_UNAVAILABLE"},
            }
        ],
        telemetry=telemetry,
    )
    root = tmp_path / "benchmarks" / benchmark_id
    assert failure["terminal"] == "error"
    assert not (root / "benchmark.json").exists()
    assert not list(root.rglob("transcript.json"))
    assert (root / "partial" / "whisper-turbo" / "attempt-0001" / "events.jsonl").is_file()
    assert (root / "partial" / "whisper-turbo" / "attempt-0001" / "telemetry.jsonl").is_file()


def test_queue_cleanup_does_not_delete_committed_benchmark_evidence(tmp_path: Path):
    store = Store(tmp_path)
    body = {
        "kind": "benchmark.craig",
        "campaign_id": "benchmark-local",
        "session_id": "benchmark-local",
        "source_id": "craig-" + "a" * 64,
        "glossary": "",
        "context": "",
        "units": 4,
        "sample_seconds": 300.0,
        "sample_identity_sha256": "c" * 64,
        "track_count": 1,
        "audio_work_seconds": 300.0,
        "profiles": list(PROFILES),
        "prepared": True,
    }
    job = store.submit("benchmark-evidence-retention", body)
    claim = store.claim()
    assert claim is not None and claim[0] == job["id"]
    benchmark_id, _ = _complete_bundle(
        tmp_path,
        job_id=job["id"],
        attempt=claim[1],
    )
    store.fail(*claim, "SYNTHETIC_TERMINAL_FAILURE")
    assert store.remove(job["id"]) == {"deleted": True, "id": job["id"]}

    manifest = load_bundle(tmp_path, benchmark_id)
    assert manifest["job_id"] == job["id"]
    assert manifest["attempt"] == claim[1]
    assert len(manifest["profiles"]) == 4


def test_benchmark_api_rejects_unauthorized_wrong_ids_and_corrupt_artifacts(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    benchmark_id, _ = _complete_bundle(data_root)
    token = "t" * 43
    origin = "https://dnd.faysk.dev"
    headers = {"Authorization": f"Bearer {token}", "Origin": origin}
    app = create_app(
        data_root,
        token,
        {origin},
        run_worker=False,
        models_root=tmp_path / "Models",
    )

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        unauthorized = client.get(f"/api/v1/benchmarks/{benchmark_id}")
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "UNAUTHORIZED"

        missing = client.get(
            f"/api/v1/benchmarks/benchmark-{'0' * 32}",
            headers=headers,
        )
        assert missing.status_code == 409
        assert missing.json()["error"]["code"] == "BENCHMARK_ARTIFACT_UNAVAILABLE"

        wrong_profile = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/not-a-profile/transcript",
            headers=headers,
        )
        assert wrong_profile.status_code == 422
        assert wrong_profile.json()["error"]["code"] == "INVALID_REQUEST"

        transcript_path = (
            data_root
            / "benchmarks"
            / benchmark_id
            / "profiles"
            / "qwen-fast"
            / "transcript.json"
        )
        payload = json.loads(transcript_path.read_text(encoding="utf-8"))
        payload["tracks"][0]["segments"][0]["text"] = "tampered"
        transcript_path.write_text(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )
        corrupt = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/qwen-fast/transcript",
            headers=headers,
        )
        assert corrupt.status_code == 409
        assert corrupt.json()["error"]["code"] == "BENCHMARK_ARTIFACT_INTEGRITY_FAILED"


def test_authenticated_benchmark_api_reopens_verified_evidence_and_quality(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    benchmark_id, _ = _complete_bundle(data_root)
    token = "t" * 43
    origin = "https://dnd.faysk.dev"
    headers = {
        "Authorization": f"Bearer {token}",
        "Origin": origin,
    }
    app = create_app(
        data_root,
        token,
        {origin},
        run_worker=False,
        models_root=tmp_path / "Models",
    )
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        manifest = client.get(
            f"/api/v1/benchmarks/{benchmark_id}",
            headers=headers,
        )
        assert manifest.status_code == 200
        assert manifest.json()["benchmark_id"] == benchmark_id

        transcript = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/qwen-quality/transcript",
            headers=headers,
        )
        assert transcript.status_code == 200
        assert transcript.json()["engine"]["profile"] == "qwen-quality"
        assert transcript.headers["cache-control"] == "no-store"

        telemetry = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/qwen-quality/telemetry",
            headers=headers,
        )
        assert telemetry.status_code == 200
        assert telemetry.json()["schema_version"] == "tda_benchmark_telemetry_v1"
        assert "samples" not in telemetry.json()

        before = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/quality",
            headers=headers,
        )
        assert before.status_code == 200
        assert before.json()["quality_measured"] is False

        saved = client.post(
            f"/api/v1/benchmarks/{benchmark_id}/reference",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "expected_revision": 0,
                "provenance": "manual",
                "seed_profile_id": None,
                "tracks": [
                    {
                        "track_number": 1,
                        "speaker": "Alice",
                        "text": "texto qwen-quality",
                    }
                ],
                "terms": ["qwen-quality"],
            },
        )
        assert saved.status_code == 200
        assert saved.json()["revision"] == 1

        after = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/quality",
            headers=headers,
        )
        assert after.status_code == 200
        assert after.json()["quality_measured"] is True
        assert len(after.json()["profiles"]) == 4

        export = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/export",
            headers=headers,
        )
        assert export.status_code == 200
        assert export.headers["content-type"] == "application/zip"
        assert "attachment;" in export.headers["content-disposition"]
