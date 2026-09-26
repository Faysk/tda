from __future__ import annotations

import io
import json
import threading
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.attempt_fence import claim_attempt_outcome
from tda_companion.craig_ingest_http import CraigIngestBoundary
from tda_companion.craig_runtime import load_craig_package
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)
from tda_companion.transcription_runs import write_completed_run

TOKEN = "i" * 43
ORIGIN = "https://dnd.faysk.dev"


def _payload() -> bytes:
    value = io.BytesIO()
    with zipfile.ZipFile(value, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-alice")
    return value.getvalue()


def _document(package, *, profile: str = "whisper-turbo") -> TranscriptDocument:
    source = package.tracks[0]
    word = TranscriptWord(
        text="resultado",
        start=0.1,
        end=0.8,
        confidence=0.95,
    )
    segment = TranscriptSegment(
        id="1-0",
        start=0.1,
        end=0.8,
        text="resultado",
        words=(word,),
    )
    track = TranscriptTrack(
        number=source.number,
        speaker=source.speaker,
        source_filename=source.filename,
        source_sha256=source.sha256,
        duration_seconds=1.0,
        segments=(segment,),
        timeline_offset_seconds=source.timeline_offset_seconds,
        identity=None,
    )
    return TranscriptDocument(
        recording_id=package.recording_id,
        source_sha256=package.source_sha256,
        language="pt",
        engine=TranscriptEngine(
            engine="faster-whisper",
            model="large-v3-turbo",
            profile=profile,
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="test-revision",
        ),
        tracks=(track,),
        stats=stats_for_tracks((track,), processing_seconds=1.0),
    )


def _running_job_for_source(client: TestClient, source_id: str, *, key: str):
    store = client.app.app.state.store
    job = store.submit(
        key,
        {
            "kind": "transcription.craig",
            "campaign_id": "campaign",
            "session_id": "session",
            "source_id": source_id,
            "profile_id": "whisper-turbo",
            "glossary": "",
            "context": "",
            "cpu": False,
            "units": 1,
        },
    )
    assert store.claim() == (job["id"], 1)
    return store, job


def _client(tmp_path: Path) -> TestClient:
    root = tmp_path / "Data"
    root.mkdir(exist_ok=True)
    api = create_app(root, TOKEN, {ORIGIN}, run_worker=False)
    app = CraigIngestBoundary(
        api,
        data_root=root,
        token=TOKEN,
        origins=frozenset({ORIGIN}),
        port=8765,
        browser_sessions=api.state.browser_sessions,
        source_gate=api.state.source_gate,
        source_running=api.state.source_in_use,
        run_visible=api.state.transcription_run_visible,
    )
    return TestClient(app, base_url="http://127.0.0.1:8765")


def test_boundary_accepts_zip_and_rejects_bad_credentials_or_media(tmp_path: Path):
    payload = _payload()
    headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN, "Content-Type": "application/zip"}
    with _client(tmp_path) as client:
        response = client.post("/api/v1/sources/craig", headers=headers, content=payload)
        assert response.status_code == 200
        assert response.json()["schema_version"] == "tda_craig_ingest_v1"

        unauthorized = client.post(
            "/api/v1/sources/craig",
            headers={**headers, "Authorization": "Bearer invalid"},
            content=payload,
        )
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "UNAUTHORIZED"

        wrong_media = client.post(
            "/api/v1/sources/craig",
            headers={**headers, "Content-Type": "application/json"},
            content=payload,
        )
        assert wrong_media.status_code == 415
        assert wrong_media.json()["error"]["code"] == "CRAIG_ZIP_REQUIRED"


