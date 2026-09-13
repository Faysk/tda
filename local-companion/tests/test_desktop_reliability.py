from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from tda_companion.agent_connection import AgentConnectionError
from tda_companion.desktop import DesktopBridge
from tda_companion.desktop_session_bridge import SessionDesktopBridge


def _bridge(tmp_path: Path) -> SessionDesktopBridge:
    paths = SimpleNamespace(
        root=tmp_path,
        companion_root=tmp_path / "Companion",
        state_root=tmp_path / "State",
        data_root=tmp_path / "Data",
        logs_root=tmp_path / "Logs",
        cache_root=tmp_path / "Cache",
        models_root=tmp_path / "Models",
        runtime_root=tmp_path / "Runtime",
    )
    for path in (
        paths.state_root,
        paths.data_root,
        paths.logs_root,
        paths.cache_root,
        paths.models_root,
        paths.runtime_root,
    ):
        path.mkdir(parents=True, exist_ok=True)
    settings = SimpleNamespace(
        snapshot=lambda: {
            "start_with_windows": False,
            "show_tray": False,
            "check_updates": False,
            "theme": "system",
            "close_behavior": "hide",
        },
        update=lambda value: value,
    )
    return SessionDesktopBridge(
        token="t" * 43,
        port=8765,
        paths=paths,
        settings=settings,
        executable=tmp_path / "TDACompanion.exe",
        start_agent=lambda: None,
    )


def _offline(connection, code: str = "AGENT_CONNECTION_REFUSED") -> None:
    connection._state = "unavailable"
    connection._last_error = code


def test_snapshot_remains_renderable_when_agent_is_unavailable(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    _offline(bridge.client)
    monkeypatch.setattr(
        bridge.client,
        "get",
        lambda _path: (_ for _ in ()).throw(AgentConnectionError("AGENT_CONNECTION_REFUSED")),
    )

    value = bridge.snapshot()

    assert value["version"]
    assert value["agent"]["lifecycle"] == "unavailable"
    assert value["agent"]["error"] == "AGENT_CONNECTION_REFUSED"
    assert value["connection"]["state"] == "unavailable"
    assert value["settings"]["close_behavior"] == "hide"
    assert value["jobs"] == []


def test_profile_discovery_failure_does_not_invalidate_selected_craig(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    source_id = "craig-" + "a" * 64
    bridge._selected_sources.add(source_id)
    _offline(bridge.client)
    monkeypatch.setattr(
        bridge.client,
        "get",
        lambda _path: (_ for _ in ()).throw(AgentConnectionError("AGENT_CONNECTION_REFUSED")),
    )

    result = bridge.transcription_profiles()

    assert source_id in bridge._selected_sources
    assert result["profiles"] == []
    assert result["unavailable"] is True
    assert result["error"] == "AGENT_CONNECTION_REFUSED"


def test_background_logs_return_degraded_state_instead_of_throwing(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    _offline(bridge.client)
    monkeypatch.setattr(
        bridge.client,
        "get",
        lambda _path: (_ for _ in ()).throw(AgentConnectionError("AGENT_CONNECTION_REFUSED")),
    )

    result = bridge.logs(limit=50)

    assert result["logs"] == []
    assert result["unavailable"] is True
    assert result["connection"]["state"] == "unavailable"


def test_installed_bridge_correlates_maintenance_operation_id(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    seen: dict[str, list[str]] = {}

    def fake_launch(self, arguments):  # noqa: ANN001
        seen["arguments"] = list(arguments)
        return True

    def fake_install(self):  # noqa: ANN001
        self._launch_maintenance(["--install-update", "--version", "0.3.3"])
        return {"accepted": True, "available": True, "version": "0.3.3"}

    monkeypatch.setattr(DesktopBridge, "_launch_maintenance", fake_launch)
    monkeypatch.setattr(DesktopBridge, "install_update", fake_install)

    result = bridge.install_update()

    operation_id = result["operation_id"]
    assert isinstance(operation_id, str) and len(operation_id) == 32
    assert seen["arguments"][-2:] == ["--operation-id", operation_id]
