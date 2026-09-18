from __future__ import annotations

from pathlib import Path

import tda_companion.worker_supervisor as worker_supervisor
from tda_companion.worker_supervisor import WorkerOutcome, WorkerSupervisor


def test_qwen_job_dispatch_trusts_sealed_gate_without_full_model_rehash(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    runtime_root = tmp_path / "Runtime"
    state_root = tmp_path / "State"
    for root in (data_root, models_root, runtime_root, state_root):
        root.mkdir(parents=True, exist_ok=True)

    worker = tmp_path / "TDAQwenWorker.exe"
    worker.write_bytes(b"worker")

    observed: dict[str, object] = {}

    def inspect_gate(state, runtime, models, *, profile_id, verify_model_content=False):  # noqa: ANN001
        observed["state_root"] = Path(state)
        observed["runtime_root"] = Path(runtime)
        observed["models_root"] = Path(models)
        observed["profile_id"] = profile_id
        observed["verify_model_content"] = verify_model_content
        return {"ready": True, "status": "ready", "profile_id": profile_id}

    monkeypatch.setattr(worker_supervisor, "inspect_qwen_physical_gate", inspect_gate)

    def locate_worker(_root, *, verify_worker=False):  # noqa: ANN001
        observed["verify_worker"] = verify_worker
        return worker

    monkeypatch.setattr(worker_supervisor, "current_qwen_worker", locate_worker)

    supervisor = WorkerSupervisor(
        data_root=data_root,
        models_root=models_root,
        runtime_root=runtime_root,
        state_root=state_root,
    )

    def fake_run(command, **kwargs):  # noqa: ANN001, ANN003
        observed["process_command"] = kwargs["process_command"]
        observed["kind"] = command.kind
        return WorkerOutcome(terminal="cancelled", payload={}, returncode=0)

    monkeypatch.setattr(supervisor, "_run_command", fake_run)

    outcome = supervisor.run_craig(
        job_id="job",
        attempt=1,
        source_id="craig-source",
        profile_id="qwen-quality",
        glossary="",
        context="",
        cpu=False,
        on_progress=lambda _message: None,
        on_event=lambda _message: None,
        is_cancelled=lambda: False,
    )

    assert outcome.terminal == "cancelled"
    assert observed["kind"] == "transcription.craig"
    assert observed["profile_id"] == "qwen-quality"
    assert observed["verify_model_content"] is False
    assert observed["verify_worker"] is False
    assert observed["process_command"] == [str(worker)]


def test_qwen_job_dispatch_rejects_stale_sealed_gate(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    runtime_root = tmp_path / "Runtime"
    state_root = tmp_path / "State"
    for root in (data_root, models_root, runtime_root, state_root):
        root.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        worker_supervisor,
        "inspect_qwen_physical_gate",
        lambda *_args, **_kwargs: {
            "ready": False,
            "status": "stale",
            "profile_id": "qwen-quality",
            "reason": "QWEN_GATE_BINDING_CHANGED",
        },
    )

    supervisor = WorkerSupervisor(
        data_root=data_root,
        models_root=models_root,
        runtime_root=runtime_root,
        state_root=state_root,
    )

    try:
        supervisor.run_craig(
            job_id="job",
            attempt=1,
            source_id="craig-source",
            profile_id="qwen-quality",
            glossary="",
            context="",
            cpu=False,
            on_progress=lambda _message: None,
        )
    except worker_supervisor.WorkerProcessError as exc:
        assert exc.code == "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED"
    else:
        raise AssertionError("stale Qwen gate was accepted")
