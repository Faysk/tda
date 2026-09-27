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



def test_session_timeline_api_classifies_clocks_and_requires_explicit_overlap_resolution(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"
    packages = {
        SOURCE_A: SimpleNamespace(
            start_time="2026-09-27T20:00:00Z",
            tracks=(
                SimpleNamespace(
                    timeline_offset_seconds=0.0,
                    duration_seconds=120.0,
                ),
            ),
        ),
        SOURCE_B: SimpleNamespace(
            start_time="2026-09-27T20:01:30Z",
            tracks=(
                SimpleNamespace(
                    timeline_offset_seconds=0.0,
                    duration_seconds=120.0,
                ),
            ),
        ),
    }

    def load_package(root, verify_tracks=False):
        del verify_tracks
        return packages[root.name]

    monkeypatch.setattr(api_module, "load_craig_package", load_package)
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    for source_id in (SOURCE_A, SOURCE_B):
        _stage(data_root, source_id)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS)
        assert capabilities.status_code == 200
        assert "transcription.session-timeline" in capabilities.json()["capabilities"]

        created = client.post(
            "/api/v1/session-workspaces/campaign-a/session-timeline",
            headers=HEADERS,
            json={},
        ).json()
        first = client.post(
            "/api/v1/session-workspaces/campaign-a/session-timeline/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_A, "expected_revision": created["revision"]},
        ).json()
        second = client.post(
            "/api/v1/session-workspaces/campaign-a/session-timeline/parts",
            headers=HEADERS,
            json={"source_id": SOURCE_B, "expected_revision": first["revision"]},
        ).json()
        assert second["chronology_mode"] == "automatic"

        automatic = client.get(
            "/api/v1/session-workspaces/campaign-a/session-timeline/timeline",
            headers=HEADERS,
        )
        assert automatic.status_code == 200
        timeline = automatic.json()
        assert [part["session_offset_seconds"] for part in timeline["parts"]] == [
            0.0,
            90.0,
        ]
        assert all(
            part["start_time"]["classification"] == "trusted_absolute"
            for part in timeline["parts"]
        )
        assert timeline["relations"][0]["kind"] == "overlap"
        assert timeline["relations"][0]["seconds"] == 30.0
        assert timeline["relations"][0]["resolved"] is False
        assert timeline["approval_blocked"] is True

        ids = [part["part_id"] for part in second["parts"]]
        manual_a = client.post(
            "/api/v1/session-workspaces/campaign-a/session-timeline/parts/timing",
            headers=HEADERS,
            json={
                "part_id": ids[0],
                "expected_revision": second["revision"],
                "manual_offset_seconds": 0.0,
                "trim_start_seconds": None,
                "trim_end_seconds": None,
                "gap_confirmed": False,
                "overlap_boundary_seconds": None,
            },
        )
        assert manual_a.status_code == 200
        workspace = manual_a.json()
        assert workspace["chronology_mode"] == "manual"

        manual_b = client.post(
            "/api/v1/session-workspaces/campaign-a/session-timeline/parts/timing",
            headers=HEADERS,
            json={
                "part_id": ids[1],
                "expected_revision": workspace["revision"],
                "manual_offset_seconds": 90.0,
                "trim_start_seconds": None,
                "trim_end_seconds": None,
                "gap_confirmed": False,
                "overlap_boundary_seconds": 105.0,
            },
        )
        assert manual_b.status_code == 200

        resolved = client.get(
            "/api/v1/session-workspaces/campaign-a/session-timeline/timeline",
            headers=HEADERS,
        )
        assert resolved.status_code == 200
        body = resolved.json()
        assert body["chronology_mode"] == "manual"
        assert body["relations"][0]["kind"] == "overlap"
        assert body["relations"][0]["resolved"] is True
        assert body["relations"][0]["resolution"] == "split_boundary_v1"
        assert body["relations"][0]["boundary_seconds"] == 105.0
        assert body["approval_blocked"] is False
        digest = body["configuration_sha256"]

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-a/session-timeline/timeline",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        assert recovered.json()["configuration_sha256"] == digest
        assert recovered.json()["relations"][0]["resolved"] is True


def test_browser_scoped_session_token_can_read_timeline_and_write_timing(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda _root, verify_tracks=False: SimpleNamespace(
            start_time="2026-09-27T20:00:00Z",
            tracks=(
                SimpleNamespace(
                    timeline_offset_seconds=0.0,
                    duration_seconds=60.0,
                ),
            ),
        ),
    )
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    _stage(data_root, SOURCE_A)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        session = client.post("/api/v1/session", headers={"Origin": ORIGIN}, json={})
        browser_headers = {
            "Authorization": f"Bearer {session.json()['token']}",
            "Origin": ORIGIN,
        }
        created = client.post(
            "/api/v1/session-workspaces/campaign-browser/session-browser",
            headers=browser_headers,
            json={},
        ).json()
        attached = client.post(
            "/api/v1/session-workspaces/campaign-browser/session-browser/parts",
            headers=browser_headers,
            json={"source_id": SOURCE_A, "expected_revision": created["revision"]},
        ).json()
        part_id = attached["parts"][0]["part_id"]

        timed = client.post(
            "/api/v1/session-workspaces/campaign-browser/session-browser/parts/timing",
            headers=browser_headers,
            json={
                "part_id": part_id,
                "expected_revision": attached["revision"],
                "manual_offset_seconds": 0.0,
                "trim_start_seconds": None,
                "trim_end_seconds": 50.0,
                "gap_confirmed": False,
                "overlap_boundary_seconds": None,
            },
        )
        assert timed.status_code == 200
        assert timed.json()["chronology_mode"] == "manual"

        timeline = client.get(
            "/api/v1/session-workspaces/campaign-browser/session-browser/timeline",
            headers=browser_headers,
        )
        assert timeline.status_code == 200
        assert timeline.json()["parts"][0]["effective_end_seconds"] == 50.0
        assert timeline.json()["approval_blocked"] is False
