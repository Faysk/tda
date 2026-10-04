"""Versioned human references and objective ASR quality metrics for local Benchmark evidence."""
from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

from .atomic_storage import atomic_write
from .benchmark_evidence import (
    BenchmarkEvidenceError,
    PROFILES,
    benchmark_root,
    bundle_manifest_sha256,
    load_bundle,
    utc_now,
    verified_profile_bytes,
)
from .transcript import TranscriptDocument, TranscriptTurn

REFERENCE_SCHEMA = "tda_benchmark_reference_v1"
REFERENCE_POINTER_SCHEMA = "tda_benchmark_reference_pointer_v1"
QUALITY_SCHEMA = "tda_benchmark_quality_receipt_v1"
NORMALIZATION_SCHEMA = "tda_asr_text_normalization_v1"
METRIC_IMPLEMENTATION = "tda_asr_quality_metrics_v1"
_MAX_REFERENCE_BYTES = 8 * 1024 * 1024
_MAX_TRACKS = 256
_MAX_TERMS = 256
_MAX_TEXT_CHARS = 2_000_000
_PROFILE_PROVENANCE = re.compile(r"^(?:manual|imported|profile_seed)$")


class BenchmarkQualityError(RuntimeError):
    pass


def _is_reparse(path: Path) -> bool:
    try:
        attrs = getattr(path.stat(follow_symlinks=False), "st_file_attributes", 0)
    except (OSError, TypeError):
        return False
    return bool(attrs & 0x400)


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def normalize_text(text: str) -> str:
    if not isinstance(text, str):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_TEXT_INVALID")
    if len(text) > _MAX_TEXT_CHARS or "\0" in text:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_TEXT_INVALID")
    value = unicodedata.normalize("NFC", text).casefold().replace("’", "'")
    chars: list[str] = []
    for char in value:
        category = unicodedata.category(char)
        if category.startswith("P") and char not in {"'", "-"}:
            chars.append(" ")
        elif char.isspace():
            chars.append(" ")
        else:
            chars.append(char)
    return " ".join("".join(chars).split())


def normalization_contract() -> dict[str, Any]:
    return {
        "schema_version": NORMALIZATION_SCHEMA,
        "unicode": "NFC",
        "case": "unicode_casefold",
        "whitespace": "collapse",
        "punctuation": "replace_except_ascii_apostrophe_hyphen",
        "diacritics": "preserved",
        "cer_whitespace": "excluded",
        "locale_dependent": False,
    }


def _edit_counts(reference: Sequence[str], hypothesis: Sequence[str]) -> dict[str, int]:
    """Exact Levenshtein S/D/I counts with bounded memory and deterministic ties."""
    if len(reference) * len(hypothesis) > 30_000_000:
        raise BenchmarkQualityError("BENCHMARK_QUALITY_COMPLEXITY_LIMIT")
    # state = (distance, substitutions, deletions, insertions, equals)
    previous: list[tuple[int, int, int, int, int]] = [
        (index, 0, 0, index, 0) for index in range(len(hypothesis) + 1)
    ]
    for ref_index, ref_value in enumerate(reference, start=1):
        current: list[tuple[int, int, int, int, int]] = [
            (ref_index, 0, ref_index, 0, 0)
        ]
        for hyp_index, hyp_value in enumerate(hypothesis, start=1):
            candidates: list[tuple[tuple[int, int, int, int, int], int]] = []
            diagonal = previous[hyp_index - 1]
            if ref_value == hyp_value:
                candidates.append((
                    (
                        diagonal[0],
                        diagonal[1],
                        diagonal[2],
                        diagonal[3],
                        diagonal[4] + 1,
                    ),
                    0,
                ))
            else:
                candidates.append((
                    (
                        diagonal[0] + 1,
                        diagonal[1] + 1,
                        diagonal[2],
                        diagonal[3],
                        diagonal[4],
                    ),
                    1,
                ))
            deleted = previous[hyp_index]
            candidates.append((
                (
                    deleted[0] + 1,
                    deleted[1],
                    deleted[2] + 1,
                    deleted[3],
                    deleted[4],
                ),
                2,
            ))
            inserted = current[hyp_index - 1]
            candidates.append((
                (
                    inserted[0] + 1,
                    inserted[1],
                    inserted[2],
                    inserted[3] + 1,
                    inserted[4],
                ),
                3,
            ))
            current.append(min(candidates, key=lambda item: (item[0][0], item[1]))[0])
        previous = current
    final = previous[-1]
    return {
        "substitutions": final[1],
        "deletions": final[2],
        "insertions": final[3],
        "equals": final[4],
    }


