from __future__ import annotations

import json
import re
from dataclasses import replace

import pytest

from tda_companion.benchmark_bundles import (
    BENCHMARK_PROFILES,
    benchmark_id_for as _canonical_benchmark_id_for,
    benchmark_root as _canonical_benchmark_root,
    benchmark_sample_identity_from_descriptor,
    finalize_benchmark_bundle,
    write_benchmark_profile,
)
from tda_companion.benchmark_quality import (
    BenchmarkQualityError,
    active_reference,
    compute_quality_metrics,
    inspect_quality_errors,
    normalize_text,
    reference_draft_from_profile,
    reference_status,
    save_reference_revision,
    score_all_profiles,
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



def document(
    profile_id: str,
    text: str,
    *,
    speaker: str = "Renan",
    turn: bool = False,
    alignment: str = "native",
    turn_overlap: bool = False,
) -> TranscriptDocument:
    segment = TranscriptSegment(
        id="seg-1",
        start=1.0,
        end=4.0,
        text=text,
    )
    track = TranscriptTrack(
        number=1,
        speaker=speaker,
        source_filename="1.flac",
        source_sha256="c" * 64,
        duration_seconds=300.0,
        segments=(segment,),
    )
    turns = (
        TranscriptTurn(
            id="turn-1",
            speaker=speaker,
            start=1.0,
            end=4.0,
            text=text,
            segments=(TranscriptSegmentRef(track_number=1, segment_id="seg-1"),),
        ),
    ) if turn else ()
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
            alignment=alignment,
        ),
        tracks=(track,),
        turns=turns,
        stats=TranscriptStats(
            audio_work_seconds=300.0,
            session_duration_seconds=300.0,
            processing_seconds=1.0,
            word_count=0,
            segment_count=1,
            track_count=1,
            turn_count=len(turns),
        ),
    )


def build_bundle(tmp_path, texts: dict[str, str] | None = None) -> str:
    benchmark_id = benchmark_id_for("bench-job", 1, SAMPLE_IDENTITY_SHA256)
    texts = texts or {}
    for profile_id in BENCHMARK_PROFILES:
        write_profile_artifact(
            tmp_path,
            benchmark_id=benchmark_id,
            sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
            sample_seconds=300.0,
            source_id=SOURCE_ID,
            document=document(
                profile_id,
                texts.get(profile_id, "um dois três quatro"),
            ),
            execution_lineage={
                "schema_version": "tda_execution_lineage_v1",
                "runtime_family": "whisper" if profile_id.startswith("whisper") else "qwen",
            },
        )
    finalize_bundle(
        tmp_path,
        benchmark_id=benchmark_id,
        job_id="bench-job",
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA256,
        sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="mesa de teste",
        glossary="João",
    )
    return benchmark_id


def test_normalization_is_locale_independent_and_preserves_diacritics():
    assert normalize_text("  OLÁ, João — d'Água!  ") == "olá joão d'água"


def test_text_quality_reports_raw_edit_counts_and_wer_over_one():
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "um",
            }
        ],
        "glossary_terms": [],
    }
    metrics = compute_quality_metrics(
        reference,
        document("whisper-turbo", "um dois três"),
    )
    micro = metrics["micro"]
    assert micro["substitutions"] == 0
    assert micro["deletions"] == 0
    assert micro["insertions"] == 2
    assert micro["reference_words"] == 1
    assert micro["wer_normalized"] == 2.0
    assert metrics["per_track"][0]["state"] == "matched"


