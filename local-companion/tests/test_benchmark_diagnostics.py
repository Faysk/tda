from __future__ import annotations

import json
import time
from types import SimpleNamespace

import pytest

import tda_companion.benchmark_diagnostics as benchmark_diagnostics_module
from tda_companion.atomic_storage import AtomicStorageError
from tda_companion.benchmark_diagnostics import (
    BenchmarkProfileDiagnostics,
    build_worker_benchmark_diagnostics,
)
from tda_companion.benchmark_bundles import benchmark_id_for
from tda_companion.engine_metrics import STAGES
from tda_companion.worker_protocol import WorkerMessage
from tda_companion.worker_supervisor import WorkerOutcome, WorkerSupervisor


SOURCE_ID = "craig-" + "a" * 64
SAMPLE_SHA = "b" * 64
GPU_UUID = "GPU-11111111-1111-1111-1111-111111111111"
OTHER_GPU_UUID = "GPU-22222222-2222-2222-2222-222222222222"
RUNTIME_ARTIFACT = {
    "runtime_id": "whisper-ctranslate2",
    "version": "1.1.10",
    "worker_sha256": "c" * 64,
    "archive_sha256": "d" * 64,
}


def _processing_metrics(total: float = 30.0) -> dict:
    stage_values = {
        "runtime_validation": 1.0,
        "checkpoint_scan": 1.0,
        "model_prepare": 2.0,
        "model_load": 4.0,
        "transcription": 18.0,
        "alignment_and_energy": 3.0,
        "consolidation": 1.0,
    }
    assert set(stage_values) == set(STAGES)
    assert sum(stage_values.values()) == total
    return {
        "version": "engine_processing_v1",
        "stage_seconds": stage_values,
        "total_processing_seconds": total,
        "external_preparation_included": False,
        "total_tracks": 1,
        "fresh_asr_tracks": 1,
        "text_checkpoint_reused_tracks": 0,
        "completed_checkpoint_reused_tracks": 0,
        "fresh_audio_work_seconds": 300.0,
        "reused_audio_work_seconds": 0.0,
        "fresh_calibration_eligible": True,
    }


def _lineage(*, qwen: bool = False) -> dict:
    artifact = {
        **RUNTIME_ARTIFACT,
        "runtime_id": "qwen3-transformers" if qwen else "whisper-ctranslate2",
        "version": "1.0.19" if qwen else "1.1.10",
    }
    return {
        "schema_version": "tda_execution_lineage_v1",
        "companion_version": "0.3.18",
        "runtime_family": "qwen" if qwen else "whisper",
        "runtime_version": artifact["version"],
        "runtime_artifact": artifact,
        "device": "cuda:0",
        "execution_device": {
            "kind": "cuda",
            "logical_index": 0,
            "physical_uuid": GPU_UUID,
            "pci_bus_id": "00000000:02:00.0",
        },
        "compute_type": "float16",
        "gpu": {
            "vendor": "NVIDIA",
            "index": 1,
            "logical_index": 0,
            "uuid": GPU_UUID,
            "pci_bus_id": "00000000:02:00.0",
            "model": "NVIDIA Test GPU",
            "vram_total_bytes": 8 * 1024**3,
            "compute_capability": "8.9",
            "driver_version": "600.12",
        },
    }


def _receipt(profile_id: str = "whisper-turbo") -> dict:
    qwen = profile_id.startswith("qwen-")
    return {
        "kind": "benchmark.profile",
        "schema_version": "tda_benchmark_profile_v1",
        "benchmark_id": benchmark_id_for("benchmark-job", 1),
        "sample_identity_sha256": SAMPLE_SHA,
        "transcript_sha256": "e" * 64,
        "transcript_size_bytes": 1024,
        "artifact_available": True,
        "profile_id": profile_id,
        "engine": "qwen3" if qwen else "whisper",
        "model": "safe/model",
        "model_revision": "revision-1",
        "device": "cuda:0",
        "compute_type": "float16",
        "alignment": "native",
        "sample_seconds": 300.0,
        "audio_work_seconds": 300.0,
        "session_duration_seconds": 300.0,
        "processing_timing_version": "engine_processing_v1",
        "processing_seconds": 30.0,
        "rtf": 0.1,
        "word_count": 100,
        "segment_count": 10,
        "track_count": 1,
        "warning_count": 1,
        "execution_lineage": _lineage(qwen=qwen),
    }


