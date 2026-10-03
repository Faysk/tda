from __future__ import annotations

from fastapi.testclient import TestClient

import tda_companion.api as api_module
from tda_companion.api import create_app

TOKEN = "w" * 43
ORIGIN = "https://dnd.faysk.dev"


def _headers(token: str = TOKEN) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Origin": ORIGIN,
        "Content-Type": "application/json",
    }


def test_whisper_rollback_runs_through_master_only_agent_gate(monkeypatch, tmp_path):
    calls: list[tuple[object, object, str]] = []

    def rollback(runtime_root, cache_root, *, target_version, **_kwargs):
        calls.append((runtime_root, cache_root, target_version))
        return {
            "accepted": True,
            "status": "ready",
            "previous_version": "1.1.8",
            "version": target_version,
            "source": "preserved",
            "worker_sha256": "a" * 64,
        }

    monkeypatch.setattr(api_module, "rollback_whisper_runtime", rollback)
    data = tmp_path / "Data"
    data.mkdir()
    app = create_app(data, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.post(
            "/api/v1/whisper-runtime/rollback",
            headers=_headers(),
            json={"version": "1.1.5"},
        )

        session = client.post(
            "/api/v1/session",
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
            json={},
        )
        browser_token = session.json()["token"]
        denied = client.post(
            "/api/v1/whisper-runtime/rollback",
            headers=_headers(browser_token),
            json={"version": "1.1.5"},
        )

    assert response.status_code == 200
    assert response.json()["previous_version"] == "1.1.8"
    assert response.json()["version"] == "1.1.5"
    assert calls == [(tmp_path / "Runtime", tmp_path / "Cache", "1.1.5")]
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "BROWSER_SESSION_SCOPE_REJECTED"


def test_whisper_rollback_is_blocked_by_queued_work(monkeypatch, tmp_path):
    called = False

    def rollback(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("rollback must not start while queued work exists")

    monkeypatch.setattr(api_module, "rollback_whisper_runtime", rollback)
    data = tmp_path / "Data"
    data.mkdir()
    app = create_app(data, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        queued = client.post(
            "/api/v1/jobs",
            headers={**_headers(), "Idempotency-Key": "queued-whisper-rollback"},
            json={
                "kind": "synthetic.fixture",
                "campaign_id": "synthetic-campaign",
                "session_id": "synthetic-session",
                "source_id": "synthetic-source",
                "units": 3,
            },
        )
        response = client.post(
            "/api/v1/whisper-runtime/rollback",
            headers=_headers(),
            json={"version": "1.1.5"},
        )

    assert queued.status_code == 200
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "RUNTIME_ROLLBACK_BLOCKED_BY_RUNNING_JOB"
    assert called is False


def test_whisper_rollback_is_blocked_by_preparation_or_qwen_maintenance(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(
        api_module,
        "rollback_whisper_runtime",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("blocked rollback must not start")
        ),
    )
    data = tmp_path / "Data"
    data.mkdir()
    app = create_app(data, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        monkeypatch.setattr(app.state.preparation_manager, "snapshot", lambda: {"active": True})
        preparation = client.post(
            "/api/v1/whisper-runtime/rollback",
            headers=_headers(),
            json={"version": "1.1.5"},
        )
        monkeypatch.setattr(app.state.preparation_manager, "snapshot", lambda: {"active": False})
        monkeypatch.setattr(app.state.qwen_runtime_manager, "snapshot", lambda: {"active": True})
        qwen = client.post(
            "/api/v1/whisper-runtime/rollback",
            headers=_headers(),
            json={"version": "1.1.5"},
        )

    assert preparation.status_code == 409
    assert (
        preparation.json()["error"]["code"]
        == "RUNTIME_ROLLBACK_BLOCKED_BY_TRANSCRIPTION_PREPARATION"
    )
    assert qwen.status_code == 409
    assert qwen.json()["error"]["code"] == "RUNTIME_ROLLBACK_BLOCKED_BY_RUNTIME_MAINTENANCE"
