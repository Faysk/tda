from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

import tda_companion.api as api_module
import tda_companion.craig_ingest_http as ingest_http
from tda_companion.api import create_app
from tda_companion.craig_ingest_http import CraigIngestBoundary
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptStats,
    TranscriptTrack,
)
from tda_companion.transcription_runs import write_completed_run


TOKEN = "t" * 43
ORIGIN = "https://dnd.faysk.dev"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}
SOURCE = "craig-" + "1" * 64


def _track():
    return SimpleNamespace(
        number=1,
        speaker="Renan",
        identity=SimpleNamespace(username="Renan", discriminator=None, discord_id="111"),
        timeline_offset_seconds=0.0,
        duration_seconds=10.0,
    )


def _package():
    return SimpleNamespace(
        source_sha256=SOURCE.removeprefix("craig-"),
        start_time="2026-09-27T20:00:00Z",
        tracks=(_track(),),
    )


def _stage_run(data_root: Path, warnings=()):
    root = data_root / "staging" / SOURCE
    root.mkdir(parents=True, exist_ok=True)
    document = TranscriptDocument(
        recording_id="recording-1",
        source_sha256=SOURCE.removeprefix("craig-"),
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="synthetic",
            profile="whisper-turbo",
            device="cpu",
        ),
        tracks=(
            TranscriptTrack(
                number=1,
                speaker="Renan",
                source_filename="1.flac",
                source_sha256=hashlib.sha256(b"track").hexdigest(),
                duration_seconds=10.0,
                timeline_offset_seconds=0.0,
                segments=(TranscriptSegment(id="s1", start=1.0, end=2.0, text="ola"),),
            ),
        ),
        warnings=warnings,
        stats=TranscriptStats(
            audio_work_seconds=10.0,
            session_duration_seconds=10.0,
            processing_seconds=1.0,
            word_count=0,
            segment_count=1,
            track_count=1,
        ),
    )
    return write_completed_run(
        root,
        document,
        job_id="assembly-api",
        attempt=1,
        source_id=SOURCE,
    )


def _prepare(monkeypatch, tmp_path, warnings=()):
    data_root = tmp_path / "Data"
    run = _stage_run(data_root, warnings)
    monkeypatch.setattr(api_module, "load_craig_package", lambda _root, verify_tracks=False: _package())
    monkeypatch.setattr(api_module, "read_attempt_outcome", lambda *_args, **_kwargs: "commit")
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    return data_root, app, run


def _build_via_api(client: TestClient, run_id: str):
    workspace = client.post(
        "/api/v1/session-workspaces/campaign-a/session-a",
        headers=HEADERS,
        json={},
    ).json()
    workspace = client.post(
        "/api/v1/session-workspaces/campaign-a/session-a/parts",
        headers=HEADERS,
        json={"source_id": SOURCE, "expected_revision": workspace["revision"]},
    ).json()
    derived = client.post(
        "/api/v1/session-workspaces/campaign-a/session-a/timeline/derive",
        headers=HEADERS,
        json={"expected_revision": workspace["revision"]},
    )
    assert derived.status_code == 200
    workspace = derived.json()
    selected = client.post(
        "/api/v1/session-workspaces/campaign-a/session-a/parts/run",
        headers=HEADERS,
        json={
            "part_id": workspace["parts"][0]["part_id"],
            "run_id": run_id,
            "expected_revision": workspace["revision"],
        },
    )
    assert selected.status_code == 200
    workspace = selected.json()
    built = client.post(
        "/api/v1/session-workspaces/campaign-a/session-a/assemblies",
        headers=HEADERS,
        json={"expected_revision": workspace["revision"]},
    )
    assert built.status_code == 200
    return workspace, built.json()


def test_session_assembly_api_selects_exact_run_builds_and_lists(tmp_path, monkeypatch):
    data_root, app, run = _prepare(monkeypatch, tmp_path)
    del data_root
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS).json()
        assert "transcription.session-assembly" in capabilities["capabilities"]
        assert "transcription.session-assembly.review" in capabilities["capabilities"]

        workspace, assembly = _build_via_api(client, run["run_id"])
        assert workspace["parts"][0]["selected_run_id"] == run["run_id"]
        assert assembly["parts"][0]["run_id"] == run["run_id"]

        listing = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a/assemblies",
            headers=HEADERS,
        )
        assert listing.status_code == 200
        assert listing.json()["assemblies"][0]["assembly_id"] == assembly["assembly_id"]

        fetched = client.get(
            f"/api/v1/session-workspaces/campaign-a/session-a/assemblies/{assembly['assembly_id']}",
            headers=HEADERS,
        )
        assert fetched.status_code == 200
        assert fetched.json()["transcript_sha256"] == assembly["transcript_sha256"]

        repeated = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/assemblies",
            headers=HEADERS,
            json={"expected_revision": workspace["revision"]},
        )
        assert repeated.status_code == 200
        assert repeated.json()["assembly_id"] == assembly["assembly_id"]


