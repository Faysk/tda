from __future__ import annotations

import shutil
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

import tda_companion.api as api_module
from tda_companion.api import create_app


TOKEN = "t" * 43
ORIGIN = "https://dnd.faysk.dev"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Origin": ORIGIN,
}
SOURCE_A = "craig-" + "a" * 64
SOURCE_B = "craig-" + "b" * 64
SOURCE_C = "craig-" + "c" * 64


def _stage(data_root: Path, source_id: str) -> Path:
    root = data_root / "staging" / source_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_session_workspace_api_is_additive_durable_and_cas_guarded(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda _root, verify_tracks=False: SimpleNamespace(),
    )

    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    for source_id in (SOURCE_A, SOURCE_B, SOURCE_C):
        _stage(data_root, source_id)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS)
        assert capabilities.status_code == 200
        assert "transcription.session-workspace" in capabilities.json()["capabilities"]

        created = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
            json={},
        )
        assert created.status_code == 200
        workspace = created.json()
        assert workspace["schema_version"] == "tda_session_workspace_v1"
        assert workspace["revision"] == 0
        assert workspace["parts"] == []

        first = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_A, "expected_revision": 0},
        )
        assert first.status_code == 200
        workspace = first.json()
        assert workspace["revision"] == 1
        assert workspace["parts"][0]["source_id"] == SOURCE_A
        assert workspace["parts"][0]["source_state"] == "ready"

        duplicate = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_A, "expected_revision": 1},
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["revision"] == 1
        assert len(duplicate.json()["parts"]) == 1

        second = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_B, "expected_revision": 1},
        )
        assert second.status_code == 200
        workspace = second.json()
        assert workspace["revision"] == 2
        ids = [part["part_id"] for part in workspace["parts"]]

        stale = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_C, "expected_revision": 1},
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "SESSION_WORKSPACE_REVISION_CONFLICT"

        reordered = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/reorder",
            headers=HEADERS,
            json={"part_ids": list(reversed(ids)), "expected_revision": 2},
        )
        assert reordered.status_code == 200
        workspace = reordered.json()
        assert workspace["revision"] == 3
        assert [part["part_id"] for part in workspace["parts"]] == list(reversed(ids))

        detached = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/detach",
            headers=HEADERS,
            json={"part_id": ids[0], "expected_revision": 3},
        )
        assert detached.status_code == 200
        workspace = detached.json()
        assert workspace["revision"] == 4
        assert [part["source_id"] for part in workspace["parts"]] == [SOURCE_B]

        shutil.rmtree(data_root / "staging" / SOURCE_B)
        missing = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        )
        assert missing.status_code == 200
        body = missing.json()
        assert body["parts"][0]["source_id"] == SOURCE_B
        assert body["parts"][0]["source_state"] == "invalid"
        serialized = missing.text.lower()
        assert "transcript" not in serialized
        assert str(tmp_path).lower() not in serialized
        assert TOKEN.lower() not in serialized

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        assert recovered.json()["revision"] == 4
        assert recovered.json()["parts"][0]["source_id"] == SOURCE_B


def test_browser_session_is_scoped_to_session_workspace_routes(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda _root, verify_tracks=False: SimpleNamespace(),
    )
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    _stage(data_root, SOURCE_A)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        session = client.post("/api/v1/session", headers={"Origin": ORIGIN}, json={})
        assert session.status_code == 200
        browser_headers = {
            "Authorization": f"Bearer {session.json()['token']}",
            "Origin": ORIGIN,
        }

        created = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=browser_headers,
            json={},
        )
        assert created.status_code == 200
        attached = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=browser_headers,
            json={"source_id": SOURCE_A, "expected_revision": 0},
        )
        assert attached.status_code == 200
        assert attached.json()["parts"][0]["source_id"] == SOURCE_A


