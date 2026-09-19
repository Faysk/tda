from __future__ import annotations

from tda_companion.desktop_runtime import DesktopExitCoordinator, DesktopUiApi


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
