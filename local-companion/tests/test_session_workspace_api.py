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
        lambda _root, verify_tracks=False: SimpleNamespace(start_time=None, tracks=()),
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
        lambda _root, verify_tracks=False: SimpleNamespace(start_time=None, tracks=()),
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



def test_session_workspace_chronology_derives_trusted_offsets_and_persists_manual_resolution(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"

    def package(root, verify_tracks=False):
        source_id = Path(root).name
        if source_id == SOURCE_A:
            return SimpleNamespace(
                start_time="2026-09-27T20:00:00Z",
                tracks=(SimpleNamespace(timeline_offset_seconds=0.0, duration_seconds=60.0),),
            )
        if source_id == SOURCE_B:
            return SimpleNamespace(
                start_time="2026-09-27T21:01:30+01:00",
                tracks=(SimpleNamespace(timeline_offset_seconds=0.0, duration_seconds=45.0),),
            )
        raise ValueError("unknown synthetic source")

    monkeypatch.setattr(api_module, "load_craig_package", package)
    for source_id in (SOURCE_A, SOURCE_B):
        _stage(data_root, source_id)

    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS)
        assert capabilities.status_code == 200
        assert "transcription.session-chronology" in capabilities.json()["capabilities"]

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

        assert second["chronology"]["parts"][0]["session_offset_seconds"] == 0.0
        assert second["chronology"]["parts"][1]["session_offset_seconds"] == 90.0
        assert second["chronology"]["relations"][0]["kind"] == "gap"
        assert second["chronology"]["relations"][0]["seconds"] == 30.0
        assert second["chronology"]["ready_for_assembly"] is False
        part_b = second["parts"][1]["part_id"]

        confirmed = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timeline",
            headers=HEADERS,
            json={
                "part_id": part_b,
                "expected_revision": second["revision"],
                "session_offset_seconds": None,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": None,
                "gap_confirmed": True,
                "overlap_resolution": None,
                "overlap_boundary_seconds": None,
            },
        )
        assert confirmed.status_code == 200
        body = confirmed.json()
        assert body["chronology"]["ready_for_assembly"] is True
        confirmed_sha = body["chronology"]["sha256"]

        overlapped = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timeline",
            headers=HEADERS,
            json={
                "part_id": part_b,
                "expected_revision": body["revision"],
                "session_offset_seconds": 30.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": None,
                "gap_confirmed": False,
                "overlap_resolution": None,
                "overlap_boundary_seconds": None,
            },
        )
        assert overlapped.status_code == 200
        body = overlapped.json()
        assert body["chronology"]["relations"][0]["kind"] == "overlap"
        assert body["chronology"]["relations"][0]["seconds"] == 30.0
        assert body["chronology"]["ready_for_assembly"] is False
        assert body["chronology"]["sha256"] != confirmed_sha

        resolved = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timeline",
            headers=HEADERS,
            json={
                "part_id": part_b,
                "expected_revision": body["revision"],
                "session_offset_seconds": 30.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": None,
                "gap_confirmed": False,
                "overlap_resolution": "prefer_later_from",
                "overlap_boundary_seconds": 45.0,
            },
        )
        assert resolved.status_code == 200
        body = resolved.json()
        assert body["chronology"]["ready_for_assembly"] is True
        assert body["chronology"]["relations"][0]["overlap_resolution"] == {
            "version": "boundary_v1",
            "mode": "prefer_later_from",
            "boundary_seconds": 45.0,
            "segment_policy": "segment_start_owner_v1",
        }
        revision = body["revision"]
        resolved_sha = body["chronology"]["sha256"]

        stale = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timeline",
            headers=HEADERS,
            json={
                "part_id": part_b,
                "expected_revision": second["revision"],
                "session_offset_seconds": 90.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": None,
                "gap_confirmed": True,
                "overlap_resolution": None,
                "overlap_boundary_seconds": None,
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "SESSION_WORKSPACE_REVISION_CONFLICT"

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        body = recovered.json()
        assert body["revision"] == revision
        assert body["parts"][1]["session_offset_seconds"] == 30.0
        assert body["parts"][1]["overlap_resolution"] == "prefer_later_from"
        assert body["chronology"]["ready_for_assembly"] is True
        assert body["chronology"]["sha256"] == resolved_sha
