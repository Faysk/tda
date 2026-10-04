from __future__ import annotations

import json
import zipfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.benchmark_bundles import (
    BENCHMARK_PROFILES,
    BenchmarkBundleError,
    benchmark_id_for,
    benchmark_root,
    benchmark_sample_descriptor,
    benchmark_sample_identity,
    finalize_benchmark_bundle,
    load_benchmark_bundle,
    write_benchmark_profile,
)
from tda_companion.benchmark_evidence import (
    BenchmarkEvidenceError,
    private_export_zip,
    verified_profile_bytes,
)
from tda_companion.benchmark_quality import (
    BenchmarkQualityError,
    _text_metrics,
    compute_quality_receipts,
    normalize_text,
    normalization_contract,
    quality_summary,
    save_reference,
)
from tda_companion.engine_metrics import EngineMeasurement
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptSegmentRef,
    TranscriptTrack,
    TranscriptTurn,
    TranscriptWord,
    stats_for_tracks,
)

SOURCE_SHA = "a" * 64
TRACK_SHA = "b" * 64
SOURCE_ID = f"craig-{SOURCE_SHA}"
TOKEN = "r" * 43
ORIGIN = "https://dnd.faysk.dev"


def _lineage(profile_id: str) -> dict:
    family = "whisper" if profile_id.startswith("whisper-") else "qwen"
    return {
        "schema_version": "tda_execution_lineage_v1",
        "companion_version": "test",
        "runtime_family": family,
        "runtime_version": "1.2.3",
        "runtime_artifact": {
            "runtime_id": f"{family}-test",
            "version": "1.2.3",
            "worker_sha256": "1" * 64,
            "archive_sha256": "2" * 64,
        },
        "device": "cuda:0",
        "execution_device": {
            "kind": "cuda",
            "physical_uuid": "GPU-test",
            "pci_bus_id": "0000:01:00.0",
        },
        "compute_type": "float16",
        "gpu": {
            "vendor": "NVIDIA",
            "index": 0,
            "model": "Synthetic GPU",
            "vram_total_bytes": 8 * 1024**3,
            "compute_capability": "8.9",
            "driver_version": "test-driver",
        },
    }


def _document_tracks(
    profile_id: str,
    tracks: list[tuple[int, str, str, bool, bool]],
) -> TranscriptDocument:
    transcript_tracks: list[TranscriptTrack] = []
    turns: list[TranscriptTurn] = []
    for number, text, speaker, word_aligned, overlaps in tracks:
        words = (
            tuple(
                TranscriptWord(
                    text=word,
                    start=1.0 + index * 0.2,
                    end=1.15 + index * 0.2,
                    confidence=0.99,
                )
                for index, word in enumerate(text.split())
            )
            if word_aligned
            else ()
        )
        segments: tuple[TranscriptSegment, ...] = ()
        if text:
            segment = TranscriptSegment(
                id=f"{number}-0",
                start=1.0,
                end=max(2.0, 1.2 + max(1, len(text.split())) * 0.2),
                text=text,
                words=words,
            )
            segments = (segment,)
            turns.append(
                TranscriptTurn(
                    id=f"turn-{number}",
                    speaker=speaker,
                    start=segment.start,
                    end=segment.end,
                    text=text,
                    segments=(TranscriptSegmentRef(track_number=number, segment_id=segment.id),),
                    overlaps_other_speaker=overlaps,
                )
            )
        transcript_tracks.append(
            TranscriptTrack(
                number=number,
                speaker=speaker,
                source_filename=f"{number}-{speaker}.flac",
                source_sha256=str(number) * 64,
                duration_seconds=300.0,
                segments=segments,
            )
        )

    tracks_value = tuple(transcript_tracks)
    timer = EngineMeasurement(lambda _event: None, clock=lambda: 10.0)
    processing = timer.finish(tracks_value)
    stats = stats_for_tracks(
        tracks_value,
        processing_seconds=30.0,
        processing_metrics=processing,
    )
    return TranscriptDocument(
        recording_id="synthetic",
        source_sha256=SOURCE_SHA,
        language="pt",
        engine=TranscriptEngine(
            engine="faster-whisper" if profile_id.startswith("whisper-") else "qwen3",
            model="synthetic-model",
            profile=profile_id,
            device="cuda:0",
            compute_type="float16",
            alignment="native",
            model_revision="synthetic-revision",
        ),
        tracks=tracks_value,
        stats=stats,
        turns=tuple(turns),
    )


def _document(profile_id: str, text: str) -> TranscriptDocument:
    return _document_tracks(profile_id, [(1, text, "Alice", True, False)])


