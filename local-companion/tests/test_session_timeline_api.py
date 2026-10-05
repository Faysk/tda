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
SOURCE_C = "craig-" + "c" * 64


def _track(duration: float):
    return SimpleNamespace(timeline_offset_seconds=0.0, duration_seconds=duration)


def _package(source_id: str):
    values = {
        SOURCE_A: ("2026-09-27T20:00:00Z", 3600.0),
        SOURCE_B: ("2026-09-27T21:05:00+00:00", 1800.0),
        SOURCE_C: ("2026-09-27T21:30:00Z", 1800.0),
    }
    start, duration = values[source_id]
    return SimpleNamespace(start_time=start, tracks=(_track(duration),))


def _stage(data_root: Path, source_id: str):
    (data_root / "staging" / source_id).mkdir(parents=True, exist_ok=True)


def _client(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    for source_id in (SOURCE_A, SOURCE_B, SOURCE_C):
        _stage(data_root, source_id)
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda root, verify_tracks=False: _package(root.name),
    )
    return data_root, create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)


def _workspace_with_sources(client: TestClient):
    response = client.post(
        "/api/v1/session-workspaces/campaign-a/session-a",
        headers=HEADERS,
        json={},
    )
    assert response.status_code == 200
    workspace = response.json()
    for source_id in (SOURCE_C, SOURCE_A, SOURCE_B):
        response = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={
                "source_id": source_id,
                "expected_revision": workspace["revision"],
            },
        )
        assert response.status_code == 200
        workspace = response.json()
    return workspace


def test_trusted_absolute_times_derive_order_offsets_gaps_and_overlaps(
    tmp_path: Path,
    monkeypatch,
):
    data_root, app = _client(tmp_path, monkeypatch)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS).json()
        assert "transcription.session-timeline" in capabilities["capabilities"]
        workspace = _workspace_with_sources(client)
        assert [part["source_id"] for part in workspace["parts"]] == [
            SOURCE_C,
            SOURCE_A,
            SOURCE_B,
        ]

        derived = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/derive",
            headers=HEADERS,
            json={"expected_revision": workspace["revision"]},
        )
        assert derived.status_code == 200
        workspace = derived.json()
        assert workspace["ordering_mode"] == "automatic"
        assert [part["source_id"] for part in workspace["parts"]] == [
            SOURCE_A,
            SOURCE_B,
            SOURCE_C,
        ]
        assert [part["session_offset_seconds"] for part in workspace["parts"]] == [
            0.0,
            3900.0,
            5400.0,
        ]
        assert [part["source_start_confidence"] for part in workspace["parts"]] == [
            "trusted_absolute",
            "trusted_absolute",
            "trusted_absolute",
        ]
        assert workspace["timeline"]["gap_count"] == 1
        assert workspace["timeline"]["overlap_count"] == 1
        assert workspace["timeline"]["unresolved_overlap_count"] == 0
        assert workspace["timeline"]["unconfirmed_gap_count"] == 0
        assert workspace["parts"][1]["physical_interval_state"] == "trusted_absolute"
        assert workspace["parts"][2]["overlap_resolution"] == "preserve_both_exact_v1"
        assert workspace["parts"][2]["overlap_resolution_valid"] is True
        assert workspace["timeline"]["segment_boundary_policy"] == "segment_start_owner_v1"
        assert workspace["timeline"]["state"] == "ready"
        before_resolution = workspace["timeline"]["fingerprint_sha256"]

        last = workspace["parts"][2]
        resolved = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=HEADERS,
            json={
                "part_id": last["part_id"],
                "expected_revision": workspace["revision"],
                "session_offset_seconds": 5400.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": None,
                "overlap_resolution": "prefer_earlier_until",
                "overlap_boundary_seconds": 5550.0,
            },
        )
        assert resolved.status_code == 200
        workspace = resolved.json()
        assert workspace["timeline"]["state"] == "ready"
        assert workspace["parts"][2]["overlap_resolution_valid"] is True
        assert workspace["timeline"]["fingerprint_sha256"] != before_resolution
        assert workspace["timeline"]["unconfirmed_gap_count"] == 0
        assert workspace["parts"][1]["gap_confirmed"] is False
        assert workspace["parts"][1]["physical_interval_state"] == "trusted_absolute"

        stale_revision = workspace["revision"] - 2
        stale = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=HEADERS,
            json={
                "part_id": last["part_id"],
                "expected_revision": stale_revision,
                "session_offset_seconds": 5400.0,
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "SESSION_WORKSPACE_REVISION_CONFLICT"

        previous_fingerprint = workspace["timeline"]["fingerprint_sha256"]
        trimmed = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=HEADERS,
            json={
                "part_id": last["part_id"],
                "expected_revision": workspace["revision"],
                "session_offset_seconds": 5400.0,
                "trim_start_seconds": 300.0,
                "trim_end_seconds": None,
                "overlap_resolution": None,
                "overlap_boundary_seconds": None,
            },
        )
        assert trimmed.status_code == 200
        workspace = trimmed.json()
        assert workspace["parts"][2]["effective_start_seconds"] == 5700.0
        assert workspace["parts"][2]["relation_to_previous"] == "contiguous"
        assert workspace["timeline"]["state"] == "ready"
        assert workspace["timeline"]["fingerprint_sha256"] != previous_fingerprint
        final_fingerprint = workspace["timeline"]["fingerprint_sha256"]

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        assert recovered.json()["timeline"]["fingerprint_sha256"] == final_fingerprint
        assert recovered.json()["parts"][1]["gap_confirmed"] is False
        assert recovered.json()["parts"][1]["physical_interval_state"] == "trusted_absolute"
        assert recovered.json()["parts"][2]["trim_start_seconds"] == 300.0