def test_reference_revision_is_immutable_hash_bound_and_stale_safe(tmp_path):
    benchmark_id = build_bundle(tmp_path)
    draft = reference_draft_from_profile(
        tmp_path,
        benchmark_id=benchmark_id,
        profile_id="whisper-turbo",
    )
    assert draft["capability_level"] == 1
    assert draft["provenance"]["human_owned"] is True
    assert draft["tracks"][0]["text"] == "um dois três quatro"

    saved = save_reference_revision(
        tmp_path,
        benchmark_id=benchmark_id,
        expected_revision=0,
        capability_level=1,
        provenance_kind="derived-from-profile",
        seed_profile_id="whisper-turbo",
        tracks=[
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "um dois três quatro corrigido",
            }
        ],
        glossary_terms=["três"],
        activate=True,
    )
    assert saved["reference"]["revision"] == 1
    assert saved["index"]["active_revision"] == 1
    assert len(saved["reference"]["canonical_payload_sha256"]) == 64

    with pytest.raises(
        BenchmarkQualityError,
        match="BENCHMARK_REFERENCE_STALE_REVISION",
    ):
        save_reference_revision(
            tmp_path,
            benchmark_id=benchmark_id,
            expected_revision=0,
            capability_level=1,
            provenance_kind="manual",
            tracks=[
                {
                    "track_number": 1,
                    "speaker": "Renan",
                    "text": "outro texto",
                }
            ],
            activate=True,
        )


def test_quality_receipt_is_sanitized_and_never_selects_a_winner(tmp_path):
    benchmark_id = build_bundle(
        tmp_path,
        {
            "whisper-turbo": "um dois cinco quatro",
            "whisper-detailed": "um dois três quatro",
            "qwen-fast": "um dois três quatro extra",
            "qwen-quality": "um dois três",
        },
    )
    secret_reference = "um dois três quatro segredo-super-privado"
    save_reference_revision(
        tmp_path,
        benchmark_id=benchmark_id,
        expected_revision=0,
        capability_level=1,
        provenance_kind="manual",
        tracks=[
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": secret_reference,
            }
        ],
        glossary_terms=["segredo-super-privado"],
        activate=True,
    )

    quality = score_all_profiles(tmp_path, benchmark_id=benchmark_id)
    assert quality["quality_measured"] is True
    assert quality["winner"] is None
    assert quality["composite_score"] is None
    assert [item["profile_id"] for item in quality["profiles"]] == list(
        BENCHMARK_PROFILES
    )
    serialized = json.dumps(quality, ensure_ascii=False)
    assert secret_reference not in serialized
    assert "segredo-super-privado" not in serialized
    for profile in quality["profiles"]:
        assert len(profile["receipt_sha256"]) == 64
        assert profile["reference_sha256"] == quality["reference"]["active_sha256"]
        assert profile["metrics"]["normalization_policy"]["diacritics"] == "preserve"


def test_benchmark_without_reference_stays_explicitly_unmeasured(tmp_path):
    benchmark_id = build_bundle(tmp_path)
    quality = score_all_profiles(tmp_path, benchmark_id=benchmark_id)
    assert quality == {
        "schema_version": "tda_benchmark_quality_summary_v1",
        "benchmark_id": benchmark_id,
        "reference": reference_status(tmp_path, benchmark_id=benchmark_id),
        "quality_measured": False,
        "profiles": [],
        "winner": None,
        "composite_score": None,
    }


def test_level_two_reference_enables_boundary_speaker_and_overlap_metrics(tmp_path):
    benchmark_id = benchmark_id_for("bench-job", 1, SAMPLE_IDENTITY_SHA256)
    for profile_id in BENCHMARK_PROFILES:
        write_profile_artifact(
            tmp_path,
            benchmark_id=benchmark_id,
            sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
            sample_seconds=300.0,
            source_id=SOURCE_ID,
            document=document(profile_id, "fala certa", turn=True),
            execution_lineage={
                "schema_version": "tda_execution_lineage_v1",
                "runtime_family": "whisper" if profile_id.startswith("whisper") else "qwen",
            },
        )
    finalize_bundle(
        tmp_path,
        benchmark_id=benchmark_id,
        job_id="bench-job",
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA256,
        sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="",
        glossary="",
    )
    save_reference_revision(
        tmp_path,
        benchmark_id=benchmark_id,
        expected_revision=0,
        capability_level=2,
        provenance_kind="imported",
        tracks=[
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "fala certa",
                "turns": [
                    {
                        "id": "human-1",
                        "speaker": "Renan",
                        "start": 1.1,
                        "end": 4.1,
                        "text": "fala certa",
                        "overlaps_other_speaker": False,
                    }
                ],
            }
        ],
        activate=True,
    )
    quality = score_all_profiles(tmp_path, benchmark_id=benchmark_id)
    timing = quality["profiles"][0]["metrics"]["timing"]
    assert timing["available"] is True
    assert timing["turn_coverage"] == 1.0
    assert timing["speaker_accuracy"] == 1.0
    assert timing["boundary_p95_seconds"] == pytest.approx(0.1)
    assert timing["timing_precision"] == "segment_aligned"


