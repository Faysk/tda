from __future__ import annotations

from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.store import Conflict

TOKEN = "s" * 43
ORIGIN = "https://dnd.faysk.dev"


def _assert_error_headers(response) -> None:
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_early_host_rejection_keeps_security_headers(tmp_path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://localhost:8765") as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 403
    assert response.json() == {
        "error": {"code": "HOST_REJECTED", "recoverable": False}
    }
    _assert_error_headers(response)
    assert "access-control-allow-origin" not in response.headers


def test_early_origin_rejection_keeps_security_headers_without_reflecting_origin(tmp_path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.get(
            "/api/v1/health",
            headers={"Origin": "https://evil.invalid"},
        )

    assert response.status_code == 403
    assert response.json() == {
        "error": {"code": "ORIGIN_REJECTED", "recoverable": False}
    }
    _assert_error_headers(response)
    assert "access-control-allow-origin" not in response.headers


def test_authenticated_guard_error_keeps_security_headers_and_allowed_cors(tmp_path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.get(
            "/api/v1/jobs",
            headers={"Origin": ORIGIN, "Authorization": "Bearer wrong"},
        )

    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "UNAUTHORIZED", "recoverable": False}
    }
    _assert_error_headers(response)
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_conflict_preserves_only_public_error_codes():
    assert Conflict("SESSION_WORKSPACE_REVISION_CONFLICT").code == "SESSION_WORKSPACE_REVISION_CONFLICT"
    assert str(Conflict("SESSION_WORKSPACE_REVISION_CONFLICT")) == "SESSION_WORKSPACE_REVISION_CONFLICT"

    hidden = Conflict("sqlite failure at C:\\Users\\Private\\jobs.sqlite3")
    assert hidden.code == "LOCAL_OPERATION_CONFLICT"
    assert str(hidden) == "LOCAL_OPERATION_CONFLICT"