def test_boundary_accepts_origin_bound_browser_session_for_zip_ingest(tmp_path: Path):
    payload = _payload()
    with _client(tmp_path) as client:
        session = client.post(
            "/api/v1/session",
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
            json={},
        )
        assert session.status_code == 200
        browser_token = session.json()["token"]

        response = client.post(
            "/api/v1/sources/craig",
            headers={
                "Authorization": f"Bearer {browser_token}",
                "Origin": ORIGIN,
                "Content-Type": "application/zip",
            },
            content=payload,
        )
        assert response.status_code == 200
        assert response.json()["schema_version"] == "tda_craig_ingest_v1"

        wrong_origin = client.post(
            "/api/v1/sources/craig",
            headers={
                "Authorization": f"Bearer {browser_token}",
                "Origin": "https://evil.example",
                "Content-Type": "application/zip",
            },
            content=payload,
        )
        assert wrong_origin.status_code == 403
        assert wrong_origin.json()["error"]["code"] == "ORIGIN_REJECTED"

        no_origin = client.post(
            "/api/v1/sources/craig",
            headers={
                "Authorization": f"Bearer {browser_token}",
                "Content-Type": "application/zip",
            },
            content=payload,
        )
        assert no_origin.status_code == 403
        assert no_origin.json()["error"]["code"] == "ORIGIN_REQUIRED"


def test_boundary_blocks_repair_while_same_source_is_running(tmp_path: Path):
    payload = _payload()
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/zip",
    }
    with _client(tmp_path) as client:
        staged = client.post(
            "/api/v1/sources/craig",
            headers=headers,
            content=payload,
        )
        assert staged.status_code == 200
        source_id = staged.json()["source_id"]
        package_root = tmp_path / "Data" / "staging" / source_id
        track = package_root / "tracks" / "track-000001.flac"
        original = track.read_bytes()
        replacement = b"fLaC-ALICE"
        assert len(replacement) == len(original)
        track.write_bytes(replacement)

        store = client.app.app.state.store
        job = store.submit(
            "running-source-repair-guard",
            {
                "kind": "transcription.craig",
                "campaign_id": "campaign",
                "session_id": "session",
                "source_id": source_id,
                "profile_id": "whisper-turbo",
                "glossary": "",
                "context": "",
                "cpu": False,
                "units": 1,
            },
        )
        claimed = store.claim()
        assert claimed is not None
        assert claimed[0] == job["id"]
        assert store.has_running_source(source_id) is True

        blocked = client.post(
            "/api/v1/sources/craig",
            headers=headers,
            content=payload,
        )

        assert blocked.status_code == 409
        assert blocked.json()["error"] == {
            "code": "CRAIG_STAGING_REPAIR_BLOCKED_BY_RUNNING_JOB",
            "recoverable": True,
        }
        assert track.read_bytes() == replacement


def test_boundary_blocks_repair_while_preparation_owns_same_source(
    monkeypatch,
    tmp_path: Path,
):
    payload = _payload()
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/zip",
    }
    with _client(tmp_path) as client:
        staged = client.post(
            "/api/v1/sources/craig",
            headers=headers,
            content=payload,
        )
        assert staged.status_code == 200
        source_id = staged.json()["source_id"]
        package_root = tmp_path / "Data" / "staging" / source_id
        track = package_root / "tracks" / "track-000001.flac"
        replacement = b"fLaC-ALICE"
        assert len(replacement) == track.stat().st_size
        track.write_bytes(replacement)

        manager = client.app.app.state.preparation_manager
        monkeypatch.setattr(
            manager,
            "snapshot",
            lambda: {
                "active": True,
                "source_id": source_id,
                "profile_id": "qwen-quality",
            },
        )
        assert client.app.app.state.source_in_use(source_id) is True

        blocked = client.post(
            "/api/v1/sources/craig",
            headers=headers,
            content=payload,
        )

        assert blocked.status_code == 409
        assert blocked.json()["error"] == {
            "code": "CRAIG_STAGING_REPAIR_BLOCKED_BY_RUNNING_JOB",
            "recoverable": True,
        }
        assert track.read_bytes() == replacement