def _text_metrics(reference: str, hypothesis: str) -> dict[str, Any]:
    ref_normalized = normalize_text(reference)
    hyp_normalized = normalize_text(hypothesis)
    ref_words = ref_normalized.split() if ref_normalized else []
    hyp_words = hyp_normalized.split() if hyp_normalized else []
    word_counts = _edit_counts(ref_words, hyp_words)
    ref_chars = [char for char in ref_normalized if not char.isspace()]
    hyp_chars = [char for char in hyp_normalized if not char.isspace()]
    char_counts = _edit_counts(ref_chars, hyp_chars)
    word_edits = word_counts["substitutions"] + word_counts["deletions"] + word_counts["insertions"]
    char_edits = char_counts["substitutions"] + char_counts["deletions"] + char_counts["insertions"]
    return {
        **word_counts,
        "reference_words": len(ref_words),
        "hypothesis_words": len(hyp_words),
        "wer_normalized": round(word_edits / len(ref_words), 8) if ref_words else None,
        "reference_characters": len(ref_chars),
        "hypothesis_characters": len(hyp_chars),
        "character_edits": char_edits,
        "cer_normalized": round(char_edits / len(ref_chars), 8) if ref_chars else None,
    }


def _hypothesis_tracks(document: TranscriptDocument) -> dict[int, str]:
    return {
        track.number: " ".join(segment.text for segment in track.segments).strip()
        for track in document.tracks
    }


