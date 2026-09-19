from __future__ import annotations

from tda_companion.browser_session import BrowserSessionManager


def test_browser_session_is_origin_bound_and_not_stored_in_plaintext():
    manager = BrowserSessionManager(ttl_seconds=60, max_sessions=4)
    session = manager.issue("https://dnd.faysk.dev")

    assert manager.validate(session.token, "https://dnd.faysk.dev") is True
    assert manager.validate(session.token, "https://preview.example") is False
    assert manager.validate(session.token, None) is False
    assert session.token not in repr(manager._sessions)
    assert session.expires_in_seconds == 60


def test_browser_session_capacity_prunes_oldest_entry():
    manager = BrowserSessionManager(ttl_seconds=60, max_sessions=2)
    first = manager.issue("https://dnd.faysk.dev")
    second = manager.issue("https://dnd.faysk.dev")
    third = manager.issue("https://dnd.faysk.dev")

    assert manager.validate(first.token, "https://dnd.faysk.dev") is False
    assert manager.validate(second.token, "https://dnd.faysk.dev") is True
    assert manager.validate(third.token, "https://dnd.faysk.dev") is True
