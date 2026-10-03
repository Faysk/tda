from __future__ import annotations

import pytest

from tda_companion.benchmark_bundles import benchmark_id_for
from tda_companion.store import Store
from tda_companion.worker_protocol import WorkerProtocolError, WorkerRunCommand
from tda_companion.worker_supervisor import WorkerOutcome, WorkerProcessError, WorkerSupervisor


def test_benchmark_idempotency_reuses_ambiguous_retry_but_allows_a_new_deliberate_run(tmp_path):
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
        "sample_identity_sha256": "b" * 64,
        "track_count": 1,
        "audio_work_seconds": 300.0,
        "profiles": [
            "whisper-turbo",
            "whisper-detailed",
            "qwen-fast",
            "qwen-quality",
        ],
        "prepared": True,
    }

    first = store.submit("benchmark-intent-1", body)
    replay = store.submit("benchmark-intent-1", body)
    second = store.submit("benchmark-intent-2", body)

    assert replay["id"] == first["id"]
    assert second["id"] != first["id"]


def test_benchmark_worker_command_requires_exact_five_minute_sample():
    command = WorkerRunCommand(
        job_id="benchmark-profile",
        attempt=1,
        kind="transcription.craig",
        payload={
            "source_id": "craig-" + "a" * 64,
            "profile_id": "qwen-fast",
            "glossary": "",
            "context": "",
            "cpu": False,
            "benchmark_mode": True,
            "benchmark_sample_seconds": 300.0,
        },
    )
    assert WorkerRunCommand.decode(command.encode()) == command

    for value in (None, 299.0, 301.0, True, float("inf")):
        payload = dict(command.payload)
        payload["benchmark_sample_seconds"] = value
        with pytest.raises(
            WorkerProtocolError,
            match="WORKER_BENCHMARK_SAMPLE_INVALID",
        ):
            WorkerRunCommand(
                job_id="benchmark-profile",
                attempt=1,
                kind="transcription.craig",
                payload=payload,
            ).encode()


def _profile_receipt(profile_id: str) -> dict:
    engine = "whisper" if profile_id.startswith("whisper-") else "qwen3"
    return {
        "kind": "benchmark.profile",
        "schema_version": "tda_benchmark_profile_v1",
        "benchmark_id": benchmark_id_for("benchmark-job", 1),
        "sample_identity_sha256": "b" * 64,
        "transcript_sha256": "c" * 64,
        "transcript_size_bytes": 4096,
        "artifact_available": True,
        "profile_id": profile_id,
        "engine": engine,
        "model": "model",
        "model_revision": "revision",
        "device": "cuda",
        "compute_type": "float16",
        "alignment": "native",
        "sample_seconds": 300.0,
        "audio_work_seconds": 300.0,
        "session_duration_seconds": 300.0,
        "processing_timing_version": "engine_processing_v1",
        "processing_seconds": 30.0,
        "rtf": 0.1,
        "word_count": 10,
        "segment_count": 2,
        "track_count": 1,
        "warning_count": 0,
        "execution_lineage": {
            "schema_version": "tda_execution_lineage_v1",
            "runtime_family": "whisper" if engine == "whisper" else "qwen",
            "runtime_version": "1.1.7" if engine == "whisper" else "1.0.12",
            "runtime_artifact": {
                "runtime_id": "whisper-ctranslate2" if engine == "whisper" else "qwen3-transformers",
                "version": "1.1.7" if engine == "whisper" else "1.0.12",
                "worker_sha256": "a" * 64,
                "archive_sha256": "b" * 64,
            },
            "device": "cuda:0",
            "gpu": {
                "vendor": "NVIDIA",
                "model": "NVIDIA GeForce RTX 4070 Laptop GPU",
            },
        },
    }


