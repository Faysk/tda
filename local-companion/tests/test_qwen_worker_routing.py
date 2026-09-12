from __future__ import annotations

from pathlib import Path

import pytest

import tda_companion.worker_supervisor as supervisor_module
from tda_companion.worker_protocol import WorkerRunCommand
from tda_companion.worker_supervisor import WorkerOutcome, WorkerProcessError, WorkerSupervisor


class CapturingSupervisor(WorkerSupervisor):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.process_command: list[str] | None = None
        self.command: WorkerRunCommand | None = None

    def _run_command(self, command, *, on_progress, on_event=None, is_cancelled=None, process_command=None):
        self.command = command
        self.process_command = process_command
        return WorkerOutcome(terminal="result", payload={"ok": True}, returncode=0)


def _run(supervisor: WorkerSupervisor, *, profile_id: str):
    return supervisor.run_craig(
        job_id="job-qwen",
        attempt=1,
        source_id="source-id",
        profile_id=profile_id,
        glossary="Yuhara",
        context="mesa",
        cpu=False,
        on_progress=lambda _message: None,
    )


def test_qwen_profile_uses_isolated_runtime_worker(monkeypatch, tmp_path: Path):
    worker = tmp_path / "Runtime" / "qwen" / "1.0.0" / "TDAQwenWorker.exe"
    worker.parent.mkdir(parents=True)
    worker.write_bytes(b"worker")
    monkeypatch.setattr(supervisor_module, "current_qwen_worker", lambda _root: worker)

    supervisor = CapturingSupervisor(
        data_root=tmp_path / "Data",
        models_root=tmp_path / "Models",
        runtime_root=tmp_path / "Runtime",
    )
    outcome = _run(supervisor, profile_id="qwen-fast")

    assert outcome.terminal == "result"
    assert supervisor.process_command == [str(worker)]
    assert supervisor.command is not None
    assert supervisor.command.payload["profile_id"] == "qwen-fast"


def test_qwen_profile_never_falls_back_to_agent_python_when_runtime_missing(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(supervisor_module, "current_qwen_worker", lambda _root: None)
    supervisor = CapturingSupervisor(
        data_root=tmp_path / "Data",
        models_root=tmp_path / "Models",
        runtime_root=tmp_path / "Runtime",
    )

    with pytest.raises(WorkerProcessError, match="QWEN_RUNTIME_UNAVAILABLE"):
        _run(supervisor, profile_id="qwen-quality")
    assert supervisor.command is None


def test_qwen_profile_requires_runtime_root_even_in_development(tmp_path: Path):
    supervisor = CapturingSupervisor(
        data_root=tmp_path / "Data",
        models_root=tmp_path / "Models",
    )

    with pytest.raises(WorkerProcessError, match="QWEN_RUNTIME_UNCONFIGURED"):
        _run(supervisor, profile_id="qwen-fast")
    assert supervisor.command is None
