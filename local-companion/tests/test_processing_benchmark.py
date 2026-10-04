from __future__ import annotations

import pytest

from tda_companion.api import _benchmark_partial_result_valid
from tda_companion.benchmark_bundles import BENCHMARK_PROFILES, benchmark_id_for
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
            "runtime_version": "1.1.10" if engine == "whisper" else "1.0.18",
            "runtime_artifact": {
                "runtime_id": "whisper-ctranslate2" if engine == "whisper" else "qwen3-transformers",
                "version": "1.1.10" if engine == "whisper" else "1.0.18",
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

def test_benchmark_rejects_profile_from_pre_evidence_runtime(monkeypatch):
    supervisor = WorkerSupervisor()

    def fake_run_craig(self, *, profile_id, **_kwargs):
        receipt = _profile_receipt(profile_id)
        lineage = receipt["execution_lineage"]
        stale = "1.1.9" if profile_id.startswith("whisper-") else "1.0.17"
        lineage["runtime_version"] = stale
        lineage["runtime_artifact"]["version"] = stale
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

@pytest.mark.parametrize("failure_index", range(4))
def test_benchmark_continues_after_allowlisted_profile_local_failure(
    monkeypatch,
    failure_index,
):
    supervisor = WorkerSupervisor()
    seen: list[str] = []
    progress: list[int] = []
    failed_profile = BENCHMARK_PROFILES[failure_index]

    def fake_run_craig(self, *, profile_id, **_kwargs):
        seen.append(profile_id)
        if profile_id == failed_profile:
            raise WorkerProcessError(
                "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
                recoverable=True,
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
        on_progress=lambda message: progress.append(message.payload["completed"]),
    )

    assert outcome.terminal == "partial"
    assert outcome.payload["schema_version"] == "tda_processing_benchmark_partial_v1"
    assert outcome.payload["status"] == "partial"
    assert seen == list(BENCHMARK_PROFILES)
    assert progress == [1, 2, 3, 4]
    assert outcome.payload["attempted_count"] == 4
    assert outcome.payload["completed_count"] == 3
    assert outcome.payload["failed_count"] == 1

    statuses = [item["status"] for item in outcome.payload["profiles"]]
    assert statuses[failure_index] == "failed"
    assert statuses.count("completed") == 3
    failed = outcome.payload["profiles"][failure_index]
    assert failed == {
        "profile_id": failed_profile,
        "status": "failed",
        "error": {
            "code": "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
            "recoverable": True,
            "scope": "profile",
        },
        "artifact_available": False,
        "continuation": {
            "decision": "continue",
            "reason": "profile_local_allowlist",
        },
    }
    for index, item in enumerate(outcome.payload["profiles"]):
        if index == failure_index:
            continue
        assert item["artifact_available"] is True
        assert item["receipt"]["profile_id"] == BENCHMARK_PROFILES[index]


def test_benchmark_represents_multiple_profile_local_failures_independently(monkeypatch):
    supervisor = WorkerSupervisor()
    progress: list[int] = []

    def fake_run_craig(self, *, profile_id, **_kwargs):
        if profile_id in {"qwen-fast", "qwen-quality"}:
            raise WorkerProcessError(
                "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
                recoverable=True,
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
        on_progress=lambda message: progress.append(message.payload["completed"]),
    )

    assert outcome.terminal == "partial"
    assert progress == [1, 2, 3, 4]
    assert outcome.payload["attempted_count"] == 4
    assert outcome.payload["completed_count"] == 2
    assert outcome.payload["failed_count"] == 2
    assert [item["status"] for item in outcome.payload["profiles"]] == [
        "completed",
        "completed",
        "failed",
        "failed",
    ]


def test_benchmark_unknown_recoverable_failure_remains_benchmark_global(monkeypatch):
    supervisor = WorkerSupervisor()
    seen: list[str] = []

    def fake_run_craig(self, *, profile_id, **_kwargs):
        seen.append(profile_id)
        if profile_id == "qwen-fast":
            raise WorkerProcessError("QWEN_ASR_INFERENCE_FAILED", recoverable=True)
        return WorkerOutcome(
            terminal="result",
            payload=_profile_receipt(profile_id),
            returncode=0,
        )

    monkeypatch.setattr(WorkerSupervisor, "run_craig", fake_run_craig)

    with pytest.raises(WorkerProcessError, match="QWEN_ASR_INFERENCE_FAILED"):
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

    assert seen == ["whisper-turbo", "whisper-detailed", "qwen-fast"]


def _benchmark_body() -> dict:
    return {
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
        "profiles": list(BENCHMARK_PROFILES),
        "prepared": True,
    }


def _partial_result() -> dict:
    profiles = []
    for profile_id in BENCHMARK_PROFILES:
        if profile_id == "qwen-fast":
            profiles.append(
                {
                    "profile_id": profile_id,
                    "status": "failed",
                    "error": {
                        "code": "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
                        "recoverable": True,
                        "scope": "profile",
                    },
                    "artifact_available": False,
                    "continuation": {
                        "decision": "continue",
                        "reason": "profile_local_allowlist",
                    },
                }
            )
        else:
            profiles.append(
                {
                    "profile_id": profile_id,
                    "status": "completed",
                    "receipt": _profile_receipt(profile_id),
                    "artifact_available": True,
                }
            )
    return {
        "schema_version": "tda_processing_benchmark_partial_v1",
        "kind": "benchmark.craig",
        "status": "partial",
        "source_id": "craig-" + "a" * 64,
        "benchmark_id": benchmark_id_for("benchmark-job", 1),
        "sample_identity_sha256": "b" * 64,
        "sample_seconds": 300.0,
        "execution_mode": "prepared_artifacts_fresh_worker_per_profile_v1",
        "attempted_count": 4,
        "completed_count": 3,
        "failed_count": 1,
        "profiles": profiles,
    }


def test_partial_benchmark_api_contract_rejects_impossible_profile_shapes():
    body = _benchmark_body()
    value = _partial_result()
    assert _benchmark_partial_result_valid(
        value,
        body,
        job_id="benchmark-job",
        attempt=1,
    )

    duplicate = {**value, "profiles": [*value["profiles"]]}
    duplicate["profiles"][3] = {
        **duplicate["profiles"][3],
        "profile_id": "qwen-fast",
    }
    assert not _benchmark_partial_result_valid(
        duplicate,
        body,
        job_id="benchmark-job",
        attempt=1,
    )

    fake_completed = {**value, "profiles": [dict(item) for item in value["profiles"]]}
    fake_completed["profiles"][2] = {
        "profile_id": "qwen-fast",
        "status": "completed",
        "artifact_available": False,
        "receipt": _profile_receipt("qwen-fast"),
    }
    assert not _benchmark_partial_result_valid(
        fake_completed,
        body,
        job_id="benchmark-job",
        attempt=1,
    )


def test_store_persists_partial_benchmark_as_failed_result_without_retry_alias(tmp_path):
    store = Store(tmp_path)
    body = _benchmark_body()
    queued = store.submit("benchmark-partial-intent", body)
    claimed = store.claim()
    assert claimed is not None
    job_id, attempt = claimed
    assert job_id == queued["id"]
    assert attempt == 1

    for completed in range(1, 5):
        assert store.progress(
            job_id,
            attempt,
            completed=completed,
            total=4,
            stage="benchmark",
        )

    result = {
        **_partial_result(),
        "job_id": job_id,
        "campaign_id": body["campaign_id"],
        "session_id": body["session_id"],
        "track_count": body["track_count"],
        "audio_work_seconds": body["audio_work_seconds"],
        "prepared": True,
        "benchmark_id": benchmark_id_for(job_id, attempt),
        "bundle_manifest_sha256": None,
        "bundle_size_bytes": None,
    }
    for item in result["profiles"]:
        if item["status"] == "completed":
            item["receipt"] = {
                **item["receipt"],
                "benchmark_id": benchmark_id_for(job_id, attempt),
            }

    assert store.complete_partial_benchmark(job_id, attempt, result)
    state = store.get(job_id)
    assert state["status"] == "failed"
    assert state["stage"] == "benchmark_partial"
    assert state["progress"] == {"completed": 4, "total": 4, "unit": "profiles"}
    assert state["error"] == {"code": "BENCHMARK_PARTIAL", "recoverable": False}
    assert state["result_available"] is True
    assert store.result(job_id) == result

    with pytest.raises(Exception, match="JOB_NOT_RETRYABLE"):
        store.action(job_id, "retry")

