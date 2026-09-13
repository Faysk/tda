from __future__ import annotations

import json

import pytest

from tda_companion.asr_quality import QualityMetrics, QualityThresholds
from tda_companion.asr_quality_receipt import (
    AsrQualityReceiptError,
    build_quality_receipt,
    serialize_quality_receipt,
    write_quality_receipt_atomic,
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


def _document() -> TranscriptDocument:
    segment = TranscriptSegment(
        id="segment-1",
        start=0.0,
        end=1.5,
        text="fala privada que nunca deve ir ao receipt",
        words=(
            TranscriptWord(text="fala", start=0.0, end=0.4),
            TranscriptWord(text="privada", start=0.5, end=1.0),
        ),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Jogador",
        source_filename="track.flac",
        source_sha256="b" * 64,
        duration_seconds=1.5,
        segments=(segment,),
    )
    turn = TranscriptTurn(
        id="turn-1",
        speaker="Jogador",
        start=0.0,
        end=1.5,
        text=segment.text,
        segments=(TranscriptSegmentRef(track_number=1, segment_id="segment-1"),),
    )
    return TranscriptDocument(
        recording_id="fixture-recording",
        source_sha256="a" * 64,
        language="pt",
        engine=TranscriptEngine(
            engine="qwen",
            model="fixture-model",
            model_revision="rev-1",
            profile="quality",
            device="cuda",
            compute_type="bf16",
            alignment="forced-aligner",
        ),
        tracks=(track,),
        stats=TranscriptStats(
            audio_work_seconds=1.5,
            session_duration_seconds=1.5,
            processing_seconds=0.5,
            word_count=2,
            segment_count=1,
            track_count=1,
            turn_count=1,
        ),
        turns=(turn,),
    )


def _metrics() -> QualityMetrics:
    return QualityMetrics(
        reference_word_count=2,
        hypothesis_word_count=2,
        substitutions=0,
        deletions=0,
        insertions=0,
        word_error_rate=0.0,
        matched_turn_count=1,
        reference_turn_count=1,
        hypothesis_turn_count=1,
        turn_coverage=1.0,
        speaker_accuracy=1.0,
        start_mae_seconds=0.0,
        end_mae_seconds=0.0,
        boundary_p95_seconds=0.0,
        overlap_precision=1.0,
        overlap_recall=1.0,
        overlap_f1=1.0,
        timing_precision="word_aligned",
        alignment_fallback_present=False,
    )


def test_receipt_is_deterministic_and_contains_no_transcript_text_or_paths() -> None:
    receipt = build_quality_receipt(
        _document(),
        _metrics(),
        reference_sha256="c" * 64,
        hypothesis_sha256="d" * 64,
        runtime={"python": "3.12.14", "empty": ""},
    )

    first = serialize_quality_receipt(receipt)
    second = serialize_quality_receipt(receipt)

    assert first == second
    text = first.decode("utf-8")
    assert "fala privada" not in text
    assert "track.flac" not in text
    assert receipt["gate"] is None
    parsed = json.loads(text)
    assert parsed["source"]["source_sha256"] == "a" * 64
    assert parsed["runtime"] == {"python": "3.12.14"}


def test_receipt_only_claims_pass_when_explicit_thresholds_are_supplied() -> None:
    receipt = build_quality_receipt(
        _document(),
        _metrics(),
        reference_sha256="c" * 64,
        hypothesis_sha256="d" * 64,
        thresholds=QualityThresholds(
            max_word_error_rate=0.10,
            min_turn_coverage=0.90,
            min_speaker_accuracy=0.90,
            max_boundary_p95_seconds=0.50,
            min_overlap_f1=0.80,
        ),
    )

    gate = receipt["gate"]
    assert isinstance(gate, dict)
    assert gate["passed"] is True
    assert gate["failures"] == []


def test_receipt_rejects_unbound_input_hashes() -> None:
    with pytest.raises(AsrQualityReceiptError, match="reference_sha256:SHA256_INVALID"):
        build_quality_receipt(
            _document(),
            _metrics(),
            reference_sha256="not-a-hash",
            hypothesis_sha256="d" * 64,
        )


def test_atomic_writer_persists_the_same_canonical_payload(tmp_path) -> None:
    receipt = build_quality_receipt(
        _document(),
        _metrics(),
        reference_sha256="c" * 64,
        hypothesis_sha256="d" * 64,
    )
    target = tmp_path / "receipt.json"

    write_quality_receipt_atomic(target, receipt)

    assert target.read_bytes() == serialize_quality_receipt(receipt)
    assert not target.with_suffix(".json.partial").exists()