def test_session_timeline_api_classifies_clocks_and_requires_explicit_gap_resolution(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"

    def package(root, verify_tracks=False):
        source_id = root.name
        if source_id == SOURCE_A:
            start_time = "2026-09-27T20:00:00Z"
            duration = 60.0
        elif source_id == SOURCE_B:
            start_time = "2026-09-27T21:01:00.001+01:00"
            duration = 60.0
        else:
            start_time = "clock unavailable"
            duration = 60.0
        return SimpleNamespace(
            start_time=start_time,
            tracks=(
                SimpleNamespace(
                    duration_seconds=duration,
                    timeline_offset_seconds=0.0,
                ),
            ),
        )

    monkeypatch.setattr(api_module, "load_craig_package", package)
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    for source_id in (SOURCE_A, SOURCE_B, SOURCE_C):
        _stage(data_root, source_id)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS).json()
        assert "transcription.session-timeline" in capabilities["capabilities"]

        workspace = client.post(
            "/api/v1/session-workspaces/campaign-time/session-time",
            headers=HEADERS,
            json={},
        ).json()
        for source_id in (SOURCE_A, SOURCE_B):
            response = client.post(
                "/api/v1/session-workspaces/campaign-time/session-time/parts",
                headers=HEADERS,
                json={
                    "source_id": source_id,
                    "expected_revision": workspace["revision"],
                },
            )
            assert response.status_code == 200
            workspace = response.json()

        assert [part["start_time"]["confidence"] for part in workspace["timeline"]["parts"]] == [
            "trusted_absolute",
            "trusted_absolute",
        ]
        assert workspace["timeline"]["boundaries"][0]["kind"] == "gap"
        assert workspace["timeline"]["boundaries"][0]["duration_ms"] == 1
        assert workspace["timeline"]["approval_ready"] is False

        parts = workspace["parts"]
        accepted = client.post(
            "/api/v1/session-workspaces/campaign-time/session-time/timeline",
            headers=HEADERS,
            json={
                "expected_revision": workspace["revision"],
                "parts": [
                    {
                        "part_id": part["part_id"],
                        "session_offset_ms": None,
                        "trim_start_ms": 0,
                        "trim_end_ms": None,
                    }
                    for part in parts
                ],
                "boundaries": [
                    {
                        "left_part_id": parts[0]["part_id"],
                        "right_part_id": parts[1]["part_id"],
                        "mode": "accept_gap",
                        "boundary_ms": None,
                    }
                ],
            },
        )
        assert accepted.status_code == 200
        body = accepted.json()
        assert body["revision"] == workspace["revision"] + 1
        assert body["timeline"]["approval_ready"] is True
        assert body["timeline"]["boundaries"][0]["resolved"] is True
        assert len(body["timeline"]["timeline_identity_sha256"]) == 64
        assert "timeline_config" not in body

        stale = client.post(
            "/api/v1/session-workspaces/campaign-time/session-time/timeline",
            headers=HEADERS,
            json={
                "expected_revision": workspace["revision"],
                "parts": [
                    {
                        "part_id": part["part_id"],
                        "session_offset_ms": None,
                        "trim_start_ms": 0,
                        "trim_end_ms": None,
                    }
                    for part in parts
                ],
                "boundaries": [],
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "SESSION_WORKSPACE_REVISION_CONFLICT"

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-time/session-time",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        assert recovered.json()["timeline"]["approval_ready"] is True


def test_session_timeline_rejects_overlap_boundary_outside_owned_region(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"

    def package(root, verify_tracks=False):
        start_time = (
            "2026-09-27T20:00:00Z"
            if root.name == SOURCE_A
            else "2026-09-27T20:00:30Z"
        )
        return SimpleNamespace(
            start_time=start_time,
            tracks=(
                SimpleNamespace(
                    duration_seconds=60.0,
                    timeline_offset_seconds=0.0,
                ),
            ),
        )

    monkeypatch.setattr(api_module, "load_craig_package", package)
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    for source_id in (SOURCE_A, SOURCE_B):
        _stage(data_root, source_id)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-overlap/session-overlap",
            headers=HEADERS,
            json={},
        ).json()
        for source_id in (SOURCE_A, SOURCE_B):
            workspace = client.post(
                "/api/v1/session-workspaces/campaign-overlap/session-overlap/parts",
                headers=HEADERS,
                json={
                    "source_id": source_id,
                    "expected_revision": workspace["revision"],
                },
            ).json()
        parts = workspace["parts"]
        invalid = client.post(
            "/api/v1/session-workspaces/campaign-overlap/session-overlap/timeline",
            headers=HEADERS,
            json={
                "expected_revision": workspace["revision"],
                "parts": [
                    {
                        "part_id": part["part_id"],
                        "session_offset_ms": None,
                        "trim_start_ms": 0,
                        "trim_end_ms": None,
                    }
                    for part in parts
                ],
                "boundaries": [
                    {
                        "left_part_id": parts[0]["part_id"],
                        "right_part_id": parts[1]["part_id"],
                        "mode": "prefer_later_from",
                        "boundary_ms": 75_000,
                    }
                ],
            },
        )
        assert invalid.status_code == 409
        assert invalid.json()["error"]["code"] == "SESSION_TIMELINE_RESOLUTION_INVALID"

        unchanged = client.get(
            "/api/v1/session-workspaces/campaign-overlap/session-overlap",
            headers=HEADERS,
        ).json()
        assert unchanged["revision"] == workspace["revision"]
        assert unchanged["timeline"]["boundaries"][0]["resolved"] is False
