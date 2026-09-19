from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from .desktop_session_bridge import SessionDesktopBridge
from .paths import CompanionPaths
from .settings import SettingsStore
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

    tray: TrayController | None = None
    if settings.snapshot().get("show_tray"):
        tray = TrayController(bridge, window)
        tray.start()

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
        if previous_renderer is None:
            os.environ.pop("TDA_DESKTOP_RENDERER", None)
        else:
            os.environ["TDA_DESKTOP_RENDERER"] = previous_renderer
        if tray is not None:
            tray.stop()
