from __future__ import annotations

import json
from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.benchmark_evidence import (
    CANONICAL_PROFILES,
    BenchmarkEvidenceError,
    benchmark_id_for,
    bundle_descriptor,
    commit_bundle,
    deterministic_private_zip,
    load_bundle,
    load_profile_transcript,
    remove_incomplete_bundles,
    sanitize_benchmark_event,
    summarize_telemetry,
    transcript_srt,
    transcript_text,
    transcript_vtt,
    write_profile_artifact,
)
from tda_companion.benchmark_quality import (
    BenchmarkQualityError,
    NORMALIZATION_VERSION,
    create_reference_revision,
    normalize_text,
    score_all_profiles,
    score_profile,
    score_text,
)
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptSegmentRef,
    TranscriptStats,
    TranscriptTrack,
    TranscriptTurn,
)


SOURCE_SHA = "a" * 64
SAMPLE_SHA = "b" * 64
JOB_ID = "benchmark-job"
ATTEMPT = 1


def _processing_metrics() -> dict:
    return {
        "version": "engine_processing_v1",
        "stage_seconds": {
            "runtime_validation": 1.0,
            "checkpoint_scan": 1.0,
            "model_prepare": 1.0,
            "model_load": 1.0,
            "transcription": 5.0,
            "alignment_and_energy": 1.0,
            "consolidation": 1.0,
        },
        "total_processing_seconds": 11.0,
        "external_preparation_included": False,
        "total_tracks": 1,
        "fresh_asr_tracks": 1,
        "text_checkpoint_reused_tracks": 0,
        "completed_checkpoint_reused_tracks": 0,
        "fresh_audio_work_seconds": 300.0,
        "reused_audio_work_seconds": 0.0,
        "fresh_calibration_eligible": True,
    }


def _document(profile_id: str, text: str, *, start: float = 12.34) -> TranscriptDocument:
    engine = "whisper" if profile_id.startswith("whisper-") else "qwen3"
    segment = TranscriptSegment(
        id="seg-1",
        start=start,
        end=start + 2.0,
        text=text,
        words=(),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Amos",
        source_filename="track.flac",
        source_sha256="c" * 64,
        duration_seconds=300.0,
        segments=(segment,),
    )
    turn = TranscriptTurn(
        id="turn-1",
        speaker="Amos",
        start=start,
        end=start + 2.0,
        text=text,
        segments=(TranscriptSegmentRef(track_number=1, segment_id="seg-1"),),
    )
    return TranscriptDocument(
        recording_id="recording",
        source_sha256=SOURCE_SHA,
        language="pt",
        engine=TranscriptEngine(
            engine=engine,
            model="synthetic-model",
            profile=profile_id,
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="synthetic-revision",
        ),
        tracks=(track,),
        turns=(turn,),
        stats=TranscriptStats(
            audio_work_seconds=300.0,
            session_duration_seconds=300.0,
            processing_seconds=11.0,
            word_count=0,
            segment_count=1,
            track_count=1,
            rtf=11.0 / 300.0,
            turn_count=1,
            processing_metrics=_processing_metrics(),
        ),
    )


def _receipt(profile_id: str) -> dict:
    family = "whisper" if profile_id.startswith("whisper-") else "qwen"
    return {
        "profile_id": profile_id,
        "execution_lineage": {
            "schema_version": "tda_execution_lineage_v1",
            "companion_version": "0.3.synthetic",
            "runtime_family": family,
            "runtime_version": "1.0.synthetic",
            "runtime_artifact": {
                "runtime_id": f"{family}-synthetic",
                "version": "1.0.synthetic",
                "worker_sha256": "d" * 64,
                "archive_sha256": "e" * 64,
            },
            "device": "cuda:0",
            "compute_type": "float16",
            "gpu": {
                "vendor": "NVIDIA",
                "index": 0,
                "model": "Synthetic GPU",
                "vram_total_bytes": 8 * 1024**3,
                "compute_capability": "8.9",
                "driver_version": "synthetic",
            },
        },
    }


