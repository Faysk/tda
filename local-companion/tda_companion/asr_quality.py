from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Mapping

from .transcript import TranscriptDocument, TranscriptTurn

_NON_WORD = re.compile(r"[^\w\s]+", re.UNICODE)
_SPACE = re.compile(r"\s+")


class AsrQualityError(ValueError):
    pass


@dataclass(frozen=True)
class ReferenceTurn:
    speaker: str
    start: float
    end: float
    text: str
    overlaps_other_speaker: bool = False


@dataclass(frozen=True)
class QualityMetrics:
    reference_word_count: int
    hypothesis_word_count: int
    substitutions: int
    deletions: int
    insertions: int
    word_error_rate: float
    matched_turn_count: int
    reference_turn_count: int
    hypothesis_turn_count: int
    turn_coverage: float
    speaker_accuracy: float | None
    start_mae_seconds: float | None
    end_mae_seconds: float | None
    boundary_p95_seconds: float | None
    overlap_precision: float | None
    overlap_recall: float | None
    overlap_f1: float | None
    timing_precision: str
    alignment_fallback_present: bool


@dataclass(frozen=True)
class QualityThresholds:
    max_word_error_rate: float
    min_turn_coverage: float
    min_speaker_accuracy: float
    max_boundary_p95_seconds: float
    min_overlap_f1: float
    allow_alignment_fallback: bool = False

    def __post_init__(self) -> None:
        max_word_error_rate = _finite(self.max_word_error_rate, "max_word_error_rate")
        min_turn_coverage = _finite(self.min_turn_coverage, "min_turn_coverage")
        min_speaker_accuracy = _finite(self.min_speaker_accuracy, "min_speaker_accuracy")
        max_boundary_p95_seconds = _finite(
            self.max_boundary_p95_seconds,
            "max_boundary_p95_seconds",
        )
        min_overlap_f1 = _finite(self.min_overlap_f1, "min_overlap_f1")

        if max_word_error_rate < 0.0:
            raise AsrQualityError("max_word_error_rate:RANGE_INVALID")
        if not 0.0 <= min_turn_coverage <= 1.0:
            raise AsrQualityError("min_turn_coverage:RANGE_INVALID")
        if not 0.0 <= min_speaker_accuracy <= 1.0:
            raise AsrQualityError("min_speaker_accuracy:RANGE_INVALID")
        if max_boundary_p95_seconds < 0.0:
            raise AsrQualityError("max_boundary_p95_seconds:RANGE_INVALID")
        if not 0.0 <= min_overlap_f1 <= 1.0:
            raise AsrQualityError("min_overlap_f1:RANGE_INVALID")
        if not isinstance(self.allow_alignment_fallback, bool):
            raise AsrQualityError("allow_alignment_fallback:BOOLEAN_REQUIRED")


@dataclass(frozen=True)
class QualityGateResult:
    passed: bool
    failures: tuple[str, ...]


def _finite(value: float | int, name: str) -> float:
    if isinstance(value, bool):
        raise AsrQualityError(f"{name}:NUMBER_REQUIRED")
    result = float(value)
    if not math.isfinite(result):
        raise AsrQualityError(f"{name}:NUMBER_INVALID")
    return result


def _normalize_tokens(value: str) -> list[str]:
    text = unicodedata.normalize("NFKC", str(value)).casefold()
    text = _NON_WORD.sub(" ", text)
    return [token for token in _SPACE.sub(" ", text).strip().split(" ") if token]


def _edit_counts(reference: list[str], hypothesis: list[str]) -> tuple[int, int, int]:
    # Each cell stores (cost, substitutions, deletions, insertions). Ties are
    # deterministic so receipts from the same inputs remain reproducible.
    previous = [(index, 0, 0, index) for index in range(len(hypothesis) + 1)]
    for ref_index, ref_token in enumerate(reference, start=1):
        current = [(ref_index, 0, ref_index, 0)]
        for hyp_index, hyp_token in enumerate(hypothesis, start=1):
            if ref_token == hyp_token:
                current.append(previous[hyp_index - 1])
                continue
            substitution = previous[hyp_index - 1]
            deletion = previous[hyp_index]
            insertion = current[hyp_index - 1]
            candidates = (
                (substitution[0] + 1, substitution[1] + 1, substitution[2], substitution[3]),
                (deletion[0] + 1, deletion[1], deletion[2] + 1, deletion[3]),
                (insertion[0] + 1, insertion[1], insertion[2], insertion[3] + 1),
            )
            current.append(
                min(
                    candidates,
                    key=lambda item: (
                        item[0],
                        item[1] + item[2] + item[3],
                        item[1],
                        item[2],
                        item[3],
                    ),
                )
            )
        previous = current
    _, substitutions, deletions, insertions = previous[-1]
    return substitutions, deletions, insertions