def _worker_diagnostics() -> dict:
    return {
        "schema_version": "tda_benchmark_worker_diagnostics_v1",
        "processing_metrics": _processing_metrics(),
        "counts": {
            "track_count": 1,
            "word_count": 100,
            "segment_count": 10,
            "turn_count": 8,
            "deduplicated_segment_count": 2,
            "warning_count": 1,
        },
        "warning_codes": ["WHISPER_GPU_MEMORY_FALLBACK"],
        "package_versions": {
            "faster-whisper": "1.2.1",
            "ctranslate2": "4.8.2",
        },
    }


def _message(seq: int, type_name: str, payload: dict | None = None) -> WorkerMessage:
    value = WorkerMessage.create(
        job_id="benchmark-job",
        attempt=1,
        seq=seq,
        type=type_name,
        payload=payload or {},
    )
    value.validate()
    return value


def _diagnostics(tmp_path, *, enable_telemetry: bool = False, clock=None):
    return BenchmarkProfileDiagnostics(
        data_root=tmp_path / "Data",
        job_id="benchmark-job",
        attempt=1,
        source_id=SOURCE_ID,
        profile_id="whisper-turbo",
        sample_identity_sha256=SAMPLE_SHA,
        sample_seconds=300.0,
        context="contexto privado que nunca deve persistir em claro",
        glossary="glossário privado que nunca deve persistir em claro",
        enable_telemetry=enable_telemetry,
        clock=clock or time.monotonic,
    )