def _write_complete_bundle(tmp_path, texts: dict[str, str] | None = None):
    package = tmp_path / "staging" / ("craig-" + SOURCE_SHA)
    package.mkdir(parents=True)
    benchmark_id = benchmark_id_for(JOB_ID, ATTEMPT)
    values = texts or {profile: "Olá mundo" for profile in CANONICAL_PROFILES}
    for profile_id in CANONICAL_PROFILES:
        events = [
            sanitize_benchmark_event(
                {"type": "stage", "stage": "transcription", "data": {"track": 1}},
                benchmark_id=benchmark_id,
                profile_id=profile_id,
                attempt=ATTEMPT,
                seq=1,
                relative_ms=10,
            ),
            sanitize_benchmark_event(
                {"type": "terminal", "code": "BENCHMARK_PROFILE_COMPLETED"},
                benchmark_id=benchmark_id,
                profile_id=profile_id,
                attempt=ATTEMPT,
                seq=2,
                relative_ms=20,
            ),
        ]
        write_profile_artifact(
            package,
            benchmark_id=benchmark_id,
            job_id=JOB_ID,
            attempt=ATTEMPT,
            sample_identity_sha256=SAMPLE_SHA,
            document=_document(profile_id, values[profile_id]),
            receipt=_receipt(profile_id),
            context="",
            glossary="",
            events=events,
        )
    commit_bundle(
        package,
        benchmark_id=benchmark_id,
        source_id="craig-" + SOURCE_SHA,
        source_sha256=SOURCE_SHA,
        job_id=JOB_ID,
        attempt=ATTEMPT,
        sample_identity_sha256=SAMPLE_SHA,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
    )
    return package, benchmark_id


