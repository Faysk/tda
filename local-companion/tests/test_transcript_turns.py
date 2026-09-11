from __future__ import annotations

from dataclasses import replace

import pytest

from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptSegmentRef,
    TranscriptStats,
    TranscriptTrack,
    TranscriptTurn,
    TranscriptValidationError,
)


def _track() -> TranscriptTrack:
    return TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1-Alice.flac",
        source_sha256="b" * 64,
        duration_seconds=10.0,
        segments=(
            TranscriptSegment(id="1-a", start=1.0, end=2.0, text="Olá mesa"),
            TranscriptSegment(id="1-b", start=2.2, end=3.0, text="Vamos seguir"),
        ),
        timeline_offset_seconds=4.0,
        identity=None,
    )


def _document(*, turn: TranscriptTurn | None = None) -> TranscriptDocument:
    track = _track()
    canonical_turn = turn or TranscriptTurn(
        id="turn-000001",
        speaker="Alice",
        start=5.0,
        end=7.0,
        text="Olá mesa Vamos seguir",
        segments=(
            TranscriptSegmentRef(track_number=1, segment_id="1-a"),
            TranscriptSegmentRef(track_number=1, segment_id="1-b"),
        ),
        overlaps_other_speaker=False,
    )
    return TranscriptDocument(
        recording_id="fixture",
        source_sha256="a" * 64,
        language="pt",
        engine=TranscriptEngine(
            engine="whisper",
            model="fixture-model",
            profile="whisper-turbo",
            device="cuda",
            compute_type="float16",
            alignment="native",
            model_revision="revision",
        ),
        tracks=(track,),
        stats=TranscriptStats(
            audio_work_seconds=10.0,
            session_duration_seconds=10.0,
            processing_seconds=1.0,
            word_count=0,
            segment_count=2,
            track_count=1,
            rtf=0.1,
            turn_count=1,
            deduplicated_segment_count=0,
        ),
        turns=(canonical_turn,),
    )


def test_canonical_turn_references_raw_segments_without_rewriting_track_timestamps():
    document = _document()
    value = document.as_dict()

    assert value["tracks"][0]["segments"][0]["start"] == 1.0
    assert value["tracks"][0]["timeline_offset_seconds"] == 4.0
    assert value["turns"][0]["start"] == 5.0
    assert value["turns"][0]["end"] == 7.0
    assert value["turns"][0]["segments"] == [
        {"track_number": 1, "segment_id": "1-a"},
        {"track_number": 1, "segment_id": "1-b"},
    ]


def test_canonical_turn_rejects_missing_segment_reference():
    turn = TranscriptTurn(
        id="turn-000001",
        speaker="Alice",
        start=5.0,
        end=6.0,
        text="Fantasma",
        segments=(TranscriptSegmentRef(track_number=1, segment_id="missing"),),
    )
    with pytest.raises(TranscriptValidationError, match="REFERENCE_MISSING"):
        _document(turn=turn).validate()


def test_canonical_turn_rejects_speaker_mismatch():
    turn = TranscriptTurn(
        id="turn-000001",
        speaker="Bob",
        start=5.0,
        end=6.0,
        text="Olá mesa",
        segments=(TranscriptSegmentRef(track_number=1, segment_id="1-a"),),
    )
    with pytest.raises(TranscriptValidationError, match="SPEAKER_MISMATCH"):
        _document(turn=turn).validate()


def test_canonical_turn_rejects_timestamp_rewrite():
    turn = TranscriptTurn(
        id="turn-000001",
        speaker="Alice",
        start=0.0,
        end=6.0,
        text="Olá mesa",
        segments=(TranscriptSegmentRef(track_number=1, segment_id="1-a"),),
    )
    with pytest.raises(TranscriptValidationError, match="START_MISMATCH"):
        _document(turn=turn).validate()


def test_canonical_stats_reject_impossible_dedup_count():
    document = _document()
    bad_stats = replace(document.stats, deduplicated_segment_count=3)
    with pytest.raises(TranscriptValidationError, match="RANGE_INVALID"):
        replace(document, stats=bad_stats).validate()
