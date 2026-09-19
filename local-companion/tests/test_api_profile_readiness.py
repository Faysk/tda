from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

import tda_companion.api as api_module
from tda_companion.api import create_app
from tda_companion.asr_models import MODEL_MARKER, get_profile, model_path, write_install_marker
from tda_companion.asr_runtime import install_whisper_runtime_archive
from tda_companion.craig import ingest_craig_zip
from tda_companion.runtime_compat import MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION


TOKEN = "t" * 43
ORIGIN = "https://dnd.faysk.dev"


def _client(tmp_path: Path) -> TestClient:
    data = tmp_path / "Data"
    data.mkdir(parents=True, exist_ok=True)
    source = tmp_path / "craig-source.zip"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-a")
    ingest_craig_zip(source, data / "staging" / "craig-source")
    app = create_app(
        data,
        TOKEN,
        {ORIGIN},
        port=8765,
        run_worker=False,
        models_root=tmp_path / "Models",
    )
    return TestClient(app, base_url="http://127.0.0.1:8765")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
    }


def _body() -> dict[str, object]:
    return {
        "kind": "transcription.craig",
        "campaign_id": "desktop-local",
        "session_id": "local-session",
        "source_id": "craig-source",
        "profile_id": "whisper-detailed",
        "glossary": "",
        "context": "",
        "cpu": False,
    }


def _install_whisper_runtime(tmp_path: Path) -> None:
    archive = tmp_path / "whisper-runtime.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.writestr("TDAWhisperWorker.exe", b"worker")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    install_whisper_runtime_archive(
        archive,
        tmp_path / "Runtime",
        version=MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
        expected_sha256=digest,
    )


def test_whisper_submission_uses_metadata_runtime_check_not_full_rehash(monkeypatch, tmp_path: Path):
    calls: list[bool] = []

    def inspect(_root, *, verify_worker=False):
        calls.append(verify_worker)
        return {"status": "missing"}

    monkeypatch.setattr(api_module, "inspect_whisper_runtime", inspect)

    with _client(tmp_path) as client:
        response = client.post(
            "/api/v1/jobs",
            headers={**_headers(), "Idempotency-Key": "whisper-light-runtime-check"},
            json=_body(),
        )

    assert response.status_code == 409
    assert calls == [False]


def test_agent_rejects_whisper_submission_when_runtime_is_not_ready(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.post(
            "/api/v1/jobs",
            headers={**_headers(), "Idempotency-Key": "whisper-no-runtime"},
            json=_body(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "WHISPER_RUNTIME_UNAVAILABLE"


def test_agent_requires_one_time_preparation_for_legacy_whisper_marker(tmp_path: Path):
    _install_whisper_runtime(tmp_path)
    profile = get_profile("whisper-detailed")
    directory = model_path(tmp_path / "Models", profile)
    directory.mkdir(parents=True)
    for name in profile.required_files:
        (directory / name).write_bytes(f"fixture:{name}".encode("utf-8"))
    write_install_marker(directory, profile)

    marker_path = directory / MODEL_MARKER
    legacy = json.loads(marker_path.read_text(encoding="utf-8"))
    legacy.pop("metadata_sha256")
    marker_path.write_text(json.dumps(legacy), encoding="utf-8")

    with _client(tmp_path) as client:
        response = client.post(
            "/api/v1/jobs",
            headers={**_headers(), "Idempotency-Key": "whisper-legacy-marker"},
            json=_body(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "WHISPER_MODEL_PREPARATION_REQUIRED"


def test_agent_rejects_whisper_submission_until_model_is_prepared(tmp_path: Path):
    _install_whisper_runtime(tmp_path)

    with _client(tmp_path) as client:
        response = client.post(
            "/api/v1/jobs",
            headers={**_headers(), "Idempotency-Key": "whisper-no-model"},
            json=_body(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "WHISPER_MODEL_PREPARATION_REQUIRED"
