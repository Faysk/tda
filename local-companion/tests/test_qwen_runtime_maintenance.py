from __future__ import annotations

import hashlib
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import tda_companion.qwen_runtime_maintenance as maintenance
from tda_companion.api import create_app
from tda_companion.network import NetworkError
from tda_companion.qwen_runtime_bundle import QwenRuntimePart, build_qwen_runtime_bundle_manifest
from tda_companion.qwen_runtime_maintenance import (
    QwenRuntimeMaintenanceError,
    QwenRuntimeMaintenanceManager,
)
from tda_companion.qwen_runtime_updates import QwenRuntimeDownloadManifest


TOKEN = "t" * 43
ORIGIN = "https://dnd.faysk.dev"


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _manifest(version: str) -> QwenRuntimeDownloadManifest:
    payload = b"runtime"
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


def _wait(manager: QwenRuntimeMaintenanceManager) -> dict[str, object]:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        snapshot = manager.snapshot()
        if snapshot["active"] is False:
            return snapshot
        time.sleep(0.01)
    raise AssertionError("runtime maintenance did not reach a terminal state")


def test_qwen_runtime_maintenance_classifies_stale_and_stable_compatible(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {
            "status": "ready",
            "version": "1.0.11",
            "worker": "TDAQwenWorker.exe",
        },
    )
    monkeypatch.setattr(
        maintenance,
        "fetch_qwen_runtime_manifest",
        lambda timeout=5.0: _manifest("1.0.12"),
    )

    manager = QwenRuntimeMaintenanceManager(
        runtime_root=tmp_path / "Runtime",
        cache_root=tmp_path / "Cache",
    )
    snapshot = manager.snapshot(refresh_manifest=True)

    assert snapshot["installed_version"] == "1.0.11"
    assert snapshot["minimum_version"] == "1.0.12"
    assert snapshot["stable_status"] == "available"
    assert snapshot["stable_version"] == "1.0.12"
    assert snapshot["stable_compatible"] is True
    assert snapshot["update_available"] is True


def test_qwen_runtime_maintenance_fails_closed_when_stable_is_below_minimum(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {
            "status": "ready",
            "version": "1.0.11",
            "worker": "TDAQwenWorker.exe",
        },
    )
    monkeypatch.setattr(
        maintenance,
        "fetch_qwen_runtime_manifest",
        lambda timeout=5.0: _manifest("1.0.11"),
    )

    manager = QwenRuntimeMaintenanceManager(
        runtime_root=tmp_path / "Runtime",
        cache_root=tmp_path / "Cache",
    )
    snapshot = manager.snapshot(refresh_manifest=True)

    assert snapshot["stable_compatible"] is False
    assert snapshot["update_available"] is False
    with pytest.raises(
        QwenRuntimeMaintenanceError,
        match="QWEN_RUNTIME_STABLE_BELOW_MINIMUM",
    ):
        manager.start()


def test_qwen_runtime_maintenance_does_not_offer_update_when_manifest_is_unknown(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {
            "status": "ready",
            "version": "1.0.11",
            "worker": "TDAQwenWorker.exe",
        },
    )

    def unavailable(*_args, **_kwargs):
        raise NetworkError("NETWORK_UNREACHABLE")

    monkeypatch.setattr(maintenance, "fetch_qwen_runtime_manifest", unavailable)

    manager = QwenRuntimeMaintenanceManager(
        runtime_root=tmp_path / "Runtime",
        cache_root=tmp_path / "Cache",
    )
    snapshot = manager.snapshot(refresh_manifest=True)

    assert snapshot["stable_status"] == "unavailable"
    assert snapshot["stable_version"] is None
    assert snapshot["update_available"] is False
    with pytest.raises(
        QwenRuntimeMaintenanceError,
        match="QWEN_RUNTIME_MANIFEST_UNAVAILABLE",
    ):
        manager.start()


