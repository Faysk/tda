from __future__ import annotations

import threading
from pathlib import Path
from types import SimpleNamespace

from tda_companion.agent import AgentController
from tda_companion.agent_connection import AgentConnectionError
from tda_companion.desktop import DesktopBridge
from tda_companion.desktop_runtime import (
    DesktopAgentWatchdog,
    DesktopExitCoordinator,
    DesktopUiApi,
)
from tda_companion.tray import TrayController


def test_native_watchdog_recovers_without_renderer_polling(tmp_path: Path):
    recovered = threading.Event()

    class Bridge:
        def __init__(self):
            self.paths = SimpleNamespace(logs_root=tmp_path / "Logs")
            self.client = SimpleNamespace(
                status=lambda: {"retry_after_seconds": 0.0}
            )
            self.calls = 0

        def agent_watchdog_tick(self):
            self.calls += 1
            if self.calls == 1:
                raise AgentConnectionError("AGENT_CONNECTION_REFUSED")
            recovered.set()
            return {
                "state": "ready",
                "service_version": "0.3.14",
                "pid": 4321,
            }

    bridge = Bridge()
    watchdog = DesktopAgentWatchdog(bridge, interval_seconds=0.01)  # type: ignore[arg-type]
    watchdog.start()
    try:
        assert recovered.wait(1.0) is True
    finally:
        watchdog.stop()

    assert bridge.calls >= 2
    rows = watchdog._log.tail(limit=20)
    assert [row["code"] for row in rows][-2:] == [
        "AGENT_WATCHDOG_RECOVERY_PENDING",
        "AGENT_WATCHDOG_RECOVERED",
    ]


def test_user_close_can_hide_when_tray_is_available():
    coordinator = DesktopExitCoordinator()

    assert coordinator.should_hide("hide", tray_available=True) is True
    assert coordinator.should_hide("close_ui", tray_available=True) is False
    assert coordinator.should_hide("hide", tray_available=False) is False


def test_programmatic_exit_bypasses_hide_preference():
    coordinator = DesktopExitCoordinator()
    closed: list[bool] = []

    coordinator.request_exit(lambda: closed.append(True))

    assert closed == [True]
    assert coordinator.programmatic_exit is True
    assert coordinator.should_hide("hide", tray_available=True) is False


def test_tray_exit_callback_uses_programmatic_desktop_close_path():
    coordinator = DesktopExitCoordinator()
    closed: list[bool] = []

    class Bridge:
        def close_desktop(self):
            coordinator.request_exit(lambda: closed.append(True))

    tray = TrayController(Bridge(), SimpleNamespace())
    tray._exit_ui()

    assert closed == [True]
    assert coordinator.programmatic_exit is True
    assert coordinator.should_hide("hide", tray_available=True) is False


def test_webview_api_exposes_machine_controls_but_not_master_token_or_editorial_ingest():
    class Bridge:
        def snapshot(self):
            return {"ok": True}

    api = DesktopUiApi(Bridge())  # type: ignore[arg-type]
    public = {
        name
        for name in dir(api)
        if not name.startswith("_") and callable(getattr(api, name))
    }

    assert "snapshot" in public
    assert "open_tda" in public
    assert "restart_agent" in public
    assert "pairing_token" not in public
    assert "select_craig_session" not in public
    assert "start_craig_transcription" not in public
    assert "prepare_transcription_profile" not in public


class _FakeLock:
    def __init__(self):
        self.released = False

    def __exit__(self, *_args):
        self.released = True


class _FakeServer:
    should_exit = False


class _FakeThread:
    def __init__(self, *, alive: bool):
        self.alive = alive
        self.join_timeout = None

    def is_alive(self):
        return self.alive

    def join(self, timeout=None):
        self.join_timeout = timeout


def test_agent_stop_keeps_data_lock_if_server_thread_is_still_alive(tmp_path: Path):
    controller = AgentController(
        tmp_path / "Data",
        "x" * 43,
        frozenset({"https://dnd.faysk.dev"}),
        8765,
    )
    fake_lock = _FakeLock()
    fake_server = _FakeServer()
    fake_thread = _FakeThread(alive=True)
    controller.lock = fake_lock
    controller.server = fake_server
    controller.thread = fake_thread

    try:
        controller.stop()
    except RuntimeError as exc:
        assert str(exc) == "LOCAL_SERVICE_STOP_TIMEOUT"
    else:
        raise AssertionError("alive server thread must fail closed")

    assert fake_thread.join_timeout == 30
    assert fake_server.should_exit is True
    assert controller.lock is fake_lock
    assert fake_lock.released is False
    assert controller.thread is fake_thread
    assert controller.server is fake_server


def test_agent_stop_releases_lock_after_server_thread_has_finished(tmp_path: Path):
    controller = AgentController(
        tmp_path / "Data",
        "x" * 43,
        frozenset({"https://dnd.faysk.dev"}),
        8765,
    )
    fake_lock = _FakeLock()
    fake_server = _FakeServer()
    fake_thread = _FakeThread(alive=False)
    controller.lock = fake_lock
    controller.server = fake_server
    controller.thread = fake_thread

    controller.stop()

    assert fake_server.should_exit is True
    assert fake_lock.released is True
    assert controller.lock is None
    assert controller.thread is None
    assert controller.server is None


def test_agent_releases_retained_lock_after_timed_out_thread_later_exits(tmp_path: Path):
    controller = AgentController(
        tmp_path / "Data",
        "x" * 43,
        frozenset({"https://dnd.faysk.dev"}),
        8765,
    )
    fake_lock = _FakeLock()
    fake_server = _FakeServer()
    fake_thread = _FakeThread(alive=True)
    controller.lock = fake_lock
    controller.server = fake_server
    controller.thread = fake_thread

    try:
        controller.stop()
    except RuntimeError as exc:
        assert str(exc) == "LOCAL_SERVICE_STOP_TIMEOUT"
    else:
        raise AssertionError("alive server thread must fail closed")

    assert fake_lock.released is False
    fake_thread.alive = False

    assert controller._release_stopped_resources() is True
    assert fake_lock.released is True
    assert controller.lock is None
    assert controller.thread is None
    assert controller.server is None


def test_desktop_maintenance_treats_queued_job_as_active():
    bridge = object.__new__(DesktopBridge)
    bridge._jobs = lambda: [{"status": "queued"}]  # type: ignore[method-assign]

    assert bridge._has_running_job() is False
    assert bridge._has_active_job() is True