@pytest.mark.parametrize(
    ("hypothesis", "substitutions", "deletions", "insertions", "wer"),
    [
        ("um dois três", 0, 0, 0, 0.0),
        ("um cinco três", 1, 0, 0, 1 / 3),
        ("um três", 0, 1, 0, 1 / 3),
        ("um dois três quatro", 0, 0, 1, 1 / 3),
        ("", 0, 3, 0, 1.0),
    ],
)
def test_standard_word_error_semantics(
    hypothesis,
    substitutions,
    deletions,
    insertions,
    wer,
):
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [{"track_number": 1, "speaker": "Renan", "text": "um dois três"}],
        "glossary_terms": [],
    }
    metrics = compute_quality_metrics(reference, document("qwen-fast", hypothesis))
    micro = metrics["micro"]
    assert micro["substitutions"] == substitutions
    assert micro["deletions"] == deletions
    assert micro["insertions"] == insertions
    assert micro["wer_normalized"] == pytest.approx(wer)


def test_normalization_preserves_accent_and_apostrophe_hyphen_identity():
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "João d'Água meio-elfo",
            }
        ],
        "glossary_terms": [],
    }
    same = compute_quality_metrics(
        reference,
        document("whisper-turbo", "JOÃO, d’Água meio‐elfo!"),
    )
    accent_lost = compute_quality_metrics(
        reference,
        document("whisper-turbo", "Joao d'Agua meio elfo"),
    )
    assert same["micro"]["wer_normalized"] == 0.0
    assert accent_lost["micro"]["wer_normalized"] > 0.0


def test_normalization_version_mismatch_fails_closed():
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v0",
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [{"track_number": 1, "speaker": "Renan", "text": "um"}],
        "glossary_terms": [],
    }
    with pytest.raises(
        BenchmarkQualityError,
        match="BENCHMARK_NORMALIZATION_VERSION_MISMATCH",
    ):
        compute_quality_metrics(reference, document("qwen-quality", "um"))


def test_missing_and_extra_tracks_are_scored_in_micro_aggregate():
    segment_one = TranscriptSegment(id="seg-1", start=0.0, end=1.0, text="um dois")
    segment_two = TranscriptSegment(id="seg-2", start=1.0, end=2.0, text="extra")
    candidate = TranscriptDocument(
        recording_id="recording",
        source_sha256=SOURCE_SHA256,
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="model",
            profile="whisper-turbo",
            device="cuda:0",
            compute_type="float16",
            alignment="native",
        ),
        tracks=(
            TranscriptTrack(
                number=1,
                speaker="A",
                source_filename="1.flac",
                source_sha256="c" * 64,
                duration_seconds=300.0,
                segments=(segment_one,),
            ),
            TranscriptTrack(
                number=3,
                speaker="C",
                source_filename="3.flac",
                source_sha256="d" * 64,
                duration_seconds=300.0,
                segments=(segment_two,),
            ),
        ),
        turns=(),
        stats=TranscriptStats(
            audio_work_seconds=600.0,
            session_duration_seconds=300.0,
            processing_seconds=1.0,
            word_count=0,
            segment_count=2,
            track_count=2,
            turn_count=0,
        ),
    )
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [
            {"track_number": 1, "speaker": "A", "text": "um dois"},
            {"track_number": 2, "speaker": "B", "text": "faltou aqui"},
        ],
        "glossary_terms": [],
    }
    metrics = compute_quality_metrics(reference, candidate)
    assert [row["state"] for row in metrics["per_track"]] == [
        "matched",
        "missing_hypothesis",
        "extra_hypothesis",
    ]
    # ref words = 4; track 2 contributes two deletions and track 3 one insertion.
    assert metrics["micro"]["deletions"] == 2
    assert metrics["micro"]["insertions"] == 1
    assert metrics["micro"]["wer_normalized"] == pytest.approx(0.75)


