from __future__ import annotations

from pathlib import Path

import pytest

import tda_companion.profile_preparation as preparation
import tda_companion.worker_supervisor as supervisor_module
from tda_companion.runtime_compat import (
    MIN_BENCHMARK_WHISPER_RUNTIME_VERSION,
    MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
    MIN_TRANSCRIPTION_WHISPER_RUNTIME_VERSION,
    whisper_runtime_benchmark_compatible,
    whisper_runtime_transcription_compatible,
    whisper_runtime_version_compatible,
)
from tda_companion.worker_supervisor import WorkerProcessError, WorkerSupervisor


def test_whisper_1_1_5_remains_valid_artifact_but_not_current_dispatch_protocol():
    assert MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION == "1.1.4"
    assert MIN_TRANSCRIPTION_WHISPER_RUNTIME_VERSION == "1.1.10"
    assert MIN_BENCHMARK_WHISPER_RUNTIME_VERSION == "1.1.10"
    assert whisper_runtime_version_compatible("1.1.5") is True
    assert whisper_runtime_transcription_compatible("1.1.5") is False
    assert whisper_runtime_transcription_compatible("1.1.9") is False
    assert whisper_runtime_transcription_compatible("1.1.10") is True
    assert whisper_runtime_benchmark_compatible("1.1.5") is False
    assert whisper_runtime_benchmark_compatible("1.1.10") is True


@pytest.mark.parametrize(
    ("runtime_version", "ready", "reason", "benchmark_ready", "benchmark_reason"),
    [
        ("1.1.5", False, "WHISPER_RUNTIME_REQUIRED", False, "WHISPER_RUNTIME_REQUIRED"),
        ("1.1.6", False, "WHISPER_RUNTIME_REQUIRED", False, "WHISPER_RUNTIME_REQUIRED"),
        ("1.1.7", False, "WHISPER_RUNTIME_REQUIRED", False, "WHISPER_RUNTIME_REQUIRED"),
        ("1.1.9", False, "WHISPER_RUNTIME_REQUIRED", False, "WHISPER_RUNTIME_REQUIRED"),
        ("1.1.10", True, None, True, None),
    ],
)
def test_profile_catalog_separates_artifact_and_current_protocol_readiness(
    monkeypatch,
    tmp_path: Path,
    runtime_version: str,
    ready: bool,
    reason: str | None,
    benchmark_ready: bool,
    benchmark_reason: str | None,
):
    monkeypatch.setattr(
        preparation,
        "inspect_whisper_runtime",
        lambda _root, verify_worker=False: {
            "status": "ready",
            "version": runtime_version,
            "worker_sha256": "a" * 64,
        },
    )
    monkeypatch.setattr(
        preparation,
        "inspect_qwen_runtime",
        lambda _root, verify_worker=False: {"status": "missing"},
    )
    monkeypatch.setattr(
        preparation,
        "inspect_model_install",
        lambda *_args, **_kwargs: {
            "status": "ready",
            "metadata_sha256": "b" * 64,
        },
    )

    catalog = preparation.profile_catalog(
        tmp_path / "State",
        tmp_path / "Runtime",
        tmp_path / "Models",
    )
    whisper = {
        str(item["id"]): item
        for item in catalog
        if item["engine"] == "whisper"
    }

    assert set(whisper) == {"whisper-turbo", "whisper-detailed"}
    for item in whisper.values():
        assert item["ready"] is ready
        assert item["preparation_required"] is (not ready)
        assert item["reason"] == reason
        assert item["benchmark_ready"] is benchmark_ready
        assert item["benchmark_preparation_required"] is (not benchmark_ready)
        assert item["benchmark_reason"] == benchmark_reason


def test_benchmark_preparation_does_not_reuse_immutable_whisper_1_1_5(
    monkeypatch,
    tmp_path: Path,
):
    active_version = "1.1.5"
    calls = {"stable_download": 0, "rc": 0}

    def inspect(_root, verify_worker=True):
        del verify_worker
        return {"status": "ready", "version": active_version}

    class StableManifest:
        version = "1.1.5"
        sha256 = "c" * 64

    def forbidden_download(*_args, **_kwargs):
        calls["stable_download"] += 1
        raise AssertionError("old Stable 1.1.5 must not be reinstalled for benchmark")

    def install_rc(*_args, **_kwargs):
        nonlocal active_version
        calls["rc"] += 1
        active_version = "1.1.10"
        return {"version": "1.1.10", "channel": "rc"}

    monkeypatch.setattr(preparation, "inspect_whisper_runtime", inspect)
    monkeypatch.setattr(
        preparation,
        "fetch_whisper_runtime_manifest",
        lambda: StableManifest(),
    )
    monkeypatch.setattr(preparation, "download_whisper_runtime", forbidden_download)
    monkeypatch.setattr(preparation, "install_published_runtime_rc", install_rc)

    ordinary = preparation._install_whisper_runtime(
        tmp_path / "Runtime",
        tmp_path / "Cache",
    )
    assert ordinary["version"] == "1.1.10"
    assert calls == {"stable_download": 0, "rc": 1}

    benchmark = preparation._install_whisper_runtime(
        tmp_path / "Runtime",
        tmp_path / "Cache",
        require_benchmark_compatibility=True,
    )
    assert benchmark["version"] == "1.1.10"
    assert benchmark["reused"] is True
    assert calls == {"stable_download": 0, "rc": 1}


def test_supervisor_blocks_old_whisper_protocol_before_worker_launch(
    monkeypatch,
    tmp_path: Path,
):
    monkeypatch.setattr(
        supervisor_module,
        "inspect_whisper_runtime",
        lambda _root, verify_worker=False: {
            "status": "ready",
            "version": "1.1.5",
            "worker": str(tmp_path / "Runtime" / "whisper" / "1.1.5" / "worker.exe"),
        },
    )
    supervisor = WorkerSupervisor(
        data_root=tmp_path / "Data",
        models_root=tmp_path / "Models",
        runtime_root=tmp_path / "Runtime",
    )

    with pytest.raises(
        WorkerProcessError,
        match="WHISPER_RUNTIME_PROTOCOL_REQUIRED",
    ):
        supervisor.run_craig(
            job_id="benchmark-whisper-old-runtime",
            attempt=1,
            source_id="craig-" + "d" * 64,
            profile_id="whisper-turbo",
            glossary="",
            context="",
            cpu=False,
            benchmark_sample_seconds=300.0,
            on_progress=lambda _message: None,
        )
