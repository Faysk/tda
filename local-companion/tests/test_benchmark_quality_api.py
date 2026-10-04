from __future__ import annotations

import json
import re
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.benchmark_bundles import (
    BENCHMARK_PROFILES,
    benchmark_id_for as _canonical_benchmark_id_for,
    benchmark_root as _canonical_benchmark_root,
    benchmark_sample_identity_from_descriptor,
    finalize_benchmark_bundle,
    write_benchmark_profile,
)
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptStats,
    TranscriptTrack,
)

TOKEN = "r" * 43
ORIGIN = "https://dnd.faysk.dev"
SOURCE_SHA256 = "a" * 64
SOURCE_ID = f"craig-{SOURCE_SHA256}"
SAMPLE_DESCRIPTOR = {
    "schema": "tda_benchmark_sample_v1",
    "source_sha256": SOURCE_SHA256,
    "start_seconds": 0.0,
    "end_seconds": 300.0,
    "tracks": [{"number": 1, "sha256": "c" * 64}],
}
SAMPLE_IDENTITY_SHA256 = benchmark_sample_identity_from_descriptor(SAMPLE_DESCRIPTOR)


def benchmark_id_for(job_id: str, attempt: int, _sample_identity_sha256: str | None = None) -> str:
    return _canonical_benchmark_id_for(job_id, attempt)


def _benchmark_parts(benchmark_id: str) -> tuple[str, int]:
    match = re.fullmatch(r"benchmark-(.+)-a([1-9][0-9]{0,5})", benchmark_id)
    if match is None:
        raise AssertionError("invalid benchmark fixture id")
    return match.group(1), int(match.group(2))


def _with_processing_metrics(document: TranscriptDocument) -> TranscriptDocument:
    stage_seconds = {
        "runtime_validation": 0.0,
        "checkpoint_scan": 0.0,
        "model_prepare": 0.0,
        "model_load": 0.0,
        "transcription": float(document.stats.processing_seconds),
        "alignment_and_energy": 0.0,
        "consolidation": 0.0,
    }
    metrics = {
        "version": "engine_processing_v1",
        "stage_seconds": stage_seconds,
        "total_processing_seconds": float(document.stats.processing_seconds),
        "external_preparation_included": False,
        "total_tracks": document.stats.track_count,
        "fresh_asr_tracks": document.stats.track_count,
        "text_checkpoint_reused_tracks": 0,
        "completed_checkpoint_reused_tracks": 0,
        "fresh_audio_work_seconds": float(document.stats.audio_work_seconds),
        "reused_audio_work_seconds": 0.0,
        "fresh_calibration_eligible": document.stats.track_count > 0 and document.stats.audio_work_seconds > 0,
    }
    return replace(document, stats=replace(document.stats, processing_metrics=metrics))


def write_profile_artifact(
    data_root,
    *,
    benchmark_id: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    source_id: str,
    document: TranscriptDocument,
    execution_lineage: dict,
):
    job_id, attempt = _benchmark_parts(benchmark_id)
    return write_benchmark_profile(
        data_root,
        _with_processing_metrics(document),
        job_id=job_id,
        attempt=attempt,
        source_id=source_id,
        sample_identity_sha256=sample_identity_sha256,
        sample_seconds=sample_seconds,
        execution_lineage=execution_lineage,
    )


def finalize_bundle(
    data_root,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    source_id: str,
    source_sha256: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    track_count: int,
    audio_work_seconds: float,
    context: str,
    glossary: str,
):
    if benchmark_id != _canonical_benchmark_id_for(job_id, attempt):
        raise AssertionError("fixture benchmark id mismatch")
    root = _canonical_benchmark_root(data_root, benchmark_id)
    receipts = []
    for profile_id in BENCHMARK_PROFILES:
        manifest = json.loads(
            (root / "profiles" / profile_id / "profile.json").read_text(encoding="utf-8")
        )
        receipts.append(
            {
                "profile_id": profile_id,
                "benchmark_id": benchmark_id,
                "sample_identity_sha256": sample_identity_sha256,
                "artifact_available": True,
                "transcript_sha256": manifest["transcript"]["sha256"],
                "transcript_size_bytes": manifest["transcript"]["size_bytes"],
                "execution_lineage": manifest["execution_lineage"],
            }
        )
    return finalize_benchmark_bundle(
        data_root,
        job_id=job_id,
        attempt=attempt,
        source_id=source_id,
        source_sha256=source_sha256,
        sample=SAMPLE_DESCRIPTOR,
        sample_identity_sha256=sample_identity_sha256,
        sample_seconds=sample_seconds,
        track_count=track_count,
        audio_work_seconds=audio_work_seconds,
        context=context,
        glossary=glossary,
        profile_receipts=receipts,
    )



