from __future__ import annotations

import math

import pytest

from tda_companion.asr_quality import (
    AsrQualityError,
    QualityThresholds,
    ReferenceTurn,
    apply_quality_thresholds,
    evaluate_transcript_quality,
)
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptSegmentRef,
    TranscriptStats,
    TranscriptTrack,
    TranscriptTurn,
    TranscriptWord,
)


def _document(*, fallback: bool = False, wrong_text: bool = False) -> TranscriptDocument:
    first_words = () if fallback else (
        TranscriptWord(text="Olá", start=0.0, end=0.7),
        TranscriptWord(text="mundo", start=0.8, end=1.8),
    )
    second_words = () if fallback else (
        TranscriptWord(text="sim", start=1.1, end=1.5),
        TranscriptWord(text="claro", start=1.6, end=2.8),
    )
    first = TranscriptSegment(
        id="a-1",
        start=0.0,
        end=2.0,
        text="Olá planeta" if wrong_text else "Olá mundo",
        words=first_words,
    )
    second = TranscriptSegment(
        id="b-1",
        start=1.0,
        end=3.0,
        text="sim claro",
        words=second_words,
    )
    tracks = (
        TranscriptTrack(
            number=1,
            speaker="Alice",
            source_filename="1.flac",
            source_sha256=None,
            duration_seconds=3.0,
            segments=(first,),
        ),
        TranscriptTrack(
            number=2,
            speaker="Bob",
            source_filename="2.flac",
            source_sha256=None,
            duration_seconds=3.0,
            segments=(second,),
        ),
    )
    turns = (
        TranscriptTurn(
            id="turn-1",
            speaker="Alice",
            start=0.0,
            end=2.0,
            text=first.text,
            segments=(TranscriptSegmentRef(track_number=1, segment_id="a-1"),),
            overlaps_other_speaker=True,
        ),
        TranscriptTurn(
            id="turn-2",
            speaker="Bob",
            start=1.0,
            end=3.0,
            text=second.text,
            segments=(TranscriptSegmentRef(track_number=2, segment_id="b-1"),),
            overlaps_other_speaker=True,
        ),
    )
    return TranscriptDocument(
        recording_id="quality-fixture",
        source_sha256="a" * 64,
        language="pt",
        engine=TranscriptEngine(
            engine="qwen",
            model="fixture",
            profile="quality",
            device="cuda",
            alignment="forced-aligner+window-fallback" if fallback else "forced-aligner",
        ),
        tracks=tracks,
        stats=TranscriptStats(
            audio_work_seconds=6.0,
            session_duration_seconds=3.0,
            processing_seconds=1.0,
            word_count=sum(len(segment.words) for track in tracks for segment in track.segments),
            segment_count=2,
            track_count=2,
            turn_count=2,
        ),
        turns=turns,
        warnings=("QWEN_ALIGNMENT_FALLBACK:track-1",) if fallback else (),
    )


def _reference() -> tuple[ReferenceTurn, ...]:
    return (
        ReferenceTurn(
            speaker="Alice",
            start=0.0,
            end=2.0,
            text="Olá mundo",
            overlaps_other_speaker=True,
        ),
        ReferenceTurn(
            speaker="Bob",
            start=1.0,
            end=3.0,
            text="sim claro",
            overlaps_other_speaker=True,
        ),
    )


def _valid_thresholds(**overrides: object) -> QualityThresholds:
    values: dict[str, object] = {
        "max_word_error_rate": 0.30,
        "min_turn_coverage": 0.90,
        "min_speaker_accuracy": 0.90,
        "max_boundary_p95_seconds": 1.0,
        "min_overlap_f1": 0.80,
        "allow_alignment_fallback": False,
    }
    values.update(overrides)
    return QualityThresholds(**values)  # type: ignore[arg-type]


def test_quality_metrics_capture_text_timing_speaker_and_overlap() -> None:
    metrics = evaluate_transcript_quality(_reference(), _document())

    assert metrics.word_error_rate == 0.0
    assert metrics.turn_coverage == 1.0
    assert metrics.speaker_accuracy == 1.0
    assert metrics.boundary_p95_seconds == 0.0
    assert metrics.overlap_f1 == 1.0
    assert metrics.timing_precision == "word_aligned"
    assert metrics.alignment_fallback_present is False


def test_word_error_rate_records_real_text_error() -> None:
    metrics = evaluate_transcript_quality(_reference(), _document(wrong_text=True))

    assert metrics.substitutions == 1
    assert metrics.deletions == 0
    assert metrics.insertions == 0
    assert metrics.word_error_rate == 0.25


def test_alignment_fallback_is_explicit_and_can_block_a_quality_gate() -> None:
    metrics = evaluate_transcript_quality(_reference(), _document(fallback=True))
    result = apply_quality_thresholds(metrics, _valid_thresholds())

    assert metrics.timing_precision == "window_fallback"
    assert metrics.alignment_fallback_present is True
    assert result.passed is False
    assert "ALIGNMENT_FALLBACK" in result.failures


@pytest.mark.parametrize(
    ("field", "value", "error"),
    (
        ("max_word_error_rate", math.nan, "max_word_error_rate:NUMBER_INVALID"),
        ("min_turn_coverage", math.inf, "min_turn_coverage:NUMBER_INVALID"),
        ("min_speaker_accuracy", -0.01, "min_speaker_accuracy:RANGE_INVALID"),
        ("min_turn_coverage", 1.01, "min_turn_coverage:RANGE_INVALID"),
        ("max_word_error_rate", -0.01, "max_word_error_rate:RANGE_INVALID"),
        ("max_boundary_p95_seconds", -0.01, "max_boundary_p95_seconds:RANGE_INVALID"),
        ("min_overlap_f1", 1.01, "min_overlap_f1:RANGE_INVALID"),
    ),
)
def test_quality_thresholds_reject_non_finite_and_out_of_range_values(
    field: str,
    value: float,
    error: str,
) -> None:
    with pytest.raises(AsrQualityError, match=error):
        _valid_thresholds(**{field: value})


def test_quality_thresholds_require_boolean_alignment_fallback_policy() -> None:
    with pytest.raises(AsrQualityError, match="allow_alignment_fallback:BOOLEAN_REQUIRED"):
        _valid_thresholds(allow_alignment_fallback=1)


@pytest.mark.parametrize(
    ("value", "error"),
    (
        (math.nan, "minimum_turn_iou:NUMBER_INVALID"),
        (math.inf, "minimum_turn_iou:NUMBER_INVALID"),
        (0.0, "minimum_turn_iou:RANGE_INVALID"),
        (1.01, "minimum_turn_iou:RANGE_INVALID"),
    ),
)
def test_minimum_turn_iou_rejects_non_finite_and_out_of_range_values(
    value: float,
    error: str,
) -> None:
    with pytest.raises(AsrQualityError, match=error):
        evaluate_transcript_quality(_reference(), _document(), minimum_turn_iou=value)
