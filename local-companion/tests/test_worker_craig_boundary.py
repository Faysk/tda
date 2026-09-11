from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import pytest

from tda_companion.craig import ingest_craig_zip
from tda_companion.worker_protocol import WorkerProtocolError
from tda_companion.worker_supervisor import WorkerProcessError, WorkerSupervisor


def _stage_craig(data_root: Path, source_id: str = "source-123") -> None:
    data_root.mkdir(parents=True, exist_ok=True)
    source = data_root.parent / "fixture.zip"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-worker-boundary")
    ingest_craig_zip(source, data_root / "staging" / source_id)


def test_supervisor_requires_fixed_asr_roots_before_spawn():
    supervisor = WorkerSupervisor()
    with pytest.raises(WorkerProcessError, match="WORKER_ASR_ROOTS_UNCONFIGURED"):
        supervisor.run_craig(
            job_id="asr-job",
            attempt=1,
            source_id="source-123",
            profile_id="qwen-fast",
            glossary="",
            context="",
            cpu=False,
            on_progress=lambda _message: None,
        )


def test_supervisor_validates_opaque_source_before_spawn(tmp_path: Path):
    sentinel = tmp_path / "spawned.txt"
    script = tmp_path / "worker.py"
    script.write_text(
        "from pathlib import Path; Path(r'" + str(sentinel).replace("\\", "\\\\") + "').write_text('spawned')",
        encoding="utf-8",
    )
    supervisor = WorkerSupervisor(
        command_factory=lambda: [sys.executable, str(script)],
        data_root=tmp_path / "Data",
        models_root=tmp_path / "Models",
    )
    with pytest.raises(WorkerProtocolError, match="WORKER_SOURCE_ID_INVALID"):
        supervisor.run_craig(
            job_id="asr-job",
            attempt=1,
            source_id="../private",
            profile_id="qwen-fast",
            glossary="",
            context="",
            cpu=False,
            on_progress=lambda _message: None,
        )
    assert not sentinel.exists()


def test_real_worker_resolves_staged_source_but_does_not_claim_qwen_runtime(tmp_path: Path):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    _stage_craig(data_root)
    supervisor = WorkerSupervisor(
        data_root=data_root,
        models_root=models_root,
        startup_timeout=5,
        heartbeat_timeout=5,
    )
    with pytest.raises(WorkerProcessError, match="ASR_ENGINE_NOT_IMPLEMENTED"):
        supervisor.run_craig(
            job_id="asr-qwen-boundary",
            attempt=1,
            source_id="source-123",
            profile_id="qwen-fast",
            glossary="",
            context="",
            cpu=False,
            on_progress=lambda _message: None,
        )
