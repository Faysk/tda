from __future__ import annotations

import hashlib
import time
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.asr_models import get_profile, model_path, write_install_marker
from tda_companion.asr_runtime import install_whisper_runtime_archive
from tda_companion.craig import CraigPackage, ingest_craig_zip
from tda_companion.craig_runtime import load_craig_package
from tda_companion.runtime_compat import MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
from tda_companion.store import Store
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)
from tda_companion.transcription_runs import write_completed_run
from tda_companion.worker_protocol import WorkerMessage
from tda_companion.worker_supervisor import WorkerOutcome, WorkerSupervisor

TOKEN = "c" * 43
ORIGIN = "https://dnd.faysk.dev"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Origin": ORIGIN,
    "Content-Type": "application/json",
    "Idempotency-Key": "craig-api-1",
}


def _stage(data_root: Path, source_id: str = "craig-source") -> None:
    source = data_root.parent / f"{source_id}.zip"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-a")
        archive.writestr("2-Bob.flac", b"fLaC-b")
    ingest_craig_zip(source, data_root / "staging" / source_id)


def _prepare_whisper(tmp_path: Path, profile_id: str = "whisper-turbo") -> None:
    archive = tmp_path / "whisper-runtime.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.writestr("TDAWhisperWorker.exe", b"worker")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    install_whisper_runtime_archive(
        archive,
        tmp_path / "Runtime",
        version=MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
        expected_sha256=digest,
    )

    profile = get_profile(profile_id)
    target = model_path(tmp_path / "Models", profile)
    target.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(profile.required_files, start=1):
        file = target / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(f"{profile_id}:{index}".encode())
    write_install_marker(target, profile)


def _document(package: CraigPackage, profile_id: str = "whisper-turbo") -> TranscriptDocument:
    tracks = []
    for source in package.tracks:
        word = TranscriptWord(text="teste", start=0.0, end=0.4, confidence=0.9)
        segment = TranscriptSegment(
            id=f"{source.number}-0",
            start=0.0,
            end=0.4,
            text="teste",
            words=(word,),
        )
        tracks.append(
            TranscriptTrack(
                number=source.number,
                speaker=source.speaker,
                source_filename=source.filename,
                source_sha256=source.sha256,
                duration_seconds=1.0,
                segments=(segment,),
                timeline_offset_seconds=source.timeline_offset_seconds,
            )
        )
    transcript_tracks = tuple(tracks)
    return TranscriptDocument(
        recording_id=package.recording_id,
        source_sha256=package.source_sha256,
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="test-model",
            profile=profile_id,
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="test",
        ),
        tracks=transcript_tracks,
        stats=stats_for_tracks(transcript_tracks, processing_seconds=1.0),
    )


def _wait_for_job(client: TestClient, job_id: str, status: str) -> dict:
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        value = client.get(f"/api/v1/jobs/{job_id}", headers=HEADERS).json()
        if value["status"] == status:
            return value
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach {status}")


def _body(source_id: str = "craig-source") -> dict:
    return {
        "kind": "transcription.craig",
        "campaign_id": "campaign",
        "session_id": "session",
        "source_id": source_id,
        "profile_id": "whisper-turbo",
        "glossary": "Yuhara Pipipi",
        "context": "campanha principal",
        "cpu": False,
    }


def test_api_queues_staged_craig_with_real_track_count_and_redacted_context(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    _stage(data_root)
    _prepare_whisper(tmp_path)
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False, models_root=tmp_path / "Models")

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        response = client.post("/api/v1/jobs", headers=HEADERS, json=_body())
        assert response.status_code == 200
        job = response.json()
        assert job["kind"] == "transcription.craig"
        assert job["status"] == "queued"
        assert job["progress"] == {"completed": 0, "total": 2, "unit": "tracks"}
        assert job["context"] == {
            "campaign_id": "campaign",
            "session_id": "session",
            "source_id": "craig-source",
            "profile_id": "whisper-turbo",
            "cpu": False,
        }
        assert "glossary" not in str(job)
        assert "campanha principal" not in str(job)
        assert "transcription.craig" in client.get("/api/v1/capabilities", headers=HEADERS).json()["capabilities"]


def test_api_rejects_local_paths_unapproved_qwen_and_missing_staged_source(tmp_path: Path):
    data_root = tmp_path / "Data"
    data_root.mkdir()
    _stage(data_root)
    app = create_app(data_root, TOKEN, {ORIGIN}, run_worker=False, models_root=tmp_path / "Models")

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        value = {**_body(), "filesystem_path": "C:/private/session.zip"}
        assert client.post("/api/v1/jobs", headers=HEADERS, json=value).status_code == 422

        qwen = {**_body(), "profile_id": "qwen-fast"}
        qwen_response = client.post("/api/v1/jobs", headers=HEADERS, json=qwen)
        assert qwen_response.status_code == 409
        assert qwen_response.json() == {
            "error": {"code": "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED", "recoverable": True}
        }

        missing_headers = {**HEADERS, "Idempotency-Key": "missing-source"}
        missing = client.post(
            "/api/v1/jobs",
            headers=missing_headers,
            json=_body("missing-source"),
        )
        assert missing.status_code == 409
        assert missing.json() == {
            "error": {"code": "CRAIG_MANIFEST_NOT_FOUND", "recoverable": True}
        }


def test_transcription_retry_resets_uncheckpointed_progress(tmp_path: Path):
    store = Store(tmp_path)
    job = store.submit(
        "asr-retry",
        {
            **_body(),
            "units": 2,
        },
    )
    job_id, attempt = store.claim()
    assert job_id == job["id"]
    assert store.progress(job_id, attempt, completed=1, total=2, stage="transcription") is True
    store.fail(job_id, attempt, "WORKER_EXECUTION_FAILED")
    failed = store.get(job_id)
    assert failed["progress"]["completed"] == 1

    retried = store.action(job_id, "retry")
    assert retried["status"] == "queued"
    assert retried["progress"] == {"completed": 0, "total": 2, "unit": "tracks"}
