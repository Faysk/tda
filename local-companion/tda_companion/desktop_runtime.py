from __future__ import annotations

from pathlib import Path
from typing import Callable

from .desktop import DesktopBridge
from .paths import CompanionPaths
from .settings import SettingsStore
from .tray import TrayController


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
    start_agent: Callable[[], None],
) -> None:
    """Run the product desktop UI while the Agent stays in its own process."""
    try:
        import webview
    except ModuleNotFoundError as exc:
        raise RuntimeError("DESKTOP_WEBVIEW_NOT_INSTALLED") from exc

    bridge = DesktopBridge(
        token=token,
        port=port,
        paths=paths,
        settings=settings,
        executable=executable,
        start_agent=start_agent,
    )
    window = webview.create_window(
        "TDA Companion",
        ui_entry().as_uri(),
        js_api=bridge,
        width=1240,
        height=780,
        min_size=(900, 640),
        background_color="#0a0c0f",
        text_select=True,
        zoomable=False,
    )

    tray: TrayController | None = None
    if settings.snapshot().get("show_tray"):
        tray = TrayController(bridge, window)
        tray.start()

    def on_closing() -> bool | None:
        current = settings.snapshot()
        if current.get("close_behavior") == "hide" and tray is not None:
            window.hide()
            return False
        return None

    window.events.closing += on_closing
    try:
        # Force the modern Windows WebView2 renderer. A missing Evergreen runtime
        # is a diagnosable installation problem, not a reason to fall back to IE.
        webview.start(gui="edgechromium", debug=False)
    finally:
        if tray is not None:
            tray.stop()
