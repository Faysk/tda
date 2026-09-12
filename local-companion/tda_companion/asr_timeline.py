from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Iterable, Mapping

from .transcript import (
    TranscriptSegment,
    TranscriptSegmentRef,
    TranscriptTrack,
    TranscriptTurn,
)

_SEGMENT_KEY = tuple[int, str]
_NON_WORD = re.compile(r"[^\w\s]+", re.UNICODE)
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class TimelineSegment:
    track_number: int
    speaker: str
    segment_id: str
    start: float
    end: float
    text: str
    confidence: float | None
    source: TranscriptSegment

    @property
    def duration(self) -> float:
        return max(self.end - self.start, 0.0)

    @property
    def key(self) -> _SEGMENT_KEY:
        return (self.track_number, self.segment_id)


@dataclass(frozen=True)
class DedupDecision:
    kept: _SEGMENT_KEY
    suppressed: _SEGMENT_KEY
    temporal_overlap_ratio: float
    text_similarity: float
    token_similarity: float
    dominance_source: str
    dominance_margin: float


@dataclass(frozen=True)
class TimelineResult:
    segments: tuple[TimelineSegment, ...]
    turns: tuple[TranscriptTurn, ...]
    dedup_decisions: tuple[DedupDecision, ...]


def _finite_number(value: float | int | None) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def _segment_confidence(segment: TranscriptSegment) -> float | None:
    direct = _finite_number(segment.confidence)
    if direct is not None:
        return direct
    values = [
        confidence
        for word in segment.words
        if (confidence := _finite_number(word.confidence)) is not None
    ]
    if not values:
        return None
    return sum(values) / len(values)


def flatten_tracks(tracks: Iterable[TranscriptTrack]) -> tuple[TimelineSegment, ...]:
    values: list[TimelineSegment] = []
    for track in tracks:
        offset = float(track.timeline_offset_seconds)
        for segment in track.segments:
            start = round(float(segment.start) + offset, 3)
            end = round(float(segment.end) + offset, 3)
            values.append(
                TimelineSegment(
                    track_number=track.number,
                    speaker=track.speaker,
                    segment_id=segment.id,
                    start=start,
                    end=end,
                    text=segment.text,
                    confidence=_segment_confidence(segment),
                    source=segment,
                )
            )
    values.sort(key=lambda item: (item.start, item.end, item.track_number, item.segment_id))
    return tuple(values)


def _normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", value).casefold()
    text = _NON_WORD.sub(" ", text)
    return _SPACE.sub(" ", text).strip()


def _token_set(value: str) -> set[str]:
    return {token for token in _normalize_text(value).split(" ") if token}


def _text_similarity(left: str, right: str) -> tuple[float, float]:
    left_normalized = _normalize_text(left)
    right_normalized = _normalize_text(right)
    if not left_normalized or not right_normalized:
        return 0.0, 0.0
    sequence = SequenceMatcher(None, left_normalized, right_normalized, autojunk=False).ratio()
    left_tokens = _token_set(left_normalized)
    right_tokens = _token_set(right_normalized)
    union = left_tokens | right_tokens
    token = len(left_tokens & right_tokens) / len(union) if union else 0.0
    return sequence, token


def _temporal_overlap_ratio(left: TimelineSegment, right: TimelineSegment) -> float:
    overlap = max(0.0, min(left.end, right.end) - max(left.start, right.start))
    denominator = min(left.duration, right.duration)
    if denominator <= 0.0:
        return 0.0
    return overlap / denominator


def _dominance(
    left: TimelineSegment,
    right: TimelineSegment,
    energy_by_segment: Mapping[_SEGMENT_KEY, float] | None,
    *,
    confidence_margin: float,
    energy_margin_db: float,
) -> tuple[TimelineSegment, TimelineSegment, str, float] | None:
    if energy_by_segment:
        left_energy = _finite_number(energy_by_segment.get(left.key))
        right_energy = _finite_number(energy_by_segment.get(right.key))
        if left_energy is not None and right_energy is not None:
            difference = left_energy - right_energy
            if abs(difference) >= energy_margin_db:
                if difference > 0:
                    return left, right, "energy_db", abs(difference)
                return right, left, "energy_db", abs(difference)

    left_confidence = left.confidence
    right_confidence = right.confidence
    if left_confidence is not None and right_confidence is not None:
        difference = left_confidence - right_confidence
        if abs(difference) >= confidence_margin:
            if difference > 0:
                return left, right, "confidence", abs(difference)
            return right, left, "confidence", abs(difference)
    return None


