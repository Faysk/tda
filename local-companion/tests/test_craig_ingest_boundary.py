from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.craig_ingest_http import CraigIngestBoundary

TOKEN = "i" * 43
ORIGIN = "https://dnd.faysk.dev"


def _payload() -> bytes:
    value = io.BytesIO()
    with zipfile.ZipFile(value, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-alice")
    return value.getvalue()


def _client(tmp_path: Path) -> TestClient:
    root = tmp_path / "Data"
    root.mkdir()
    api = create_app(root, TOKEN, {ORIGIN}, run_worker=False)
    app = CraigIngestBoundary(
        api,
        data_root=root,
        token=TOKEN,
        origins=frozenset({ORIGIN}),
        port=8765,
    )
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_boundary_accepts_zip_and_rejects_bad_credentials_or_media(tmp_path: Path):
    payload = _payload()
    headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN, "Content-Type": "application/zip"}
    with _client(tmp_path) as client:
        response = client.post("/api/v1/sources/craig", headers=headers, content=payload)
        assert response.status_code == 200
        assert response.json()["schema_version"] == "tda_craig_ingest_v1"

        unauthorized = client.post(
            "/api/v1/sources/craig",
            headers={**headers, "Authorization": "Bearer invalid"},
            content=payload,
        )
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "UNAUTHORIZED"

        wrong_media = client.post(
            "/api/v1/sources/craig",
            headers={**headers, "Content-Type": "application/json"},
            content=payload,
        )
        assert wrong_media.status_code == 415
        assert wrong_media.json()["error"]["code"] == "CRAIG_ZIP_REQUIRED"


def test_boundary_preflight_is_narrow_and_private_network_aware(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.options(
            "/api/v1/sources/craig",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, content-type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert response.headers["access-control-allow-private-network"] == "true"

        rejected = client.options(
            "/api/v1/sources/craig",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, x-file-path",
            },
        )
        assert rejected.status_code == 403
        assert rejected.json()["error"]["code"] == "PREFLIGHT_REJECTED"
