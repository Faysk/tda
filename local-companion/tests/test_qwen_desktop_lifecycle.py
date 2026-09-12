from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest

import tda_companion.desktop as desktop
from tda_companion.desktop import DesktopBridge
from tda_companion.qwen_runtime_bundle import QwenRuntimePart, build_qwen_runtime_bundle_manifest
from tda_companion.qwen_runtime_updates import QwenRuntimeDownloadManifest


def _manifest(version: str = "1.2.3") -> QwenRuntimeDownloadManifest:
    payload = b"runtime"
    part = QwenRuntimePart(
        index=1,
        name=f"TDAQwenRuntime-{version}-windows-x64.zip.part001",
        size=len(payload),
        sha256=hashlib.sha256(payload).hexdigest(),
    )
    bundle = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256=hashlib.sha256(payload).hexdigest(),
        parts=(part,),
    )
    return QwenRuntimeDownloadManifest(
        version=version,
        tag=f"companion-qwen-runtime-v{version}",
        bundle=bundle,
    )


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


def test_check_qwen_runtime_reports_download_shape(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    manifest = _manifest("1.2.3")
    monkeypatch.setattr(
        desktop,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": "1.2.2", "worker": "worker.exe"},
    )
    monkeypatch.setattr(desktop, "fetch_qwen_runtime_manifest", lambda: manifest)

    value = bridge.check_qwen_runtime()
    assert value["status"] == "ready"
    assert value["current_version"] == "1.2.2"
    assert value["available"] is True
    assert value["version"] == "1.2.3"
    assert value["size"] == manifest.bundle.archive_size
    assert value["part_count"] == 1


def test_install_qwen_runtime_downloads_installs_and_verifies(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge._has_running_job = lambda: False  # type: ignore[method-assign]
    manifest = _manifest()
    archive = tmp_path / "runtime.zip"
    archive.write_bytes(b"runtime")
    states = iter(
        [
            {"status": "missing", "version": None, "worker": None},
            {"status": "ready", "version": manifest.version, "worker": "worker.exe"},
        ]
    )
    monkeypatch.setattr(desktop, "inspect_qwen_runtime", lambda *_args, **_kwargs: next(states))
    monkeypatch.setattr(desktop, "fetch_qwen_runtime_manifest", lambda: manifest)
    monkeypatch.setattr(desktop, "download_qwen_runtime", lambda *_args, **_kwargs: archive)
    calls: dict[str, object] = {}

    def fake_install(path, root, **kwargs):
        calls.update(path=path, root=root, **kwargs)
        return {"worker_sha256": "a" * 64}

    monkeypatch.setattr(desktop, "install_qwen_runtime_archive", fake_install)
    value = bridge.install_qwen_runtime()

    assert value["accepted"] is True
    assert value["status"] == "ready"
    assert value["repaired"] is False
    assert calls["expected_sha256"] == manifest.bundle.archive_sha256
    assert calls["replace_corrupt"] is False


def test_install_qwen_runtime_repairs_same_corrupt_version(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge._has_running_job = lambda: False  # type: ignore[method-assign]
    manifest = _manifest()
    archive = tmp_path / "runtime.zip"
    archive.write_bytes(b"runtime")
    states = iter(
        [
            {"status": "corrupt", "version": manifest.version, "worker": None},
            {"status": "ready", "version": manifest.version, "worker": "worker.exe"},
        ]
    )
    monkeypatch.setattr(desktop, "inspect_qwen_runtime", lambda *_args, **_kwargs: next(states))
    monkeypatch.setattr(desktop, "fetch_qwen_runtime_manifest", lambda: manifest)
    monkeypatch.setattr(desktop, "download_qwen_runtime", lambda *_args, **_kwargs: archive)
    calls: dict[str, object] = {}

    def fake_install(_path, _root, **kwargs):
        calls.update(kwargs)
        return {"worker_sha256": "b" * 64}

    monkeypatch.setattr(desktop, "install_qwen_runtime_archive", fake_install)
    value = bridge.install_qwen_runtime()

    assert value["repaired"] is True
    assert calls["replace_corrupt"] is True


def test_install_qwen_runtime_is_blocked_while_job_runs(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge._has_running_job = lambda: True  # type: ignore[method-assign]
    monkeypatch.setattr(
        desktop,
        "fetch_qwen_runtime_manifest",
        lambda: (_ for _ in ()).throw(AssertionError("manifest should not be fetched")),
    )
    with pytest.raises(RuntimeError, match="RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB"):
        bridge.install_qwen_runtime()


def test_install_qwen_runtime_noops_when_current_version_is_ready(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge._has_running_job = lambda: False  # type: ignore[method-assign]
    manifest = _manifest()
    monkeypatch.setattr(
        desktop,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": manifest.version, "worker": "worker.exe"},
    )
    monkeypatch.setattr(desktop, "fetch_qwen_runtime_manifest", lambda: manifest)
    monkeypatch.setattr(
        desktop,
        "download_qwen_runtime",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("download should not run")),
    )

    value = bridge.install_qwen_runtime()
    assert value == {
        "accepted": False,
        "available": False,
        "status": "ready",
        "version": manifest.version,
    }