def test_boundary_preflight_is_narrow_and_private_network_aware(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.options(
            "/api/v1/sources/craig",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, content-type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert response.headers["access-control-allow-private-network"] == "true"

        rejected = client.options(
            "/api/v1/sources/craig",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, x-file-path",
            },
        )
        assert rejected.status_code == 403
        assert rejected.json()["error"]["code"] == "PREFLIGHT_REJECTED"


def test_startup_migrates_legacy_and_listing_never_returns_transcript_or_path(tmp_path: Path):
    payload = _payload()
    upload_headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/zip",
    }
    get_headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}
    with _client(tmp_path) as client:
        staged = client.post("/api/v1/sources/craig", headers=upload_headers, content=payload)
        assert staged.status_code == 200
        source = staged.json()
        source_id = source["source_id"]
        source_sha = source["source_sha256"]
        package_root = tmp_path / "Data" / "staging" / source_id
        secret = "SEGREDO QUE NAO PODE IR PARA A LISTAGEM"
        package = load_craig_package(package_root, verify_tracks=False)
        legacy = _document(package, profile="whisper-detailed").as_dict()
        legacy["tracks"][0]["segments"][0]["text"] = secret
        (package_root / "transcript.json").write_text(
            json.dumps(legacy, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )

        initial = client.get(f"/api/v1/sources/{source_id}/runs", headers=get_headers)
        assert initial.json()["runs"] == []
        assert initial.json()["root_transcript"] == {"kind": "unclassified_legacy_candidate"}

    with _client(tmp_path) as client:
        response = client.get(f"/api/v1/sources/{source_id}/runs", headers=get_headers)
        assert response.status_code == 200
        value = response.json()
        assert value["schema_version"] == "tda_transcription_runs_v1"
        assert value["source_id"] == source_id
        assert len(value["runs"]) == 1
        assert value["runs"][0]["origin"] == "legacy_transcript_v1"
        encoded = json.dumps(value, ensure_ascii=False)
        assert secret not in encoded
        assert str(tmp_path) not in encoded
        assert (package_root / "transcript.json").is_file()

        unauthorized = client.get(
            f"/api/v1/sources/{source_id}/runs",
            headers={"Authorization": "Bearer invalid", "Origin": ORIGIN},
        )
        assert unauthorized.status_code == 401
        assert unauthorized.json()["error"]["code"] == "UNAUTHORIZED"


def test_run_discovery_hides_historical_cancelled_attempt_even_if_run_exists(tmp_path: Path):
    payload = _payload()
    upload_headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/zip",
    }
    get_headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}

    with _client(tmp_path) as client:
        staged = client.post(
            "/api/v1/sources/craig",
            headers=upload_headers,
            content=payload,
        )
        assert staged.status_code == 200
        source_id = staged.json()["source_id"]
        package_root = tmp_path / "Data" / "staging" / source_id
        package = load_craig_package(package_root, verify_tracks=True)
        store, job = _running_job_for_source(
            client,
            source_id,
            key="historical-cancelled-run",
        )

        # Reproduce the pre-fence contradiction: durable run first, then the
        # queue row is marked cancelled with no arbitration marker.
        write_completed_run(
            package_root,
            _document(package),
            job_id=job["id"],
            attempt=1,
        )
        assert store.action(job["id"], "cancel")["status"] == "cancelled"

        response = client.get(
            f"/api/v1/sources/{source_id}/runs",
            headers=get_headers,
        )
        assert response.status_code == 200
        assert response.json()["runs"] == []