def _interval_iou(left_start: float, left_end: float, right_start: float, right_end: float) -> float:
    intersection = max(0.0, min(left_end, right_end) - max(left_start, right_start))
    union = max(left_end, right_end) - min(left_start, right_start)
    if union <= 0.0:
        return 0.0
    return intersection / union


def _match_turns(
    reference: tuple[ReferenceTurn, ...],
    hypothesis: tuple[TranscriptTurn, ...],
    *,
    minimum_iou: float,
) -> tuple[tuple[int, int], ...]:
    candidates: list[tuple[float, float, int, int]] = []
    for ref_index, ref in enumerate(reference):
        for hyp_index, hyp in enumerate(hypothesis):
            iou = _interval_iou(ref.start, ref.end, hyp.start, hyp.end)
            if iou < minimum_iou:
                continue
            center_distance = abs(((ref.start + ref.end) / 2.0) - ((hyp.start + hyp.end) / 2.0))
            candidates.append((iou, -center_distance, ref_index, hyp_index))
    candidates.sort(reverse=True)

    used_reference: set[int] = set()
    used_hypothesis: set[int] = set()
    matches: list[tuple[int, int]] = []
    for _iou, _distance, ref_index, hyp_index in candidates:
        if ref_index in used_reference or hyp_index in used_hypothesis:
            continue
        used_reference.add(ref_index)
        used_hypothesis.add(hyp_index)
        matches.append((ref_index, hyp_index))
    matches.sort()
    return tuple(matches)


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return ordered[index]


def _safe_ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def _f1(precision: float | None, recall: float | None) -> float | None:
    if precision is None or recall is None:
        return None
    if precision + recall == 0.0:
        return 0.0
    return 2.0 * precision * recall / (precision + recall)


def _timing_precision(document: TranscriptDocument) -> tuple[str, bool]:
    fallback = any(str(value).startswith("QWEN_ALIGNMENT_FALLBACK") for value in document.warnings)
    if fallback or "window-fallback" in document.engine.alignment:
        return "window_fallback", True
    segments = [segment for track in document.tracks for segment in track.segments]
    if segments and all(segment.words for segment in segments):
        return "word_aligned", False
    return "segment_aligned", False


def reference_turns_from_dict(values: Iterable[Mapping[str, object]]) -> tuple[ReferenceTurn, ...]:
    turns: list[ReferenceTurn] = []
    for index, value in enumerate(values):
        speaker = str(value.get("speaker") or "").strip()
        text = str(value.get("text") or "").strip()
        if not speaker:
            raise AsrQualityError(f"reference[{index}].speaker:TEXT_EMPTY")
        if not text:
            raise AsrQualityError(f"reference[{index}].text:TEXT_EMPTY")
        start = _finite(value.get("start"), f"reference[{index}].start")  # type: ignore[arg-type]
        end = _finite(value.get("end"), f"reference[{index}].end")  # type: ignore[arg-type]
        if start < 0.0 or end < start:
            raise AsrQualityError(f"reference[{index}]:TIME_INVALID")
        overlap = value.get("overlaps_other_speaker", False)
        if not isinstance(overlap, bool):
            raise AsrQualityError(f"reference[{index}].overlaps_other_speaker:BOOLEAN_REQUIRED")
        turns.append(
            ReferenceTurn(
                speaker=speaker,
                start=round(start, 3),
                end=round(end, 3),
                text=text,
                overlaps_other_speaker=overlap,
            )
        )
    turns.sort(key=lambda item: (item.start, item.end, item.speaker))
    if not turns:
        raise AsrQualityError("reference:EMPTY")
    return tuple(turns)


