from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

import tda_companion.api as api_module
from tda_companion.api import create_app
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
SOURCE_A = "craig-" + "a" * 64
SOURCE_B = "craig-" + "b" * 64


def _track(number: int, speaker: str, discord_id: str):
    return SimpleNamespace(
        number=number,
        speaker=speaker,
        identity=SimpleNamespace(
            username=speaker,
            discriminator=None,
            discord_id=discord_id,
        ),
        timeline_offset_seconds=0.0,
        duration_seconds=10.0,
    )


def _package(source_id: str, start_time: str, number: int, speaker: str):
    return SimpleNamespace(
        source_sha256=source_id.removeprefix("craig-"),
        start_time=start_time,
        tracks=(_track(number, speaker, "111"),),
    )


def _write_run(
    data_root: Path,
    *,
    source_id: str,
    recording_id: str,
    run_label: str,
    track_number: int,
    speaker: str,
    segment_id: str,
    text: str,
):
    root = data_root / "staging" / source_id
    root.mkdir(parents=True, exist_ok=True)
    document = TranscriptDocument(
        recording_id=recording_id,
        source_sha256=source_id.removeprefix("craig-"),
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="synthetic",
            profile="whisper-turbo",
            device="cpu",
        ),
        tracks=(
            TranscriptTrack(
                number=track_number,
                speaker=speaker,
                source_filename=f"{track_number}.flac",
                source_sha256=hashlib.sha256(run_label.encode()).hexdigest(),
                duration_seconds=10.0,
                timeline_offset_seconds=0.0,
                segments=(
                    TranscriptSegment(
                        id=segment_id,
                        start=1.0,
                        end=2.0,
                        text=text,
                    ),
                ),
            ),
        ),
        stats=TranscriptStats(
            audio_work_seconds=10.0,
            session_duration_seconds=10.0,
            processing_seconds=1.0,
            word_count=2,
            segment_count=1,
            track_count=1,
        ),
    )
    return write_completed_run(
        root,
        document,
        job_id=run_label,
        attempt=1,
        source_id=source_id,
    )


def test_two_recordings_flow_from_workspace_to_approved_assembly_and_restart(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"
    run_a = _write_run(
        data_root,
        source_id=SOURCE_A,
        recording_id="recording-a",
        run_label="run-a",
        track_number=1,
        speaker="Renan",
        segment_id="segment-a",
        text="primeira parte",
    )
    run_b = _write_run(
        data_root,
        source_id=SOURCE_B,
        recording_id="recording-b",
        run_label="run-b",
        track_number=7,
        speaker="Faysk",
        segment_id="segment-b",
        text="segunda parte",
    )
    packages = {
        SOURCE_A: _package(
            SOURCE_A,
            "2026-09-27T20:00:00Z",
            1,
            "Renan",
        ),
        SOURCE_B: _package(
            SOURCE_B,
            "2026-09-27T20:00:10Z",
            7,
            "Faysk",
        ),
    }

    monkeypatch.setattr(
        api_module,
        "load_craig_package",
        lambda root, verify_tracks=False: packages[root.name],
    )
    monkeypatch.setattr(
        api_module,
        "read_attempt_outcome",
        lambda *_args, **_kwargs: "commit",
    )

    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        capabilities = client.get("/api/v1/capabilities", headers=HEADERS).json()
        for capability in (
            "transcription.session-workspace",
            "transcription.session-timeline",
            "transcription.session-participants",
            "transcription.session-assembly",
            "transcription.session-assembly.review",
        ):
            assert capability in capabilities["capabilities"]

        workspace = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
            json={},
        ).json()
        for source_id in (SOURCE_A, SOURCE_B):
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

        derived = client.post(
            "/api/v1/session-workspaces/campaign-a/session-a/timeline/derive",
            headers=HEADERS,
            json={"expected_revision": workspace["revision"]},
        )
        assert derived.status_code == 200
        workspace = derived.json()
        assert workspace["timeline"]["state"] == "ready"
        assert [
            part["session_offset_seconds"] for part in workspace["parts"]
        ] == [0.0, 10.0]

        participants = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a/participants",
            headers=HEADERS,
        )
        assert participants.status_code == 200
        mapping = participants.json()
        assert mapping["approval_blocked"] is False
        assert len(mapping["participants"]) == 1
        assert len(mapping["participants"][0]["observation_ids"]) == 2

        for part, run in zip(
            workspace["parts"],
            (run_a, run_b),
            strict=True,
        ):
            selected = client.post(
                "/api/v1/session-workspaces/campaign-a/session-a/parts/run",
                headers=HEADERS,
                json={
                    "part_id": part["part_id"],
                    "run_id": run["run_id"],
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
        assembly = built.json()
        assert assembly["part_count"] == 2
        assert [part["source_id"] for part in assembly["parts"]] == [
            SOURCE_A,
            SOURCE_B,
        ]
        assert [part["run_id"] for part in assembly["parts"]] == [
            run_a["run_id"],
            run_b["run_id"],
        ]
        assert assembly["participant_approval_blocked"] is False

        review_path = (
            "/api/v1/session-workspaces/campaign-a/session-a/assemblies/"
            f"{assembly['assembly_id']}/review"
        )
        base = client.get(review_path + "/base", headers=HEADERS)
        assert base.status_code == 200
        base_value = base.json()
        saved = client.post(
            review_path,
            headers=HEADERS,
            json={
                "snapshot_contract": "tda_session_assembly_review_cas_v1",
                "expected": {
                    "persistence": "ephemeral_base",
                    "base_transcript_sha256": base_value["base"]["transcript_sha256"],
                },
                "status": "reviewed",
                "segments": [
                    dict(segment, reviewed=True)
                    for segment in base_value["segments"]
                ],
            },
        )
        assert saved.status_code == 200
        saved_value = saved.json()

        approved = client.post(
            review_path,
            headers=HEADERS,
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
        approved_value = approved.json()
        assert approved_value["approval_current"] is True
        assert approved_value["base"]["assembly_id"] == assembly["assembly_id"]
        assembly_id = assembly["assembly_id"]

    restarted = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False)
    with TestClient(restarted, base_url="http://127.0.0.1:8765") as client:
        recovered = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a",
            headers=HEADERS,
        )
        assert recovered.status_code == 200
        assert [part["selected_run_id"] for part in recovered.json()["parts"]] == [
            run_a["run_id"],
            run_b["run_id"],
        ]

        assemblies = client.get(
            "/api/v1/session-workspaces/campaign-a/session-a/assemblies",
            headers=HEADERS,
        )
        assert assemblies.status_code == 200
        assert assemblies.json()["assemblies"][0]["assembly_id"] == assembly_id