def test_run_discovery_shows_current_attempt_only_after_queue_success(tmp_path: Path):
    payload = _payload()
    upload_headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/zip",
    }
    get_headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}

    with _client(tmp_path) as client:
        staged = client.post(
            "/api/v1/sources/craig",
            headers=upload_headers,
            content=payload,
        )
        source_id = staged.json()["source_id"]
        package_root = tmp_path / "Data" / "staging" / source_id
        package = load_craig_package(package_root, verify_tracks=True)
        store, job = _running_job_for_source(
            client,
            source_id,
            key="run-visible-after-success",
        )
        run = write_completed_run(
            package_root,
            _document(package),
            job_id=job["id"],
            attempt=1,
        )

        while_running = client.get(
            f"/api/v1/sources/{source_id}/runs",
            headers=get_headers,
        )
        assert while_running.status_code == 200
        assert while_running.json()["runs"] == []

        assert store.progress(
            job["id"],
            1,
            completed=1,
            total=1,
            stage="alignment",
        )
        assert store.complete(
            job["id"],
            1,
            {
                "schema_version": "tda_local_result_v1",
                "transcription": {
                    "run_id": run["run_id"],
                    "sha256": run["transcript_sha256"],
                },
            },
        )

        succeeded = client.get(
            f"/api/v1/sources/{source_id}/runs",
            headers=get_headers,
        )
        assert succeeded.status_code == 200
        assert [item["run_id"] for item in succeeded.json()["runs"]] == [
            run["run_id"]
        ]


def test_cancel_fence_keeps_attempt_hidden_after_job_cleanup(tmp_path: Path):
    payload = _payload()
    upload_headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/zip",
    }
    get_headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}

    with _client(tmp_path) as client:
        staged = client.post(
            "/api/v1/sources/craig",
            headers=upload_headers,
            content=payload,
        )
        source_id = staged.json()["source_id"]
        package_root = tmp_path / "Data" / "staging" / source_id
        package = load_craig_package(package_root, verify_tracks=True)
        store, job = _running_job_for_source(
            client,
            source_id,
            key="cancel-fence-after-cleanup",
        )

        # Synthetic historical artifact: even if a committed run is present,
        # the durable cancel decision remains authoritative after queue cleanup.
        write_completed_run(
            package_root,
            _document(package),
            job_id=job["id"],
            attempt=1,
        )
        assert claim_attempt_outcome(
            package_root,
            job["id"],
            1,
            "cancel",
        ) == "cancel"
        assert store.action(job["id"], "cancel")["status"] == "cancelled"
        assert store.remove(job["id"])["deleted"] is True

        response = client.get(
            f"/api/v1/sources/{source_id}/runs",
            headers=get_headers,
        )
        assert response.status_code == 200
        assert response.json()["runs"] == []


def test_run_discovery_runs_filesystem_work_off_event_loop(monkeypatch, tmp_path: Path):
    payload = _payload()
    upload_headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Origin": ORIGIN,
        "Content-Type": "application/zip",
    }
    get_headers = {"Authorization": f"Bearer {TOKEN}", "Origin": ORIGIN}
    with _client(tmp_path) as client:
        staged = client.post(
            "/api/v1/sources/craig",
            headers=upload_headers,
            content=payload,
        )
        source_id = staged.json()["source_id"]
        boundary = client.app
        original = boundary._run_listing
        observed: dict[str, int] = {}
        caller_thread = threading.get_ident()

        def wrapped(value: str):
            observed["thread"] = threading.get_ident()
            return original(value)

        monkeypatch.setattr(boundary, "_run_listing", wrapped)

        response = client.get(
            f"/api/v1/sources/{source_id}/runs",
            headers=get_headers,
        )

        assert response.status_code == 200
        assert observed["thread"] != caller_thread


def test_run_discovery_preflight_allows_only_get_authorization(tmp_path: Path):
    payload = _payload()
    with _client(tmp_path) as client:
        staged = client.post(
            "/api/v1/sources/craig",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Origin": ORIGIN,
                "Content-Type": "application/zip",
            },
            content=payload,
        )
        source_id = staged.json()["source_id"]
        response = client.options(
            f"/api/v1/sources/{source_id}/runs",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-private-network"] == "true"

        rejected = client.options(
            f"/api/v1/sources/{source_id}/runs",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert rejected.status_code == 403
        assert rejected.json()["error"]["code"] == "PREFLIGHT_REJECTED"