def test_qwen_runtime_maintenance_installs_once_and_refreshes_active_version(
    tmp_path: Path,
    monkeypatch,
):
    installed = {"version": "1.0.11"}
    manifest = _manifest("1.0.12")
    archive = tmp_path / "runtime.zip"
    archive.write_bytes(b"runtime")

    def inspect(*_args, **_kwargs):
        return {
            "status": "ready",
            "version": installed["version"],
            "worker": "TDAQwenWorker.exe",
        }

    monkeypatch.setattr(maintenance, "inspect_qwen_runtime", inspect)
    monkeypatch.setattr(
        maintenance,
        "fetch_qwen_runtime_manifest",
        lambda timeout=5.0: manifest,
    )
    monkeypatch.setattr(
        maintenance,
        "download_qwen_runtime",
        lambda *_args, **_kwargs: archive,
    )

    install_calls: list[str] = []

    def install(_archive, _root, *, version, **_kwargs):
        install_calls.append(version)
        installed["version"] = version
        return {"worker_sha256": "a" * 64}

    monkeypatch.setattr(maintenance, "install_qwen_runtime_archive", install)

    manager = QwenRuntimeMaintenanceManager(
        runtime_root=tmp_path / "Runtime",
        cache_root=tmp_path / "Cache",
    )
    started = manager.start()
    assert started["state"] in {"running", "completed"}
    terminal = _wait(manager)

    assert terminal["state"] == "completed"
    assert terminal["installed_version"] == "1.0.12"
    assert terminal["update_available"] is False
    assert install_calls == ["1.0.12"]


def test_qwen_runtime_maintenance_reports_sanitized_failure_and_allows_retry(
    tmp_path: Path,
    monkeypatch,
):
    manifest = _manifest("1.0.12")
    monkeypatch.setattr(
        maintenance,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {
            "status": "ready",
            "version": "1.0.11",
            "worker": "TDAQwenWorker.exe",
        },
    )
    monkeypatch.setattr(
        maintenance,
        "fetch_qwen_runtime_manifest",
        lambda timeout=5.0: manifest,
    )
    monkeypatch.setattr(
        maintenance,
        "download_qwen_runtime",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("QWEN_RUNTIME_PART_SIZE_MISMATCH")
        ),
    )

    manager = QwenRuntimeMaintenanceManager(
        runtime_root=tmp_path / "Runtime",
        cache_root=tmp_path / "Cache",
    )
    manager.start()
    failed = _wait(manager)

    assert failed["state"] == "failed"
    assert failed["error_code"] == "QWEN_RUNTIME_PART_SIZE_MISMATCH"
    assert failed["update_available"] is True

    manager.start()
    retried = _wait(manager)
    assert retried["state"] == "failed"


def test_browser_session_can_check_and_start_qwen_runtime_maintenance(
    tmp_path: Path,
    monkeypatch,
):
    app = create_app(
        tmp_path / "Data",
        TOKEN,
        {ORIGIN},
        run_worker=False,
    )
    manager = app.state.qwen_runtime_maintenance
    snapshot = {
        "schema": "tda_qwen_runtime_maintenance_v1",
        "state": "idle",
        "active": False,
        "operation_id": None,
        "installed_status": "ready",
        "installed_version": "1.0.11",
        "minimum_version": "1.0.12",
        "stable_status": "available",
        "stable_version": "1.0.12",
        "stable_compatible": True,
        "update_available": True,
        "error_code": None,
    }
    monkeypatch.setattr(
        manager,
        "snapshot",
        lambda *, refresh_manifest=False: dict(snapshot),
    )
    monkeypatch.setattr(
        manager,
        "start",
        lambda: {**snapshot, "state": "running", "active": True, "operation_id": "a" * 32},
    )

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        session = client.post("/api/v1/session", headers={"Origin": ORIGIN}, json={})
        assert session.status_code == 200
        browser_headers = {
            "Authorization": f"Bearer {session.json()['token']}",
            "Origin": ORIGIN,
        }

        checked = client.get("/api/v1/runtime/qwen", headers=browser_headers)
        assert checked.status_code == 200
        assert checked.json()["stable_version"] == "1.0.12"

        started = client.post(
            "/api/v1/runtime/qwen/update",
            headers=browser_headers,
            json={},
        )
        assert started.status_code == 200
        assert started.json()["active"] is True


def test_qwen_runtime_update_is_blocked_while_preparation_is_active(
    tmp_path: Path,
    monkeypatch,
):
    app = create_app(
        tmp_path / "Data",
        TOKEN,
        {ORIGIN},
        run_worker=False,
    )
    monkeypatch.setattr(
        app.state.preparation_manager,
        "snapshot",
        lambda: {"active": True},
    )
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.post(
            "/api/v1/runtime/qwen/update",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Origin": ORIGIN,
            },
            json={},
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "QWEN_RUNTIME_UPDATE_BLOCKED_BY_PREPARATION"