def _bundle(
    root: Path,
    texts: dict[str, str] | None = None,
    *,
    job_id: str = "quality-gate",
    documents: dict[str, TranscriptDocument] | None = None,
) -> str:
    representative = (
        documents[BENCHMARK_PROFILES[0]]
        if documents is not None
        else _document(BENCHMARK_PROFILES[0], (texts or {}).get(BENCHMARK_PROFILES[0], f"texto {BENCHMARK_PROFILES[0]}"))
    )
    package = SimpleNamespace(
        source_sha256=SOURCE_SHA,
        tracks=tuple(
            SimpleNamespace(number=track.number, sha256=track.source_sha256)
            for track in representative.tracks
        ),
    )
    sample = benchmark_sample_descriptor(package)
    sample_identity = benchmark_sample_identity(package)
    receipts = []
    for profile_id in BENCHMARK_PROFILES:
        document = (
            documents[profile_id]
            if documents is not None
            else _document(profile_id, (texts or {}).get(profile_id, f"texto {profile_id}"))
        )
        receipt = write_benchmark_profile(
            root,
            document,
            job_id=job_id,
            attempt=1,
            source_id=SOURCE_ID,
            sample_identity_sha256=sample_identity,
            sample_seconds=300.0,
            execution_lineage=_lineage(profile_id),
        )
        receipts.append(
            {
                "profile_id": profile_id,
                "sample_identity_sha256": sample_identity,
                **receipt,
            }
        )
    track_count = len(package.tracks)
    final = finalize_benchmark_bundle(
        root,
        job_id=job_id,
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA,
        sample=sample,
        sample_identity_sha256=sample_identity,
        sample_seconds=300.0,
        track_count=track_count,
        audio_work_seconds=300.0 * track_count,
        context="private context",
        glossary="Valyndra",
        profile_receipts=receipts,
    )
    assert final["status"] == "completed"
    return benchmark_id_for(job_id, 1)


def _headers(client: TestClient) -> dict[str, str]:
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


