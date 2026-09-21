from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Callable

from .agent_connection import AgentConnectionError
from .desktop_session_bridge import SessionDesktopBridge
from .paths import CompanionPaths
from .settings import SettingsStore
from .system_log import SystemLog
from .tray import TrayController


class DesktopUiApi:
    """Narrow pywebview API: machine control only, never editorial ingest or secrets."""

    def __init__(self, bridge: SessionDesktopBridge) -> None:
        self._bridge = bridge

    def snapshot(self):
        return self._bridge.snapshot()

    def logs(self, level=None, component=None, limit=200):
        return self._bridge.logs(level, component, limit)

    def set_queue_paused(self, paused: bool):
        return self._bridge.set_queue_paused(paused)

    def open_tda(self):
        return self._bridge.open_tda()

    def open_local_folder(self):
        return self._bridge.open_local_folder()

    def open_logs_folder(self):
        return self._bridge.open_logs_folder()

    def update_settings(self, changes):
        return self._bridge.update_settings(changes)

    def diagnostics(self):
        return self._bridge.diagnostics()

    def export_diagnostics(self):
        return self._bridge.export_diagnostics()

    def check_update(self):
        return self._bridge.check_update()

    def install_update(self):
        return self._bridge.install_update()

    def check_whisper_runtime(self):
        return self._bridge.check_whisper_runtime()

    def install_whisper_runtime(self):
        return self._bridge.install_whisper_runtime()

    def check_qwen_runtime(self):
        return self._bridge.check_qwen_runtime()

    def install_qwen_runtime(self):
        return self._bridge.install_qwen_runtime()

    def uninstall(self, purge: bool = False):
        return self._bridge.uninstall(purge)

    def restart_agent(self):
        return self._bridge.restart_agent()

    def close_desktop(self):
        return self._bridge.close_desktop()


class DesktopAgentWatchdog:
    """Keep the local Agent recoverable independently of WebView renderer timers."""

    def __init__(
        self,
        bridge: SessionDesktopBridge,
        *,
        interval_seconds: float = 2.0,
    ) -> None:
        self.bridge = bridge
        self.interval_seconds = max(0.25, float(interval_seconds))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_marker: str | None = None
        self._log = SystemLog(bridge.paths.logs_root)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="tda-agent-watchdog",
            daemon=True,
        )
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=max(0.0, float(timeout)))

    def _write_transition(
        self,
        marker: str,
        *,
        level: str,
        code: str,
        message: str,
        context: dict[str, object] | None = None,
    ) -> None:
        if marker == self._last_marker:
            return
        self._last_marker = marker
        self._log.write(level, "desktop-watchdog", code, message, context or {})

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                status = self.bridge.agent_watchdog_tick()
                state = str(status.get("state") or "unknown")
                if state == "suspended":
                    self._last_marker = "suspended"
                elif state == "ready":
                    previous = self._last_marker
                    self._last_marker = "ready"
                    if previous not in {None, "ready", "suspended"}:
                        self._log.write(
                            "info",
                            "desktop-watchdog",
                            "AGENT_WATCHDOG_RECOVERED",
                            "Desktop watchdog restored the exact local Agent",
                            {
                                "service_version": status.get("service_version"),
                                "pid": status.get("pid"),
                            },
                        )
                else:
                    self._write_transition(
                        f"state:{state}",
                        level="warning",
                        code="AGENT_WATCHDOG_NOT_READY",
                        message="Desktop watchdog observed a non-ready Agent state",
                        context={"state": state},
                    )
            except AgentConnectionError as exc:
                self._write_transition(
                    f"agent:{exc.code}",
                    level="warning",
                    code="AGENT_WATCHDOG_RECOVERY_PENDING",
                    message="Desktop watchdog could not restore the local Agent yet",
                    context={
                        "error_code": exc.code,
                        "retry_after_seconds": self.bridge.client.status().get(
                            "retry_after_seconds"
                        ),
                    },
                )
            except BaseException as exc:
                self._write_transition(
                    f"internal:{type(exc).__name__}",
                    level="error",
                    code="AGENT_WATCHDOG_FAILED",
                    message="Desktop watchdog encountered an internal error",
                    context={"error_type": type(exc).__name__},
                )
            self._stop.wait(self.interval_seconds)


