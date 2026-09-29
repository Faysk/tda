from __future__ import annotations

from fastapi.testclient import TestClient

from tda_companion.api import create_app, error
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


def test_conflict_keeps_valid_symbolic_code_and_sanitizes_internal_text():
    valid = Conflict("SESSION_WORKSPACE_REVISION_CONFLICT")
    assert valid.code == "SESSION_WORKSPACE_REVISION_CONFLICT"
    assert str(valid) == "SESSION_WORKSPACE_REVISION_CONFLICT"

    for private_value in (
        r"sqlite failure at C:\Users\Private\jobs.sqlite3",
        "OperationalError: database is locked",
        "lowercase_internal_detail",
        "X" * 97,
        None,
    ):
        hidden = Conflict(private_value)
        assert hidden.code == "LOCAL_OPERATION_CONFLICT"
        assert str(hidden) == "LOCAL_OPERATION_CONFLICT"


def test_conflict_handler_never_serializes_exception_text(tmp_path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    secret = r"sqlite failure at C:\Users\Private\jobs.sqlite3"

    @app.get("/api/v1/security-test-conflict")
    def security_test_conflict():
        raise Conflict(secret)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.get(
            "/api/v1/security-test-conflict",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert response.status_code == 409
    assert response.json() == {
        "error": {"code": "LOCAL_OPERATION_CONFLICT", "recoverable": True}
    }
    assert secret not in response.text
    assert "Private" not in response.text
    _assert_error_headers(response)


def test_shared_error_boundary_fails_closed_for_non_public_code(tmp_path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    secret = r"C:\private\runtime\worker.log: CUDA exploded"

    @app.get("/api/v1/security-test-error")
    def security_test_error():
        return error(secret, 503, recoverable="truthy")

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.get(
            "/api/v1/security-test-error",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "INTERNAL_ERROR", "recoverable": True}
    }
    assert secret not in response.text
    assert "CUDA" not in response.text
    _assert_error_headers(response)


def test_shared_error_boundary_preserves_valid_public_codes(tmp_path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    @app.get("/api/v1/security-test-public-error")
    def security_test_public_error():
        return error("SESSION_ASSEMBLY_NOT_FOUND", 404, recoverable=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.get(
            "/api/v1/security-test-public-error",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "SESSION_ASSEMBLY_NOT_FOUND", "recoverable": False}
    }
    _assert_error_headers(response)
