from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import tda_companion.benchmark_bundles as bundles
from tda_companion.api import create_app
from tda_companion.benchmark_bundles import (
    BENCHMARK_PROFILES,
    BUNDLE_SCHEMA_VERSION,
    BenchmarkBundleError,
    benchmark_id_for,
    benchmark_root,
    benchmark_sample_descriptor,
    benchmark_sample_identity,
    claim_benchmark_outcome,
    finalize_benchmark_bundle,
    load_benchmark_bundle,
    read_benchmark_transcript,
    verify_benchmark_profile_receipt,
    write_benchmark_profile,
)
from tda_companion.store import Store
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


def _document(profile_id: str, text: str | None = None) -> TranscriptDocument:
    engine = "faster-whisper" if profile_id.startswith("whisper-") else "qwen3"
    word = TranscriptWord(
        text=text or profile_id,
        start=1.0,
        end=1.4,
        confidence=0.99,
    )
    segment = TranscriptSegment(
        id="1-0",
        start=1.0,
        end=1.5,
        text=text or profile_id,
        words=(word,),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1-Alice.flac",
        source_sha256=TRACK_SHA,
        duration_seconds=300.0,
        segments=(segment,),
    )
    return TranscriptDocument(
        recording_id="recording",
        source_sha256=SOURCE_SHA,
        language="pt",
        engine=TranscriptEngine(
            engine=engine,
            model="model-for-test",
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


def _profile_receipts(data_root: Path, job_id: str, attempt: int, count: int = 4) -> list[dict]:
    package = _package()
    sample_identity = benchmark_sample_identity(package)
    receipts: list[dict] = []
    for profile_id in BENCHMARK_PROFILES[:count]:
        artifact = write_benchmark_profile(
            data_root,
            _document(profile_id),
            job_id=job_id,
            attempt=attempt,
            source_id=SOURCE_ID,
            sample_identity_sha256=sample_identity,
            sample_seconds=300.0,
            execution_lineage=_lineage(profile_id),
        )
        receipts.append(
            {
                "profile_id": profile_id,
                "benchmark_id": artifact["benchmark_id"],
                "sample_identity_sha256": sample_identity,
                "transcript_sha256": artifact["transcript_sha256"],
                "transcript_size_bytes": artifact["transcript_size_bytes"],
                "artifact_available": True,
                "execution_lineage": _lineage(profile_id),
            }
        )
    return receipts


def _finalize(data_root: Path, job_id: str = "benchmark-job", attempt: int = 1) -> dict:
    package = _package()
    receipts = _profile_receipts(data_root, job_id, attempt)
    return finalize_benchmark_bundle(
        data_root,
        job_id=job_id,
        attempt=attempt,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA,
        sample=benchmark_sample_descriptor(package),
        sample_identity_sha256=benchmark_sample_identity(package),
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="contexto privado",
        glossary="Valyndra",
        profile_receipts=receipts,
    )


def test_completed_bundle_hash_binds_profile_diagnostics(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    job_id = "diagnostics-job"
    benchmark_id = benchmark_id_for(job_id, 1)
    receipts = _profile_receipts(data_root, job_id, 1)

    for index, profile_id in enumerate(BENCHMARK_PROFILES):
        root = benchmark_root(data_root, benchmark_id) / "profiles" / profile_id
        metrics = json.dumps(
            {
                "schema_version": "tda_benchmark_metrics_v1",
                "benchmark_id": benchmark_id,
                "profile_id": profile_id,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        events = (
            json.dumps(
                {
                    "schema_version": "tda_benchmark_event_v1",
                    "benchmark_id": benchmark_id,
                    "profile_id": profile_id,
                    "seq": 0,
                    "code": "PROFILE_COMPLETED",
                },
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode("utf-8")
        (root / "metrics.json").write_bytes(metrics)
        (root / "events.jsonl").write_bytes(events)
        if index == 0:
            (root / "telemetry.jsonl").write_text(
                '{"schema_version":"tda_benchmark_telemetry_v1","relative_ms":0}\n',
                encoding="utf-8",
            )

    package = _package()
    bundle = finalize_benchmark_bundle(
        data_root,
        job_id=job_id,
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA,
        sample=benchmark_sample_descriptor(package),
        sample_identity_sha256=benchmark_sample_identity(package),
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="contexto privado",
        glossary="Valyndra",
        profile_receipts=receipts,
    )

    assert bundle["status"] == "completed"
    assert all("diagnostics" in item for item in bundle["profiles"])
    first = bundle["profiles"][0]["diagnostics"]
    assert first["metrics"]["artifact"].endswith("/metrics.json")
    assert first["events"]["artifact"].endswith("/events.jsonl")
    assert first["telemetry"]["artifact"].endswith("/telemetry.jsonl")
    assert bundle["profiles"][1]["diagnostics"]["telemetry"] is None

    tampered = benchmark_root(data_root, benchmark_id) / "profiles" / "qwen-fast" / "events.jsonl"
    tampered.write_bytes(tampered.read_bytes() + b'{"seq":999}\n')
    with pytest.raises(
        BenchmarkBundleError,
        match="BENCHMARK_BUNDLE_DIAGNOSTIC_ARTIFACT_MISMATCH",
    ):
        load_benchmark_bundle(data_root, benchmark_id)


def test_bundle_rejects_partial_diagnostic_artifacts(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    job_id = "partial-diagnostics"
    benchmark_id = benchmark_id_for(job_id, 1)
    receipts = _profile_receipts(data_root, job_id, 1)
    first = benchmark_root(data_root, benchmark_id) / "profiles" / BENCHMARK_PROFILES[0]
    (first / "metrics.json").write_text(
        '{"schema_version":"tda_benchmark_metrics_v1"}',
        encoding="utf-8",
    )
    package = _package()

    with pytest.raises(
        BenchmarkBundleError,
        match="BENCHMARK_DIAGNOSTIC_ARTIFACT_INCOMPLETE",
    ):
        finalize_benchmark_bundle(
            data_root,
            job_id=job_id,
            attempt=1,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample=benchmark_sample_descriptor(package),
            sample_identity_sha256=benchmark_sample_identity(package),
            sample_seconds=300.0,
            track_count=1,
            audio_work_seconds=300.0,
            context="",
            glossary="",
            profile_receipts=receipts,
        )


def test_oversized_manifest_and_jsonl_diagnostics_fail_closed(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    data_root.mkdir()

    completed = _finalize(data_root, job_id="oversized-manifest")
    benchmark_id = completed["benchmark_id"]
    monkeypatch.setattr(bundles, "_MAX_MANIFEST_BYTES", 64)
    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_BUNDLE_MANIFEST_INVALID"):
        load_benchmark_bundle(data_root, benchmark_id)

    monkeypatch.setattr(bundles, "_MAX_MANIFEST_BYTES", 512 * 1024)
    job_id = "oversized-events"
    receipts = _profile_receipts(data_root, job_id, 1)
    profile_root = (
        benchmark_root(data_root, benchmark_id_for(job_id, 1))
        / "profiles"
        / BENCHMARK_PROFILES[0]
    )
    (profile_root / "metrics.json").write_text(
        '{"schema_version":"tda_benchmark_metrics_v1"}',
        encoding="utf-8",
    )
    (profile_root / "events.jsonl").write_bytes(b"x" * 65)
    monkeypatch.setattr(bundles, "_MAX_BENCHMARK_EVENTS_BYTES", 64)
    package = _package()
    with pytest.raises(
        BenchmarkBundleError,
        match="BENCHMARK_DIAGNOSTIC_ARTIFACT_INVALID",
    ):
        finalize_benchmark_bundle(
            data_root,
            job_id=job_id,
            attempt=1,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample=benchmark_sample_descriptor(package),
            sample_identity_sha256=benchmark_sample_identity(package),
            sample_seconds=300.0,
            track_count=1,
            audio_work_seconds=300.0,
            context="",
            glossary="",
            profile_receipts=receipts,
        )


def test_profile_artifacts_commit_before_top_manifest_and_bundle_is_separate(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    job_id = "benchmark-job"
    benchmark_id = benchmark_id_for(job_id, 1)

    receipts = _profile_receipts(data_root, job_id, 1)
    root = benchmark_root(data_root, benchmark_id)

    assert not (root / "benchmark.json").exists()
    for profile_id in BENCHMARK_PROFILES:
        assert (root / "profiles" / profile_id / "transcript.json").is_file()
        assert (root / "profiles" / profile_id / "profile.json").is_file()

    package = _package()
    bundle = finalize_benchmark_bundle(
        data_root,
        job_id=job_id,
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA,
        sample=benchmark_sample_descriptor(package),
        sample_identity_sha256=benchmark_sample_identity(package),
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="contexto privado",
        glossary="Valyndra",
        profile_receipts=receipts,
    )

    assert bundle["schema_version"] == BUNDLE_SCHEMA_VERSION
    assert bundle["status"] == "completed"
    assert bundle["profile_order"] == list(BENCHMARK_PROFILES)
    assert bundle["bundle_size_bytes"] > bundle["bundle_manifest_size_bytes"]
    assert (root / "benchmark.json").is_file()
    assert not (data_root / "staging" / SOURCE_ID / "runs").exists()
    assert not any(path.suffix.lower() in {".wav", ".flac", ".mp3"} for path in root.rglob("*"))

    manifest_text = (root / "benchmark.json").read_text(encoding="utf-8")
    assert "contexto privado" not in manifest_text
    assert "Valyndra" not in manifest_text
    assert str(tmp_path) not in manifest_text
    assert bundle["context"]["sha256"] == hashlib.sha256("contexto privado".encode()).hexdigest()
    assert bundle["glossary"]["sha256"] == hashlib.sha256("Valyndra".encode()).hexdigest()


def test_partial_profile_receipts_remain_hash_verifiable_without_completed_bundle(
    tmp_path: Path,
):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    job_id = "partial-profile-verification"
    package = _package()
    sample_identity = benchmark_sample_identity(package)
    receipts = _profile_receipts(data_root, job_id, 1, count=3)
    benchmark_id = benchmark_id_for(job_id, 1)
    root = benchmark_root(data_root, benchmark_id)

    assert not (root / "benchmark.json").exists()
    for receipt in receipts:
        verify_benchmark_profile_receipt(
            data_root,
            benchmark_id=benchmark_id,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample_identity_sha256=sample_identity,
            receipt=receipt,
        )

    transcript = root / "profiles" / receipts[1]["profile_id"] / "transcript.json"
    payload = bytearray(transcript.read_bytes())
    payload[-2] = payload[-2] ^ 1
    transcript.write_bytes(payload)

    with pytest.raises(
        BenchmarkBundleError,
        match="BENCHMARK_BUNDLE_ARTIFACT_MISMATCH",
    ):
        verify_benchmark_profile_receipt(
            data_root,
            benchmark_id=benchmark_id,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample_identity_sha256=sample_identity,
            receipt=receipts[1],
        )

    assert not (root / "benchmark.json").exists()


def test_partial_profile_receipt_rejects_wrong_sample_or_source_identity(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    job_id = "partial-profile-identity"
    package = _package()
    sample_identity = benchmark_sample_identity(package)
    receipt = _profile_receipts(data_root, job_id, 1, count=1)[0]
    benchmark_id = benchmark_id_for(job_id, 1)

    with pytest.raises(
        BenchmarkBundleError,
        match="BENCHMARK_BUNDLE_PROFILE_RECEIPT_INVALID",
    ):
        verify_benchmark_profile_receipt(
            data_root,
            benchmark_id=benchmark_id,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample_identity_sha256="f" * 64,
            receipt=receipt,
        )

    with pytest.raises(
        BenchmarkBundleError,
        match="BENCHMARK_BUNDLE_PROFILE_RECEIPT_MISMATCH",
    ):
        verify_benchmark_profile_receipt(
            data_root,
            benchmark_id=benchmark_id,
            source_id=SOURCE_ID,
            source_sha256="e" * 64,
            sample_identity_sha256=sample_identity,
            receipt=receipt,
        )


@pytest.mark.parametrize("completed_profiles", [1, 2, 3])
def test_cancelled_partial_benchmark_never_has_completed_top_manifest(
    tmp_path: Path,
    completed_profiles: int,
):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    _profile_receipts(data_root, "cancelled-job", 1, count=completed_profiles)

    root = benchmark_root(data_root, benchmark_id_for("cancelled-job", 1))
    assert not (root / "benchmark.json").exists()
    assert len(list((root / "profiles").iterdir())) == completed_profiles


def test_profile_commit_failure_cleans_non_ambiguous_partial_artifact(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    package = _package()
    benchmark_id = benchmark_id_for("crash-job", 1)

    def crash(_path, _value):
        raise OSError("synthetic crash before profile commit marker")

    monkeypatch.setattr(bundles, "_atomic_json", crash)
    with pytest.raises(OSError, match="synthetic crash"):
        write_benchmark_profile(
            data_root,
            _document("whisper-turbo"),
            job_id="crash-job",
            attempt=1,
            source_id=SOURCE_ID,
            sample_identity_sha256=benchmark_sample_identity(package),
            sample_seconds=300.0,
            execution_lineage=_lineage("whisper-turbo"),
        )

    assert not (
        benchmark_root(data_root, benchmark_id)
        / "profiles"
        / "whisper-turbo"
    ).exists()


def test_cancel_fence_wins_before_top_manifest_and_preserves_profile_evidence(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    package = _package()
    job_id = "cancel-fence-job"
    receipts = _profile_receipts(data_root, job_id, 1)

    assert claim_benchmark_outcome(data_root, job_id, 1, "cancel") == "cancel"
    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_ATTEMPT_CANCELLED"):
        finalize_benchmark_bundle(
            data_root,
            job_id=job_id,
            attempt=1,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample=benchmark_sample_descriptor(package),
            sample_identity_sha256=benchmark_sample_identity(package),
            sample_seconds=300.0,
            track_count=1,
            audio_work_seconds=300.0,
            context="",
            glossary="",
            profile_receipts=receipts,
        )

    root = benchmark_root(data_root, benchmark_id_for(job_id, 1))
    assert not (root / "benchmark.json").exists()
    assert all(
        (root / "profiles" / profile_id / "profile.json").is_file()
        for profile_id in BENCHMARK_PROFILES
    )


def test_crash_before_top_manifest_preserves_profiles_but_not_completed_bundle(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    package = _package()
    receipts = _profile_receipts(data_root, "top-crash-job", 1)
    real_atomic_json = bundles._atomic_json

    def crash_top(path, value):
        if path.name == "benchmark.json":
            raise OSError("synthetic crash before top commit")
        return real_atomic_json(path, value)

    monkeypatch.setattr(bundles, "_atomic_json", crash_top)
    with pytest.raises(OSError, match="synthetic crash"):
        finalize_benchmark_bundle(
            data_root,
            job_id="top-crash-job",
            attempt=1,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample=benchmark_sample_descriptor(package),
            sample_identity_sha256=benchmark_sample_identity(package),
            sample_seconds=300.0,
            track_count=1,
            audio_work_seconds=300.0,
            context="",
            glossary="",
            profile_receipts=receipts,
        )

    root = benchmark_root(data_root, benchmark_id_for("top-crash-job", 1))
    assert not (root / "benchmark.json").exists()
    assert all(
        (root / "profiles" / profile_id / "profile.json").is_file()
        for profile_id in BENCHMARK_PROFILES
    )


def test_corrupted_profile_bytes_cannot_be_sealed_by_top_manifest(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    package = _package()
    receipts = _profile_receipts(data_root, "corrupt-before-finalize", 1)
    root = benchmark_root(
        data_root,
        benchmark_id_for("corrupt-before-finalize", 1),
    )
    transcript = root / "profiles" / "qwen-fast" / "transcript.json"
    payload = bytearray(transcript.read_bytes())
    payload[-2] = payload[-2] ^ 1
    transcript.write_bytes(payload)

    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_BUNDLE_ARTIFACT_MISMATCH"):
        finalize_benchmark_bundle(
            data_root,
            job_id="corrupt-before-finalize",
            attempt=1,
            source_id=SOURCE_ID,
            source_sha256=SOURCE_SHA,
            sample=benchmark_sample_descriptor(package),
            sample_identity_sha256=benchmark_sample_identity(package),
            sample_seconds=300.0,
            track_count=1,
            audio_work_seconds=300.0,
            context="",
            glossary="",
            profile_receipts=receipts,
        )

    assert not (root / "benchmark.json").exists()


def test_same_attempt_replay_is_idempotent_but_different_transcript_is_rejected(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    package = _package()
    identity = benchmark_sample_identity(package)
    first = write_benchmark_profile(
        data_root,
        _document("qwen-fast"),
        job_id="replay-job",
        attempt=1,
        source_id=SOURCE_ID,
        sample_identity_sha256=identity,
        sample_seconds=300.0,
        execution_lineage=_lineage("qwen-fast"),
    )
    replay = write_benchmark_profile(
        data_root,
        _document("qwen-fast"),
        job_id="replay-job",
        attempt=1,
        source_id=SOURCE_ID,
        sample_identity_sha256=identity,
        sample_seconds=300.0,
        execution_lineage=_lineage("qwen-fast"),
    )
    assert replay == first

    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_PROFILE_TRANSCRIPT_MISMATCH"):
        write_benchmark_profile(
            data_root,
            _document("qwen-fast", text="different bytes"),
            job_id="replay-job",
            attempt=1,
            source_id=SOURCE_ID,
            sample_identity_sha256=identity,
            sample_seconds=300.0,
            execution_lineage=_lineage("qwen-fast"),
        )

    assert benchmark_id_for("replay-job", 2) != benchmark_id_for("replay-job", 1)


def test_bundle_rejects_transcript_corruption_and_wrong_profile_lookup(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _finalize(data_root)
    benchmark_id = bundle["benchmark_id"]

    payload = read_benchmark_transcript(data_root, benchmark_id, "whisper-turbo")
    parsed = json.loads(payload)
    assert parsed["engine"]["profile"] == "whisper-turbo"

    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_PROFILE_INVALID"):
        read_benchmark_transcript(data_root, benchmark_id, "../qwen-fast")

    transcript = (
        benchmark_root(data_root, benchmark_id)
        / "profiles"
        / "whisper-turbo"
        / "transcript.json"
    )
    corrupted = bytearray(transcript.read_bytes())
    corrupted[10] = corrupted[10] ^ 1
    transcript.write_bytes(bytes(corrupted))

    with pytest.raises(
        BenchmarkBundleError,
        match="BENCHMARK_PROFILE_TRANSCRIPT_MISMATCH|BENCHMARK_PROFILE_TRANSCRIPT_INVALID",
    ):
        read_benchmark_transcript(data_root, benchmark_id, "whisper-turbo")


def test_exact_transcript_read_rejects_internally_rehashed_malformed_schema(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _finalize(data_root, job_id="malformed-transcript")
    benchmark_id = bundle["benchmark_id"]
    root = benchmark_root(data_root, benchmark_id)
    profile_id = "qwen-fast"
    transcript_path = root / "profiles" / profile_id / "transcript.json"
    profile_path = root / "profiles" / profile_id / "profile.json"
    top_path = root / "benchmark.json"

    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    transcript["schema_version"] = "malformed_transcript_schema"
    transcript_bytes = json.dumps(
        transcript,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    transcript_path.write_bytes(transcript_bytes)
    transcript_sha = hashlib.sha256(transcript_bytes).hexdigest()

    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    profile["transcript"]["sha256"] = transcript_sha
    profile["transcript"]["size_bytes"] = len(transcript_bytes)
    profile_bytes = json.dumps(
        profile,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    profile_path.write_bytes(profile_bytes)

    top = json.loads(top_path.read_text(encoding="utf-8"))
    entry = next(item for item in top["profiles"] if item["profile_id"] == profile_id)
    entry["transcript"]["sha256"] = transcript_sha
    entry["transcript"]["size_bytes"] = len(transcript_bytes)
    entry["profile_manifest"]["sha256"] = hashlib.sha256(profile_bytes).hexdigest()
    entry["profile_manifest"]["size_bytes"] = len(profile_bytes)
    top_path.write_bytes(
        json.dumps(
            top,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )

    # Metadata stays lazy: the malformed transcript body is not parsed until the
    # exact profile content is explicitly requested.
    assert load_benchmark_bundle(data_root, benchmark_id)["status"] == "completed"
    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_PROFILE_TRANSCRIPT_INVALID"):
        read_benchmark_transcript(data_root, benchmark_id, profile_id)


def test_bundle_rejects_manifest_tampering_and_path_traversal(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _finalize(data_root)
    benchmark_id = bundle["benchmark_id"]

    profile_manifest = (
        benchmark_root(data_root, benchmark_id)
        / "profiles"
        / "qwen-quality"
        / "profile.json"
    )
    value = json.loads(profile_manifest.read_text(encoding="utf-8"))
    value["schema_version"] = "evil"
    profile_manifest.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(BenchmarkBundleError):
        load_benchmark_bundle(data_root, benchmark_id)

    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_ID_INVALID"):
        benchmark_root(data_root, "../escape")


@pytest.mark.skipif(os.name == "nt", reason="symlink creation is not guaranteed in Windows CI")
def test_benchmark_root_rejects_symlink_escape(tmp_path: Path):
    data_root = tmp_path / "Data"
    outside = tmp_path / "outside"
    data_root.mkdir()
    outside.mkdir()
    (data_root / "benchmarks").symlink_to(outside, target_is_directory=True)

    with pytest.raises(BenchmarkBundleError, match="BENCHMARK_ROOT_INVALID"):
        benchmark_root(data_root, benchmark_id_for("escape-job", 1))


def test_queue_row_deletion_does_not_remove_completed_bundle(tmp_path: Path):
    data_root = tmp_path / "Data"
    state_root = tmp_path / "State"
    data_root.mkdir()
    store = Store(state_root)

    body = {
        "kind": "benchmark.craig",
        "campaign_id": "benchmark-local",
        "session_id": "benchmark-local",
        "source_id": SOURCE_ID,
        "glossary": "",
        "context": "",
        "units": 4,
        "sample_seconds": 300.0,
        "sample_identity_sha256": benchmark_sample_identity(_package()),
        "track_count": 1,
        "audio_work_seconds": 300.0,
        "profiles": list(BENCHMARK_PROFILES),
        "prepared": True,
    }
    submitted = store.submit("queue-delete-test", body)
    job_id, attempt = store.claim()
    assert job_id == submitted["id"]

    bundle = _finalize(data_root, job_id=job_id, attempt=attempt)
    for completed in range(1, 5):
        assert store.progress(
            job_id,
            attempt,
            completed=completed,
            total=4,
            stage="benchmark",
        )
    assert store.complete(
        job_id,
        attempt,
        {
            "schema_version": "tda_processing_benchmark_v1",
            "benchmark_id": bundle["benchmark_id"],
        },
    )
    assert store.remove(job_id)["deleted"] is True

    reloaded = load_benchmark_bundle(data_root, bundle["benchmark_id"])
    assert reloaded["bundle_manifest_sha256"] == bundle["bundle_manifest_sha256"]



def test_partial_benchmark_result_readback_revalidates_preserved_profile_bytes(
    tmp_path: Path,
):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    package = _package()
    sample_identity = benchmark_sample_identity(package)
    body = {
        "kind": "benchmark.craig",
        "campaign_id": "benchmark-local",
        "session_id": "benchmark-local",
        "source_id": SOURCE_ID,
        "glossary": "",
        "context": "",
        "units": 4,
        "sample_seconds": 300.0,
        "sample_identity_sha256": sample_identity,
        "track_count": 1,
        "audio_work_seconds": 300.0,
        "profiles": list(BENCHMARK_PROFILES),
        "prepared": True,
    }
    store = Store(data_root)
    submitted = store.submit("partial-api-intent", body)
    actual_job_id = submitted["id"]
    receipts = _profile_receipts(data_root, actual_job_id, 1, count=3)
    benchmark_id = benchmark_id_for(actual_job_id, 1)
    claimed = store.claim()
    assert claimed is not None
    assert claimed[0] == actual_job_id
    attempt = claimed[1]
    for completed in range(1, 5):
        assert store.progress(
            actual_job_id,
            attempt,
            completed=completed,
            total=4,
            stage="benchmark",
        )

    outcomes = [
        {
            "schema_version": "tda_benchmark_profile_outcome_v1",
            "profile_id": profile_id,
            "status": "completed",
            "artifact_available": True,
            "error": None,
        }
        for profile_id in BENCHMARK_PROFILES[:3]
    ]
    outcomes.append(
        {
            "schema_version": "tda_benchmark_profile_outcome_v1",
            "profile_id": "qwen-quality",
            "status": "failed",
            "artifact_available": False,
            "error": {
                "code": "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
                "recoverable": True,
                "scope": "profile",
            },
        }
    )
    partial = {
        "schema_version": "tda_processing_benchmark_v2",
        "kind": "benchmark.craig",
        "job_id": actual_job_id,
        "campaign_id": "benchmark-local",
        "session_id": "benchmark-local",
        "source_id": SOURCE_ID,
        "source_sha256": SOURCE_SHA,
        "benchmark_id": benchmark_id,
        "sample_identity_sha256": sample_identity,
        "sample_seconds": 300.0,
        "execution_mode": "prepared_artifacts_fresh_worker_per_profile_v1",
        "outcome": "partial",
        "attempted_count": 4,
        "completed_count": 3,
        "failed_count": 1,
        "track_count": 1,
        "audio_work_seconds": 300.0,
        "prepared": True,
        "bundle_manifest_sha256": None,
        "bundle_size_bytes": None,
        "profiles": receipts,
        "profile_outcomes": outcomes,
    }
    assert store.complete_partial_benchmark(actual_job_id, attempt, partial)

    token = "s" * 43
    origin = "https://panel.example"
    app = create_app(data_root, token, {origin}, run_worker=False)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        session_response = client.post(
            "/api/v1/session",
            headers={"Origin": origin, "Content-Type": "application/json"},
            json={},
        )
        browser_token = session_response.json()["token"]
        headers = {
            "Origin": origin,
            "Authorization": f"Bearer {browser_token}",
        }

        result = client.get(f"/api/v1/jobs/{actual_job_id}/result", headers=headers)
        assert result.status_code == 200
        assert result.json()["outcome"] == "partial"
        assert result.json()["bundle_manifest_sha256"] is None

        transcript = (
            benchmark_root(data_root, benchmark_id)
            / "profiles"
            / "whisper-detailed"
            / "transcript.json"
        )
        payload = bytearray(transcript.read_bytes())
        payload[-2] = payload[-2] ^ 1
        transcript.write_bytes(payload)

        corrupted = client.get(
            f"/api/v1/jobs/{actual_job_id}/result",
            headers=headers,
        )
        assert corrupted.status_code == 409
        assert corrupted.json()["error"]["code"] == "RESULT_ARTIFACT_UNAVAILABLE"


def test_benchmark_content_endpoints_are_authenticated_lazy_and_profile_scoped(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    bundle = _finalize(data_root)
    benchmark_id = bundle["benchmark_id"]
    token = "s" * 43
    origin = "https://panel.example"
    app = create_app(data_root, token, {origin}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        unauthorized = client.get(f"/api/v1/benchmarks/{benchmark_id}")
        assert unauthorized.status_code == 401

        session_response = client.post(
            "/api/v1/session",
            headers={"Origin": origin, "Content-Type": "application/json"},
            json={},
        )
        assert session_response.status_code == 200
        browser_token = session_response.json()["token"]
        headers = {
            "Origin": origin,
            "Authorization": f"Bearer {browser_token}",
        }

        metadata = client.get(
            f"/api/v1/benchmarks/{benchmark_id}",
            headers=headers,
        )
        assert metadata.status_code == 200
        assert metadata.json()["bundle_manifest_sha256"] == bundle["bundle_manifest_sha256"]
        assert "Alice" not in metadata.text
        assert "segments" not in metadata.text

        qwen = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/qwen-fast/transcript",
            headers=headers,
        )
        assert qwen.status_code == 200
        assert qwen.headers["cache-control"] == "no-store"
        assert qwen.json()["engine"]["profile"] == "qwen-fast"

        whisper = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/whisper-turbo/transcript",
            headers=headers,
        )
        assert whisper.status_code == 200
        assert whisper.json()["engine"]["profile"] == "whisper-turbo"
        assert qwen.content != whisper.content
