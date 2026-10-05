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
        assert "transcription.session-intent" in capabilities.json()["capabilities"]

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
        browser_capabilities = client.get(
            "/api/v1/capabilities",
            headers=browser_headers,
        )
        assert browser_capabilities.status_code == 200
        assert (
            "transcription.session-sequence"
            in browser_capabilities.json()["capabilities"]
        )

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

        # Domain validation should reject a one-part sequence, but the browser
        # credential must be authorized to reach the new endpoint first.
        sequence = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/confirm-sequence",
            headers=browser_headers,
            json={"expected_revision": attached.json()["revision"]},
        )
        assert sequence.status_code == 409
        assert sequence.json()["error"]["code"] == "SESSION_WORKSPACE_SEQUENCE_INVALID"



def test_participant_mapping_api_uses_discord_identity_and_persists_manual_resolution(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"

    def track(number, speaker, *, username=None, discord_id=None):
        return SimpleNamespace(
            number=number,
            speaker=speaker,
            identity=SimpleNamespace(
                username=username,
                discriminator=None,
                discord_id=discord_id,
            ),
            timeline_offset_seconds=0.0,
            duration_seconds=60.0,
        )

    packages = {
        SOURCE_A: SimpleNamespace(
            start_time="2026-09-27T20:00:00Z",
            tracks=(
                track(1, "Renan", username="Renan", discord_id="111"),
                track(2, "Guest", username="Guest"),
            ),
        ),
        SOURCE_B: SimpleNamespace(
            start_time="2026-09-27T21:00:00Z",
            tracks=(
                track(7, "Faysk", username="Faysk", discord_id="111"),
                track(8, "Guest", username="Guest"),
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
        assert "transcription.session-participants" in capabilities.json()["capabilities"]

        workspace = client.post(
            "/api/v1/session-workspaces/campaign-map/session-map",
            headers=HEADERS,
            json={},
        ).json()
        for source_id in (SOURCE_A, SOURCE_B):
            response = client.post(
                "/api/v1/session-workspaces/campaign-map/session-map/parts",
                headers=HEADERS,
                json={
                    "source_id": source_id,
                    "expected_revision": workspace["revision"],
                },
            )
            assert response.status_code == 200
            workspace = response.json()

        projection = client.get(
            "/api/v1/session-workspaces/campaign-map/session-map/participants",
            headers=HEADERS,
        )
        assert projection.status_code == 200
        body = projection.json()
        assert body["schema_version"] == "tda_session_participant_mapping_v1"
        assert body["policy"] == "strong_discord_or_manual_v1"
        assert body["workspace_revision"] == workspace["revision"]
        assert body["approval_blocked"] is True
        assert all(
            participant["profile_id"] is None for participant in body["participants"]
        )

        renan_observations = [
            row for row in body["observations"] if row["discord_id"] == "111"
        ]
        assert len(renan_observations) == 2
        renan_participants = [
            participant["participant_id"]
            for participant in body["participants"]
            if any(
                observation["observation_id"] in participant["observation_ids"]
                for observation in renan_observations
            )
        ]
        assert len(set(renan_participants)) == 1
        assert any(
            conflict["code"] == "DISCORD_LABEL_DRIFT"
            for conflict in body["conflicts"]
        )

        guests = [
            row for row in body["observations"] if row["raw_speaker"] == "Guest"
        ]
        assert len(guests) == 2
        assert any(
            conflict["code"] == "LABEL_ONLY_CROSS_SOURCE_AMBIGUOUS"
            for conflict in body["conflicts"]
        )
        unresolved_hash = body["mapping_sha256"]

        manual_participant = "e" * 32
        resolved = client.post(
            "/api/v1/session-workspaces/campaign-map/session-map/participants",
            headers=HEADERS,
            json={
                "expected_revision": workspace["revision"],
                "assignments": [
                    {
                        "observation_id": observation["observation_id"],
                        "participant_id": manual_participant,
                    }
                    for observation in guests
                ],
            },
        )
        assert resolved.status_code == 200
        body = resolved.json()
        assert body["workspace_revision"] == workspace["revision"] + 1
        assert body["approval_blocked"] is False
        assert body["mapping_sha256"] != unresolved_hash
        assert any(
            participant["participant_id"] == manual_participant
            and participant["resolution"] == "manual"
            and len(participant["observation_ids"]) == 2
            for participant in body["participants"]
        )
        resolved_hash = body["mapping_sha256"]
        serialized = resolved.text.lower()
        assert str(tmp_path).lower() not in serialized
        assert TOKEN.lower() not in serialized

        stale = client.post(
            "/api/v1/session-workspaces/campaign-map/session-map/participants",
            headers=HEADERS,
            json={
                "expected_revision": workspace["revision"],
                "assignments": [],
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "SESSION_WORKSPACE_REVISION_CONFLICT"

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-map/session-map/participants",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        assert recovered.json()["mapping_sha256"] == resolved_hash
        assert recovered.json()["approval_blocked"] is False


def test_browser_session_is_scoped_to_participant_mapping_routes(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    package = SimpleNamespace(
        start_time="2026-09-27T20:00:00Z",
        tracks=(
            SimpleNamespace(
                number=1,
                speaker="Guest",
                identity=SimpleNamespace(
                    username="Guest",
                    discriminator=None,
                    discord_id=None,
                ),
                timeline_offset_seconds=0.0,
                duration_seconds=60.0,
            ),
        ),
    )
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda _root, verify_tracks=False: package,
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
            "/api/v1/session-workspaces/campaign-browser/session-browser",
            headers=browser_headers,
            json={},
        ).json()
        attached = client.post(
            "/api/v1/session-workspaces/campaign-browser/session-browser/parts",
            headers=browser_headers,
            json={"source_id": SOURCE_A, "expected_revision": created["revision"]},
        ).json()

        projection = client.get(
            "/api/v1/session-workspaces/campaign-browser/session-browser/participants",
            headers=browser_headers,
        )
        assert projection.status_code == 200
        observation = projection.json()["observations"][0]

        updated = client.post(
            "/api/v1/session-workspaces/campaign-browser/session-browser/participants",
            headers=browser_headers,
            json={
                "expected_revision": attached["revision"],
                "assignments": [
                    {
                        "observation_id": observation["observation_id"],
                        "participant_id": "f" * 32,
                    }
                ],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["participants"][0]["participant_id"] == "f" * 32
        assert updated.json()["participants"][0]["profile_id"] is None


def test_browser_session_intent_recovery_keeps_text_in_local_agent(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda _root, verify_tracks=False: SimpleNamespace(),
    )
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        session = client.post("/api/v1/session", headers={"Origin": ORIGIN}, json={})
        assert session.status_code == 200
        browser_headers = {
            "Authorization": f"Bearer {session.json()['token']}",
            "Origin": ORIGIN,
        }
        created = client.post(
            "/api/v1/session-workspaces/campaign-intent/session-intent",
            headers=browser_headers,
            json={},
        )
        assert created.status_code == 200

        saved = client.post(
            "/api/v1/session-workspaces/campaign-intent/session-intent/intent",
            headers=browser_headers,
            json={
                "request_id": "intent-a",
                "profile_id": "qwen-quality",
                "context": "mesa de quinta",
                "glossary": "Yuhara",
            },
        )
        assert saved.status_code == 200
        body = saved.json()
        assert body["schema_version"] == "tda_session_transcription_intent_v1"
        assert body["context"] == "mesa de quinta"
        assert body["glossary"] == "Yuhara"
        assert len(body["context_sha256"]) == 64
        assert len(body["glossary_sha256"]) == 64
        assert len(body["compatibility_fingerprint"]) == 64

        recovered = client.get(
            "/api/v1/session-workspaces/campaign-intent/session-intent/intent",
            headers=browser_headers,
        )
        assert recovered.status_code == 200
        assert recovered.json() == body

        workspace = client.get(
            "/api/v1/session-workspaces/campaign-intent/session-intent",
            headers=browser_headers,
        )
        assert workspace.status_code == 200
        serialized_workspace = workspace.text
        assert "mesa de quinta" not in serialized_workspace
        assert "Yuhara" not in serialized_workspace

        conflict = client.post(
            "/api/v1/session-workspaces/campaign-intent/session-intent/intent",
            headers=browser_headers,
            json={
                "request_id": "intent-a",
                "profile_id": "qwen-quality",
                "context": "mudou",
                "glossary": "Yuhara",
            },
        )
        assert conflict.status_code == 409
        assert (
            conflict.json()["error"]["code"]
            == "SESSION_TRANSCRIPTION_INTENT_CONFLICT"
        )

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-intent/session-intent/intent",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        assert recovered.json()["context"] == "mesa de quinta"
        assert recovered.json()["glossary"] == "Yuhara"
