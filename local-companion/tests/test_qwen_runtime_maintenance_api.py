from __future__ import annotations

from fastapi.testclient import TestClient

import tda_companion.api as api_module
from tda_companion.api import create_app

TOKEN = "r" * 43
ORIGIN = "https://dnd.faysk.dev"


def _snapshot(
    *,
    state: str = "completed",
    active: bool = False,
    mode: str | None = "check",
    can_update: bool = True,
) -> dict[str, object]:
    return {
        "schema": "tda_qwen_runtime_maintenance_v1",
        "state": state,
        "active": active,
        "operation_id": "a" * 32,
        "mode": mode,
        "stage": "complete" if not active else "checking",
        "title": "Qwen Runtime verificado.",
        "detail": "Estado sintético.",
        "sequence": 1,
        "installed_status": "ready",
        "installed_version": "1.0.11",
        "minimum_version": "1.0.12",
        "stable_status": "compatible",
        "stable_version": "1.0.12",
        "stable_tag": "companion-qwen-runtime-v1.0.12",
        "stable_size": 1024,
        "stable_part_count": 1,
        "update_available": can_update,
        "can_update": can_update,
        "error_code": None,
    }


class FakeRuntimeManager:
    instances: list["FakeRuntimeManager"] = []

    def __init__(self, **_kwargs):
        self.checks = 0
        self.updates = 0
        self.cancelled = False
        self.value = _snapshot()
        self.__class__.instances.append(self)

    def snapshot(self):
        return dict(self.value)

    def start_check(self):
        self.checks += 1
        self.value = _snapshot(mode="check")
        return dict(self.value)

    def start_update(self):
        self.updates += 1
        self.value = {
            **_snapshot(mode="update", can_update=False),
            "installed_version": "1.0.12",
            "update_available": False,
            "title": "Qwen Runtime atualizado.",
        }
        return dict(self.value)

    def request_cancel(self):
        self.cancelled = True
        return False

    def wait(self, _timeout=None):
        return True


def _browser_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Origin": ORIGIN,
        "Content-Type": "application/json",
    }


def test_browser_session_can_check_and_update_qwen_runtime(monkeypatch, tmp_path):
    FakeRuntimeManager.instances.clear()
    monkeypatch.setattr(
        api_module,
        "QwenRuntimeMaintenanceManager",
        FakeRuntimeManager,
    )
    data = tmp_path / "Data"
    data.mkdir()
    app = create_app(data, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        session = client.post(
            "/api/v1/session",
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
            json={},
        )
        browser_token = session.json()["token"]
        get_headers = {
            "Authorization": f"Bearer {browser_token}",
            "Origin": ORIGIN,
        }
        post_headers = _browser_headers(browser_token)

        capabilities = client.get("/api/v1/capabilities", headers=get_headers)
        status = client.get("/api/v1/qwen-runtime", headers=get_headers)
        checked = client.post(
            "/api/v1/qwen-runtime/check",
            headers=post_headers,
            json={},
        )
        updated = client.post(
            "/api/v1/qwen-runtime/update",
            headers=post_headers,
            json={},
        )

    assert capabilities.status_code == 200
    assert "runtime.qwen.check" in capabilities.json()["capabilities"]
    assert "runtime.qwen.update" in capabilities.json()["capabilities"]
    assert status.status_code == 200
    assert checked.status_code == 200
    assert updated.status_code == 200
    assert updated.json()["installed_version"] == "1.0.12"
    manager = FakeRuntimeManager.instances[-1]
    assert manager.checks == 1
    assert manager.updates == 1


def test_qwen_runtime_update_is_blocked_by_queued_work(monkeypatch, tmp_path):
    FakeRuntimeManager.instances.clear()
    monkeypatch.setattr(
        api_module,
        "QwenRuntimeMaintenanceManager",
        FakeRuntimeManager,
    )
    data = tmp_path / "Data"
    data.mkdir()
    app = create_app(data, TOKEN, {ORIGIN}, run_worker=False)
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/json",
    }

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        queued = client.post(
            "/api/v1/jobs",
            headers={**headers, "Idempotency-Key": "queued-maintenance-fence"},
            json={
                "kind": "synthetic.fixture",
                "campaign_id": "synthetic-campaign",
                "session_id": "synthetic-session",
                "source_id": "synthetic-source",
                "units": 3,
            },
        )
        response = client.post(
            "/api/v1/qwen-runtime/update",
            headers=headers,
            json={},
        )

    assert queued.status_code == 200
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB"
    assert FakeRuntimeManager.instances[-1].updates == 0