def _read_jsonl(path):
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_completed_profile_persists_full_metrics_events_and_physical_gpu_telemetry(tmp_path):
    clock_value = [0.0]
    diagnostics = _diagnostics(tmp_path, clock=lambda: clock_value[0])
    diagnostics.bind_runtime_artifact(RUNTIME_ARTIFACT)

    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    clock_value[0] = 0.1
    diagnostics.observe_message(
        _message(1, "stage", {"stage": "model_load", "profile": "whisper-turbo"})
    )
    clock_value[0] = 0.2
    diagnostics.observe_message(
        _message(
            2,
            "event",
            {
                "code": "ASR_EXECUTION_DEVICE",
                "stage": "model_load",
                "device": "cuda:0",
                "kind": "cuda",
                "logical_index": 0,
                "physical_uuid": GPU_UUID,
                "pci_bus_id": "00000000:02:00.0",
            },
        )
    )
    diagnostics.record_telemetry_snapshot(
        {
            "host": {"os": "private-host", "cpu": "private-cpu"},
            "cpu": {"utilization_percent": 20.0},
            "memory": {"used_bytes": 1000, "total_bytes": 4000, "percent": 25.0},
            "gpus": [
                {
                    "index": 0,
                    "uuid": OTHER_GPU_UUID,
                    "pci_bus_id": "00000000:01:00.0",
                    "name": "Wrong GPU",
                    "utilization_percent": 99,
                    "memory_used_bytes": 999,
                    "memory_total_bytes": 2000,
                },
                {
                    "index": 1,
                    "uuid": GPU_UUID,
                    "pci_bus_id": "00000000:02:00.0",
                    "name": "NVIDIA Test GPU",
                    "utilization_percent": 20,
                    "memory_used_bytes": 100,
                    "memory_total_bytes": 8000,
                },
            ],
        },
        relative_ms=250,
    )
    diagnostics.record_telemetry_snapshot(
        {
            "cpu": {"utilization_percent": 40.0},
            "memory": {"used_bytes": 2000, "total_bytes": 4000, "percent": 50.0},
            "gpus": [
                {
                    "index": 0,
                    "uuid": OTHER_GPU_UUID,
                    "pci_bus_id": "00000000:01:00.0",
                    "name": "Wrong GPU",
                    "utilization_percent": 1,
                    "memory_used_bytes": 1,
                    "memory_total_bytes": 2000,
                },
                {
                    "index": 1,
                    "uuid": GPU_UUID,
                    "pci_bus_id": "00000000:02:00.0",
                    "name": "NVIDIA Test GPU",
                    "utilization_percent": 60,
                    "memory_used_bytes": 300,
                    "memory_total_bytes": 8000,
                },
            ],
        },
        relative_ms=900,
    )
    clock_value[0] = 1.0
    diagnostics.observe_message(_message(3, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )

    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    events = _read_jsonl(diagnostics.profile_root / "events.jsonl")
    telemetry = _read_jsonl(diagnostics.profile_root / "telemetry.jsonl")

    assert metrics["schema_version"] == "tda_benchmark_metrics_v1"
    assert metrics["status"] == "completed"
    assert metrics["processing_timing_version"] == "engine_processing_v1"
    assert metrics["stage_seconds"] == _processing_metrics()["stage_seconds"]
    assert metrics["total_processing_seconds"] == 30.0
    assert metrics["rtf"] == 0.1
    assert metrics["realtime_factor"] == {
        "value": 10.0,
        "derived": True,
        "source": "rtf",
    }
    assert metrics["counts"] == _worker_diagnostics()["counts"]
    assert metrics["warning_codes"] == ["WHISPER_GPU_MEMORY_FALLBACK"]
    assert metrics["external_preparation_included"] is False
    assert metrics["work_provenance"]["fresh_asr_tracks"] == 1
    assert metrics["telemetry"]["aggregates"]["vram_peak_bytes"] == 300
    assert metrics["telemetry"]["aggregates"]["vram_average_bytes"] == 200.0
    assert metrics["telemetry"]["aggregates"]["gpu_utilization_average_percent"] == 40.0
    assert metrics["telemetry"]["aggregates"]["cpu_average_percent"] == 30.0
    assert metrics["telemetry"]["aggregates"]["ram_peak_bytes"] == 2000
    assert all(row["gpu"]["uuid"] == GPU_UUID for row in telemetry)
    assert all(row["gpu"]["model"] == "NVIDIA Test GPU" for row in telemetry)
    assert all(row["runtime_artifact"]["worker_sha256"] == "c" * 64 for row in telemetry)
    assert [row["seq"] for row in events] == list(range(len(events)))
    assert events[-1]["code"] == "PROFILE_COMPLETED"
    assert events[-1]["type"] == "result"


def test_diagnostics_privacy_allowlist_rejects_paths_tokens_identity_and_transcript_text(tmp_path):
    diagnostics = _diagnostics(tmp_path)
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(
        _message(
            1,
            "event",
            {
                "code": "QWEN_WINDOW_TRANSCRIBED",
                "stage": "transcription",
                "track": 1,
                "speaker": "renan@example.com",
                "path": r"C:\Users\Renan\private.wav",
                "unix_path": "/home/renan/private.wav",
                "authorization": "Bearer private-token",
                "cookie": "session=private",
                "token": "private-token",
                "hostname": "renan-pc",
                "username": "renan@example.com",
                "text": "este é um trecho secreto da transcrição",
                "source_filename": "1-Renan.flac",
            },
        )
    )
    hostile_receipt = _receipt()
    hostile_receipt["model"] = "alice@example.com"
    hostile_receipt["model_revision"] = r"C:\\Users\\Alice\\private-revision"
    hostile_receipt["alignment"] = "/home/alice/private-aligner"
    diagnostics.observe_message(_message(2, "result", hostile_receipt))
    diagnostics.finalize(
        status="completed",
        receipt=hostile_receipt,
        worker_diagnostics=_worker_diagnostics(),
    )

    serialized = "\n".join(
        [
            (diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"),
            (diagnostics.profile_root / "events.jsonl").read_text(encoding="utf-8"),
        ]
    )
    for forbidden in (
        "C:\\Users",
        "/home/renan",
        "private-token",
        "renan@example.com",
        "renan-pc",
        "trecho secreto",
        "1-Renan.flac",
        "contexto privado",
        "glossário privado",
    ):
        assert forbidden not in serialized
    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["context"]["characters"] > 0
    assert len(metrics["context"]["sha256"]) == 64
    assert metrics["glossary"]["characters"] > 0


def test_optional_telemetry_failure_never_fails_completed_profile(tmp_path):
    class MissingTelemetry:
        def __init__(self):
            raise RuntimeError("sensor unavailable")

    diagnostics = BenchmarkProfileDiagnostics(
        data_root=tmp_path / "Data",
        job_id="benchmark-job",
        attempt=1,
        source_id=SOURCE_ID,
        profile_id="whisper-turbo",
        sample_identity_sha256=SAMPLE_SHA,
        sample_seconds=300.0,
        context="",
        glossary="",
        telemetry_factory=MissingTelemetry,
    )
    diagnostics.start()
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(_message(1, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )

    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["status"] == "completed"
    assert metrics["telemetry"]["captured_samples"] == 0
    assert metrics["telemetry"]["missing_reason"] == "sampler_unavailable"
    assert not (diagnostics.profile_root / "telemetry.jsonl").exists()


def test_ambiguous_atomic_diagnostic_writes_confirm_matching_bytes(monkeypatch, tmp_path):
    def ambiguous_write(path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        raise AtomicStorageError("namespace_sync", True)

    monkeypatch.setattr(benchmark_diagnostics_module, "atomic_write", ambiguous_write)
    diagnostics = _diagnostics(tmp_path)
    diagnostics.record_telemetry_snapshot(
        {
            "cpu": {"utilization_percent": 10.0},
            "memory": {"used_bytes": 100, "percent": 20.0},
            "gpus": [],
        },
        relative_ms=0,
    )
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(_message(1, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )

    assert (diagnostics.profile_root / "metrics.json").is_file()
    assert (diagnostics.profile_root / "events.jsonl").is_file()
    assert (diagnostics.profile_root / "telemetry.jsonl").is_file()


def test_unconfirmed_optional_telemetry_is_removed_instead_of_bound(monkeypatch, tmp_path):
    real_atomic_write = benchmark_diagnostics_module.atomic_write

    def fail_telemetry(path, payload):
        if path.name == "telemetry.jsonl":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"unconfirmed")
            raise AtomicStorageError("namespace_sync", True)
        return real_atomic_write(path, payload)

    monkeypatch.setattr(benchmark_diagnostics_module, "atomic_write", fail_telemetry)
    diagnostics = _diagnostics(tmp_path)
    diagnostics.record_telemetry_snapshot(
        {
            "cpu": {"utilization_percent": 10.0},
            "memory": {"used_bytes": 100, "percent": 20.0},
            "gpus": [],
        },
        relative_ms=0,
    )
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(_message(1, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )

    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["telemetry"]["missing_reason"] == "telemetry_write_failed"
    assert not (diagnostics.profile_root / "telemetry.jsonl").exists()
    assert metrics["artifacts"]["telemetry"] is None


def test_failed_profile_keeps_sanitized_diagnostics_without_quality_artifact(tmp_path):
    diagnostics = _diagnostics(tmp_path)
    diagnostics.start()
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(
        _message(
            1,
            "error",
            {
                "code": "WORKER_MODEL_LOAD_TIMEOUT",
                "recoverable": True,
                "path": "/private/model",
                "text": "private transcript",
            },
        )
    )
    diagnostics.finalize(status="failed", error_code="WORKER_MODEL_LOAD_TIMEOUT")

    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    events = _read_jsonl(diagnostics.profile_root / "events.jsonl")
    assert metrics["status"] == "failed"
    assert metrics["processing_timing_version"] is None
    assert metrics["error_code"] == "WORKER_MODEL_LOAD_TIMEOUT"
    assert events[-1]["code"] == "WORKER_MODEL_LOAD_TIMEOUT"
    assert events[-1]["type"] == "error"
    assert not (diagnostics.profile_root / "transcript.json").exists()
    assert not (diagnostics.profile_root / "profile.json").exists()
    assert "/private/model" not in (diagnostics.profile_root / "events.jsonl").read_text(
        encoding="utf-8"
    )


def test_progress_volume_is_bounded_and_auditable(tmp_path):
    diagnostics = _diagnostics(tmp_path)
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    started = time.perf_counter()
    for sample in range(315):
        diagnostics.record_telemetry_snapshot(
            {
                "cpu": {"utilization_percent": 25.0},
                "memory": {"used_bytes": 1024, "percent": 10.0},
                "gpus": [],
            },
            relative_ms=sample * 1000,
        )
    for seq in range(1, 2001):
        diagnostics.observe_message(
            _message(
                seq,
                "progress",
                {
                    "completed": min(seq, 300),
                    "total": 300,
                    "unit": "seconds",
                    "stage": "transcription",
                },
            )
        )
    capture_seconds = time.perf_counter() - started
    diagnostics.observe_message(_message(2001, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )

    events = _read_jsonl(diagnostics.profile_root / "events.jsonl")
    aggregate = next(row for row in events if row["code"] == "BENCHMARK_EVENT_AGGREGATE")
    assert aggregate["data"]["count"] == 2000
    assert aggregate["data"]["first_worker_seq"] == 1
    assert aggregate["data"]["last_worker_seq"] == 2000
    assert len(events) <= 3
    assert (diagnostics.profile_root / "events.jsonl").stat().st_size < 32 * 1024
    # The synthetic no-model fixture includes 315 telemetry insertions plus 2,000
    # protocol observations. 1.5 s is 0.5% of the fixed 300 s benchmark window and
    # intentionally leaves generous CI headroom without measuring model/GPU work.
    assert capture_seconds < 1.5


def test_telemetry_sample_cap_is_explicit_and_bounded(tmp_path):
    diagnostics = _diagnostics(tmp_path)
    snapshot = {
        "cpu": {"utilization_percent": 1.0},
        "memory": {"used_bytes": 1, "total_bytes": 2, "percent": 50.0},
        "gpus": [],
    }
    for index in range(1000):
        diagnostics.record_telemetry_snapshot(snapshot, relative_ms=index * 1000)
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(_message(1, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )
    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["telemetry"]["captured_samples"] == 900
    assert metrics["telemetry"]["truncated"] is True
    assert metrics["telemetry"]["missing_reason"] == "sample_limit_reached"
    assert (diagnostics.profile_root / "telemetry.jsonl").stat().st_size < 2 * 1024 * 1024


def test_telemetry_gap_records_coverage_and_missing_reason(tmp_path):
    clock_value = [0.0]
    diagnostics = _diagnostics(tmp_path, clock=lambda: clock_value[0])
    diagnostics.record_telemetry_snapshot(
        {
            "cpu": {"utilization_percent": 10.0},
            "memory": {"used_bytes": 10, "total_bytes": 100, "percent": 10.0},
            "gpus": [],
        },
        relative_ms=0,
    )
    diagnostics.record_telemetry_snapshot(
        {
            "cpu": {"utilization_percent": 20.0},
            "memory": {"used_bytes": 20, "total_bytes": 100, "percent": 20.0},
            "gpus": [],
        },
        relative_ms=2000,
    )
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    clock_value[0] = 4.1
    diagnostics.observe_message(_message(1, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )

    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    telemetry = metrics["telemetry"]
    assert telemetry["sampler"] == "system_telemetry_v1"
    assert telemetry["window"] == "profile_supervisor_v1"
    assert telemetry["interval_ms"] == 1000
    assert telemetry["expected_samples"] == 5
    assert telemetry["captured_samples"] == 2
    assert telemetry["coverage"] == 0.4
    assert telemetry["missing_reason"] == "coverage_gap"


def test_cancellation_always_leaves_terminal_marker(tmp_path):
    diagnostics = _diagnostics(tmp_path)
    diagnostics.start()
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(
        _message(1, "cancelled", {"stage": "transcription", "forced": True})
    )
    diagnostics.finalize(status="cancelled", error_code="PROFILE_CANCELLED")

    metrics = json.loads((diagnostics.profile_root / "metrics.json").read_text(encoding="utf-8"))
    events = _read_jsonl(diagnostics.profile_root / "events.jsonl")
    assert metrics["status"] == "cancelled"
    assert events[-1]["type"] == "cancelled"
    assert events[-1]["code"] == "PROFILE_CANCELLED"


def test_global_system_log_rotation_cannot_change_profile_artifacts(tmp_path):
    from tda_companion.system_log import SystemLog

    system_log = SystemLog(tmp_path / "Logs", max_bytes=1024, backups=2)
    for index in range(12):
        system_log.write(
            "info",
            "worker",
            f"UNRELATED_{index}",
            "x" * 300,
            {"path": f"/home/alice/{index}", "speaker": "alice@example.com"},
        )
    assert (tmp_path / "Logs" / "companion.log.1").exists()

    diagnostics = _diagnostics(tmp_path)
    diagnostics.observe_message(_message(0, "ready", {"kind": "transcription.craig"}))
    diagnostics.observe_message(_message(1, "result", _receipt()))
    diagnostics.finalize(
        status="completed",
        receipt=_receipt(),
        worker_diagnostics=_worker_diagnostics(),
    )
    before_events = (diagnostics.profile_root / "events.jsonl").read_bytes()
    before_metrics = (diagnostics.profile_root / "metrics.json").read_bytes()

    for index in range(12, 24):
        system_log.write(
            "warning",
            "update",
            f"UNRELATED_{index}",
            "y" * 300,
            {"authorization": "Bearer secret", "hostname": "alice-pc"},
        )

    assert (diagnostics.profile_root / "events.jsonl").read_bytes() == before_events
    assert (diagnostics.profile_root / "metrics.json").read_bytes() == before_metrics
    serialized = before_events + before_metrics
    assert b"UNRELATED_" not in serialized
    assert b"alice@example.com" not in serialized
    assert b"alice-pc" not in serialized


def test_worker_projection_keeps_warning_codes_and_counts_without_warning_payload(monkeypatch):
    import tda_companion.benchmark_diagnostics as module

    monkeypatch.setattr(module, "_runtime_package_versions", lambda _engine: {"torch": "2.9.1"})
    document = SimpleNamespace(
        stats=SimpleNamespace(
            processing_metrics=_processing_metrics(),
            track_count=1,
            word_count=100,
            segment_count=10,
            turn_count=8,
            deduplicated_segment_count=2,
        ),
        warnings=(
            "WHISPER_GPU_MEMORY_FALLBACK",
            r"custom warning:C:\Users\Renan\secret",
        ),
        engine=SimpleNamespace(engine="qwen3"),
    )
    value = build_worker_benchmark_diagnostics(document)
    serialized = json.dumps(value)
    assert value["counts"]["warning_count"] == 2
    assert value["warning_codes"] == [
        "CUSTOM_WARNING",
        "WHISPER_GPU_MEMORY_FALLBACK",
    ]
    assert "Users" not in serialized
    assert value["package_versions"] == {"torch": "2.9.1"}


def test_run_benchmark_persists_each_profile_diagnostics_and_strips_internal_payload(
    monkeypatch,
    tmp_path,
):
    import tda_companion.worker_supervisor as supervisor_module

    monkeypatch.setattr(BenchmarkProfileDiagnostics, "start", lambda self: None)
    supervisor = WorkerSupervisor(
        data_root=tmp_path / "Data",
        models_root=tmp_path / "Models",
    )

    def fake_run_craig(
        self,
        *,
        job_id,
        attempt,
        profile_id,
        on_message=None,
        on_runtime_artifact=None,
        **_kwargs,
    ):
        assert on_message is not None
        assert on_runtime_artifact is not None
        receipt = _receipt(profile_id)
        hidden = _worker_diagnostics()
        if profile_id.startswith("qwen-"):
            hidden = {
                **hidden,
                "package_versions": {"torch": "2.9.1"},
            }
        on_runtime_artifact(receipt["execution_lineage"]["runtime_artifact"])
        on_message(
            WorkerMessage.create(
                job_id=job_id,
                attempt=attempt,
                seq=0,
                type="ready",
                payload={"kind": "transcription.craig", "profile_id": profile_id},
            )
        )
        on_message(
            WorkerMessage.create(
                job_id=job_id,
                attempt=attempt,
                seq=1,
                type="stage",
                payload={"stage": "transcription", "profile": profile_id},
            )
        )
        payload = {**receipt, "benchmark_diagnostics": hidden}
        on_message(
            WorkerMessage.create(
                job_id=job_id,
                attempt=attempt,
                seq=2,
                type="result",
                payload=payload,
            )
        )
        return WorkerOutcome(terminal="result", payload=payload, returncode=0)

    monkeypatch.setattr(WorkerSupervisor, "run_craig", fake_run_craig)
    outcome = supervisor.run_benchmark(
        job_id="benchmark-job",
        attempt=1,
        source_id=SOURCE_ID,
        glossary="",
        context="",
        sample_identity_sha256=SAMPLE_SHA,
        sample_seconds=300.0,
        on_progress=lambda _message: None,
    )

    assert outcome.terminal == "result"
    assert len(outcome.payload["profiles"]) == 4
    assert all("benchmark_diagnostics" not in item for item in outcome.payload["profiles"])
    benchmark_roots = list((tmp_path / "Data" / "benchmarks").iterdir())
    assert len(benchmark_roots) == 1
    for profile_id in (
        "whisper-turbo",
        "whisper-detailed",
        "qwen-fast",
        "qwen-quality",
    ):
        root = benchmark_roots[0] / "profiles" / profile_id
        metrics = json.loads((root / "metrics.json").read_text(encoding="utf-8"))
        assert metrics["status"] == "completed"
        assert metrics["profile_id"] == profile_id
        assert (root / "events.jsonl").is_file()
        assert not (root / "transcript.json").exists()
        assert not (root / "profile.json").exists()


def test_old_receipt_path_remains_valid_when_diagnostics_storage_is_not_configured(monkeypatch):
    supervisor = WorkerSupervisor()

    def fake_run_craig(self, *, profile_id, **_kwargs):
        return WorkerOutcome(terminal="result", payload=_receipt(profile_id), returncode=0)

    monkeypatch.setattr(WorkerSupervisor, "run_craig", fake_run_craig)
    outcome = supervisor.run_benchmark(
        job_id="benchmark-job",
        attempt=1,
        source_id=SOURCE_ID,
        glossary="",
        context="",
        sample_identity_sha256=SAMPLE_SHA,
        sample_seconds=300.0,
        on_progress=lambda _message: None,
    )
    assert outcome.terminal == "result"
    assert len(outcome.payload["profiles"]) == 4
