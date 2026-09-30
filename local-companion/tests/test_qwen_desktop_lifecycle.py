from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import tda_companion.desktop as desktop
from tda_companion.desktop import DesktopBridge


def _bridge(tmp_path: Path) -> DesktopBridge:
    paths = SimpleNamespace(
        root=tmp_path,
        data_root=tmp_path / "Data",
        cache_root=tmp_path / "Cache",
        runtime_root=tmp_path / "Runtime",
        logs_root=tmp_path / "Logs",
    )
    settings = SimpleNamespace(snapshot=lambda: {}, update=lambda value: value)
    return DesktopBridge(
        token="t" * 43,
        port=8765,
        paths=paths,
        settings=settings,
        executable=tmp_path / "TDACompanion.exe",
        start_agent=lambda: None,
    )


def test_check_qwen_runtime_uses_shared_maintenance_contract(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    monkeypatch.setattr(
        desktop,
        "inspect_qwen_runtime_update",
        lambda *_args, **_kwargs: {
            "installed_status": "ready",
            "installed_version": "1.2.2",
            "minimum_version": "1.0.12",
            "stable_status": "compatible",
            "stable_version": "1.2.3",
            "stable_tag": "companion-qwen-runtime-v1.2.3",
            "stable_size": 4096,
            "stable_part_count": 2,
            "update_available": True,
            "can_update": True,
            "error_code": None,
        },
    )

    value = bridge.check_qwen_runtime()

    assert value == {
        "status": "ready",
        "current_version": "1.2.2",
        "installed_version": "1.2.2",
        "available": True,
        "version": "1.2.3",
        "tag": "companion-qwen-runtime-v1.2.3",
        "size": 4096,
        "part_count": 2,
    }


def test_check_qwen_runtime_preserves_manifest_failure_as_error(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    monkeypatch.setattr(
        desktop,
        "inspect_qwen_runtime_update",
        lambda *_args, **_kwargs: {
            "installed_status": "ready",
            "installed_version": "1.0.11",
            "minimum_version": "1.0.12",
            "stable_status": "unavailable",
            "stable_version": None,
            "stable_tag": None,
            "stable_size": None,
            "stable_part_count": None,
            "update_available": None,
            "can_update": False,
            "error_code": "NETWORK_UNAVAILABLE",
        },
    )

    with pytest.raises(RuntimeError, match="NETWORK_UNAVAILABLE"):
        bridge.check_qwen_runtime()


def test_install_qwen_runtime_uses_shared_verified_updater(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge._has_active_job = lambda: False  # type: ignore[method-assign]
    calls: dict[str, object] = {}

    def install(runtime_root, cache_root):
        calls["runtime_root"] = runtime_root
        calls["cache_root"] = cache_root
        return {
            "accepted": True,
            "status": "ready",
            "version": "1.2.3",
            "worker_sha256": "a" * 64,
            "repaired": True,
            "stable_part_count": 2,
            "update_available": False,
            "can_update": False,
        }

    monkeypatch.setattr(desktop, "install_qwen_runtime_update", install)

    value = bridge.install_qwen_runtime()

    assert calls == {
        "runtime_root": bridge.paths.runtime_root,
        "cache_root": bridge.paths.cache_root,
    }
    assert value == {
        "accepted": True,
        "available": True,
        "status": "ready",
        "version": "1.2.3",
        "worker_sha256": "a" * 64,
        "repaired": True,
        "part_count": 2,
    }


def test_install_qwen_runtime_is_blocked_while_job_runs(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge._has_active_job = lambda: True  # type: ignore[method-assign]
    monkeypatch.setattr(
        desktop,
        "install_qwen_runtime_update",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("shared updater should not start")
        ),
    )

    with pytest.raises(RuntimeError, match="RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB"):
        bridge.install_qwen_runtime()


def test_install_qwen_runtime_noops_when_shared_updater_reports_current(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge._has_active_job = lambda: False  # type: ignore[method-assign]
    monkeypatch.setattr(
        desktop,
        "install_qwen_runtime_update",
        lambda *_args, **_kwargs: {
            "accepted": False,
            "status": "ready",
            "version": "1.2.3",
            "stable_version": "1.2.3",
            "stable_part_count": 1,
            "update_available": False,
            "can_update": False,
        },
    )

    value = bridge.install_qwen_runtime()

    assert value == {
        "accepted": False,
        "available": False,
        "status": "ready",
        "version": "1.2.3",
        "part_count": 1,
    }
