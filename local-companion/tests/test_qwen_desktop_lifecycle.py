from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

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


def _status(
    *,
    state: str = "idle",
    active: bool = False,
    mode: str | None = None,
    installed_version: str | None = "1.2.2",
    stable_status: str = "compatible",
    stable_version: str | None = "1.2.3",
    update_available: bool | None = True,
    accepted: bool | None = None,
    error_code: str | None = None,
) -> dict[str, object]:
    value: dict[str, object] = {
        "schema": "tda_qwen_runtime_maintenance_v1",
        "state": state,
        "active": active,
        "operation_id": "a" * 32 if mode else None,
        "mode": mode,
        "stage": "complete" if not active else "checking",
        "title": "Qwen Runtime",
        "detail": "",
        "sequence": 1,
        "installed_status": "ready" if installed_version else "missing",
        "installed_version": installed_version,
        "minimum_version": "1.0.12",
        "stable_status": stable_status,
        "stable_version": stable_version,
        "stable_tag": (
            f"companion-qwen-runtime-v{stable_version}"
            if stable_version
            else None
        ),
        "stable_size": 4096 if stable_version else None,
        "stable_part_count": 2 if stable_version else None,
        "update_available": update_available,
        "can_update": update_available is True,
        "error_code": error_code,
    }
    if accepted is not None:
        value["accepted"] = accepted
    return value


def test_check_qwen_runtime_routes_through_agent_maintenance_contract(
    tmp_path: Path,
):
    bridge = _bridge(tmp_path)
    get_values = iter(
        [
            _status(),
            _status(
                state="completed",
                mode="check",
                active=False,
                update_available=True,
            ),
        ]
    )
    calls: list[tuple[str, str]] = []
    bridge.client.get = lambda path: (calls.append(("GET", path)), next(get_values))[1]  # type: ignore[method-assign]
    bridge.client.post = lambda path, body: (  # type: ignore[method-assign]
        calls.append(("POST", path)),
        _status(state="running", mode="check", active=True),
    )[1]

    value = bridge.check_qwen_runtime()

    assert calls == [
        ("GET", "/qwen-runtime"),
        ("POST", "/qwen-runtime/check"),
        ("GET", "/qwen-runtime"),
    ]
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


def test_check_qwen_runtime_preserves_manifest_failure_as_error(tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge.client.get = lambda _path: _status()  # type: ignore[method-assign]
    bridge.client.post = lambda _path, _body: _status(  # type: ignore[method-assign]
        state="completed",
        mode="check",
        stable_status="unavailable",
        stable_version=None,
        update_available=None,
        error_code="NETWORK_UNAVAILABLE",
    )

    with pytest.raises(RuntimeError, match="NETWORK_UNAVAILABLE"):
        bridge.check_qwen_runtime()


def test_install_qwen_runtime_routes_mutation_through_agent_dispatch_fence(
    tmp_path: Path,
):
    bridge = _bridge(tmp_path)
    # The old Desktop path performed this non-atomic precheck locally. If it
    # returns, a queued job can be claimed before mutation begins. It must never
    # be consulted now; the Agent owns the check + start under dispatch_gate.
    bridge._has_active_job = lambda: (_ for _ in ()).throw(  # type: ignore[method-assign]
        AssertionError("Desktop must not use a check-then-mutate runtime fence")
    )
    get_values = iter(
        [
            _status(),
            _status(
                state="completed",
                mode="update",
                installed_version="1.2.3",
                update_available=False,
                accepted=True,
            ),
        ]
    )
    calls: list[tuple[str, str]] = []
    bridge.client.get = lambda path: (calls.append(("GET", path)), next(get_values))[1]  # type: ignore[method-assign]
    bridge.client.post = lambda path, body: (  # type: ignore[method-assign]
        calls.append(("POST", path)),
        _status(state="running", mode="update", active=True),
    )[1]

    value = bridge.install_qwen_runtime()

    assert calls == [
        ("GET", "/qwen-runtime"),
        ("POST", "/qwen-runtime/update"),
        ("GET", "/qwen-runtime"),
    ]
    assert value == {
        "accepted": True,
        "available": True,
        "status": "ready",
        "version": "1.2.3",
        "part_count": 2,
    }


def test_install_qwen_runtime_propagates_agent_job_fence(tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge.client.get = lambda _path: _status()  # type: ignore[method-assign]

    def blocked(_path, _body):
        raise RuntimeError("RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB")

    bridge.client.post = blocked  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB"):
        bridge.install_qwen_runtime()


def test_install_qwen_runtime_noops_when_agent_reports_current(tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge.client.get = lambda _path: _status(  # type: ignore[method-assign]
        installed_version="1.2.3",
        stable_version="1.2.3",
        update_available=False,
    )
    bridge.client.post = lambda _path, _body: _status(  # type: ignore[method-assign]
        state="completed",
        mode="update",
        installed_version="1.2.3",
        stable_version="1.2.3",
        update_available=False,
        accepted=False,
    )

    value = bridge.install_qwen_runtime()

    assert value == {
        "accepted": False,
        "available": False,
        "status": "ready",
        "version": "1.2.3",
        "part_count": 2,
    }


def test_desktop_reattaches_to_existing_agent_update_without_duplicate_post(
    tmp_path: Path,
):
    bridge = _bridge(tmp_path)
    get_values = iter(
        [
            _status(state="running", mode="update", active=True),
            _status(
                state="completed",
                mode="update",
                installed_version="1.2.3",
                update_available=False,
                accepted=True,
            ),
        ]
    )
    posts: list[str] = []
    bridge.client.get = lambda _path: next(get_values)  # type: ignore[method-assign]
    bridge.client.post = lambda path, _body: posts.append(path)  # type: ignore[method-assign]

    value = bridge.install_qwen_runtime()

    assert posts == []
    assert value["accepted"] is True
    assert value["version"] == "1.2.3"
