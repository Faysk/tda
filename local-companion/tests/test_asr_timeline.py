from __future__ import annotations

from tda_companion.asr_timeline import build_timeline, deduplicate_cross_track_segments, flatten_tracks
from tda_companion.transcript import TranscriptSegment, TranscriptTrack, TranscriptWord


def _segment(
    segment_id: str,
    start: float,
    end: float,
    text: str,
    *,
    confidence: float | None = None,
) -> TranscriptSegment:
    words = ()
    if confidence is not None:
        words = (
            TranscriptWord(
                text=text.split()[0],
                start=start,
                end=min(end, start + 0.2),
                confidence=confidence,
            ),
        )
    return TranscriptSegment(
        id=segment_id,
        start=start,
        end=end,
        text=text,
        words=words,
        confidence=None,
    )


def _track(number: int, speaker: str, *segments: TranscriptSegment, offset: float = 0.0) -> TranscriptTrack:
    return TranscriptTrack(
        number=number,
        speaker=speaker,
        source_filename=f"{number}-{speaker}.flac",
        source_sha256=(str(number) * 64)[:64],
        duration_seconds=20.0,
        segments=tuple(segments),
        timeline_offset_seconds=offset,
        identity=None,
    )


def test_flatten_tracks_applies_common_timeline_offset():
    track = _track(1, "Alice", _segment("1-a", 1.0, 2.0, "Olá"), offset=3.5)
    result = flatten_tracks((track,))
    assert result[0].start == 4.5
    assert result[0].end == 5.5


def test_dedup_suppresses_bleed_only_with_strong_confidence_dominance():
    alice = _track(
        1,
        "Alice",
        _segment("1-a", 10.0, 12.0, "A porta está trancada", confidence=0.96),
    )
    bob = _track(
        2,
        "Bob",
        _segment("2-a", 10.1, 12.1, "a porta está trancada!", confidence=0.70),
    )
    flattened = flatten_tracks((alice, bob))
    kept, decisions = deduplicate_cross_track_segments(flattened)

    assert [item.key for item in kept] == [(1, "1-a")]
    assert len(decisions) == 1
    assert decisions[0].kept == (1, "1-a")
    assert decisions[0].suppressed == (2, "2-a")
    assert decisions[0].dominance_source == "confidence"


def test_dedup_uses_energy_when_confidence_is_unavailable():
    alice = _track(1, "Alice", _segment("1-a", 5.0, 6.5, "Vamos para Neverwinter"))
    bob = _track(2, "Bob", _segment("2-a", 5.05, 6.45, "vamos para neverwinter"))
    flattened = flatten_tracks((alice, bob))
    kept, decisions = deduplicate_cross_track_segments(
        flattened,
        energy_by_segment={(1, "1-a"): -15.0, (2, "2-a"): -28.0},
    )

    assert [item.key for item in kept] == [(1, "1-a")]
    assert decisions[0].dominance_source == "energy_db"
    assert decisions[0].dominance_margin == 13.0


def test_dedup_preserves_ambiguous_duplicate_without_dominance_evidence():
    alice = _track(
        1,
        "Alice",
        _segment("1-a", 1.0, 2.0, "Eu abro a porta", confidence=0.88),
    )
    bob = _track(
        2,
        "Bob",
        _segment("2-a", 1.02, 2.02, "eu abro a porta", confidence=0.84),
    )
    flattened = flatten_tracks((alice, bob))
    kept, decisions = deduplicate_cross_track_segments(flattened)

    assert len(kept) == 2
    assert decisions == ()


def test_dedup_never_removes_distinct_simultaneous_speech():
    alice = _track(
        1,
        "Alice",
        _segment("1-a", 3.0, 4.0, "Eu ataco o goblin", confidence=0.98),
    )
    bob = _track(
        2,
        "Bob",
        _segment("2-a", 3.0, 4.0, "Cuidado com a armadilha", confidence=0.60),
    )
    result = build_timeline((alice, bob))

    assert len(result.segments) == 2
    assert result.dedup_decisions == ()
    assert all(turn.overlaps_other_speaker for turn in result.turns)


def test_turn_builder_groups_only_consecutive_same_speaker_segments():
    alice = _track(
        1,
        "Alice",
        _segment("1-a", 0.0, 0.8, "Eu entro."),
        _segment("1-b", 1.0, 1.7, "E olho em volta."),
        _segment("1-c", 5.0, 5.7, "Voltei."),
    )
    bob = _track(
        2,
        "Bob",
        _segment("2-a", 2.0, 2.8, "Eu espero aqui."),
    )
    result = build_timeline((alice, bob))

    assert len(result.turns) == 3
    first, second, third = result.turns
    assert first.speaker == "Alice"
    assert first.segment_ids == ("1-a", "1-b")
    assert first.text == "Eu entro. E olho em volta."
    assert second.speaker == "Bob"
    assert third.speaker == "Alice"
    assert third.segment_ids == ("1-c",)


def test_real_overlap_breaks_turn_order_even_for_same_speaker_afterward():
    alice = _track(
        1,
        "Alice",
        _segment("1-a", 0.0, 1.0, "Primeira fala"),
        _segment("1-b", 1.2, 2.0, "Continuação"),
    )
    bob = _track(
        2,
        "Bob",
        _segment("2-a", 0.9, 1.3, "Interrompendo"),
    )
    result = build_timeline((alice, bob))

    assert [turn.speaker for turn in result.turns] == ["Alice", "Bob", "Alice"]
    assert result.turns[0].overlaps_other_speaker is True
    assert result.turns[1].overlaps_other_speaker is True
    assert result.turns[2].overlaps_other_speaker is True