def test_stale_run_selection_and_unselected_build_fail_closed(tmp_path, monkeypatch):
    _data_root, app, run = _prepare(monkeypatch, tmp_path)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        created = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a", headers=HEADERS, json={}
        ).json()
        attached = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers=HEADERS,
            json={"source_id": SOURCE, "expected_revision": created["revision"]},
        ).json()
        derived = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/derive",
            headers=HEADERS,
            json={"expected_revision": attached["revision"]},
        ).json()

        missing_selection = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/assemblies",
            headers=HEADERS,
            json={"expected_revision": derived["revision"]},
        )
        assert missing_selection.status_code == 409
        assert missing_selection.json()["error"]["code"] == "SESSION_ASSEMBLY_PART_INVALID"

        selected = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/run",
            headers=HEADERS,
            json={
                "part_id": derived["parts"][0]["part_id"],
                "run_id": run["run_id"],
                "expected_revision": derived["revision"],
            },
        )
        assert selected.status_code == 200

        stale = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/run",
            headers=HEADERS,
            json={
                "part_id": derived["parts"][0]["part_id"],
                "run_id": run["run_id"],
                "expected_revision": derived["revision"],
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "SESSION_WORKSPACE_REVISION_CONFLICT"


def test_browser_scoped_assembly_review_approves_exact_base_and_delete_is_fenced(
    tmp_path, monkeypatch
):
    data_root, api, run = _prepare(monkeypatch, tmp_path, warnings=("QWEN_UNRECOGNIZED_WINDOW:track-1:window-2:54.000-114.000",))
    monkeypatch.setattr(ingest_http, "load_craig_package", lambda _root, verify_tracks=False: _package())
    boundary = CraigIngestBoundary(
        api,
        data_root=data_root,
        token=TOKEN,
        origins=frozenset({ORIGIN}),
        port=8765,
        browser_sessions=api.state.browser_sessions,
        source_gate=api.state.source_gate,
        source_running=api.state.source_in_use,
        run_visible=api.state.transcription_run_visible,
        result_deleted=api.state.store.clear_local_result_reference,
    )
    with TestClient(boundary, base_url="http://127.0.0.1:8765") as client:
        session = client.post("/api/v1/session", headers={"Origin": ORIGIN}, json={})
        assert session.status_code == 200
        browser_headers = {
            "Authorization": f"Bearer {session.json()['token']}",
            "Origin": ORIGIN,
        }
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers={**browser_headers, "Content-Type": "application/json"},
            json={},
        ).json()
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts",
            headers={**browser_headers, "Content-Type": "application/json"},
            json={"source_id": SOURCE, "expected_revision": workspace["revision"]},
        ).json()
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/derive",
            headers={**browser_headers, "Content-Type": "application/json"},
            json={"expected_revision": workspace["revision"]},
        ).json()
        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/parts/run",
            headers={**browser_headers, "Content-Type": "application/json"},
            json={
                "part_id": workspace["parts"][0]["part_id"],
                "run_id": run["run_id"],
                "expected_revision": workspace["revision"],
            },
        ).json()
        assembly = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/assemblies",
            headers={**browser_headers, "Content-Type": "application/json"},
            json={"expected_revision": workspace["revision"]},
        ).json()

        review_path = (
            f"/api/v1/session-workspaces/campaign-a/session-a/assemblies/"
            f"{assembly['assembly_id']}/review"
        )
        base = client.get(review_path + "/base", headers=browser_headers)
        assert base.status_code == 200
        base_value = base.json()
        assert len(base_value["warnings"]) == 1
        assert base_value["warnings"][0].endswith("QWEN_UNRECOGNIZED_WINDOW:track-1:window-2:54.000-114.000")
        assert base_value["warning_summary"] == {"total_count": 1, "displayed_count": 1, "truncated": False}
        saved = client.post(
            review_path,
            headers={**browser_headers, "Content-Type": "application/json"},
            json={
                "snapshot_contract": "tda_session_assembly_review_cas_v1",
                "expected": {
                    "persistence": "ephemeral_base",
                    "base_transcript_sha256": base_value["base"]["transcript_sha256"],
                },
                "status": "reviewed",
                "segments": [dict(row, reviewed=True) for row in base_value["segments"]],
            },
        )
        assert saved.status_code == 200
        saved_value = saved.json()
        assert saved_value["warnings"] == base_value["warnings"]

        approved = client.post(
            review_path,
            headers={**browser_headers, "Content-Type": "application/json"},
            json={
                "snapshot_contract": "tda_session_assembly_review_cas_v1",
                "expected": {
                    "persistence": "persisted",
                    "draft_revision": saved_value["draft_revision"],
                    "draft_sha256": saved_value["draft_sha256"],
                },
                "status": "approved_local",
                "segments": saved_value["segments"],
            },
        )
        assert approved.status_code == 200
        assert approved.json()["warnings"] == base_value["warnings"]
        assert client.get(review_path, headers=browser_headers).json()["warnings"] == base_value["warnings"]
        assert approved.json()["approval_current"] is True
        assert approved.json()["base"]["assembly_id"] == assembly["assembly_id"]

        blocked_delete = client.post(
            f"/api/v1/sources/{SOURCE}/runs/{run['run_id']}/delete",
            headers={**browser_headers, "Content-Type": "application/json"},
            json={
                "transcript_sha256": run["transcript_sha256"],
                "operation_id": "11111111-1111-1111-1111-111111111111",
            },
        )
        assert blocked_delete.status_code == 409
        assert blocked_delete.json()["error"]["code"] == "TRANSCRIPTION_RUN_ASSEMBLY_DEPENDENCY"
