from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import tda_companion.api as api_module
from tda_companion.api import create_app

TOKEN = "q" * 43
ORIGIN = "https://panel.example"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Origin": ORIGIN,
    "Content-Type": "application/json",
}


def _body(profile_id: str, *, cpu: bool = False) -> dict:
    return {
        "kind": "transcription.craig",
        "campaign_id": "campaign",
        "session_id": "session",
        "source_id": "source",
        "profile_id": profile_id,
        "glossary": "",
        "context": "",
        "cpu": cpu,
    }


def _app(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir(parents=True, exist_ok=True)
    return create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)


def test_qwen_profile_is_valid_api_input_but_requires_physical_gate_before_staging(tmp_path: Path):
    app = _app(tmp_path)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.post(
            "/api/v1/jobs",
            headers={**HEADERS, "Idempotency-Key": "qwen-gate"},
            json=_body("qwen-fast"),
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED"

        capability = client.get("/api/v1/capabilities", headers=HEADERS).json()
        assert "qwen-fast" not in capability["transcription"]["profiles"]
        assert capability["transcription"]["qwen_physical_gate"]["qwen-fast"]["ready"] is False


def test_qwen_cpu_mode_is_rejected_without_touching_source_package(tmp_path: Path):
    app = _app(tmp_path)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.post(
            "/api/v1/jobs",
            headers={**HEADERS, "Idempotency-Key": "qwen-cpu"},
            json=_body("qwen-quality", cpu=True),
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "QWEN_CPU_UNSUPPORTED"


def test_capabilities_advertise_only_profiles_with_ready_physical_gate(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(
        api_module,
        "ready_qwen_profiles",
        lambda *_args, **_kwargs: ["qwen-fast"],
    )
    monkeypatch.setattr(
        api_module,
        "inspect_qwen_physical_gate",
        lambda *_args, profile_id, **_kwargs: {
            "status": "ready" if profile_id == "qwen-fast" else "missing",
            "ready": profile_id == "qwen-fast",
            "profile_id": profile_id,
        },
    )
    monkeypatch.setattr(
        api_module,
        "inspect_whisper_runtime",
        lambda *_args, **_kwargs: {"status": "missing", "version": None},
    )

    app = _app(tmp_path)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capability = client.get("/api/v1/capabilities", headers=HEADERS).json()

    assert capability["transcription"]["profiles"] == ["qwen-fast"]
    assert "transcription.craig" in capability["capabilities"]
    assert capability["transcription"]["qwen_physical_gate"]["qwen-fast"]["ready"] is True
    assert capability["transcription"]["qwen_physical_gate"]["qwen-quality"]["ready"] is False
