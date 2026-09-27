from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

import tda_companion.api as api_module
from tda_companion.api import create_app


TOKEN = "t" * 43
ORIGIN = "https://dnd.faysk.dev"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}
SOURCE_A = "craig-" + "a" * 64
SOURCE_B = "craig-" + "b" * 64


def _stage(data_root: Path, source_id: str) -> None:
    (data_root / "staging" / source_id).mkdir(parents=True, exist_ok=True)


def _package(start_time: str | None, duration: float):
    return SimpleNamespace(
        start_time=start_time,
        tracks=[
            SimpleNamespace(
                timeline_offset_seconds=0.0,
                duration_seconds=duration,
            )
        ],
    )


def test_session_timeline_api_persists_manual_timing_and_resolution(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    _stage(data_root, SOURCE_A)
    _stage(data_root, SOURCE_B)
    packages = {
        SOURCE_A: _package("2026-09-27T21:00:00Z", 60.0),
        SOURCE_B: _package("2026-09-27T21:00:50Z", 60.0),
    }

    def fake_load(root: Path, verify_tracks=False):
        return packages[root.name]

    monkeypatch.setattr(api_module, "load_craig_package", fake_load)
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS).json()
        assert "transcription.session-timeline" in capabilities["capabilities"]

        created = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
            json={},
        ).json()
        first = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_A, "expected_revision": created["revision"]},
        ).json()
        second = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_B, "expected_revision": first["revision"]},
        ).json()

        relation = second["timeline"]["relations"][0]
        assert relation["kind"] == "overlap"
        assert relation["duration_seconds"] == 10.0
        assert relation["resolved"] is False
        assert second["timeline"]["ready"] is False

        resolved = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/resolve",
            headers=HEADERS,
            json={
                "earlier_part_id": second["parts"][0]["part_id"],
                "later_part_id": second["parts"][1]["part_id"],
                "decision": "prefer_earlier_until",
                "boundary_seconds": 55.0,
                "expected_revision": second["revision"],
            },
        )
        assert resolved.status_code == 200
        resolved_value = resolved.json()
        assert resolved_value["timeline"]["relations"][0]["resolved"] is True
        assert resolved_value["timeline"]["relations"][0]["boundary_seconds"] == 55.0
        assert resolved_value["timeline"]["ready"] is True

        changed = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=HEADERS,
            json={
                "part_id": resolved_value["parts"][1]["part_id"],
                "manual_offset_seconds": 75.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": 50.0,
                "expected_revision": resolved_value["revision"],
            },
        )
        assert changed.status_code == 200
        changed_value = changed.json()
        assert changed_value["timeline"]["relations"][0]["kind"] == "gap"
        assert changed_value["timeline"]["relations"][0]["duration_seconds"] == 15.0
        assert changed_value["timeline"]["relations"][0]["resolved"] is False
        assert changed_value["timeline"]["config_sha256"] != resolved_value["timeline"]["config_sha256"]

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    monkeypatch.setattr(api_module, "load_craig_package", fake_load)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        value = recovered.json()
        assert value["parts"][1]["manual_offset_seconds"] == 75.0
        assert value["parts"][1]["trim_end_seconds"] == 50.0
        assert value["timeline"]["relations"][0]["kind"] == "gap"


def test_timeline_resolution_rejects_wrong_relation_kind_and_stale_revision(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    _stage(data_root, SOURCE_A)
    _stage(data_root, SOURCE_B)
    packages = {
        SOURCE_A: _package("2026-09-27T21:00:00Z", 60.0),
        SOURCE_B: _package("2026-09-27T21:02:00Z", 60.0),
    }
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda root, verify_tracks=False: packages[root.name],
    )
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        current = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
            json={},
        ).json()
        for source_id in (SOURCE_A, SOURCE_B):
            current = client.post(
                "/api/v1/session-workspaces/campaign-a/session-a/parts",
                headers=HEADERS,
                json={"source_id": source_id, "expected_revision": current["revision"]},
            ).json()

        wrong = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/resolve",
            headers=HEADERS,
            json={
                "earlier_part_id": current["parts"][0]["part_id"],
                "later_part_id": current["parts"][1]["part_id"],
                "decision": "prefer_later_from",
                "boundary_seconds": 61.0,
                "expected_revision": current["revision"],
            },
        )
        assert wrong.status_code == 409
        assert wrong.json()["error"]["code"] == "SESSION_TIMELINE_DECISION_MISMATCH"

        acknowledged = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/resolve",
            headers=HEADERS,
            json={
                "earlier_part_id": current["parts"][0]["part_id"],
                "later_part_id": current["parts"][1]["part_id"],
                "decision": "gap_acknowledged",
                "boundary_seconds": None,
                "expected_revision": current["revision"],
            },
        )
        assert acknowledged.status_code == 200

        stale = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=HEADERS,
            json={
                "part_id": current["parts"][0]["part_id"],
                "manual_offset_seconds": 0.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": None,
                "expected_revision": current["revision"],
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "SESSION_WORKSPACE_REVISION_CONFLICT"


def test_browser_session_is_scoped_to_new_timeline_mutations(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    _stage(data_root, SOURCE_A)
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda _root, verify_tracks=False: _package(None, 60.0),
    )
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        browser = client.post(
            "/api/v1/session",
            headers={"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN},
            json={},
        ).json()
        headers = {"Authorization": f"Bearer {browser['token']}", "Origin": ORIGIN}
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=headers,
            json={},
        ).json()
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=headers,
            json={"source_id": SOURCE_A, "expected_revision": workspace["revision"]},
        ).json()
        timed = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=headers,
            json={
                "part_id": workspace["parts"][0]["part_id"],
                "manual_offset_seconds": 0.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": 60.0,
                "expected_revision": workspace["revision"],
            },
        )
        assert timed.status_code == 200