def test_complete_four_profile_bundle_is_hash_bound_and_queue_independent(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    manifest = load_bundle(package, benchmark_id)
    assert manifest["schema_version"] == "tda_benchmark_bundle_v1"
    assert [item["profile_id"] for item in manifest["profiles"]] == list(CANONICAL_PROFILES)

    # Evidence authority is the committed bundle, not queue retention.
    unrelated_queue = tmp_path / "jobs.sqlite3"
    unrelated_queue.write_bytes(b"queue")
    unrelated_queue.unlink()
    assert load_bundle(package, benchmark_id)["benchmark_id"] == benchmark_id

    transcript = load_profile_transcript(package, benchmark_id, "qwen-quality")
    assert transcript.engine.profile == "qwen-quality"
    assert transcript.turns[0].text == "Olá mundo"


def test_partial_bundle_never_becomes_visible_and_recovery_removes_it(tmp_path):
    package = tmp_path / "staging" / ("craig-" + SOURCE_SHA)
    partial = package / "benchmarks" / "benchmark-partial" / "profiles" / "whisper-turbo"
    partial.mkdir(parents=True)
    (partial / "transcript.json").write_text("{}", encoding="utf-8")
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_INCOMPLETE"):
        load_bundle(package, "benchmark-partial")
    assert remove_incomplete_bundles(package) == 1
    assert not (package / "benchmarks" / "benchmark-partial").exists()


def test_corrupted_transcript_fails_closed(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    path = package / "benchmarks" / benchmark_id / "profiles" / "qwen-fast" / "transcript.json"
    path.write_bytes(path.read_bytes() + b" ")
    with pytest.raises(BenchmarkEvidenceError, match="HASH_MISMATCH"):
        load_bundle(package, benchmark_id)


def test_diagnostic_event_allowlist_drops_paths_tokens_email_and_transcript_like_values():
    row = sanitize_benchmark_event(
        {
            "type": "event",
            "code": "ASR_CHECKPOINT_SAVED",
            "stage": "transcription",
            "data": {
                "track": 1,
                "reason": "C:\\Users\\Alice\\private.txt",
                "profile": "qwen-fast",
                "compute_type": "float16",
                "token": "secret",
                "count": 4,
                "returncode": 0,
            },
        },
        benchmark_id="benchmark-safe",
        profile_id="qwen-fast",
        attempt=1,
        seq=1,
        relative_ms=50,
    )
    encoded = json.dumps(row, ensure_ascii=False)
    assert "Alice" not in encoded
    assert "secret" not in encoded
    assert "token" not in encoded.lower()
    assert row["data"]["track"] == 1
    assert row["data"]["compute_type"] == "float16"
    assert row["data"]["count"] == 4


def test_txt_vtt_srt_are_deterministic_and_zip_contains_no_audio(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    document = load_profile_transcript(package, benchmark_id, "whisper-turbo")
    assert transcript_text(document) == transcript_text(document)
    assert transcript_vtt(document).startswith("WEBVTT\n\n00:00:12.340 --> 00:00:14.340")
    assert "00:00:12,340 --> 00:00:14,340" in transcript_srt(document)

    first = deterministic_private_zip(package, benchmark_id)
    second = deterministic_private_zip(package, benchmark_id)
    assert first == second
    with ZipFile(BytesIO(first)) as archive:
        names = archive.namelist()
        assert "benchmark.json" in names
        for profile_id in CANONICAL_PROFILES:
            assert f"profiles/{profile_id}/transcript.json" in names
            assert f"profiles/{profile_id}/transcript.txt" in names
            assert f"profiles/{profile_id}/transcript.vtt" in names
            assert f"profiles/{profile_id}/transcript.srt" in names
            assert f"profiles/{profile_id}/metrics.json" in names
            assert f"profiles/{profile_id}/events.jsonl" in names
        assert not any(name.lower().endswith((".flac", ".wav", ".mp3", ".ogg")) for name in names)


@pytest.mark.parametrize(
    ("reference", "hypothesis", "expected"),
    [
        ("a b c", "a b c", (0, 0, 0, 0.0)),
        ("a b c", "a x c", (1, 0, 0, 1 / 3)),
        ("a b c", "a c", (0, 1, 0, 1 / 3)),
        ("a b c", "a b x c", (0, 0, 1, 1 / 3)),
        ("a", "a x y", (0, 0, 2, 2.0)),
    ],
)
def test_wer_known_answers(reference, hypothesis, expected):
    result = score_text(reference, hypothesis)
    assert (
        result["substitutions"],
        result["deletions"],
        result["insertions"],
    ) == expected[:3]
    assert result["wer_normalized"] == pytest.approx(expected[3])


def test_normalization_is_versioned_unicode_aware_and_preserves_diacritics_and_word_joiners():
    assert NORMALIZATION_VERSION == "tda_asr_text_normalization_v1"
    assert normalize_text("  JOÃO, d’Artagnan -- Porto-Alegre! ") == "joão d'artagnan -- porto-alegre"
    assert score_text("João", "Joao")["wer_normalized"] == 1.0
    assert score_text("ação", "acao")["cer_normalized"] > 0


def test_reference_is_hash_bound_to_exact_sample_and_scores_all_profiles_without_winner(tmp_path):
    package, benchmark_id = _write_complete_bundle(
        tmp_path,
        {
            "whisper-turbo": "Olá mundo",
            "whisper-detailed": "Olá planeta",
            "qwen-fast": "Olá mundo extra",
            "qwen-quality": "Olá mundo",
        },
    )
    with pytest.raises(BenchmarkQualityError, match="REFERENCE_SAMPLE_MISMATCH"):
        create_reference_revision(
            package,
            benchmark_id,
            sample_identity_sha256="f" * 64,
            tracks=[{"track_number": 1, "speaker": "Amos", "text": "Olá mundo"}],
        )

    reference = create_reference_revision(
        package,
        benchmark_id,
        sample_identity_sha256=SAMPLE_SHA,
        tracks=[{"track_number": 1, "speaker": "Amos", "text": "Olá mundo"}],
        provenance="derived_from_profile",
        seed_profile_id="qwen-quality",
        terms=["Olá"],
    )
    assert reference["revision"] == 1
    assert reference["capability"] == "text"

    results = score_all_profiles(package, benchmark_id)
    assert results["qwen-quality"]["micro"]["wer_normalized"] == 0.0
    assert results["whisper-turbo"]["micro"]["wer_normalized"] == 0.0
    assert results["whisper-detailed"]["micro"]["substitutions"] == 1
    assert results["qwen-fast"]["micro"]["insertions"] == 1
    assert all(result["winner"] is None for result in results.values())
    assert all(result["timed"] is None for result in results.values())
    assert "wer_normalized" in results["qwen-quality"]["metrics_available"]


def test_reference_revisions_are_immutable_and_expected_revision_is_cas(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    first = create_reference_revision(
        package,
        benchmark_id,
        sample_identity_sha256=SAMPLE_SHA,
        tracks=[{"track_number": 1, "speaker": "Amos", "text": "um"}],
        expected_revision=0,
    )
    with pytest.raises(BenchmarkQualityError, match="REFERENCE_REVISION_CONFLICT"):
        create_reference_revision(
            package,
            benchmark_id,
            sample_identity_sha256=SAMPLE_SHA,
            tracks=[{"track_number": 1, "speaker": "Amos", "text": "dois"}],
            expected_revision=0,
        )
    second = create_reference_revision(
        package,
        benchmark_id,
        sample_identity_sha256=SAMPLE_SHA,
        tracks=[{"track_number": 1, "speaker": "Amos", "text": "dois"}],
        expected_revision=1,
    )
    assert first["revision"] == 1
    assert second["revision"] == 2
    root = package / "benchmarks" / benchmark_id / "reference"
    assert json.loads((root / "reference-r1.json").read_text(encoding="utf-8"))["tracks"][0]["text"] == "um"


def test_timed_reference_enables_timing_metrics_only_when_annotations_exist(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    create_reference_revision(
        package,
        benchmark_id,
        sample_identity_sha256=SAMPLE_SHA,
        tracks=[
            {
                "track_number": 1,
                "speaker": "Amos",
                "text": "Olá mundo",
                "turns": [
                    {
                        "start": 12.0,
                        "end": 14.0,
                        "speaker": "Amos",
                        "text": "Olá mundo",
                        "overlaps_other_speaker": False,
                    }
                ],
            }
        ],
    )
    result = score_profile(package, benchmark_id, "qwen-quality")
    assert result["reference_capability"] == "timed_turns"
    assert result["timed"]["matched_turns"] == 1
    assert result["timed"]["speaker_accuracy"] == 1.0
    assert "timing" in result["metrics_available"]


def test_shareable_quality_receipt_does_not_include_reference_or_transcript_text(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    create_reference_revision(
        package,
        benchmark_id,
        sample_identity_sha256=SAMPLE_SHA,
        tracks=[{"track_number": 1, "speaker": "Amos", "text": "segredo narrativo"}],
        terms=["segredo"],
    )
    receipt = score_profile(package, benchmark_id, "qwen-quality")
    encoded = json.dumps(receipt, ensure_ascii=False)
    assert "segredo narrativo" not in encoded
    assert "Olá mundo" not in encoded
    # Term identifiers are hashed in the shareable receipt.
    assert '"term_sha256"' in encoded



def _rewrite_json(path, mutate):
    value = json.loads(path.read_text(encoding="utf-8"))
    mutate(value)
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


def test_bundle_manifest_is_completed_provenance_bound_and_exposes_controlled_descriptors(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    manifest = load_bundle(package, benchmark_id)
    descriptor = bundle_descriptor(package, benchmark_id)
    assert manifest["status"] == "completed"
    assert manifest["profile_order"] == list(CANONICAL_PROFILES)
    assert manifest["context_sha256"] == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    assert manifest["glossary_sha256"] == manifest["context_sha256"]
    assert descriptor["manifest_sha256"]
    assert descriptor["bundle_size_bytes"] > descriptor["manifest_size_bytes"]
    for entry in manifest["profiles"]:
        profile_id = entry["profile_id"]
        assert entry["profile_manifest"]["path"] == f"profiles/{profile_id}/profile.json"
        assert entry["transcript"]["path"] == f"profiles/{profile_id}/transcript.json"
        assert entry["metrics"]["path"] == f"profiles/{profile_id}/metrics.json"
        assert entry["events"]["path"] == f"profiles/{profile_id}/events.jsonl"
        assert entry["transcript"]["size_bytes"] > 0


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        (lambda value: value.__setitem__("status", "partial"), "BENCHMARK_MANIFEST_MISMATCH"),
        (
            lambda value: value.__setitem__("sample_identity_sha256", "f" * 64),
            "BENCHMARK_PROFILE_MANIFEST_MISMATCH",
        ),
        (
            lambda value: value["profiles"][0].__setitem__("profile_id", "qwen-fast"),
            "BENCHMARK_PROFILE_SET_INVALID",
        ),
        (
            lambda value: value["profiles"][0]["transcript"].__setitem__(
                "size_bytes", value["profiles"][0]["transcript"]["size_bytes"] + 1
            ),
            "BENCHMARK_ARTIFACT_DESCRIPTOR_MISMATCH",
        ),
        (
            lambda value: value["profiles"][0]["transcript"].__setitem__("path", "../escape.json"),
            "BENCHMARK_ARTIFACT_DESCRIPTOR_MISMATCH",
        ),
    ],
)
def test_top_level_manifest_mutations_fail_closed(tmp_path, mutation, code):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    path = package / "benchmarks" / benchmark_id / "benchmark.json"
    _rewrite_json(path, mutation)
    with pytest.raises(BenchmarkEvidenceError, match=code):
        load_bundle(package, benchmark_id)


def test_profile_manifest_mutation_fails_top_level_hash_verification(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    path = package / "benchmarks" / benchmark_id / "profiles" / "qwen-quality" / "profile.json"
    _rewrite_json(path, lambda value: value.__setitem__("sample_identity_sha256", "f" * 64))
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_PROFILE_MANIFEST_HASH_MISMATCH"):
        load_bundle(package, benchmark_id)


def test_committed_profiles_and_bundle_cannot_be_overwritten(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_PROFILE_ALREADY_COMMITTED"):
        write_profile_artifact(
            package,
            benchmark_id=benchmark_id,
            job_id=JOB_ID,
            attempt=ATTEMPT,
            sample_identity_sha256=SAMPLE_SHA,
            document=_document("qwen-quality", "outro"),
            receipt=_receipt("qwen-quality"),
            context="",
            glossary="",
        )
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ALREADY_COMMITTED"):
        commit_bundle(
            package,
            benchmark_id=benchmark_id,
            source_id="craig-" + SOURCE_SHA,
            source_sha256=SOURCE_SHA,
            job_id=JOB_ID,
            attempt=ATTEMPT,
            sample_identity_sha256=SAMPLE_SHA,
            sample_seconds=300.0,
            track_count=1,
            audio_work_seconds=300.0,
        )


def test_partial_profile_matrix_never_has_a_completed_bundle(tmp_path):
    for count in range(4):
        package = tmp_path / f"partial-{count}" / "staging" / ("craig-" + SOURCE_SHA)
        package.mkdir(parents=True)
        benchmark_id = benchmark_id_for(f"{JOB_ID}-{count}", ATTEMPT)
        for profile_id in CANONICAL_PROFILES[:count]:
            write_profile_artifact(
                package,
                benchmark_id=benchmark_id,
                job_id=f"{JOB_ID}-{count}",
                attempt=ATTEMPT,
                sample_identity_sha256=SAMPLE_SHA,
                document=_document(profile_id, profile_id),
                receipt=_receipt(profile_id),
                context="",
                glossary="",
            )
        with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_INCOMPLETE"):
            load_bundle(package, benchmark_id)


def test_path_traversal_and_symlink_root_fail_closed(tmp_path):
    package = tmp_path / "staging" / ("craig-" + SOURCE_SHA)
    package.mkdir(parents=True)
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_ID_INVALID"):
        load_bundle(package, "../escape")
    link = tmp_path / "linked-package"
    try:
        link.symlink_to(package, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation is unavailable on this runner")
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_PACKAGE_ROOT_UNSAFE"):
        load_bundle(link, "benchmark-safe")


def test_benchmark_id_changes_per_deliberate_attempt_and_is_stable_within_attempt():
    assert benchmark_id_for(JOB_ID, 1) == benchmark_id_for(JOB_ID, 1)
    assert benchmark_id_for(JOB_ID, 1) != benchmark_id_for(JOB_ID, 2)


def test_telemetry_summary_handles_unavailable_partial_complete_and_wrong_gpu():
    unavailable = summarize_telemetry(
        [],
        interval_ms=1000,
        expected_samples=3,
        expected_gpu_identity="GPU-1",
    )
    assert unavailable["captured_samples"] == 0
    assert unavailable["coverage"] == 0
    assert unavailable["missing_reason"] == "SAMPLER_NOT_AVAILABLE"
    assert unavailable["vram_peak_bytes"] is None

    partial = summarize_telemetry(
        [
            {
                "relative_ms": 0,
                "gpu_identity": "GPU-1",
                "gpu_utilization_percent": 50,
                "vram_used_bytes": 100,
                "vram_total_bytes": 1000,
                "cpu_utilization_percent": 10,
                "ram_used_bytes": 200,
            },
            {
                "relative_ms": 1000,
                "gpu_identity": "GPU-1",
                "gpu_utilization_percent": 90,
                "vram_used_bytes": 300,
                "vram_total_bytes": 1000,
                "cpu_utilization_percent": 30,
                "ram_used_bytes": 250,
                "temperature_c": 70,
                "power_w": 120,
            },
        ],
        interval_ms=1000,
        expected_samples=4,
        expected_gpu_identity="GPU-1",
    )
    assert partial["coverage"] == 0.5
    assert partial["vram_peak_bytes"] == 300
    assert partial["gpu_utilization_average_percent"] == 70
    assert partial["gpu_utilization_p95_percent"] == 90
    assert partial["ram_peak_bytes"] == 250
    assert partial["temperature_max_c"] == 70
    assert partial["power_peak_w"] == 120

    complete = summarize_telemetry(
        [
            {"relative_ms": 0, "gpu_identity": "GPU-1", "gpu_utilization_percent": 1},
            {"relative_ms": 1000, "gpu_identity": "GPU-1", "gpu_utilization_percent": 2},
        ],
        interval_ms=1000,
        expected_samples=2,
        expected_gpu_identity="GPU-1",
    )
    assert complete["coverage"] == 1.0

    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_TELEMETRY_GPU_MISMATCH"):
        summarize_telemetry(
            [{"relative_ms": 0, "gpu_identity": "GPU-2"}],
            interval_ms=1000,
            expected_samples=1,
            expected_gpu_identity="GPU-1",
        )


def test_telemetry_rejects_sampling_time_reversal_and_private_gpu_identity():
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_TELEMETRY_TIME_INVALID"):
        summarize_telemetry(
            [{"relative_ms": 1000}, {"relative_ms": 500}],
            interval_ms=1000,
            expected_samples=2,
        )
    with pytest.raises(BenchmarkEvidenceError, match="BENCHMARK_TELEMETRY_GPU_INVALID"):
        summarize_telemetry(
            [{"relative_ms": 0, "gpu_identity": "C:\\Users\\Alice\\gpu"}],
            interval_ms=1000,
            expected_samples=1,
        )


def test_normalization_known_edge_cases_and_mismatch_fail_closed(tmp_path):
    assert normalize_text("  OLÁ\t\nMUNDO!!! ") == "olá mundo"
    assert normalize_text("d’Artagnan") == "d'artagnan"
    assert normalize_text("Porto‑Alegre") == "porto-alegre"
    assert normalize_text("ação") == normalize_text("ação")
    assert score_text("um dois", "")["wer_normalized"] == 1.0

    package, benchmark_id = _write_complete_bundle(tmp_path)
    create_reference_revision(
        package,
        benchmark_id,
        sample_identity_sha256=SAMPLE_SHA,
        tracks=[{"track_number": 1, "speaker": "Amos", "text": "Olá mundo"}],
    )
    pointer = package / "benchmarks" / benchmark_id / "reference" / "current.json"
    current = json.loads(pointer.read_text(encoding="utf-8"))
    reference_path = pointer.parent / current["artifact"]
    _rewrite_json(
        reference_path,
        lambda value: value.__setitem__("normalization_version", "tda_asr_text_normalization_v0"),
    )
    # The payload hash no longer matches even before the scorer can accept stale semantics.
    with pytest.raises(BenchmarkQualityError, match="REFERENCE_HASH_MISMATCH"):
        score_profile(package, benchmark_id, "qwen-quality")



def test_committed_bundle_survives_real_queue_row_and_event_pruning(tmp_path):
    package, benchmark_id = _write_complete_bundle(tmp_path)
    token = "z" * 43
    origin = "https://dnd.faysk.dev"
    app = create_app(tmp_path, token, {origin}, run_worker=False)
    headers = {"Authorization": f"Bearer {token}", "Origin": origin}
    body = {
        "kind": "benchmark.craig",
        "campaign_id": "benchmark-local",
        "session_id": "benchmark-local",
        "source_id": "craig-" + SOURCE_SHA,
        "sample_identity_sha256": SAMPLE_SHA,
        "sample_seconds": 300.0,
        "profile_order": list(CANONICAL_PROFILES),
        "context": "",
        "glossary": "",
        "cpu": False,
        "units": 4,
    }
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        job = app.state.store.submit("benchmark-retention", body)
        claimed = app.state.store.claim()
        assert claimed == (job["id"], 1)
        for completed in range(1, 5):
            assert app.state.store.progress(
                job["id"],
                1,
                completed=completed,
                total=4,
                stage="benchmark_profile",
            )
        result = {
            "schema_version": "tda_processing_benchmark_v1",
            "kind": "benchmark.craig",
            "benchmark_id": benchmark_id,
            "evidence_schema_version": "tda_benchmark_bundle_v1",
            "source_id": body["source_id"],
            "sample_identity_sha256": SAMPLE_SHA,
        }
        assert app.state.store.complete(job["id"], 1, result)
        assert app.state.store.remove(job["id"]) == {"deleted": True, "id": job["id"]}
        assert app.state.store.terminal_receipt(job["id"])["status"] == "succeeded"

        response = client.get(f"/api/v1/benchmarks/{benchmark_id}", headers=headers)
        assert response.status_code == 200
        assert response.json()["benchmark_id"] == benchmark_id
        assert response.json()["status"] == "completed"

        transcript = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/qwen-quality/transcript",
            headers=headers,
        )
        assert transcript.status_code == 200
        assert transcript.json()["engine"]["profile"] == "qwen-quality"


def test_benchmark_evidence_api_requires_auth_and_fails_closed_for_unknown_or_invalid_profile(tmp_path):
    _package, benchmark_id = _write_complete_bundle(tmp_path)
    token = "z" * 43
    origin = "https://dnd.faysk.dev"
    app = create_app(tmp_path, token, {origin}, run_worker=False)
    headers = {"Authorization": f"Bearer {token}", "Origin": origin}
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        unauthorized = client.get(
            f"/api/v1/benchmarks/{benchmark_id}",
            headers={"Origin": origin},
        )
        assert unauthorized.status_code == 401
        missing = client.get("/api/v1/benchmarks/benchmark-missing", headers=headers)
        assert missing.status_code == 404
        invalid_profile = client.get(
            f"/api/v1/benchmarks/{benchmark_id}/profiles/not-a-profile/transcript",
            headers=headers,
        )
        assert invalid_profile.status_code in {404, 409}
        assert "traceback" not in invalid_profile.text.lower()