def _safe_reference_tracks(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_TRACKS:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACKS_INVALID")
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    for raw in value:
        if not isinstance(raw, dict):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACK_INVALID")
        number = raw.get("track_number")
        text = raw.get("text")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1 or number > 4096 or number in seen:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACK_INVALID")
        if not isinstance(text, str) or len(text) > _MAX_TEXT_CHARS or "\0" in text:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TEXT_INVALID")
        speaker = raw.get("speaker")
        if speaker is not None and (not isinstance(speaker, str) or len(speaker) > 160 or "\0" in speaker):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_SPEAKER_INVALID")
        row: dict[str, Any] = {"track_number": number, "speaker": speaker, "text": text}
        turns = raw.get("turns")
        if turns is not None:
            if not isinstance(turns, list) or len(turns) > 50_000:
                raise BenchmarkQualityError("BENCHMARK_REFERENCE_TURNS_INVALID")
            safe_turns: list[dict[str, Any]] = []
            for turn in turns:
                if not isinstance(turn, dict):
                    raise BenchmarkQualityError("BENCHMARK_REFERENCE_TURN_INVALID")
                start, end = turn.get("start"), turn.get("end")
                turn_text, turn_speaker = turn.get("text"), turn.get("speaker")
                if (
                    isinstance(start, bool) or not isinstance(start, (int, float)) or not math.isfinite(float(start)) or float(start) < 0
                    or isinstance(end, bool) or not isinstance(end, (int, float)) or not math.isfinite(float(end)) or float(end) < float(start)
                    or not isinstance(turn_text, str) or len(turn_text) > 200_000 or "\0" in turn_text
                    or not isinstance(turn_speaker, str) or not turn_speaker.strip() or len(turn_speaker) > 160
                ):
                    raise BenchmarkQualityError("BENCHMARK_REFERENCE_TURN_INVALID")
                safe_turns.append({
                    "start": round(float(start), 6),
                    "end": round(float(end), 6),
                    "speaker": turn_speaker.strip(),
                    "text": turn_text,
                    "overlaps_other_speaker": bool(turn.get("overlaps_other_speaker", False)),
                })
            row["turns"] = safe_turns
        rows.append(row)
        seen.add(number)
    return sorted(rows, key=lambda item: item["track_number"])


def _safe_terms(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > _MAX_TERMS:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_TERMS_INVALID")
    terms: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item) > 160 or "\0" in item:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TERMS_INVALID")
        normalized = normalize_text(item)
        if normalized and normalized not in terms:
            terms.append(normalized)
    return terms


def _assert_regular_owned_file(root: Path, path: Path) -> None:
    root_abs = root.absolute()
    path_abs = path.absolute()
    try:
        path_abs.relative_to(root_abs)
    except ValueError as exc:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_ESCAPE") from exc
    current = root_abs
    for part in path_abs.relative_to(root_abs).parts:
        current = current / part
        if current.exists() and (current.is_symlink() or _is_reparse(current)):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_REPARSE_REJECTED")
    if path.exists() and not path.is_file():
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_INVALID")


def _read_json(
    path: Path,
    maximum: int = _MAX_REFERENCE_BYTES,
    *,
    root: Path | None = None,
) -> dict[str, Any]:
    if root is not None:
        _assert_regular_owned_file(root, path)
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_UNAVAILABLE") from exc
    if not payload or len(payload) > maximum:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SIZE_INVALID")
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INVALID") from exc
    if not isinstance(value, dict):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INVALID")
    return value


def _current_reference(root: Path) -> dict[str, Any] | None:
    pointer = root / "reference" / "current.json"
    if not pointer.is_file():
        return None
    value = _read_json(pointer, root=root)
    if value.get("schema_version") != REFERENCE_POINTER_SCHEMA:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_POINTER_INVALID")
    revision = value.get("revision")
    digest = value.get("reference_sha256")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1 or not isinstance(digest, str):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_POINTER_INVALID")
    path = root / "reference" / f"reference-{revision:06d}.json"
    _assert_regular_owned_file(root, path)
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_UNAVAILABLE") from exc
    if not payload or len(payload) > _MAX_REFERENCE_BYTES:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SIZE_INVALID")
    if _digest(payload) != digest:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INTEGRITY_FAILED")
    reference = json.loads(payload)
    if not isinstance(reference, dict) or reference.get("revision") != revision:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INVALID")
    return reference


def save_reference(
    data_root: Path,
    benchmark_id: str,
    request: Mapping[str, Any],
) -> dict[str, Any]:
    manifest = load_bundle(data_root, benchmark_id)
    root = benchmark_root(data_root, benchmark_id)
    expected_revision = request.get("expected_revision")
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_EXPECTED_REVISION_INVALID")
    current = _current_reference(root)
    current_revision = int(current["revision"]) if current is not None else 0
    if expected_revision != current_revision:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_REVISION_CONFLICT")
    provenance = request.get("provenance", "manual")
    if not isinstance(provenance, str) or _PROFILE_PROVENANCE.fullmatch(provenance) is None:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PROVENANCE_INVALID")
    seed_profile = request.get("seed_profile_id")
    if seed_profile is not None and seed_profile not in PROFILES:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PROFILE_INVALID")
    tracks = _safe_reference_tracks(request.get("tracks"))
    sample = manifest.get("sample")
    if not isinstance(sample, dict):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_IDENTITY_MISMATCH")
    sample_start = sample.get("start_seconds")
    sample_end = sample.get("end_seconds")
    sample_tracks_raw = sample.get("tracks")
    if (
        isinstance(sample_start, bool)
        or not isinstance(sample_start, (int, float))
        or isinstance(sample_end, bool)
        or not isinstance(sample_end, (int, float))
        or not isinstance(sample_tracks_raw, list)
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_IDENTITY_MISMATCH")
    sample_track_numbers = {
        item.get("number")
        for item in sample_tracks_raw
        if isinstance(item, dict) and isinstance(item.get("number"), int)
    }
    for track in tracks:
        if track["track_number"] not in sample_track_numbers:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACK_SAMPLE_MISMATCH")
        for turn in track.get("turns", []):
            if float(turn["start"]) < float(sample_start) or float(turn["end"]) > float(sample_end):
                raise BenchmarkQualityError("BENCHMARK_REFERENCE_TURN_OUT_OF_SAMPLE")
    terms = _safe_terms(request.get("terms"))
    capability = "timed_turns" if all(isinstance(track.get("turns"), list) for track in tracks) else "text"
    payload = {"tracks": tracks, "terms": terms}
    payload_bytes = _canonical(payload)
    revision = current_revision + 1
    reference = {
        "schema_version": REFERENCE_SCHEMA,
        "benchmark_id": benchmark_id,
        "source_sha256": manifest["source_sha256"],
        "sample_identity_sha256": manifest["sample_identity_sha256"],
        "sample": manifest["sample"],
        "track_numbers": [track["track_number"] for track in tracks],
        "revision": revision,
        "parent_revision": current_revision or None,
        "provenance": provenance,
        "seed_profile_id": seed_profile,
        "capability": capability,
        "normalization": normalization_contract(),
        "payload_sha256": _digest(payload_bytes),
        "payload": payload,
        "created_at": utc_now(),
    }
    encoded = _canonical(reference)
    if len(encoded) > _MAX_REFERENCE_BYTES:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SIZE_INVALID")
    reference_dir = root / "reference"
    if reference_dir.exists() and (reference_dir.is_symlink() or _is_reparse(reference_dir)):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_REPARSE_REJECTED")
    reference_dir.mkdir(parents=True, exist_ok=True)
    path = reference_dir / f"reference-{revision:06d}.json"
    if path.exists():
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_REVISION_EXISTS")
    atomic_write(path, encoded)
    pointer = {
        "schema_version": REFERENCE_POINTER_SCHEMA,
        "benchmark_id": benchmark_id,
        "revision": revision,
        "reference_sha256": _digest(encoded),
        "updated_at": utc_now(),
    }
    atomic_write(reference_dir / "current.json", _canonical(pointer))
    receipts = compute_quality_receipts(data_root, benchmark_id, reference=reference)
    return {
        "schema_version": REFERENCE_POINTER_SCHEMA,
        "benchmark_id": benchmark_id,
        "revision": revision,
        "reference_sha256": pointer["reference_sha256"],
        "capability": capability,
        "quality": receipts,
    }


def reference_summary(data_root: Path, benchmark_id: str) -> dict[str, Any] | None:
    load_bundle(data_root, benchmark_id)
    reference = _current_reference(benchmark_root(data_root, benchmark_id))
    if reference is None:
        return None
    return {
        "schema_version": REFERENCE_SCHEMA,
        "benchmark_id": benchmark_id,
        "revision": reference["revision"],
        "parent_revision": reference["parent_revision"],
        "provenance": reference["provenance"],
        "seed_profile_id": reference["seed_profile_id"],
        "capability": reference["capability"],
        "payload_sha256": reference["payload_sha256"],
        "normalization": reference["normalization"],
        "track_numbers": reference["track_numbers"],
        "created_at": reference["created_at"],
    }


def reference_private(data_root: Path, benchmark_id: str) -> dict[str, Any] | None:
    load_bundle(data_root, benchmark_id)
    return _current_reference(benchmark_root(data_root, benchmark_id))


def _count_phrase(tokens: list[str], phrase: list[str]) -> int:
    if not phrase or len(phrase) > len(tokens):
        return 0
    return sum(1 for index in range(len(tokens) - len(phrase) + 1) if tokens[index:index + len(phrase)] == phrase)


def _term_fidelity(reference_text: str, hypothesis_text: str, terms: Sequence[str]) -> dict[str, Any] | None:
    if not terms:
        return None
    ref_tokens = normalize_text(reference_text).split()
    hyp_tokens = normalize_text(hypothesis_text).split()
    reference_occurrences = 0
    hypothesis_occurrences = 0
    correct = 0
    for term in terms:
        phrase = term.split()
        ref_count = _count_phrase(ref_tokens, phrase)
        if ref_count == 0:
            continue
        hyp_count = _count_phrase(hyp_tokens, phrase)
        reference_occurrences += ref_count
        hypothesis_occurrences += hyp_count
        correct += min(ref_count, hyp_count)
    if reference_occurrences == 0:
        return {
            "reference_occurrences": 0,
            "hypothesis_occurrences": 0,
            "correct_occurrences": 0,
            "missed_occurrences": 0,
            "extra_occurrences": 0,
            "recall": None,
            "precision": None,
        }
    return {
        "reference_occurrences": reference_occurrences,
        "hypothesis_occurrences": hypothesis_occurrences,
        "correct_occurrences": correct,
        "missed_occurrences": max(0, reference_occurrences - correct),
        "extra_occurrences": max(0, hypothesis_occurrences - correct),
        "recall": round(correct / reference_occurrences, 8),
        "precision": round(correct / hypothesis_occurrences, 8) if hypothesis_occurrences else 0.0,
    }


def _turn_track(document: TranscriptDocument, turn: TranscriptTurn) -> int | None:
    numbers = {ref.track_number for ref in turn.segments}
    return next(iter(numbers)) if len(numbers) == 1 else None


def _hypothesis_timing_provenance(document: TranscriptDocument) -> dict[str, Any]:
    segments = [segment for track in document.tracks for segment in track.segments]
    word_aligned = bool(segments) and all(
        bool(segment.words)
        and normalize_text(" ".join(word.text for word in segment.words)) == normalize_text(segment.text)
        for segment in segments
    )
    return {
        "timestamp_granularity": "word_aligned" if word_aligned else "segment_aligned",
        "alignment_backend": document.engine.alignment,
        "warning_count": len(document.warnings),
    }


def _timing_metrics(reference_tracks: Sequence[Mapping[str, Any]], document: TranscriptDocument) -> dict[str, Any] | None:
    if not all(isinstance(track.get("turns"), list) for track in reference_tracks):
        return None
    hypotheses: dict[int, list[dict[str, Any]]] = {}
    for turn in document.turns:
        number = _turn_track(document, turn)
        if number is None:
            continue
        hypotheses.setdefault(number, []).append({
            "start": turn.start,
            "end": turn.end,
            "speaker": turn.speaker,
            "overlaps_other_speaker": turn.overlaps_other_speaker,
        })
    matched = 0
    unmatched = 0
    speaker_correct = 0
    start_errors: list[float] = []
    end_errors: list[float] = []
    overlap_tp = overlap_fp = overlap_fn = 0
    reference_turn_count = sum(len(track.get("turns", [])) for track in reference_tracks)
    hypothesis_turn_count = sum(len(values) for values in hypotheses.values())
    used_hypotheses = 0
    for track in reference_tracks:
        number = int(track["track_number"])
        available = list(enumerate(hypotheses.get(number, [])))
        used: set[int] = set()
        for ref in track.get("turns", []):
            candidates: list[tuple[float, float, int, dict[str, Any]]] = []
            for index, hyp in available:
                if index in used:
                    continue
                intersection = max(0.0, min(float(ref["end"]), hyp["end"]) - max(float(ref["start"]), hyp["start"]))
                union = max(float(ref["end"]), hyp["end"]) - min(float(ref["start"]), hyp["start"])
                iou = intersection / union if union > 0 else 0.0
                if iou >= 0.1:
                    boundary_error = abs(float(ref["start"]) - hyp["start"]) + abs(float(ref["end"]) - hyp["end"])
                    candidates.append((iou, -boundary_error, index, hyp))
            if not candidates:
                unmatched += 1
                if ref.get("overlaps_other_speaker"):
                    overlap_fn += 1
                continue
            _, _, index, hyp = max(candidates, key=lambda item: (item[0], item[1], -item[2]))
            used.add(index)
            used_hypotheses += 1
            matched += 1
            speaker_correct += int(str(ref["speaker"]) == str(hyp["speaker"]))
            start_errors.append(abs(float(ref["start"]) - float(hyp["start"])))
            end_errors.append(abs(float(ref["end"]) - float(hyp["end"])))
            ref_overlap = bool(ref.get("overlaps_other_speaker"))
            hyp_overlap = bool(hyp.get("overlaps_other_speaker"))
            if ref_overlap and hyp_overlap:
                overlap_tp += 1
            elif hyp_overlap:
                overlap_fp += 1
            elif ref_overlap:
                overlap_fn += 1
        overlap_fp += sum(
            1
            for index, hyp in available
            if index not in used and bool(hyp.get("overlaps_other_speaker"))
        )
    boundary = start_errors + end_errors

    def percentile(values: list[float], fraction: float) -> float | None:
        if not values:
            return None
        ordered = sorted(values)
        index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))
        return round(ordered[index], 6)

    precision = overlap_tp / (overlap_tp + overlap_fp) if overlap_tp + overlap_fp else None
    recall = overlap_tp / (overlap_tp + overlap_fn) if overlap_tp + overlap_fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision is not None and recall is not None and precision + recall else None
    return {
        "matched_turns": matched,
        "unmatched_reference_turns": unmatched,
        "unmatched_hypothesis_turns": max(0, hypothesis_turn_count - used_hypotheses),
        "turn_coverage": round(matched / reference_turn_count, 8) if reference_turn_count else None,
        "speaker_accuracy": round(speaker_correct / matched, 8) if matched else None,
        "start_mae_seconds": round(sum(start_errors) / len(start_errors), 6) if start_errors else None,
        "end_mae_seconds": round(sum(end_errors) / len(end_errors), 6) if end_errors else None,
        "boundary_p50_seconds": percentile(boundary, 0.5),
        "boundary_p95_seconds": percentile(boundary, 0.95),
        "overlap_precision": round(precision, 8) if precision is not None else None,
        "overlap_recall": round(recall, 8) if recall is not None else None,
        "overlap_f1": round(f1, 8) if f1 is not None else None,
        "hypothesis_timing": _hypothesis_timing_provenance(document),
    }