def test_reference_integrity_tamper_and_wrong_sample_fail_closed(tmp_path):
    benchmark_id = build_bundle(tmp_path)
    saved = save_reference_revision(
        tmp_path,
        benchmark_id=benchmark_id,
        expected_revision=0,
        capability_level=1,
        provenance_kind="manual",
        tracks=[
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "texto humano",
            }
        ],
        activate=True,
    )
    reference = dict(saved["reference"])
    reference["source_sha256"] = "9" * 64
    with pytest.raises(
        BenchmarkQualityError,
        match="BENCHMARK_REFERENCE_SOURCE_MISMATCH",
    ):
        compute_quality_metrics(reference, document("whisper-turbo", "texto humano"))

    revision_path = (
        tmp_path
        / "benchmarks"
        / benchmark_id
        / "reference"
        / "revisions"
        / f"r000001-{saved['reference']['canonical_payload_sha256'][:12]}.json"
    )
    payload = json.loads(revision_path.read_text(encoding="utf-8"))
    payload["tracks"][0]["text"] = "tampered"
    revision_path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(
        BenchmarkQualityError,
        match="BENCHMARK_REFERENCE_INTEGRITY_MISMATCH",
    ):
        active_reference(tmp_path, benchmark_id=benchmark_id)


def test_private_error_inspection_loads_text_separately_from_receipt(tmp_path):
    benchmark_id = build_bundle(
        tmp_path,
        {
            "whisper-turbo": "Joao chegou cedo",
            "whisper-detailed": "João chegou cedo",
            "qwen-fast": "João chegou muito cedo",
            "qwen-quality": "João cedo",
        },
    )
    save_reference_revision(
        tmp_path,
        benchmark_id=benchmark_id,
        expected_revision=0,
        capability_level=1,
        provenance_kind="manual",
        tracks=[
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "João chegou cedo",
            }
        ],
        glossary_terms=["João"],
        activate=True,
    )

    receipt = score_all_profiles(tmp_path, benchmark_id=benchmark_id)
    assert "João" not in json.dumps(receipt, ensure_ascii=False)

    inspection = inspect_quality_errors(
        tmp_path,
        benchmark_id=benchmark_id,
        profile_id="whisper-turbo",
    )
    assert inspection["private_text"] is True
    assert inspection["regions"]
    assert any(
        "joão" in region["reference_context"]
        for region in inspection["regions"]
    )
    assert inspection["glossary_findings"][0]["term"] == "João"


def test_glossary_absent_from_reference_does_not_affect_score():
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [{"track_number": 1, "speaker": "Renan", "text": "fala comum"}],
        "glossary_terms": ["Strahd"],
    }
    metrics = compute_quality_metrics(
        reference,
        document("qwen-fast", "fala comum Strahd Strahd"),
    )
    assert metrics["glossary"] == {
        "available": False,
        "reference_occurrences": 0,
        "correct_occurrences": 0,
        "missed_occurrences": 0,
        "extra_occurrences": 0,
        "recall": None,
        "precision": None,
        "terms": [],
    }


