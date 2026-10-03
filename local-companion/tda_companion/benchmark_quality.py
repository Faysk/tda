from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from .atomic_storage import atomic_write
from .benchmark_evidence import (
    CANONICAL_PROFILES,
    BenchmarkEvidenceError,
    bundle_root,
    load_bundle,
    load_profile_transcript,
    utc_now,
)

REFERENCE_SCHEMA = "tda_benchmark_reference_v1"
QUALITY_SCHEMA = "tda_benchmark_quality_receipt_v1"
NORMALIZATION_VERSION = "tda_asr_text_normalization_v1"
METRIC_IMPLEMENTATION = "tda_asr_quality_metrics_v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_APOSTROPHES = {"’", "‘", "ʼ", "＇"}
_HYPHENS = {"‐", "‑", "‒", "–", "—", "﹘", "﹣", "－"}


class BenchmarkQualityError(ValueError):
    pass


@dataclass(frozen=True)
class EditCounts:
    substitutions: int
    deletions: int
    insertions: int


def _canonical(value: Mapping[str, Any] | Sequence[Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _hash(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def normalize_text(value: str) -> str:
    if not isinstance(value, str):
        raise BenchmarkQualityError("QUALITY_TEXT_INVALID")
    text = unicodedata.normalize("NFC", value).casefold()
    out: list[str] = []
    for char in text:
        if char in _APOSTROPHES:
            out.append("'")
            continue
        if char in _HYPHENS:
            out.append("-")
            continue
        if char in {"'", "-"}:
            out.append(char)
            continue
        category = unicodedata.category(char)
        if category.startswith("P"):
            out.append(" ")
        elif char.isspace():
            out.append(" ")
        elif category.startswith("C"):
            continue
        else:
            out.append(char)
    return " ".join("".join(out).split())


def _tokens(value: str) -> list[str]:
    normalized = normalize_text(value)
    return normalized.split(" ") if normalized else []


def _characters(value: str) -> list[str]:
    return list(normalize_text(value).replace(" ", ""))


def edit_counts(reference: Sequence[str], hypothesis: Sequence[str]) -> EditCounts:
    previous: list[tuple[int, int, int, int]] = [
        (index, 0, 0, index) for index in range(len(hypothesis) + 1)
    ]
    for ref_index, ref_value in enumerate(reference, start=1):
        current: list[tuple[int, int, int, int]] = [(ref_index, 0, ref_index, 0)]
        for hyp_index, hyp_value in enumerate(hypothesis, start=1):
            if ref_value == hyp_value:
                current.append(previous[hyp_index - 1])
                continue
            sub = previous[hyp_index - 1]
            delete = previous[hyp_index]
            insert = current[hyp_index - 1]
            candidates = (
                (sub[0] + 1, sub[1] + 1, sub[2], sub[3]),
                (delete[0] + 1, delete[1], delete[2] + 1, delete[3]),
                (insert[0] + 1, insert[1], insert[2], insert[3] + 1),
            )
            current.append(min(candidates, key=lambda item: (item[0], item[1], item[2], item[3])))
        previous = current
    _cost, substitutions, deletions, insertions = previous[-1]
    return EditCounts(substitutions, deletions, insertions)


def score_text(reference: str, hypothesis: str) -> dict[str, Any]:
    ref_words = _tokens(reference)
    hyp_words = _tokens(hypothesis)
    word = edit_counts(ref_words, hyp_words)
    ref_chars = _characters(reference)
    hyp_chars = _characters(hypothesis)
    char = edit_counts(ref_chars, hyp_chars)
    return {
        "normalization_version": NORMALIZATION_VERSION,
        "reference_words": len(ref_words),
        "hypothesis_words": len(hyp_words),
        "substitutions": word.substitutions,
        "deletions": word.deletions,
        "insertions": word.insertions,
        "wer_normalized": None
        if not ref_words
        else round((word.substitutions + word.deletions + word.insertions) / len(ref_words), 8),
        "reference_characters": len(ref_chars),
        "hypothesis_characters": len(hyp_chars),
        "character_substitutions": char.substitutions,
        "character_deletions": char.deletions,
        "character_insertions": char.insertions,
        "cer_normalized": None
        if not ref_chars
        else round((char.substitutions + char.deletions + char.insertions) / len(ref_chars), 8),
    }


def _validate_tracks(tracks: Any) -> list[dict[str, Any]]:
    if not isinstance(tracks, list) or not tracks or len(tracks) > 256:
        raise BenchmarkQualityError("REFERENCE_TRACKS_INVALID")
    output: list[dict[str, Any]] = []
    seen: set[int] = set()
    for raw in tracks:
        if not isinstance(raw, dict):
            raise BenchmarkQualityError("REFERENCE_TRACK_INVALID")
        number = raw.get("track_number")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1 or number in seen:
            raise BenchmarkQualityError("REFERENCE_TRACK_NUMBER_INVALID")
        seen.add(number)
        speaker = raw.get("speaker")
        text = raw.get("text")
        if not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 160:
            raise BenchmarkQualityError("REFERENCE_SPEAKER_INVALID")
        if not isinstance(text, str) or len(text) > 2_000_000:
            raise BenchmarkQualityError("REFERENCE_TEXT_INVALID")
        item: dict[str, Any] = {
            "track_number": number,
            "speaker": speaker.strip(),
            "text": unicodedata.normalize("NFC", text),
        }
        turns = raw.get("turns")
        if turns is not None:
            if not isinstance(turns, list) or len(turns) > 200_000:
                raise BenchmarkQualityError("REFERENCE_TURNS_INVALID")
            validated_turns: list[dict[str, Any]] = []
            for turn in turns:
                if not isinstance(turn, dict):
                    raise BenchmarkQualityError("REFERENCE_TURN_INVALID")
                start = turn.get("start")
                end = turn.get("end")
                turn_text = turn.get("text")
                turn_speaker = turn.get("speaker", speaker)
                overlap = turn.get("overlaps_other_speaker", False)
                if (
                    isinstance(start, bool)
                    or not isinstance(start, (int, float))
                    or not math.isfinite(float(start))
                    or float(start) < 0
                    or isinstance(end, bool)
                    or not isinstance(end, (int, float))
                    or not math.isfinite(float(end))
                    or float(end) < float(start)
                    or not isinstance(turn_text, str)
                    or not turn_text.strip()
                    or not isinstance(turn_speaker, str)
                    or not turn_speaker.strip()
                    or not isinstance(overlap, bool)
                ):
                    raise BenchmarkQualityError("REFERENCE_TURN_INVALID")
                validated_turns.append(
                    {
                        "start": round(float(start), 3),
                        "end": round(float(end), 3),
                        "text": unicodedata.normalize("NFC", turn_text),
                        "speaker": turn_speaker.strip(),
                        "overlaps_other_speaker": overlap,
                    }
                )
            item["turns"] = validated_turns
        output.append(item)
    output.sort(key=lambda item: item["track_number"])
    return output


def create_reference_revision(
    package_root: Path,
    benchmark_id: str,
    *,
    sample_identity_sha256: str,
    tracks: list[dict[str, Any]],
    provenance: str = "manual",
    seed_profile_id: str | None = None,
    expected_revision: int | None = None,
    terms: Iterable[str] = (),
) -> dict[str, Any]:
    bundle = load_bundle(package_root, benchmark_id, verify_artifacts=True)
    if sample_identity_sha256 != bundle.get("sample_identity_sha256"):
        raise BenchmarkQualityError("REFERENCE_SAMPLE_MISMATCH")
    if provenance not in {"manual", "imported", "derived_from_profile"}:
        raise BenchmarkQualityError("REFERENCE_PROVENANCE_INVALID")
    if seed_profile_id is not None and seed_profile_id not in CANONICAL_PROFILES:
        raise BenchmarkQualityError("REFERENCE_SEED_PROFILE_INVALID")
    values = _validate_tracks(tracks)
    normalized_terms = sorted(
        {
            unicodedata.normalize("NFC", item).strip()
            for item in terms
            if isinstance(item, str) and item.strip() and len(item) <= 160
        }
    )
    root = bundle_root(package_root, benchmark_id)
    reference_root = root / "reference"
    reference_root.mkdir(parents=True, exist_ok=True)
    current_path = reference_root / "current.json"
    current: dict[str, Any] | None = None
    if current_path.exists():
        try:
            current = json.loads(current_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BenchmarkQualityError("REFERENCE_CURRENT_INVALID") from exc
        if not isinstance(current, dict):
            raise BenchmarkQualityError("REFERENCE_CURRENT_INVALID")
    current_revision = int(current["revision"]) if current else 0
    if expected_revision is not None and expected_revision != current_revision:
        raise BenchmarkQualityError("REFERENCE_REVISION_CONFLICT")
    revision = current_revision + 1
    capability = "timed_turns" if all("turns" in item for item in values) else "text"
    payload: dict[str, Any] = {
        "schema_version": REFERENCE_SCHEMA,
        "benchmark_id": benchmark_id,
        "source_sha256": bundle["source_sha256"],
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "sample": bundle["sample"],
        "revision": revision,
        "parent_revision": current_revision or None,
        "provenance": provenance,
        "seed_profile_id": seed_profile_id,
        "capability": capability,
        "normalization_version": NORMALIZATION_VERSION,
        "tracks": values,
        "terms": normalized_terms,
        "created_at": utc_now(),
    }
    digest = _hash(_canonical(payload))
    payload["payload_sha256"] = digest
    revision_path = reference_root / f"reference-r{revision}.json"
    if revision_path.exists():
        raise BenchmarkQualityError("REFERENCE_REVISION_EXISTS")
    atomic_write(revision_path, _canonical(payload))
    pointer = {
        "schema_version": "tda_benchmark_reference_pointer_v1",
        "benchmark_id": benchmark_id,
        "revision": revision,
        "reference_sha256": digest,
        "artifact": revision_path.name,
        "updated_at": utc_now(),
    }
    atomic_write(current_path, _canonical(pointer))
    return payload


def load_current_reference(package_root: Path, benchmark_id: str) -> dict[str, Any]:
    root = bundle_root(package_root, benchmark_id) / "reference"
    try:
        pointer = json.loads((root / "current.json").read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BenchmarkQualityError("REFERENCE_NOT_FOUND") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchmarkQualityError("REFERENCE_CURRENT_INVALID") from exc
    if not isinstance(pointer, dict) or pointer.get("benchmark_id") != benchmark_id:
        raise BenchmarkQualityError("REFERENCE_CURRENT_INVALID")
    artifact = pointer.get("artifact")
    if not isinstance(artifact, str) or not re.fullmatch(r"reference-r[1-9][0-9]*\.json", artifact):
        raise BenchmarkQualityError("REFERENCE_CURRENT_INVALID")
    try:
        raw = (root / artifact).read_bytes()
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkQualityError("REFERENCE_INVALID") from exc
    if not isinstance(value, dict):
        raise BenchmarkQualityError("REFERENCE_INVALID")
    expected = value.get("payload_sha256")
    unhashed = dict(value)
    unhashed.pop("payload_sha256", None)
    actual = _hash(_canonical(unhashed))
    if expected != pointer.get("reference_sha256") or expected != actual:
        raise BenchmarkQualityError("REFERENCE_HASH_MISMATCH")
    return value


def _track_hypothesis(document, track_number: int) -> str:
    track = next((item for item in document.tracks if item.number == track_number), None)
    if track is None:
        return ""
    return " ".join(segment.text.strip() for segment in track.segments if segment.text.strip())


def _percentile(values: Sequence[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return round(ordered[index], 6)


def _timed_metrics(reference_tracks: list[dict[str, Any]], document) -> dict[str, Any] | None:
    if not all("turns" in track for track in reference_tracks):
        return None
    hypothesis_by_track: dict[int, list[Any]] = {track.number: [] for track in document.tracks}
    segment_track: dict[tuple[int, str], int] = {}
    for track in document.tracks:
        for segment in track.segments:
            segment_track[(track.number, segment.id)] = track.number
    for turn in document.turns:
        candidates = {ref.track_number for ref in turn.segments}
        if len(candidates) == 1:
            hypothesis_by_track.setdefault(next(iter(candidates)), []).append(turn)

    matched = 0
    reference_count = 0
    hypothesis_count = sum(len(values) for values in hypothesis_by_track.values())
    speaker_matches = 0
    start_errors: list[float] = []
    end_errors: list[float] = []
    ref_overlap = pred_overlap = true_overlap = 0

    for track in reference_tracks:
        refs = track.get("turns", [])
        hyps = hypothesis_by_track.get(track["track_number"], [])
        reference_count += len(refs)
        used: set[int] = set()
        for ref in refs:
            ref_overlap += int(bool(ref.get("overlaps_other_speaker")))
            best_index: int | None = None
            best_iou = 0.0
            for index, hyp in enumerate(hyps):
                if index in used:
                    continue
                intersection = max(0.0, min(ref["end"], hyp.end) - max(ref["start"], hyp.start))
                union = max(ref["end"], hyp.end) - min(ref["start"], hyp.start)
                iou = 0.0 if union <= 0 else intersection / union
                if iou >= 0.15 and iou > best_iou:
                    best_iou = iou
                    best_index = index
            if best_index is None:
                continue
            used.add(best_index)
            hyp = hyps[best_index]
            matched += 1
            speaker_matches += int(ref["speaker"].casefold() == hyp.speaker.casefold())
            start_errors.append(abs(float(ref["start"]) - float(hyp.start)))
            end_errors.append(abs(float(ref["end"]) - float(hyp.end)))
            pred = bool(hyp.overlaps_other_speaker)
            truth = bool(ref.get("overlaps_other_speaker"))
            pred_overlap += int(pred)
            true_overlap += int(pred and truth)
        for index, hyp in enumerate(hyps):
            if index not in used:
                pred_overlap += int(bool(hyp.overlaps_other_speaker))

    precision = None if pred_overlap == 0 else true_overlap / pred_overlap
    recall = None if ref_overlap == 0 else true_overlap / ref_overlap
    overlap_f1 = (
        None
        if precision is None or recall is None
        else 0.0
        if precision + recall == 0
        else 2 * precision * recall / (precision + recall)
    )
    boundary = start_errors + end_errors
    return {
        "matched_turns": matched,
        "reference_turns": reference_count,
        "hypothesis_turns": hypothesis_count,
        "turn_coverage": None if reference_count == 0 else round(matched / reference_count, 8),
        "speaker_accuracy": None if matched == 0 else round(speaker_matches / matched, 8),
        "start_mae_seconds": None if not start_errors else round(sum(start_errors) / len(start_errors), 6),
        "end_mae_seconds": None if not end_errors else round(sum(end_errors) / len(end_errors), 6),
        "boundary_p50_seconds": _percentile(boundary, 0.5),
        "boundary_p95_seconds": _percentile(boundary, 0.95),
        "overlap_precision": None if precision is None else round(precision, 8),
        "overlap_recall": None if recall is None else round(recall, 8),
        "overlap_f1": None if overlap_f1 is None else round(overlap_f1, 8),
    }


def _term_fidelity(terms: Sequence[str], reference_text: str, hypothesis_text: str) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for term in terms:
        normalized = normalize_text(term)
        if not normalized:
            continue
        ref_count = normalize_text(reference_text).count(normalized)
        if ref_count == 0:
            continue
        hyp_count = normalize_text(hypothesis_text).count(normalized)
        correct = min(ref_count, hyp_count)
        rows.append(
            {
                "term_sha256": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
                "reference_occurrences": ref_count,
                "correct_occurrences": correct,
                "missed_occurrences": max(0, ref_count - hyp_count),
                "extra_occurrences": max(0, hyp_count - ref_count),
            }
        )
    ref_total = sum(row["reference_occurrences"] for row in rows)
    correct_total = sum(row["correct_occurrences"] for row in rows)
    hyp_total = sum(row["correct_occurrences"] + row["extra_occurrences"] for row in rows)
    return {
        "reference_occurrences": ref_total,
        "correct_occurrences": correct_total,
        "term_recall": None if ref_total == 0 else round(correct_total / ref_total, 8),
        "term_precision": None if hyp_total == 0 else round(correct_total / hyp_total, 8),
        "terms": rows,
    }


def score_profile(
    package_root: Path,
    benchmark_id: str,
    profile_id: str,
    reference: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if profile_id not in CANONICAL_PROFILES:
        raise BenchmarkQualityError("QUALITY_PROFILE_INVALID")
    bundle = load_bundle(package_root, benchmark_id, verify_artifacts=True)
    ref = dict(reference or load_current_reference(package_root, benchmark_id))
    if (
        ref.get("benchmark_id") != benchmark_id
        or ref.get("sample_identity_sha256") != bundle.get("sample_identity_sha256")
        or ref.get("source_sha256") != bundle.get("source_sha256")
        or ref.get("normalization_version") != NORMALIZATION_VERSION
    ):
        raise BenchmarkQualityError("QUALITY_REFERENCE_BINDING_MISMATCH")
    document = load_profile_transcript(package_root, benchmark_id, profile_id)
    reference_tracks = _validate_tracks(ref.get("tracks"))
    hypothesis_tracks = {track.number: track for track in document.tracks}
    reference_numbers = {track["track_number"] for track in reference_tracks}
    track_scores: list[dict[str, Any]] = []
    totals = {
        "reference_words": 0,
        "hypothesis_words": 0,
        "substitutions": 0,
        "deletions": 0,
        "insertions": 0,
        "reference_characters": 0,
        "hypothesis_characters": 0,
        "character_substitutions": 0,
        "character_deletions": 0,
        "character_insertions": 0,
    }
    all_reference_text: list[str] = []
    all_hypothesis_text: list[str] = []

    for track in reference_tracks:
        number = track["track_number"]
        hypothesis = _track_hypothesis(document, number)
        scored = score_text(track["text"], hypothesis)
        track_scores.append({"track_number": number, **scored})
        all_reference_text.append(track["text"])
        all_hypothesis_text.append(hypothesis)
        for key in totals:
            totals[key] += int(scored[key])

    for number, track in sorted(hypothesis_tracks.items()):
        if number in reference_numbers:
            continue
        hypothesis = " ".join(segment.text.strip() for segment in track.segments if segment.text.strip())
        scored = score_text("", hypothesis)
        track_scores.append({"track_number": number, "reference_track_missing": True, **scored})
        all_hypothesis_text.append(hypothesis)
        for key in totals:
            totals[key] += int(scored[key])

    micro = {
        **totals,
        "wer_normalized": None
        if totals["reference_words"] == 0
        else round(
            (totals["substitutions"] + totals["deletions"] + totals["insertions"])
            / totals["reference_words"],
            8,
        ),
        "cer_normalized": None
        if totals["reference_characters"] == 0
        else round(
            (
                totals["character_substitutions"]
                + totals["character_deletions"]
                + totals["character_insertions"]
            )
            / totals["reference_characters"],
            8,
        ),
    }
    transcript_raw = _canonical(document.as_dict())
    receipt = {
        "schema_version": QUALITY_SCHEMA,
        "metric_implementation": METRIC_IMPLEMENTATION,
        "normalization_version": NORMALIZATION_VERSION,
        "benchmark_id": benchmark_id,
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "profile_id": profile_id,
        "transcript_sha256": _hash(transcript_raw),
        "reference_revision": ref["revision"],
        "reference_sha256": ref["payload_sha256"],
        "reference_capability": ref["capability"],
        "metrics_available": [
            "wer_normalized",
            "cer_normalized",
            "term_fidelity",
            *(["timing", "speaker", "overlap"] if ref["capability"] == "timed_turns" else []),
        ],
        "per_track": sorted(track_scores, key=lambda item: item["track_number"]),
        "micro": micro,
        "term_fidelity": _term_fidelity(
            ref.get("terms", []),
            "\n".join(all_reference_text),
            "\n".join(all_hypothesis_text),
        ),
        "timed": _timed_metrics(reference_tracks, document),
        "winner": None,
        "computed_at": utc_now(),
    }
    root = bundle_root(package_root, benchmark_id) / "quality"
    root.mkdir(parents=True, exist_ok=True)
    atomic_write(root / f"{profile_id}-r{ref['revision']}.json", _canonical(receipt))
    return receipt


def score_all_profiles(package_root: Path, benchmark_id: str) -> dict[str, Any]:
    reference = load_current_reference(package_root, benchmark_id)
    return {
        profile_id: score_profile(package_root, benchmark_id, profile_id, reference)
        for profile_id in CANONICAL_PROFILES
    }