def compute_quality_receipts(
    data_root: Path,
    benchmark_id: str,
    *,
    reference: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    manifest = load_bundle(data_root, benchmark_id)
    manifest_sha256 = bundle_manifest_sha256(data_root, benchmark_id)
    normalization = normalization_contract()
    normalization_sha256 = _digest(_canonical(normalization))
    root = benchmark_root(data_root, benchmark_id)
    ref = dict(reference) if reference is not None else _current_reference(root)
    if ref is None:
        return []
    if (
        ref.get("schema_version") != REFERENCE_SCHEMA
        or ref.get("benchmark_id") != benchmark_id
        or ref.get("source_sha256") != manifest.get("source_sha256")
        or ref.get("sample_identity_sha256") != manifest.get("sample_identity_sha256")
        or ref.get("normalization", {}).get("schema_version") != NORMALIZATION_SCHEMA
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_IDENTITY_MISMATCH")
    payload = ref.get("payload")
    if not isinstance(payload, dict) or _digest(_canonical(payload)) != ref.get("payload_sha256"):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INTEGRITY_FAILED")
    reference_tracks = _safe_reference_tracks(payload.get("tracks"))
    terms = _safe_terms(payload.get("terms"))
    reference_by_track = {int(item["track_number"]): item["text"] for item in reference_tracks}
    reference_text = " ".join(reference_by_track[number] for number in sorted(reference_by_track))
    reference_sha = _digest(_canonical(ref))
    quality_root = root / "quality"
    if quality_root.exists() and (quality_root.is_symlink() or _is_reparse(quality_root)):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_REPARSE_REJECTED")
    quality_dir = quality_root / f"reference-{int(ref['revision']):06d}"
    if quality_dir.exists() and (quality_dir.is_symlink() or _is_reparse(quality_dir)):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_REPARSE_REJECTED")
    quality_dir.mkdir(parents=True, exist_ok=True)
    receipts: list[dict[str, Any]] = []
    for profile_id in PROFILES:
        raw = verified_profile_bytes(data_root, benchmark_id, profile_id, "transcript")
        transcript_sha = _digest(raw)
        document = TranscriptDocument.from_dict(json.loads(raw))
        hypothesis = _hypothesis_tracks(document)
        track_numbers = sorted(set(reference_by_track) | set(hypothesis))
        per_track: list[dict[str, Any]] = []
        totals = Counter()
        ref_words_total = hyp_words_total = 0
        ref_chars_total = hyp_chars_total = char_edits_total = 0
        for number in track_numbers:
            metrics = _text_metrics(reference_by_track.get(number, ""), hypothesis.get(number, ""))
            per_track.append({"track_number": number, **metrics})
            for key in ("substitutions", "deletions", "insertions", "equals"):
                totals[key] += metrics[key]
            ref_words_total += metrics["reference_words"]
            hyp_words_total += metrics["hypothesis_words"]
            ref_chars_total += metrics["reference_characters"]
            hyp_chars_total += metrics["hypothesis_characters"]
            char_edits_total += metrics["character_edits"]
        edits = totals["substitutions"] + totals["deletions"] + totals["insertions"]
        hypothesis_text = " ".join(hypothesis[number] for number in sorted(hypothesis))
        receipt = {
            "schema_version": QUALITY_SCHEMA,
            "metric_implementation": METRIC_IMPLEMENTATION,
            "benchmark_id": benchmark_id,
            "benchmark_manifest_sha256": manifest_sha256,
            "profile_id": profile_id,
            "sample_identity_sha256": manifest["sample_identity_sha256"],
            "transcript_sha256": transcript_sha,
            "reference_revision": ref["revision"],
            "reference_sha256": reference_sha,
            "reference_payload_sha256": ref["payload_sha256"],
            "reference_capability": ref["capability"],
            "normalization": normalization,
            "normalization_sha256": normalization_sha256,
            "overall": {
                "aggregation": "micro",
                "reference_words": ref_words_total,
                "hypothesis_words": hyp_words_total,
                "substitutions": totals["substitutions"],
                "deletions": totals["deletions"],
                "insertions": totals["insertions"],
                "wer_normalized": round(edits / ref_words_total, 8) if ref_words_total else None,
                "reference_characters": ref_chars_total,
                "hypothesis_characters": hyp_chars_total,
                "character_edits": char_edits_total,
                "cer_normalized": round(char_edits_total / ref_chars_total, 8) if ref_chars_total else None,
            },
            "per_track": per_track,
            "term_fidelity": _term_fidelity(reference_text, hypothesis_text, terms),
            "timing": _timing_metrics(reference_tracks, document) if ref["capability"] == "timed_turns" else None,
        }
        encoded = _canonical(receipt)
        atomic_write(quality_dir / f"{profile_id}.json", encoded)
        receipts.append(receipt)
    return receipts


def quality_summary(data_root: Path, benchmark_id: str) -> dict[str, Any]:
    reference = reference_summary(data_root, benchmark_id)
    if reference is None:
        return {
            "schema_version": "tda_benchmark_quality_summary_v1",
            "benchmark_id": benchmark_id,
            "reference": None,
            "quality_measured": False,
            "profiles": [],
        }
    receipts = compute_quality_receipts(data_root, benchmark_id)
    return {
        "schema_version": "tda_benchmark_quality_summary_v1",
        "benchmark_id": benchmark_id,
        "reference": reference,
        "quality_measured": True,
        "profiles": receipts,
    }