def test_level_two_speaker_mismatch_and_overlap_are_not_hidden(tmp_path):
    benchmark_id = benchmark_id_for("bench-job", 1, SAMPLE_IDENTITY_SHA256)
    for profile_id in BENCHMARK_PROFILES:
        write_profile_artifact(
            tmp_path,
            benchmark_id=benchmark_id,
            sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
            sample_seconds=300.0,
            source_id=SOURCE_ID,
            document=document(
                profile_id,
                "fala certa",
                speaker="Renan",
                turn=True,
                turn_overlap=False,
            ),
            execution_lineage={"schema_version": "tda_execution_lineage_v1"},
        )
    finalize_bundle(
        tmp_path,
        benchmark_id=benchmark_id,
        job_id="bench-job",
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA256,
        sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="",
        glossary="",
    )
    save_reference_revision(
        tmp_path,
        benchmark_id=benchmark_id,
        expected_revision=0,
        capability_level=2,
        provenance_kind="manual",
        tracks=[
            {
                "track_number": 1,
                "speaker": "Outra pessoa",
                "text": "fala certa",
                "turns": [
                    {
                        "id": "human-1",
                        "speaker": "Outra pessoa",
                        "start": 1.0,
                        "end": 4.0,
                        "text": "fala certa",
                        "overlaps_other_speaker": True,
                    }
                ],
            }
        ],
        activate=True,
    )
    quality = score_all_profiles(tmp_path, benchmark_id=benchmark_id)
    timing = quality["profiles"][0]["metrics"]["timing"]
    assert timing["matched_reference_turns"] == 1
    assert timing["speaker_accuracy"] == 0.0
    assert timing["overlap"]["reference_positive"] == 1
    assert timing["overlap"]["hypothesis_positive"] == 0
    assert timing["overlap"]["recall"] == 0.0
    assert timing["overlap"]["f1"] is None


def test_fallback_timing_precision_remains_visible(tmp_path):
    benchmark_id = benchmark_id_for("bench-job", 1, SAMPLE_IDENTITY_SHA256)
    for profile_id in BENCHMARK_PROFILES:
        write_profile_artifact(
            tmp_path,
            benchmark_id=benchmark_id,
            sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
            sample_seconds=300.0,
            source_id=SOURCE_ID,
            document=document(
                profile_id,
                "fala certa",
                turn=True,
                alignment="window-fallback",
            ),
            execution_lineage={"schema_version": "tda_execution_lineage_v1"},
        )
    finalize_bundle(
        tmp_path,
        benchmark_id=benchmark_id,
        job_id="bench-job",
        attempt=1,
        source_id=SOURCE_ID,
        source_sha256=SOURCE_SHA256,
        sample_identity_sha256=SAMPLE_IDENTITY_SHA256,
        sample_seconds=300.0,
        track_count=1,
        audio_work_seconds=300.0,
        context="",
        glossary="",
    )
    save_reference_revision(
        tmp_path,
        benchmark_id=benchmark_id,
        expected_revision=0,
        capability_level=2,
        provenance_kind="manual",
        tracks=[
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "fala certa",
                "turns": [
                    {
                        "id": "human-1",
                        "speaker": "Renan",
                        "start": 1.0,
                        "end": 4.0,
                        "text": "fala certa",
                        "overlaps_other_speaker": False,
                    }
                ],
            }
        ],
        activate=True,
    )
    quality = score_all_profiles(tmp_path, benchmark_id=benchmark_id)
    assert (
        quality["profiles"][0]["metrics"]["timing"]["timing_precision"]
        == "window_fallback"
    )


def test_silence_only_level_one_range_has_explicit_undefined_rates():
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [{"track_number": 1, "speaker": "Renan", "text": ""}],
        "glossary_terms": [],
    }
    metrics = compute_quality_metrics(
        reference,
        document("whisper-turbo", ""),
    )
    assert metrics["micro"]["distance"] == 0
    assert metrics["micro"]["wer_normalized"] is None
    assert metrics["micro"]["cer_normalized"] is None



def test_level_two_turns_cannot_escape_exact_benchmark_sample(tmp_path):
    benchmark_id = build_bundle(tmp_path)
    with pytest.raises(
        BenchmarkQualityError,
        match="BENCHMARK_REFERENCE_TURN_INVALID",
    ):
        save_reference_revision(
            tmp_path,
            benchmark_id=benchmark_id,
            expected_revision=0,
            capability_level=2,
            provenance_kind="manual",
            tracks=[
                {
                    "track_number": 1,
                    "speaker": "Renan",
                    "text": "fala",
                    "turns": [
                        {
                            "id": "outside-sample",
                            "speaker": "Renan",
                            "start": 299.0,
                            "end": 301.0,
                            "text": "fala",
                            "overlaps_other_speaker": False,
                        }
                    ],
                }
            ],
            activate=True,
        )