def test_ambiguous_or_opaque_clock_never_auto_orders(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    for source_id in (SOURCE_A, SOURCE_B):
        _stage(data_root, source_id)

    def package(root, verify_tracks=False):
        if root.name == SOURCE_A:
            return SimpleNamespace(
                start_time="2026-09-27T20:00:00Z",
                tracks=(_track(60.0),),
            )
        return SimpleNamespace(
            start_time="2026-09-27T20:01:00",
            tracks=(_track(60.0),),
        )

    monkeypatch.setattr(api_module, "load_craig_package", package)
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
            json={},
        ).json()
        for source_id in (SOURCE_A, SOURCE_B):
            workspace = client.post(
                "/api/v1/session-workspaces/campaign-a/session-a/parts",
                headers=HEADERS,
                json={
                    "source_id": source_id,
                    "expected_revision": workspace["revision"],
                },
            ).json()

        before = workspace["revision"]
        assert workspace["parts"][1]["source_start_confidence"] == "ambiguous"
        response = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/derive",
            headers=HEADERS,
            json={"expected_revision": before},
        )
        assert response.status_code == 409
        assert (
            response.json()["error"]["code"]
            == "SESSION_WORKSPACE_TIMELINE_NOT_TRUSTED"
        )
        unchanged = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        ).json()
        assert unchanged["revision"] == before
        assert unchanged["ordering_mode"] == "attachment"
        assert all(
            part["session_offset_seconds"] is None
            for part in unchanged["parts"]
        )


def test_overlap_resolution_must_land_inside_actual_overlap(tmp_path: Path, monkeypatch):
    _, app = _client(tmp_path, monkeypatch)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        workspace = _workspace_with_sources(client)
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/derive",
            headers=HEADERS,
            json={"expected_revision": workspace["revision"]},
        ).json()
        target = workspace["parts"][2]
        revision = workspace["revision"]

        invalid = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=HEADERS,
            json={
                "part_id": target["part_id"],
                "expected_revision": revision,
                "session_offset_seconds": 5400.0,
                "overlap_resolution": "prefer_later_from",
                "overlap_boundary_seconds": 6000.0,
            },
        )
        assert invalid.status_code == 409
        assert (
            invalid.json()["error"]["code"]
            == "SESSION_WORKSPACE_OVERLAP_BOUNDARY_INVALID"
        )
        unchanged = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        ).json()
        assert unchanged["revision"] == revision
        assert (
            unchanged["parts"][2]["overlap_resolution"]
            == "preserve_both_exact_v1"
        )
        assert unchanged["parts"][2]["overlap_resolution_valid"] is True


def test_manual_trim_cannot_extend_beyond_source_duration(tmp_path: Path, monkeypatch):
    _, app = _client(tmp_path, monkeypatch)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        workspace = _workspace_with_sources(client)
        target = workspace["parts"][0]
        invalid = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/timing",
            headers=HEADERS,
            json={
                "part_id": target["part_id"],
                "expected_revision": workspace["revision"],
                "session_offset_seconds": 0.0,
                "trim_start_seconds": 0.0,
                "trim_end_seconds": 99999.0,
            },
        )
        assert invalid.status_code == 409
        assert invalid.json()["error"]["code"] == "SESSION_WORKSPACE_TRIM_RANGE_INVALID"