def evaluate_transcript_quality(
    reference: Iterable[ReferenceTurn],
    document: TranscriptDocument,
    *,
    minimum_turn_iou: float = 0.15,
) -> QualityMetrics:
    reference_turns = tuple(reference)
    if not reference_turns:
        raise AsrQualityError("reference:EMPTY")
    minimum_turn_iou = _finite(minimum_turn_iou, "minimum_turn_iou")
    if minimum_turn_iou <= 0.0 or minimum_turn_iou > 1.0:
        raise AsrQualityError("minimum_turn_iou:RANGE_INVALID")

    reference_tokens = _normalize_tokens(" ".join(turn.text for turn in reference_turns))
    hypothesis_tokens = _normalize_tokens(" ".join(turn.text for turn in document.turns))
    if not reference_tokens:
        raise AsrQualityError("reference:WORDS_EMPTY")
    substitutions, deletions, insertions = _edit_counts(reference_tokens, hypothesis_tokens)
    wer = (substitutions + deletions + insertions) / len(reference_tokens)

    matches = _match_turns(reference_turns, document.turns, minimum_iou=minimum_turn_iou)
    start_errors: list[float] = []
    end_errors: list[float] = []
    speaker_matches = 0
    predicted_overlap_positive = 0
    reference_overlap_positive = 0
    true_overlap_positive = 0

    for ref_index, hyp_index in matches:
        ref = reference_turns[ref_index]
        hyp = document.turns[hyp_index]
        start_errors.append(abs(ref.start - hyp.start))
        end_errors.append(abs(ref.end - hyp.end))
        if ref.speaker.casefold() == hyp.speaker.casefold():
            speaker_matches += 1
        if hyp.overlaps_other_speaker:
            predicted_overlap_positive += 1
        if ref.overlaps_other_speaker:
            reference_overlap_positive += 1
        if ref.overlaps_other_speaker and hyp.overlaps_other_speaker:
            true_overlap_positive += 1

    # Unmatched reference/hypothesis turns still matter for overlap recall/precision.
    matched_reference = {ref for ref, _hyp in matches}
    matched_hypothesis = {hyp for _ref, hyp in matches}
    reference_overlap_positive += sum(
        1
        for index, turn in enumerate(reference_turns)
        if index not in matched_reference and turn.overlaps_other_speaker
    )
    predicted_overlap_positive += sum(
        1
        for index, turn in enumerate(document.turns)
        if index not in matched_hypothesis and turn.overlaps_other_speaker
    )

    overlap_precision = _safe_ratio(true_overlap_positive, predicted_overlap_positive)
    overlap_recall = _safe_ratio(true_overlap_positive, reference_overlap_positive)
    timing_precision, fallback = _timing_precision(document)
    boundary_errors = start_errors + end_errors

    return QualityMetrics(
        reference_word_count=len(reference_tokens),
        hypothesis_word_count=len(hypothesis_tokens),
        substitutions=substitutions,
        deletions=deletions,
        insertions=insertions,
        word_error_rate=round(wer, 6),
        matched_turn_count=len(matches),
        reference_turn_count=len(reference_turns),
        hypothesis_turn_count=len(document.turns),
        turn_coverage=round(len(matches) / len(reference_turns), 6),
        speaker_accuracy=None if not matches else round(speaker_matches / len(matches), 6),
        start_mae_seconds=None if not start_errors else round(sum(start_errors) / len(start_errors), 6),
        end_mae_seconds=None if not end_errors else round(sum(end_errors) / len(end_errors), 6),
        boundary_p95_seconds=None if not boundary_errors else round(_p95(boundary_errors) or 0.0, 6),
        overlap_precision=None if overlap_precision is None else round(overlap_precision, 6),
        overlap_recall=None if overlap_recall is None else round(overlap_recall, 6),
        overlap_f1=None if (value := _f1(overlap_precision, overlap_recall)) is None else round(value, 6),
        timing_precision=timing_precision,
        alignment_fallback_present=fallback,
    )


def apply_quality_thresholds(metrics: QualityMetrics, thresholds: QualityThresholds) -> QualityGateResult:
    failures: list[str] = []
    if metrics.word_error_rate > thresholds.max_word_error_rate:
        failures.append("WORD_ERROR_RATE")
    if metrics.turn_coverage < thresholds.min_turn_coverage:
        failures.append("TURN_COVERAGE")
    if metrics.speaker_accuracy is None or metrics.speaker_accuracy < thresholds.min_speaker_accuracy:
        failures.append("SPEAKER_ACCURACY")
    if metrics.boundary_p95_seconds is None or metrics.boundary_p95_seconds > thresholds.max_boundary_p95_seconds:
        failures.append("TIMING_BOUNDARY_P95")
    if metrics.overlap_f1 is None or metrics.overlap_f1 < thresholds.min_overlap_f1:
        failures.append("OVERLAP_F1")
    if metrics.alignment_fallback_present and not thresholds.allow_alignment_fallback:
        failures.append("ALIGNMENT_FALLBACK")
    return QualityGateResult(passed=not failures, failures=tuple(failures))