def _document(profile_id: str, text: str) -> TranscriptDocument:
    segment = TranscriptSegment(id="seg-1", start=1.0, end=4.0, text=text)
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1.flac",
        source_sha256="c" * 64,
        duration_seconds=300.0,
        segments=(segment,),
    )
    return TranscriptDocument(
        recording_id="recording",
        source_sha256=SOURCE_SHA256,
        language="pt",
        engine=TranscriptEngine(
            engine="whisper" if profile_id.startswith("whisper") else "qwen3",
            model=f"model-{profile_id}",
            profile=profile_id,
            device="cuda:0",
            compute_type="float16",
            alignment="native",
        ),
        tracks=(track,),
        turns=(),
        stats=TranscriptStats(
            audio_work_seconds=300.0,
            session_duration_seconds=300.0,
            processing_seconds=1.0,
            word_count=0,
            segment_count=1,
            track_count=1,
            turn_count=0,
        ),
    )


def _build_bundle(root: Path) -> str:
    benchmark_id = benchmark_id_for("bench-api", 1, SAMPLE_IDENTITY_SHA256)
    texts = {
        "whisper-turbo": "Joao chegou cedo",
        "whisper-detailed": "João chegou cedo",
        "qwen-fast": "João chegou muito cedo",
        "qwen-quality": "João cedo",
    }
    for profile_id in BENCHMARK_PROFILES:
        write_profile_artifact(
            root,
            benchmark_id=benchmark_id,
            sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
            sample_seconds=300.0,
            source_id=SOURCE_ID,
            document=_document(profile_id, texts[profile_id]),
            execution_lineage={"schema_version": "tda_execution_lineage_v1"},
        )
    finalize_bundle(
        root,
        benchmark_id=benchmark_id,
        job_id="bench-api",
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA256,
        sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="privado contexto",
        glossary="João",
    )
    return benchmark_id


def _browser_headers(client: TestClient) -> dict[str, str]:
    session = client.post(
        "/api/v1/session",
        headers={"Origin": ORIGIN, "Content-Type": "application/json"},
        json={},
    )
    assert session.status_code == 200
    return {
        "Authorization": f"Bearer {session.json()['token']}",
        "Origin": ORIGIN,
    }


def test_benchmark_reference_quality_and_private_inspection_api(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _build_bundle(root)
    api = create_app(root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(api, base_url="http://127.0.0.1:8765") as client:
        headers = _browser_headers(client)

        reference_before = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/reference",
            headers=headers,
        )
        assert reference_before.status_code == 200
        assert reference_before.json()["reference"] is None
        assert reference_before.json()["status"]["active_revision"] is None

        quality_before = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/quality",
            headers=headers,
        )
        assert quality_before.status_code == 200
        assert quality_before.json()["quality_measured"] is False
        assert quality_before.json()["profiles"] == []

        draft = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/whisper-turbo/reference-draft",
            headers=headers,
        )
        assert draft.status_code == 200
        draft_value = draft.json()
        assert draft_value["provenance"] == {
            "kind": "derived-from-profile",
            "seed_profile_id": "whisper-turbo",
            "human_owned": True,
        }
        assert draft_value["tracks"][0]["text"] == "Joao chegou cedo"

        saved = client.post(
            f"/api/v1/benchmarks/{benchmark_id}/references",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "expected_revision": 0,
                "capability_level": 1,
                "provenance_kind": "derived-from-profile",
                "seed_profile_id": "whisper-turbo",
                "glossary_terms": ["João"],
                "tracks": [
                    {
                        "track_number": 1,
                        "speaker": "Alice",
                        "text": "João chegou cedo SEGREDO HUMANO",
                        "turns": [],
                    }
                ],
                "activate": True,
            },
        )
        assert saved.status_code == 200
        saved_value = saved.json()
        assert saved_value["reference"]["revision"] == 1
        assert saved_value["status"]["active_revision"] == 1
        assert saved_value["quality"]["quality_measured"] is True
        assert saved_value["quality"]["winner"] is None
        assert saved_value["quality"]["composite_score"] is None
        assert "SEGREDO HUMANO" not in json.dumps(saved_value["quality"])
        assert "João" not in json.dumps(saved_value["quality"])

        stale = client.post(
            f"/api/v1/benchmarks/{benchmark_id}/references",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "expected_revision": 0,
                "capability_level": 1,
                "provenance_kind": "manual",
                "seed_profile_id": None,
                "glossary_terms": [],
                "tracks": [
                    {
                        "track_number": 1,
                        "speaker": "Alice",
                        "text": "não sobrescrever",
                        "turns": [],
                    }
                ],
                "activate": True,
            },
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "BENCHMARK_REFERENCE_STALE_REVISION"

        inspection = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/quality/whisper-turbo/inspection",
            headers=headers,
        )
        assert inspection.status_code == 200
        inspection_value = inspection.json()
        assert inspection_value["private_text"] is True
        assert inspection_value["regions"]
        serialized_inspection = json.dumps(inspection_value, ensure_ascii=False)
        assert "segredo humano" in serialized_inspection
        assert "joão" in serialized_inspection


def test_benchmark_quality_routes_require_browser_session(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _build_bundle(root)
    api = create_app(root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(api, base_url="http://127.0.0.1:8765") as client:
        unauthenticated = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/quality",
            headers={"Origin": ORIGIN},
        )
        assert unauthenticated.status_code == 401
        assert "João" not in unauthenticated.text
