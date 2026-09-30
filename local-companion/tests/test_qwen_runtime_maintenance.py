from __future__ import annotations

import hashlib
import threading
from pathlib import Path

import pytest

import tda_companion.qwen_runtime_maintenance as maintenance
from tda_companion.network import NetworkError
from tda_companion.qwen_runtime_bundle import (
    QwenRuntimePart,
    build_qwen_runtime_bundle_manifest,
)
from tda_companion.qwen_runtime_maintenance import (
    QwenRuntimeMaintenanceError,
    QwenRuntimeMaintenanceManager,
    inspect_qwen_runtime_update,
    install_qwen_runtime_update,
)
from tda_companion.qwen_runtime_updates import QwenRuntimeDownloadManifest


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _manifest(version: str) -> QwenRuntimeDownloadManifest:
    payload = f"runtime-{version}".encode()
    part = QwenRuntimePart(
        index=1,
        name=f"TDAQwenRuntime-{version}-windows-x64.zip.part001",
        size=len(payload),
        sha256=_sha(payload),
    )
    bundle = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256=_sha(payload),
        parts=(part,),
    )
    return QwenRuntimeDownloadManifest(
        version=version,
        tag=f"companion-qwen-runtime-v{version}",
        bundle=bundle,
    )


def test_runtime_check_exposes_installed_minimum_and_compatible_stable(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": "1.0.11"},
    )

    state = inspect_qwen_runtime_update(
        tmp_path / "Runtime",
        manifest_fetcher=lambda: _manifest("1.0.12"),
    )

    assert state == {
        "installed_status": "ready",
        "installed_version": "1.0.11",
        "minimum_version": "1.0.12",
        "stable_status": "compatible",
        "stable_version": "1.0.12",
        "stable_tag": "companion-qwen-runtime-v1.0.12",
        "stable_size": len(b"runtime-1.0.12"),
        "stable_part_count": 1,
        "update_available": True,
        "can_update": True,
        "error_code": None,
    }


def test_runtime_check_fails_closed_when_stable_is_below_minimum(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": "1.0.10"},
    )

    state = inspect_qwen_runtime_update(
        tmp_path / "Runtime",
        manifest_fetcher=lambda: _manifest("1.0.11"),
    )

    assert state["stable_status"] == "below_minimum"
    assert state["stable_version"] == "1.0.11"
    assert state["update_available"] is False
    assert state["can_update"] is False


def test_runtime_check_never_claims_update_when_manifest_is_unavailable(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": "1.0.11"},
    )

    def unavailable():
        raise NetworkError("NETWORK_UNAVAILABLE")

    state = inspect_qwen_runtime_update(
        tmp_path / "Runtime",
        manifest_fetcher=unavailable,
    )

    assert state["stable_status"] == "unavailable"
    assert state["stable_version"] is None
    assert state["update_available"] is None
    assert state["can_update"] is False
    assert state["error_code"] == "NETWORK_UNAVAILABLE"


def test_runtime_update_installs_verified_stable_and_rechecks_active_version(monkeypatch, tmp_path: Path):
    runtime_root = tmp_path / "Runtime"
    cache_root = tmp_path / "Cache"
    manifest = _manifest("1.0.12")
    archive = tmp_path / "runtime.zip"
    archive.write_bytes(b"runtime-1.0.12")
    inspections = iter(
        [
            {"status": "ready", "version": "1.0.11"},
            {"status": "ready", "version": "1.0.12"},
        ]
    )
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: next(inspections),
    )
    installed: list[dict[str, object]] = []

    def fake_install(path, root, **kwargs):
        installed.append({"path": path, "root": root, **kwargs})
        return {"worker_sha256": "a" * 64}

    monkeypatch.setattr(maintenance, "install_qwen_runtime_archive", fake_install)
    stages: list[str] = []

    result = install_qwen_runtime_update(
        runtime_root,
        cache_root,
        manifest_fetcher=lambda: manifest,
        downloader=lambda *_args, **_kwargs: archive,
        on_stage=stages.append,
    )

    assert result["accepted"] is True
    assert result["version"] == "1.0.12"
    assert result["can_update"] is False
    assert stages == ["checking", "downloading", "installing", "verifying"]
    assert installed == [
        {
            "path": archive,
            "root": runtime_root,
            "version": "1.0.12",
            "expected_sha256": manifest.bundle.archive_sha256,
            "replace_corrupt": False,
        }
    ]


def test_runtime_manager_deduplicates_same_operation_and_fences_cross_mode(monkeypatch, tmp_path: Path):
    entered = threading.Event()
    release = threading.Event()

    def blocking_manifest():
        entered.set()
        release.wait(timeout=2)
        return _manifest("1.0.12")

    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": "1.0.11"},
    )
    manager = QwenRuntimeMaintenanceManager(
        runtime_root=tmp_path / "Runtime",
        cache_root=tmp_path / "Cache",
        manifest_fetcher=blocking_manifest,
    )

    first = manager.start_check()
    assert entered.wait(timeout=1)
    second = manager.start_check()
    assert second["operation_id"] == first["operation_id"]

    with pytest.raises(QwenRuntimeMaintenanceError, match="QWEN_RUNTIME_MAINTENANCE_BUSY"):
        manager.start_update()

    release.set()
    assert manager.wait(timeout=2)
    final = manager.snapshot()
    assert final["state"] == "completed"
    assert final["can_update"] is True