def test_glossary_hit_on_wrong_track_is_not_counted_as_correct():
    track_one = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1.flac",
        source_sha256="c" * 64,
        duration_seconds=300.0,
        segments=(
            TranscriptSegment(
                id="seg-1",
                start=0.0,
                end=1.0,
                text="fala comum",
            ),
        ),
    )
    track_two = TranscriptTrack(
        number=2,
        speaker="Bob",
        source_filename="2.flac",
        source_sha256="d" * 64,
        duration_seconds=300.0,
        segments=(
            TranscriptSegment(
                id="seg-2",
                start=0.0,
                end=1.0,
                text="Strahd",
            ),
        ),
    )
    candidate = TranscriptDocument(
        recording_id="recording",
        source_sha256=SOURCE_SHA256,
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="model",
            profile="whisper-turbo",
            device="cuda:0",
            compute_type="float16",
            alignment="native",
        ),
        tracks=(track_one, track_two),
        turns=(),
        stats=TranscriptStats(
            audio_work_seconds=600.0,
            session_duration_seconds=300.0,
            processing_seconds=1.0,
            word_count=0,
            segment_count=2,
            track_count=2,
            turn_count=0,
        ),
    )
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [
            {"track_number": 1, "speaker": "Alice", "text": "Strahd fala"},
            {"track_number": 2, "speaker": "Bob", "text": "fala comum"},
        ],
        "glossary_terms": ["Strahd"],
    }
    glossary = compute_quality_metrics(reference, candidate)["glossary"]
    assert glossary["reference_occurrences"] == 1
    assert glossary["correct_occurrences"] == 0
    assert glossary["missed_occurrences"] == 1
    assert glossary["extra_occurrences"] == 1
    assert glossary["recall"] == 0.0
    assert glossary["precision"] == 0.0

def test_timing_match_uses_temporal_overlap_before_speaker_identity():
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 2,
        "tracks": [
            {
                "track_number": 1,
                "speaker": "Alice",
                "text": "fala",
                "turns": [
                    {
                        "id": "ref-1",
                        "speaker": "Alice",
                        "start": 10.0,
                        "end": 20.0,
                        "text": "fala",
                        "overlaps_other_speaker": False,
                    }
                ],
            }
        ],
        "glossary_terms": [],
    }
    segment_near = TranscriptSegment(
        id="seg-near",
        start=10.0,
        end=20.0,
        text="fala",
    )
    segment_far = TranscriptSegment(
        id="seg-far",
        start=10.0,
        end=16.0,
        text="fala",
    )
    candidate = TranscriptDocument(
        recording_id="recording",
        source_sha256=SOURCE_SHA256,
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="model",
            profile="whisper-turbo",
            device="cuda:0",
            compute_type="float16",
            alignment="native",
        ),
        tracks=(
            TranscriptTrack(
                number=1,
                speaker="track-speaker",
                source_filename="1.flac",
                source_sha256="c" * 64,
                duration_seconds=300.0,
                segments=(segment_near, segment_far),
            ),
        ),
        turns=(
            TranscriptTurn(
                id="turn-near",
                speaker="Bob",
                start=10.0,
                end=20.0,
                text="fala",
                segments=(
                    TranscriptSegmentRef(track_number=1, segment_id="seg-near"),
                ),
            ),
            TranscriptTurn(
                id="turn-far",
                speaker="Alice",
                start=10.0,
                end=16.0,
                text="fala",
                segments=(
                    TranscriptSegmentRef(track_number=1, segment_id="seg-far"),
                ),
            ),
        ),
        stats=TranscriptStats(
            audio_work_seconds=300.0,
            session_duration_seconds=300.0,
            processing_seconds=1.0,
            word_count=2,
            segment_count=2,
            track_count=1,
            turn_count=2,
        ),
    )

    timing = compute_quality_metrics(reference, candidate)["timing"]

    assert timing["matched_reference_turns"] == 1
    assert timing["speaker_accuracy"] == 0.0
    assert timing["boundary_p95_seconds"] == 0.0
    assert timing["unmatched_hypothesis_turns"] == 1

