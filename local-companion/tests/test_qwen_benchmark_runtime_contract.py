from __future__ import annotations

from pathlib import Path

import pytest

import tda_companion.profile_preparation as preparation
import tda_companion.worker_supervisor as supervisor_module
from tda_companion.runtime_compat import (
    MIN_BENCHMARK_QWEN_RUNTIME_VERSION,
    MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
    qwen_runtime_benchmark_compatible,
    qwen_runtime_version_compatible,
)
from tda_companion.worker_supervisor import WorkerProcessError, WorkerSupervisor


def _artifact(version: str) -> dict[str, str]:
    return {
        "runtime_id": "qwen3-transformers",
        "version": version,
        "worker_sha256": "a" * 64,
        "archive_sha256": "b" * 64,
    }


def test_qwen_1_0_18_remains_valid_for_transcription_but_not_benchmark():
    assert MIN_COMPATIBLE_QWEN_RUNTIME_VERSION == "1.0.12"
    assert MIN_BENCHMARK_QWEN_RUNTIME_VERSION == "1.0.19"
    assert qwen_runtime_version_compatible("1.0.18") is True
    assert qwen_runtime_benchmark_compatible("1.0.18") is False
    assert qwen_runtime_benchmark_compatible("1.0.19") is True


def test_qwen_profile_catalog_separates_transcription_and_benchmark_readiness(
    monkeypatch,
    tmp_path: Path,
):
    monkeypatch.setattr(
        preparation,
        "inspect_whisper_runtime",
        lambda _root, verify_worker=False: {"status": "missing"},
    )
    monkeypatch.setattr(
        preparation,
        "inspect_qwen_runtime",
        lambda _root, verify_worker=False: {
            "status": "ready",
            "version": "1.0.18",
            "worker_sha256": "a" * 64,
        },
    )
    monkeypatch.setattr(
        preparation,
        "inspect_qwen_physical_gate",
        lambda *_args, **_kwargs: {
            "ready": True,
            "status": "ready",
            "metrics": {"compute_type": "float16"},
            "gpu": {
                "name": "NVIDIA GeForce RTX 4070 Laptop GPU",
                "compute_capability": "8.9",
            },
        },
    )

    catalog = preparation.profile_catalog(
        tmp_path / "State",
        tmp_path / "Runtime",
        tmp_path / "Models",
    )
    qwen = {str(item["id"]): item for item in catalog if item["engine"] == "qwen3"}

    assert set(qwen) == {"qwen-fast", "qwen-quality"}
    for item in qwen.values():
        assert item["ready"] is True
        assert item["reason"] is None
        assert item["benchmark_ready"] is False
        assert item["benchmark_preparation_required"] is True
        assert item["benchmark_reason"] == "QWEN_BENCHMARK_RUNTIME_REQUIRED"


def test_supervisor_blocks_old_qwen_before_benchmark_worker_launch(
    monkeypatch,
    tmp_path: Path,
):
    artifact = _artifact("1.0.18")
    monkeypatch.setattr(
        supervisor_module,
        "inspect_qwen_physical_gate",
        lambda *_args, **_kwargs: {
            "ready": True,
            "runtime_artifact": artifact,
        },
    )
    monkeypatch.setattr(
        supervisor_module,
        "inspect_qwen_runtime",
        lambda _root, verify_worker=False: {
            "status": "ready",
            "version": "1.0.18",
            "worker": str(tmp_path / "Runtime" / "qwen" / "1.0.18" / "worker.exe"),
            **artifact,
        },
    )
    supervisor = WorkerSupervisor(
        data_root=tmp_path / "Data",
        models_root=tmp_path / "Models",
        runtime_root=tmp_path / "Runtime",
        state_root=tmp_path / "State",
    )

    with pytest.raises(
        WorkerProcessError,
        match="QWEN_BENCHMARK_RUNTIME_REQUIRED",
    ):
        supervisor.run_craig(
            job_id="benchmark-qwen-old-runtime",
            attempt=1,
            source_id="craig-" + "d" * 64,
            profile_id="qwen-fast",
            glossary="",
            context="",
            cpu=False,
            benchmark_sample_seconds=300.0,
            on_progress=lambda _message: None,
        )