class DesktopExitCoordinator:
    """Separate a user's close gesture from an intentional product shutdown."""

    def __init__(self) -> None:
        self.programmatic_exit = False

    def request_exit(self, close: Callable[[], None]) -> None:
        self.programmatic_exit = True
        close()

    def should_hide(self, close_behavior: str, *, tray_available: bool) -> bool:
        return (
            not self.programmatic_exit
            and close_behavior == "hide"
            and tray_available
        )


def ui_entry() -> Path:
    path = Path(__file__).resolve().parent / "ui" / "index.html"
    if not path.is_file():
        raise RuntimeError("DESKTOP_UI_ASSET_MISSING")
    return path


def run_desktop(
    *,
    token: str,
    port: int,
    paths: CompanionPaths,
    settings: SettingsStore,
    executable: Path,
    start_agent: Callable[[], object],
    acceptance_tray_exit: bool = False,
) -> None:
    """Run the product desktop UI while the Agent stays in its own process."""
    try:
        import webview
    except ModuleNotFoundError as exc:
        raise RuntimeError("DESKTOP_WEBVIEW_NOT_INSTALLED") from exc

    bridge = SessionDesktopBridge(
        token=token,
        port=port,
        paths=paths,
        settings=settings,
        executable=executable,
        start_agent=start_agent,
    )
    ui_api = DesktopUiApi(bridge)
    window = webview.create_window(
        "TDA Companion",
        ui_entry().as_uri(),
        js_api=ui_api,
        width=1240,
        height=780,
        min_size=(900, 640),
        background_color="#0a0c0f",
        text_select=True,
        zoomable=False,
    )
    exit_coordinator = DesktopExitCoordinator()
    bridge.bind_close_desktop(lambda: exit_coordinator.request_exit(window.destroy))
    watchdog = DesktopAgentWatchdog(bridge)
    watchdog.start()

    tray: TrayController | None = None
    if settings.snapshot().get("show_tray") or acceptance_tray_exit:
        tray = TrayController(bridge, window)
        tray.start()

    if acceptance_tray_exit:
        if tray is None:
            raise RuntimeError("ACCEPTANCE_TRAY_REQUIRED")

        def on_loaded_for_acceptance() -> None:
            # pystray invokes the menu callback from its own thread. Mirror that
            # execution shape instead of calling window.destroy() directly so the
            # acceptance path exercises TrayController -> bridge.close_desktop()
            # -> DesktopExitCoordinator -> window.destroy().
            timer = threading.Timer(0.25, tray.exit_ui)
            timer.daemon = True
            timer.start()

        window.events.loaded += on_loaded_for_acceptance

    def on_closing() -> bool | None:
        current = settings.snapshot()
        if exit_coordinator.should_hide(
            str(current.get("close_behavior") or "hide"),
            tray_available=tray is not None,
        ):
            window.hide()
            return False
        return None

    window.events.closing += on_closing
    previous_renderer = os.environ.get("TDA_DESKTOP_RENDERER")
    os.environ["TDA_DESKTOP_RENDERER"] = "edgechromium"
    try:
        # Force the modern Windows WebView2 renderer. While this event loop is
        # alive, diagnostics can treat the running renderer itself as positive
        # evidence that WebView2 is available even if registry reads are blocked.
        webview.start(gui="edgechromium", debug=False)
    finally:
        watchdog.stop()
        if previous_renderer is None:
            os.environ.pop("TDA_DESKTOP_RENDERER", None)
        else:
            os.environ["TDA_DESKTOP_RENDERER"] = previous_renderer
        if tray is not None:
            tray.stop()