def test_micro_aggregate_is_not_naive_macro_average():
    track_one = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1.flac",
        source_sha256="c" * 64,
        duration_seconds=300.0,
        segments=(
            TranscriptSegment(
                id="seg-1",
                start=0.0,
                end=1.0,
                text="um dois três quatro cinco seis sete oito nove dez",
            ),
        ),
    )
    track_two = TranscriptTrack(
        number=2,
        speaker="Bob",
        source_filename="2.flac",
        source_sha256="d" * 64,
        duration_seconds=300.0,
        segments=(
            TranscriptSegment(
                id="seg-2",
                start=0.0,
                end=1.0,
                text="errado",
            ),
        ),
    )
    candidate = TranscriptDocument(
        recording_id="recording",
        source_sha256=SOURCE_SHA256,
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="model",
            profile="whisper-turbo",
            device="cuda:0",
            compute_type="float16",
            alignment="native",
        ),
        tracks=(track_one, track_two),
        turns=(),
        stats=TranscriptStats(
            audio_work_seconds=600.0,
            session_duration_seconds=300.0,
            processing_seconds=1.0,
            word_count=11,
            segment_count=2,
            track_count=2,
            turn_count=0,
        ),
    )
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [
            {
                "track_number": 1,
                "speaker": "Alice",
                "text": "um dois três quatro cinco seis sete oito nove dez",
            },
            {
                "track_number": 2,
                "speaker": "Bob",
                "text": "certo",
            },
        ],
        "glossary_terms": [],
    }

    metrics = compute_quality_metrics(reference, candidate)
    assert metrics["per_track"][0]["wer_normalized"] == 0.0
    assert metrics["per_track"][1]["wer_normalized"] == 1.0
    assert metrics["micro"]["wer_normalized"] == pytest.approx(1 / 11)
    assert metrics["micro"]["macro_wer_normalized"] == pytest.approx(0.5)


def test_identical_words_with_different_segmentation_score_as_exact_match():
    candidate = document("qwen-quality", "placeholder")
    first = TranscriptSegment(id="seg-a", start=0.0, end=1.0, text="um dois")
    second = TranscriptSegment(id="seg-b", start=1.0, end=2.0, text="três quatro")
    track = TranscriptTrack(
        number=1,
        speaker="Renan",
        source_filename="1.flac",
        source_sha256="c" * 64,
        duration_seconds=300.0,
        segments=(first, second),
    )
    candidate = TranscriptDocument(
        recording_id=candidate.recording_id,
        source_sha256=candidate.source_sha256,
        language=candidate.language,
        engine=candidate.engine,
        tracks=(track,),
        turns=(),
        stats=TranscriptStats(
            audio_work_seconds=300.0,
            session_duration_seconds=300.0,
            processing_seconds=1.0,
            word_count=4,
            segment_count=2,
            track_count=1,
            turn_count=0,
        ),
    )
    reference = {
        "normalization_policy": {
            "schema_version": "tda_asr_text_normalization_v1",
            "unicode_normalization": "NFC",
            "case": "unicode_casefold",
            "whitespace": "collapse",
            "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
            "diacritics": "preserve",
            "locale_dependent": False,
        },
        "source_sha256": SOURCE_SHA256,
        "capability_level": 1,
        "tracks": [
            {
                "track_number": 1,
                "speaker": "Renan",
                "text": "um dois três quatro",
            }
        ],
        "glossary_terms": [],
    }

    metrics = compute_quality_metrics(reference, candidate)
    assert metrics["micro"]["wer_normalized"] == 0.0
    assert metrics["micro"]["cer_normalized"] == 0.0
    assert metrics["micro"]["substitutions"] == 0
    assert metrics["micro"]["deletions"] == 0
    assert metrics["micro"]["insertions"] == 0