def test_canonical_bundle_is_readable_exportable_deterministic_and_audio_free(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _bundle(root)
    loaded = load_benchmark_bundle(root, benchmark_id)
    assert loaded["profile_order"] == list(BENCHMARK_PROFILES)

    for profile_id in BENCHMARK_PROFILES:
        payload = verified_profile_bytes(root, benchmark_id, profile_id, "transcript")
        assert json.loads(payload)["engine"]["profile"] == profile_id

    first = private_export_zip(root, benchmark_id)
    second = private_export_zip(root, benchmark_id)
    assert first == second
    with zipfile.ZipFile(BytesIO(first)) as archive:
        names = archive.namelist()
        assert sum(name.endswith("/transcript.json") for name in names) == 4
        assert sum(name.endswith("/transcript.txt") for name in names) == 4
        assert sum(name.endswith("/transcript.vtt") for name in names) == 4
        assert sum(name.endswith("/transcript.srt") for name in names) == 4
        assert not any(
            name.lower().endswith((".wav", ".flac", ".mp3", ".ogg", ".m4a", ".opus"))
            for name in names
        )
        assert not any("Alice.flac" in name or "1-Alice" in name for name in names)


def test_corruption_and_queue_independence_fail_closed(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _bundle(root)
    transcript = benchmark_root(root, benchmark_id) / "profiles" / "qwen-fast" / "transcript.json"
    transcript.write_bytes(transcript.read_bytes() + b" ")
    with pytest.raises((BenchmarkEvidenceError, BenchmarkBundleError)):
        verified_profile_bytes(root, benchmark_id, "qwen-fast", "transcript")


def test_known_answer_wer_cer_and_normalization_contract():
    assert normalize_text("  OLÁ, João — d'Água!  ") == "olá joão d'água"
    assert normalize_text("ação") != normalize_text("acao")
    assert normalize_text("d'água") == "d'água"
    assert normalize_text("guarda-chuva") == "guarda-chuva"

    exact = _text_metrics("um dois", "um dois")
    assert exact["substitutions"] == 0
    assert exact["deletions"] == 0
    assert exact["insertions"] == 0
    assert exact["wer_normalized"] == 0
    assert exact["cer_normalized"] == 0

    over_one = _text_metrics("um", "um dois três quatro")
    assert over_one["insertions"] == 3
    assert over_one["wer_normalized"] == 3.0

    missing = _text_metrics("um dois", "")
    assert missing["deletions"] == 2
    assert missing["wer_normalized"] == 1.0



@pytest.mark.parametrize(
    ("reference", "hypothesis", "expected"),
    [
        ("um dois", "um três", (1, 0, 0, 0.5)),
        ("um dois", "um", (0, 1, 0, 0.5)),
        ("um", "um dois", (0, 0, 1, 1.0)),
        ("um", "um dois três quatro", (0, 0, 3, 3.0)),
        ("um dois", "", (0, 2, 0, 1.0)),
    ],
)
def test_word_error_known_answers(reference, hypothesis, expected):
    metrics = _text_metrics(reference, hypothesis)
    assert (
        metrics["substitutions"],
        metrics["deletions"],
        metrics["insertions"],
        metrics["wer_normalized"],
    ) == expected


def test_normalization_is_versioned_nfc_and_locale_independent():
    contract = normalization_contract()
    assert contract["schema_version"] == "tda_asr_text_normalization_v1"
    assert contract["locale_dependent"] is False
    assert normalize_text("  OLÁ, João!  ") == "olá joão"
    assert normalize_text("ac\u0327a\u0303o") == normalize_text("ação")
    assert normalize_text("ação") != normalize_text("acao")
    assert normalize_text("d’água") == normalize_text("d'água")
    assert normalize_text("guarda-chuva") == "guarda-chuva"


def test_quality_micro_aggregate_counts_missing_and_extra_tracks(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    documents = {
        profile_id: _document_tracks(
            profile_id,
            [
                (1, "um três", "Alice", True, False),
                (2, "", "Bob", True, False),
                (3, "extra", "Carol", True, False),
            ],
        )
        for profile_id in BENCHMARK_PROFILES
    }
    benchmark_id = _bundle(root, job_id="micro-aggregate", documents=documents)
    save_reference(
        root,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [
                {"track_number": 1, "speaker": "Alice", "text": "um dois"},
                {"track_number": 2, "speaker": "Bob", "text": "três"},
            ],
            "terms": [],
        },
    )
    receipt = next(
        item
        for item in quality_summary(root, benchmark_id)["profiles"]
        if item["profile_id"] == "qwen-fast"
    )
    assert receipt["overall"]["aggregation"] == "micro"
    assert receipt["overall"]["reference_words"] == 3
    assert receipt["overall"]["substitutions"] == 1
    assert receipt["overall"]["deletions"] == 1
    assert receipt["overall"]["insertions"] == 1
    assert receipt["overall"]["wer_normalized"] == 1.0
    assert [item["track_number"] for item in receipt["per_track"]] == [1, 2, 3]


def test_timed_reference_reports_boundaries_speaker_overlap_and_fallback_alignment(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    documents = {
        profile_id: _document_tracks(
            profile_id,
            [(1, "olá mundo", "Alice", False, False)],
        )
        for profile_id in BENCHMARK_PROFILES
    }
    benchmark_id = _bundle(root, job_id="timed-quality", documents=documents)
    save_reference(
        root,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [
                {
                    "track_number": 1,
                    "speaker": "Bob",
                    "text": "olá mundo",
                    "turns": [
                        {
                            "start": 1.1,
                            "end": 2.1,
                            "speaker": "Bob",
                            "text": "olá mundo",
                            "overlaps_other_speaker": True,
                        },
                        {
                            "start": 100.0,
                            "end": 101.0,
                            "speaker": "Bob",
                            "text": "turno sem hipótese",
                            "overlaps_other_speaker": False,
                        },
                    ],
                }
            ],
            "terms": [],
        },
    )
    receipt = next(
        item
        for item in quality_summary(root, benchmark_id)["profiles"]
        if item["profile_id"] == "whisper-turbo"
    )
    timing = receipt["timing"]
    assert timing["matched_turns"] == 1
    assert timing["unmatched_reference_turns"] == 1
    assert timing["speaker_accuracy"] == 0.0
    assert timing["start_mae_seconds"] == pytest.approx(0.1)
    assert timing["end_mae_seconds"] == pytest.approx(0.1)
    assert timing["overlap_recall"] == 0.0
    assert timing["hypothesis_timing"]["timestamp_granularity"] == "segment_aligned"


def test_timed_reference_cannot_escape_exact_five_minute_sample(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _bundle(root, job_id="timed-out-of-sample")
    with pytest.raises(BenchmarkQualityError, match="BENCHMARK_REFERENCE_TURN_OUT_OF_SAMPLE"):
        save_reference(
            root,
            benchmark_id,
            {
                "expected_revision": 0,
                "provenance": "manual",
                "seed_profile_id": None,
                "tracks": [
                    {
                        "track_number": 1,
                        "speaker": "Alice",
                        "text": "fora",
                        "turns": [
                            {
                                "start": 299.5,
                                "end": 300.5,
                                "speaker": "Alice",
                                "text": "fora",
                                "overlaps_other_speaker": False,
                            }
                        ],
                    }
                ],
                "terms": [],
            },
        )


def test_reference_normalization_schema_mismatch_fails_closed(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _bundle(root, job_id="normalization-mismatch")
    save_reference(
        root,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [{"track_number": 1, "speaker": "Alice", "text": "olá"}],
            "terms": [],
        },
    )
    reference_path = benchmark_root(root, benchmark_id) / "reference" / "reference-000001.json"
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    reference["normalization"]["schema_version"] = "tda_asr_text_normalization_v999"
    with pytest.raises(BenchmarkQualityError, match="BENCHMARK_REFERENCE_IDENTITY_MISMATCH"):
        compute_quality_receipts(root, benchmark_id, reference=reference)


def test_reference_seed_profile_does_not_change_scoring_algorithm(tmp_path: Path):
    documents = {
        profile_id: _document(profile_id, "olá mundo")
        for profile_id in BENCHMARK_PROFILES
    }
    summaries = []
    for index, seed in enumerate(("qwen-fast", "whisper-turbo"), start=1):
        root = tmp_path / f"Data-{index}"
        root.mkdir()
        benchmark_id = _bundle(root, job_id=f"seed-{index}", documents=documents)
        save_reference(
            root,
            benchmark_id,
            {
                "expected_revision": 0,
                "provenance": "profile_seed",
                "seed_profile_id": seed,
                "tracks": [{"track_number": 1, "speaker": "Alice", "text": "olá mundo"}],
                "terms": [],
            },
        )
        receipt = next(
            item
            for item in quality_summary(root, benchmark_id)["profiles"]
            if item["profile_id"] == "qwen-fast"
        )
        summaries.append((receipt["overall"], receipt["per_track"], receipt["timing"]))
    assert summaries[0] == summaries[1]

def test_reference_is_versioned_sample_bound_and_unlocks_quality(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _bundle(
        root,
        {
            "whisper-turbo": "olá mundo",
            "whisper-detailed": "olá cruel mundo",
            "qwen-fast": "ola mundo",
            "qwen-quality": "olá mundo",
        },
    )
    before = quality_summary(root, benchmark_id)
    assert before["quality_measured"] is False
    assert before["profiles"] == []

    saved = save_reference(
        root,
        benchmark_id,
        {
            "expected_revision": 0,
            "provenance": "manual",
            "seed_profile_id": None,
            "tracks": [{"track_number": 1, "speaker": "Alice", "text": "olá mundo"}],
            "terms": [],
        },
    )
    assert saved["revision"] == 1

    measured = quality_summary(root, benchmark_id)
    assert measured["quality_measured"] is True
    assert len(measured["profiles"]) == 4
    turbo = next(item for item in measured["profiles"] if item["profile_id"] == "whisper-turbo")
    detailed = next(item for item in measured["profiles"] if item["profile_id"] == "whisper-detailed")
    assert turbo["overall"]["wer_normalized"] == 0
    assert detailed["overall"]["insertions"] == 1

    with pytest.raises(BenchmarkQualityError, match="BENCHMARK_REFERENCE_REVISION_CONFLICT"):
        save_reference(
            root,
            benchmark_id,
            {
                "expected_revision": 0,
                "provenance": "manual",
                "seed_profile_id": None,
                "tracks": [{"track_number": 1, "speaker": "Alice", "text": "stale"}],
                "terms": [],
            },
        )

    reference_path = benchmark_root(root, benchmark_id) / "reference" / "reference-000001.json"
    value = json.loads(reference_path.read_text(encoding="utf-8"))
    value["sample_identity_sha256"] = "f" * 64
    reference_path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    with pytest.raises(BenchmarkQualityError):
        quality_summary(root, benchmark_id)


def test_benchmark_evidence_and_quality_api_require_session_and_stay_local(tmp_path: Path):
    root = tmp_path / "Data"
    root.mkdir()
    benchmark_id = _bundle(root, job_id="quality-api")
    app = create_app(root, TOKEN, {ORIGIN}, run_worker=False)

    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        denied = client.get(f"/api/v1/benchmarks/{benchmark_id}")
        assert denied.status_code in {401, 403}

        headers = _headers(client)
        manifest = client.get(f"/api/v1/benchmarks/{benchmark_id}", headers=headers)
        assert manifest.status_code == 200
        assert manifest.json()["benchmark_id"] == benchmark_id

        transcript = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/qwen-quality/transcript",
            headers=headers,
        )
        assert transcript.status_code == 200
        assert transcript.headers["cache-control"] == "no-store"

        before = client.get(f"/api/v1/benchmarks/{benchmark_id}/quality", headers=headers)
        assert before.status_code == 200
        assert before.json()["quality_measured"] is False

        saved = client.post(
            f"/api/v1/benchmarks/{benchmark_id}/reference",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "expected_revision": 0,
                "provenance": "manual",
                "seed_profile_id": None,
                "tracks": [{"track_number": 1, "speaker": "Alice", "text": "texto qwen-quality"}],
                "terms": [],
            },
        )
        assert saved.status_code == 200

        after = client.get(f"/api/v1/benchmarks/{benchmark_id}/quality", headers=headers)
        assert after.status_code == 200
        assert after.json()["quality_measured"] is True
        serialized = json.dumps(after.json(), ensure_ascii=False)
        assert "texto qwen-quality" not in serialized
        assert "private context" not in serialized