def test_benchmark_runs_canonical_profiles_in_order_and_emits_profile_progress(
    monkeypatch,
):
    supervisor = WorkerSupervisor()
    seen: list[tuple[str, float | None]] = []
    progress: list[int] = []

    def fake_run_craig(self, *, profile_id, benchmark_sample_seconds=None, **_kwargs):
        seen.append((profile_id, benchmark_sample_seconds))
        return WorkerOutcome(
            terminal="result",
            payload=_profile_receipt(profile_id),
            returncode=0,
        )

    monkeypatch.setattr(WorkerSupervisor, "run_craig", fake_run_craig)

    outcome = supervisor.run_benchmark(
        job_id="benchmark-job",
        attempt=1,
        source_id="craig-" + "a" * 64,
        glossary="",
        context="",
        sample_identity_sha256="b" * 64,
        sample_seconds=300.0,
        on_progress=lambda message: progress.append(message.payload["completed"]),
    )

    assert outcome.terminal == "result"
    assert seen == [
        ("whisper-turbo", 300.0),
        ("whisper-detailed", 300.0),
        ("qwen-fast", 300.0),
        ("qwen-quality", 300.0),
    ]
    assert progress == [1, 2, 3, 4]
    assert [item["profile_id"] for item in outcome.payload["profiles"]] == [
        "whisper-turbo",
        "whisper-detailed",
        "qwen-fast",
        "qwen-quality",
    ]


def test_benchmark_stops_without_complete_receipt_on_cancel(monkeypatch):
    supervisor = WorkerSupervisor()
    calls = 0

    def fake_run_craig(self, *, profile_id, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            return WorkerOutcome(
                terminal="cancelled",
                payload={"stage": "benchmark", "forced": False},
                returncode=0,
            )
        return WorkerOutcome(
            terminal="result",
            payload=_profile_receipt(profile_id),
            returncode=0,
        )

    monkeypatch.setattr(WorkerSupervisor, "run_craig", fake_run_craig)

    outcome = supervisor.run_benchmark(
        job_id="benchmark-job",
        attempt=1,
        source_id="craig-" + "a" * 64,
        glossary="",
        context="",
        sample_identity_sha256="b" * 64,
        sample_seconds=300.0,
        on_progress=lambda _message: None,
    )

    assert outcome.terminal == "cancelled"
    assert calls == 2


def test_benchmark_rejects_non_benchmark_profile_result(monkeypatch):
    supervisor = WorkerSupervisor()

    monkeypatch.setattr(
        WorkerSupervisor,
        "run_craig",
        lambda *_args, **_kwargs: WorkerOutcome(
            terminal="result",
            payload={"schema_version": "tda_transcript_v1"},
            returncode=0,
        ),
    )

    with pytest.raises(
        WorkerProcessError,
        match="BENCHMARK_PROFILE_RESULT_INVALID",
    ):
        supervisor.run_benchmark(
            job_id="benchmark-job",
            attempt=1,
            source_id="craig-" + "a" * 64,
            glossary="",
            context="",
            sample_identity_sha256="b" * 64,
            sample_seconds=300.0,
            on_progress=lambda _message: None,
        )

def test_benchmark_rejects_profile_without_exact_runtime_gpu_evidence(monkeypatch):
    supervisor = WorkerSupervisor()

    def fake_run_craig(self, *, profile_id, **_kwargs):
        receipt = _profile_receipt(profile_id)
        receipt["execution_lineage"]["runtime_artifact"]["archive_sha256"] = None
        receipt["execution_lineage"]["gpu"] = None
        return WorkerOutcome(terminal="result", payload=receipt, returncode=0)

    monkeypatch.setattr(WorkerSupervisor, "run_craig", fake_run_craig)

    with pytest.raises(
        WorkerProcessError,
        match="BENCHMARK_PROFILE_EVIDENCE_INVALID",
    ):
        supervisor.run_benchmark(
            job_id="benchmark-job",
            attempt=1,
            source_id="craig-" + "a" * 64,
            glossary="",
            context="",
            sample_identity_sha256="b" * 64,
            sample_seconds=300.0,
            on_progress=lambda _message: None,
        )