def deduplicate_cross_track_segments(
    segments: Iterable[TimelineSegment],
    *,
    energy_by_segment: Mapping[_SEGMENT_KEY, float] | None = None,
    temporal_overlap_threshold: float = 0.75,
    text_similarity_threshold: float = 0.90,
    token_similarity_threshold: float = 0.80,
    confidence_margin: float = 0.12,
    energy_margin_db: float = 5.0,
) -> tuple[tuple[TimelineSegment, ...], tuple[DedupDecision, ...]]:
    ordered = tuple(sorted(segments, key=lambda item: (item.start, item.end, item.track_number, item.segment_id)))
    suppressed: set[_SEGMENT_KEY] = set()
    decisions: list[DedupDecision] = []

    for index, left in enumerate(ordered):
        if left.key in suppressed:
            continue
        for right in ordered[index + 1 :]:
            if right.start >= left.end:
                break
            if right.key in suppressed or left.track_number == right.track_number:
                continue
            overlap_ratio = _temporal_overlap_ratio(left, right)
            if overlap_ratio < temporal_overlap_threshold:
                continue
            sequence_similarity, token_similarity = _text_similarity(left.text, right.text)
            if (
                sequence_similarity < text_similarity_threshold
                or token_similarity < token_similarity_threshold
            ):
                continue
            dominance = _dominance(
                left,
                right,
                energy_by_segment,
                confidence_margin=confidence_margin,
                energy_margin_db=energy_margin_db,
            )
            if dominance is None:
                continue
            kept, weaker, source, margin = dominance
            if kept.key in suppressed:
                continue
            suppressed.add(weaker.key)
            decisions.append(
                DedupDecision(
                    kept=kept.key,
                    suppressed=weaker.key,
                    temporal_overlap_ratio=round(overlap_ratio, 6),
                    text_similarity=round(sequence_similarity, 6),
                    token_similarity=round(token_similarity, 6),
                    dominance_source=source,
                    dominance_margin=round(margin, 6),
                )
            )
            if weaker.key == left.key:
                break

    kept_segments = tuple(item for item in ordered if item.key not in suppressed)
    return kept_segments, tuple(decisions)


def _overlaps_different_speaker(segment: TimelineSegment, all_segments: tuple[TimelineSegment, ...]) -> bool:
    for other in all_segments:
        if other.key == segment.key or other.speaker == segment.speaker:
            continue
        if min(segment.end, other.end) - max(segment.start, other.start) > 0.0:
            return True
    return False


def build_turns(
    segments: Iterable[TimelineSegment],
    *,
    max_same_speaker_gap_seconds: float = 1.25,
) -> tuple[TranscriptTurn, ...]:
    ordered = tuple(sorted(segments, key=lambda item: (item.start, item.end, item.track_number, item.segment_id)))
    if not ordered:
        return ()

    turns: list[TranscriptTurn] = []
    current: list[TimelineSegment] = []

    def flush() -> None:
        if not current:
            return
        index = len(turns) + 1
        text = " ".join(item.text.strip() for item in current if item.text.strip()).strip()
        turns.append(
            TranscriptTurn(
                id=f"turn-{index:06d}",
                speaker=current[0].speaker,
                start=round(min(item.start for item in current), 3),
                end=round(max(item.end for item in current), 3),
                text=text,
                segments=tuple(
                    TranscriptSegmentRef(track_number=item.track_number, segment_id=item.segment_id)
                    for item in current
                ),
                overlaps_other_speaker=any(
                    _overlaps_different_speaker(item, ordered) for item in current
                ),
            )
        )
        current.clear()

    for segment in ordered:
        if not current:
            current.append(segment)
            continue
        previous = current[-1]
        gap = segment.start - previous.end
        same_speaker = segment.speaker == previous.speaker
        contiguous_in_global_order = same_speaker and gap <= max_same_speaker_gap_seconds
        if contiguous_in_global_order:
            current.append(segment)
        else:
            flush()
            current.append(segment)
    flush()
    return tuple(turns)


def build_timeline(
    tracks: Iterable[TranscriptTrack],
    *,
    energy_by_segment: Mapping[_SEGMENT_KEY, float] | None = None,
) -> TimelineResult:
    flattened = flatten_tracks(tracks)
    deduplicated, decisions = deduplicate_cross_track_segments(
        flattened,
        energy_by_segment=energy_by_segment,
    )
    return TimelineResult(
        segments=deduplicated,
        turns=build_turns(deduplicated),
        dedup_decisions=decisions,
    )
