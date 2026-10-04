from __future__ import annotations

import difflib
import hashlib
import json
import math
import re
import statistics
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .atomic_storage import atomic_write
from .benchmark_bundles import (
    BENCHMARK_PROFILES,
    BenchmarkBundleError,
    benchmark_root,
    load_benchmark_bundle,
    read_benchmark_transcript,
)
from .transcript import TranscriptDocument, TranscriptValidationError

REFERENCE_SCHEMA = "tda_benchmark_reference_v1"
REFERENCE_INDEX_SCHEMA = "tda_benchmark_reference_index_v1"
NORMALIZATION_SCHEMA = "tda_asr_text_normalization_v1"
QUALITY_RECEIPT_SCHEMA = "tda_benchmark_quality_receipt_v1"
QUALITY_METRICS_VERSION = "tda_asr_quality_metrics_v1"
TURN_MATCH_VERSION = "tda_benchmark_turn_match_v1"

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAX_REFERENCE_BYTES = 16 * 1024 * 1024
_MAX_REFERENCE_TRACK_CHARS = 250_000
_MAX_REFERENCE_TRACKS = 128
_MAX_GLOSSARY_TERMS = 512
_MAX_GLOSSARY_TERM_CHARS = 256
_MAX_TURNS_PER_TRACK = 20_000
_MIN_TURN_IOU = 0.10


class BenchmarkQualityError(RuntimeError):
    pass


def canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise BenchmarkQualityError("BENCHMARK_JSON_INVALID") from exc


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_bundle(
    data_root: Path,
    *,
    benchmark_id: str,
    verify_profiles: bool = True,
) -> dict[str, Any]:
    del verify_profiles  # canonical bundle reads always verify all profile artifacts
    bundle = load_benchmark_bundle(data_root, benchmark_id)
    return {**bundle, "sample_descriptor": bundle["sample"]}


def load_profile_transcript(
    data_root: Path,
    *,
    benchmark_id: str,
    profile_id: str,
) -> tuple[dict[str, Any], TranscriptDocument]:
    bundle = load_benchmark_bundle(data_root, benchmark_id)
    entry = next(
        (item for item in bundle["profiles"] if item.get("profile_id") == profile_id),
        None,
    )
    if entry is None:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_NOT_FOUND")
    payload = read_benchmark_transcript(data_root, benchmark_id, profile_id)
    try:
        value = json.loads(payload.decode("utf-8"))
        document = TranscriptDocument.from_dict(value)
    except (UnicodeDecodeError, json.JSONDecodeError, TranscriptValidationError) as exc:
        raise BenchmarkQualityError("BENCHMARK_PROFILE_TRANSCRIPT_INVALID") from exc
    return entry, document


def normalization_policy() -> dict[str, Any]:
    return {
        "schema_version": NORMALIZATION_SCHEMA,
        "unicode_normalization": "NFC",
        "case": "unicode_casefold",
        "whitespace": "collapse",
        "punctuation": "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
        "diacritics": "preserve",
        "locale_dependent": False,
    }


def _policy_sha256() -> str:
    return sha256_bytes(canonical_json_bytes(normalization_policy()))


def normalize_text(value: str) -> str:
    if not isinstance(value, str):
        raise BenchmarkQualityError("BENCHMARK_QUALITY_TEXT_INVALID")
    text = unicodedata.normalize("NFC", value).casefold()
    text = (
        text.replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u02bc", "'")
        .replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
    )
    cleaned: list[str] = []
    for char in text:
        if char in {"'", "-"}:
            cleaned.append(char)
        elif unicodedata.category(char).startswith("P"):
            cleaned.append(" ")
        else:
            cleaned.append(char)
    tokens = "".join(cleaned).split()
    return " ".join(token for token in tokens if token.strip("'-"))


def _words(value: str) -> list[str]:
    normalized = normalize_text(value)
    return normalized.split() if normalized else []


def _cer_text(value: str) -> str:
    return normalize_text(value).replace(" ", "")


def _edit_counts(reference: list[str], hypothesis: list[str]) -> dict[str, int]:
    if not reference:
        return {
            "substitutions": 0,
            "deletions": 0,
            "insertions": len(hypothesis),
            "distance": len(hypothesis),
        }
    if not hypothesis:
        return {
            "substitutions": 0,
            "deletions": len(reference),
            "insertions": 0,
            "distance": len(reference),
        }

    # tuple: (distance, substitutions, deletions, insertions). Keeping only two
    # rows bounds memory while preserving a deterministic minimum-edit path.
    previous = [(index, 0, 0, index) for index in range(len(hypothesis) + 1)]
    for ref_index, ref_token in enumerate(reference, start=1):
        current: list[tuple[int, int, int, int]] = [(ref_index, 0, ref_index, 0)]
        for hyp_index, hyp_token in enumerate(hypothesis, start=1):
            if ref_token == hyp_token:
                current.append(previous[hyp_index - 1])
                continue
            substitution = previous[hyp_index - 1]
            deletion = previous[hyp_index]
            insertion = current[hyp_index - 1]
            candidates = (
                (
                    substitution[0] + 1,
                    substitution[1] + 1,
                    substitution[2],
                    substitution[3],
                    0,
                ),
                (
                    deletion[0] + 1,
                    deletion[1],
                    deletion[2] + 1,
                    deletion[3],
                    1,
                ),
                (
                    insertion[0] + 1,
                    insertion[1],
                    insertion[2],
                    insertion[3] + 1,
                    2,
                ),
            )
            best = min(candidates, key=lambda item: (item[0], item[4]))
            current.append(best[:4])
        previous = current
    distance, substitutions, deletions, insertions = previous[-1]
    return {
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "distance": distance,
    }


def _levenshtein_distance(reference: str, hypothesis: str) -> int:
    # Myers' bit-vector algorithm is exact Levenshtein distance and keeps CER
    # practical for five-minute samples without a quadratic Python matrix.
    if reference == hypothesis:
        return 0
    if not reference:
        return len(hypothesis)
    if not hypothesis:
        return len(reference)
    if len(reference) > len(hypothesis):
        reference, hypothesis = hypothesis, reference

    positions: dict[str, int] = {}
    for index, char in enumerate(reference):
        positions[char] = positions.get(char, 0) | (1 << index)
    mask = (1 << len(reference)) - 1
    highest = 1 << (len(reference) - 1)
    positive = mask
    negative = 0
    score = len(reference)

    for char in hypothesis:
        equal = positions.get(char, 0)
        xv = equal | negative
        xh = (((equal & positive) + positive) ^ positive) | equal
        ph = negative | ~(xh | positive)
        mh = positive & xh
        if ph & highest:
            score += 1
        elif mh & highest:
            score -= 1
        ph = ((ph << 1) | 1) & mask
        mh = (mh << 1) & mask
        positive = (mh | ~(xv | ph)) & mask
        negative = ph & xv
    return score


def _ratio(numerator: int | float, denominator: int | float) -> float | None:
    if denominator <= 0:
        return None
    return float(numerator) / float(denominator)


def _track_text(document: TranscriptDocument, track_number: int) -> str:
    for track in document.tracks:
        if track.number == track_number:
            return " ".join(segment.text for segment in track.segments if segment.text.strip())
    return ""


def _count_phrase(tokens: list[str], phrase: list[str]) -> int:
    if not phrase or len(phrase) > len(tokens):
        return 0
    width = len(phrase)
    return sum(1 for index in range(len(tokens) - width + 1) if tokens[index:index + width] == phrase)


def _safe_reference_root(data_root: Path, benchmark_id: str) -> Path:
    root = benchmark_root(data_root, benchmark_id)
    raw = root / "reference"
    if raw.exists() and (raw.is_symlink() or getattr(raw, "is_junction", lambda: False)()):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_INVALID")
    resolved = raw.resolve()
    if resolved.parent != root:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_INVALID")
    return resolved


def _safe_quality_root(data_root: Path, benchmark_id: str) -> Path:
    root = benchmark_root(data_root, benchmark_id)
    raw = root / "quality"
    if raw.exists() and (raw.is_symlink() or getattr(raw, "is_junction", lambda: False)()):
        raise BenchmarkQualityError("BENCHMARK_QUALITY_PATH_INVALID")
    resolved = raw.resolve()
    if resolved.parent != root:
        raise BenchmarkQualityError("BENCHMARK_QUALITY_PATH_INVALID")
    return resolved


def _reference_index_path(data_root: Path, benchmark_id: str) -> Path:
    return _safe_reference_root(data_root, benchmark_id) / "index.json"


def _read_json(path: Path, *, maximum: int = _MAX_REFERENCE_BYTES) -> dict[str, Any]:
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_INVALID")
    try:
        size = path.stat().st_size
        if size <= 0 or size > maximum:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_SIZE_INVALID")
        payload = path.read_bytes()
    except OSError as exc:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_UNAVAILABLE") from exc
    if len(payload) != size:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SIZE_INVALID")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INVALID") from exc
    if not isinstance(value, dict):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INVALID")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    payload = canonical_json_bytes(value)
    if len(payload) <= 0 or len(payload) > _MAX_REFERENCE_BYTES:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SIZE_INVALID")
    atomic_write(path, payload)


def _empty_reference_index(benchmark_id: str) -> dict[str, Any]:
    return {
        "schema_version": REFERENCE_INDEX_SCHEMA,
        "benchmark_id": benchmark_id,
        "latest_revision": 0,
        "active_revision": None,
        "active_sha256": None,
        "revisions": [],
    }


def reference_index(data_root: Path, *, benchmark_id: str) -> dict[str, Any]:
    load_bundle(data_root, benchmark_id=benchmark_id, verify_profiles=True)
    path = _reference_index_path(data_root, benchmark_id)
    if not path.exists():
        return _empty_reference_index(benchmark_id)
    value = _read_json(path)
    if (
        value.get("schema_version") != REFERENCE_INDEX_SCHEMA
        or value.get("benchmark_id") != benchmark_id
        or isinstance(value.get("latest_revision"), bool)
        or not isinstance(value.get("latest_revision"), int)
        or value["latest_revision"] < 0
        or not isinstance(value.get("revisions"), list)
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INDEX_INVALID")
    revisions = value["revisions"]
    if len(revisions) != value["latest_revision"]:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INDEX_INVALID")
    for expected, item in enumerate(revisions, start=1):
        if (
            not isinstance(item, dict)
            or item.get("revision") != expected
            or not isinstance(item.get("artifact"), str)
            or not re.fullmatch(r"r\d{6}-[0-9a-f]{12}\.json", item["artifact"])
            or not isinstance(item.get("sha256"), str)
            or not _SHA256.fullmatch(item["sha256"])
        ):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_INDEX_INVALID")
    active = value.get("active_revision")
    if active is not None and (
        isinstance(active, bool)
        or not isinstance(active, int)
        or active < 1
        or active > value["latest_revision"]
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INDEX_INVALID")
    if active is None:
        if value.get("active_sha256") is not None:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_INDEX_INVALID")
    else:
        if value.get("active_sha256") != revisions[active - 1]["sha256"]:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_INDEX_INVALID")
    return value


def _reference_payload_sha(value: dict[str, Any]) -> str:
    payload = dict(value)
    payload.pop("canonical_payload_sha256", None)
    return sha256_bytes(canonical_json_bytes(payload))


def _validate_reference_tracks(
    tracks: Iterable[dict[str, Any]],
    *,
    capability_level: int,
    expected_track_numbers: set[int],
    sample_start_seconds: float,
    sample_end_seconds: float,
) -> list[dict[str, Any]]:
    if (
        not math.isfinite(float(sample_start_seconds))
        or not math.isfinite(float(sample_end_seconds))
        or float(sample_start_seconds) < 0
        or float(sample_end_seconds) <= float(sample_start_seconds)
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SAMPLE_INVALID")
    sample_start_seconds = float(sample_start_seconds)
    sample_end_seconds = float(sample_end_seconds)
    values = list(tracks)
    if not values or len(values) > _MAX_REFERENCE_TRACKS:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACKS_INVALID")
    seen: set[int] = set()
    normalized: list[dict[str, Any]] = []
    for raw in values:
        if not isinstance(raw, dict):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACK_INVALID")
        number = raw.get("track_number")
        speaker = raw.get("speaker")
        text = raw.get("text")
        if (
            isinstance(number, bool)
            or not isinstance(number, int)
            or number < 1
            or number in seen
            or number not in expected_track_numbers
        ):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACK_INVALID")
        if not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 160:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_SPEAKER_INVALID")
        if (
            not isinstance(text, str)
            or "\x00" in text
            or len(text) > _MAX_REFERENCE_TRACK_CHARS
            or any(0xD800 <= ord(char) <= 0xDFFF for char in text)
        ):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TEXT_INVALID")
        turns_raw = raw.get("turns", [])
        if not isinstance(turns_raw, list) or len(turns_raw) > _MAX_TURNS_PER_TRACK:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_TURNS_INVALID")
        if capability_level == 1 and turns_raw:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_CAPABILITY_MISMATCH")
        turns: list[dict[str, Any]] = []
        previous_start = -1.0
        for index, turn in enumerate(turns_raw, start=1):
            if not isinstance(turn, dict):
                raise BenchmarkQualityError("BENCHMARK_REFERENCE_TURN_INVALID")
            turn_speaker = turn.get("speaker")
            turn_text = turn.get("text")
            start = turn.get("start")
            end = turn.get("end")
            overlap = turn.get("overlaps_other_speaker", False)
            if (
                not isinstance(turn_speaker, str)
                or not turn_speaker.strip()
                or len(turn_speaker) > 160
                or not isinstance(turn_text, str)
                or "\x00" in turn_text
                or len(turn_text) > _MAX_REFERENCE_TRACK_CHARS
                or any(0xD800 <= ord(char) <= 0xDFFF for char in turn_text)
                or isinstance(start, bool)
                or not isinstance(start, (int, float))
                or isinstance(end, bool)
                or not isinstance(end, (int, float))
                or not math.isfinite(float(start))
                or not math.isfinite(float(end))
                or float(start) < sample_start_seconds
                or float(end) > sample_end_seconds
                or float(end) < float(start)
                or float(start) < previous_start
                or not isinstance(overlap, bool)
            ):
                raise BenchmarkQualityError("BENCHMARK_REFERENCE_TURN_INVALID")
            previous_start = float(start)
            turns.append(
                {
                    "id": str(turn.get("id") or f"{number}-{index}"),
                    "speaker": turn_speaker.strip(),
                    "start": float(start),
                    "end": float(end),
                    "text": turn_text,
                    "overlaps_other_speaker": overlap,
                }
            )
        seen.add(number)
        normalized.append(
            {
                "track_number": number,
                "speaker": speaker.strip(),
                "text": text,
                **({"turns": turns} if capability_level >= 2 else {}),
            }
        )
    if seen != expected_track_numbers:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_TRACK_SET_MISMATCH")
    return sorted(normalized, key=lambda item: item["track_number"])


def _validate_glossary_terms(terms: Iterable[str]) -> list[str]:
    values = list(terms)
    if len(values) > _MAX_GLOSSARY_TERMS:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_GLOSSARY_INVALID")
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        if (
            not isinstance(raw, str)
            or not raw.strip()
            or "\x00" in raw
            or len(raw) > _MAX_GLOSSARY_TERM_CHARS
        ):
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_GLOSSARY_INVALID")
        term = unicodedata.normalize("NFC", raw.strip())
        key = normalize_text(term)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(term)
    return result


def reference_draft_from_profile(
    data_root: Path,
    *,
    benchmark_id: str,
    profile_id: str,
) -> dict[str, Any]:
    if profile_id not in BENCHMARK_PROFILES:
        raise BenchmarkQualityError("BENCHMARK_PROFILE_INVALID")
    bundle = load_bundle(data_root, benchmark_id=benchmark_id, verify_profiles=True)
    _, document = load_profile_transcript(
        data_root,
        benchmark_id=benchmark_id,
        profile_id=profile_id,
    )
    return {
        "schema_version": "tda_benchmark_reference_draft_v1",
        "benchmark_id": benchmark_id,
        "source_sha256": bundle["source_sha256"],
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "sample_descriptor": bundle["sample_descriptor"],
        "capability_level": 1,
        "provenance": {
            "kind": "derived-from-profile",
            "seed_profile_id": profile_id,
            "human_owned": True,
        },
        "tracks": [
            {
                "track_number": track.number,
                "speaker": track.speaker,
                "text": " ".join(
                    segment.text for segment in track.segments if segment.text.strip()
                ),
            }
            for track in document.tracks
        ],
        "glossary_terms": [],
        "normalization_policy": normalization_policy(),
    }


def save_reference_revision(
    data_root: Path,
    *,
    benchmark_id: str,
    expected_revision: int,
    capability_level: int,
    provenance_kind: str,
    tracks: Iterable[dict[str, Any]],
    glossary_terms: Iterable[str] = (),
    seed_profile_id: str | None = None,
    activate: bool,
) -> dict[str, Any]:
    if (
        isinstance(expected_revision, bool)
        or not isinstance(expected_revision, int)
        or expected_revision < 0
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_REVISION_INVALID")
    if capability_level not in {1, 2}:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_CAPABILITY_UNSUPPORTED")
    if provenance_kind not in {"manual", "imported", "derived-from-profile"}:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PROVENANCE_INVALID")
    if provenance_kind == "derived-from-profile":
        if seed_profile_id not in BENCHMARK_PROFILES:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_PROVENANCE_INVALID")
    elif seed_profile_id is not None:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PROVENANCE_INVALID")

    bundle = load_bundle(data_root, benchmark_id=benchmark_id, verify_profiles=True)
    index = reference_index(data_root, benchmark_id=benchmark_id)
    if index["latest_revision"] != expected_revision:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_STALE_REVISION")

    first_profile = BENCHMARK_PROFILES[0]
    _, profile_document = load_profile_transcript(
        data_root,
        benchmark_id=benchmark_id,
        profile_id=first_profile,
    )
    expected_tracks = {track.number for track in profile_document.tracks}
    descriptor = bundle["sample_descriptor"]
    normalized_tracks = _validate_reference_tracks(
        tracks,
        capability_level=capability_level,
        expected_track_numbers=expected_tracks,
        sample_start_seconds=float(descriptor["start_seconds"]),
        sample_end_seconds=float(descriptor["end_seconds"]),
    )
    normalized_terms = _validate_glossary_terms(glossary_terms)

    revision = expected_revision + 1
    parent_revision = expected_revision or None
    now = utc_now()
    reference: dict[str, Any] = {
        "schema_version": REFERENCE_SCHEMA,
        "benchmark_id": benchmark_id,
        "source_sha256": bundle["source_sha256"],
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "sample_descriptor": bundle["sample_descriptor"],
        "track_set": sorted(expected_tracks),
        "revision": revision,
        "parent_revision": parent_revision,
        "created_at": now,
        "updated_at": now,
        "provenance": {
            "kind": provenance_kind,
            "seed_profile_id": seed_profile_id,
            "human_owned": True,
        },
        "capability_level": capability_level,
        "normalization_policy": normalization_policy(),
        "glossary_terms": normalized_terms,
        "tracks": normalized_tracks,
    }
    reference["canonical_payload_sha256"] = _reference_payload_sha(reference)
    digest = reference["canonical_payload_sha256"]

    root = _safe_reference_root(data_root, benchmark_id)
    revisions_root = root / "revisions"
    if revisions_root.exists() and (
        revisions_root.is_symlink()
        or getattr(revisions_root, "is_junction", lambda: False)()
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_PATH_INVALID")
    revisions_root.mkdir(parents=True, exist_ok=True)
    artifact = f"r{revision:06d}-{digest[:12]}.json"
    path = revisions_root / artifact
    if path.exists():
        existing = load_reference_revision(
            data_root,
            benchmark_id=benchmark_id,
            revision=revision,
            expected_sha256=digest,
        )
        if existing != reference:
            raise BenchmarkQualityError("BENCHMARK_REFERENCE_REVISION_CONFLICT")
    else:
        _write_json(path, reference)

    revisions = [
        *index["revisions"],
        {
            "revision": revision,
            "sha256": digest,
            "artifact": artifact,
            "capability_level": capability_level,
            "created_at": now,
        },
    ]
    updated_index = {
        "schema_version": REFERENCE_INDEX_SCHEMA,
        "benchmark_id": benchmark_id,
        "latest_revision": revision,
        "active_revision": revision if activate else index.get("active_revision"),
        "active_sha256": digest if activate else index.get("active_sha256"),
        "revisions": revisions,
    }
    root.mkdir(parents=True, exist_ok=True)
    _write_json(_reference_index_path(data_root, benchmark_id), updated_index)
    return {
        "reference": reference,
        "index": updated_index,
    }


def load_reference_revision(
    data_root: Path,
    *,
    benchmark_id: str,
    revision: int,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    index = reference_index(data_root, benchmark_id=benchmark_id)
    if (
        isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 1
        or revision > index["latest_revision"]
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_REVISION_INVALID")
    entry = index["revisions"][revision - 1]
    if expected_sha256 is not None and entry["sha256"] != expected_sha256:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_HASH_MISMATCH")
    root = _safe_reference_root(data_root, benchmark_id)
    value = _read_json(root / "revisions" / entry["artifact"])
    if (
        value.get("schema_version") != REFERENCE_SCHEMA
        or value.get("benchmark_id") != benchmark_id
        or value.get("revision") != revision
        or value.get("canonical_payload_sha256") != entry["sha256"]
        or _reference_payload_sha(value) != entry["sha256"]
        or value.get("normalization_policy") != normalization_policy()
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INTEGRITY_MISMATCH")
    bundle = load_bundle(data_root, benchmark_id=benchmark_id, verify_profiles=True)
    if (
        value.get("source_sha256") != bundle["source_sha256"]
        or value.get("sample_identity_sha256") != bundle["sample_identity_sha256"]
        or value.get("sample_descriptor") != bundle["sample_descriptor"]
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SAMPLE_MISMATCH")
    capability = value.get("capability_level")
    if capability not in {1, 2}:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_CAPABILITY_UNSUPPORTED")
    expected_tracks = set(value.get("track_set") or [])
    descriptor = bundle["sample_descriptor"]
    validated_tracks = _validate_reference_tracks(
        value.get("tracks") or [],
        capability_level=capability,
        expected_track_numbers=expected_tracks,
        sample_start_seconds=float(descriptor["start_seconds"]),
        sample_end_seconds=float(descriptor["end_seconds"]),
    )
    if validated_tracks != value.get("tracks"):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_INTEGRITY_MISMATCH")
    _validate_glossary_terms(value.get("glossary_terms") or [])
    return value


def active_reference(data_root: Path, *, benchmark_id: str) -> dict[str, Any] | None:
    index = reference_index(data_root, benchmark_id=benchmark_id)
    revision = index.get("active_revision")
    if revision is None:
        return None
    return load_reference_revision(
        data_root,
        benchmark_id=benchmark_id,
        revision=revision,
        expected_sha256=index.get("active_sha256"),
    )


def reference_status(data_root: Path, *, benchmark_id: str) -> dict[str, Any]:
    index = reference_index(data_root, benchmark_id=benchmark_id)
    return {
        "schema_version": "tda_benchmark_reference_status_v1",
        "benchmark_id": benchmark_id,
        "latest_revision": index["latest_revision"],
        "active_revision": index["active_revision"],
        "active_sha256": index["active_sha256"],
        "normalization_policy": normalization_policy(),
    }


def _quality_for_text(reference: str, hypothesis: str) -> dict[str, Any]:
    reference_words = _words(reference)
    hypothesis_words = _words(hypothesis)
    counts = _edit_counts(reference_words, hypothesis_words)
    ref_chars = _cer_text(reference)
    hyp_chars = _cer_text(hypothesis)
    char_distance = _levenshtein_distance(ref_chars, hyp_chars)
    return {
        **counts,
        "reference_words": len(reference_words),
        "hypothesis_words": len(hypothesis_words),
        "wer_normalized": _ratio(counts["distance"], len(reference_words)),
        "reference_characters": len(ref_chars),
        "hypothesis_characters": len(hyp_chars),
        "character_distance": char_distance,
        "cer_normalized": _ratio(char_distance, len(ref_chars)),
    }


def _glossary_metrics(
    reference_tracks: list[dict[str, Any]],
    document: TranscriptDocument,
    glossary_terms: list[str],
) -> dict[str, Any]:
    reference_tokens_by_track = {
        item["track_number"]: _words(item["text"]) for item in reference_tracks
    }
    hypothesis_tokens_by_track = {
        track.number: _words(_track_text(document, track.number)) for track in document.tracks
    }
    rows: list[dict[str, Any]] = []
    for term in glossary_terms:
        phrase = _words(term)
        if not phrase:
            continue
        track_numbers = set(reference_tokens_by_track) | set(hypothesis_tokens_by_track)
        reference_occurrences = 0
        hypothesis_occurrences = 0
        correct = 0
        for track_number in track_numbers:
            reference_count = _count_phrase(
                reference_tokens_by_track.get(track_number, []),
                phrase,
            )
            hypothesis_count = _count_phrase(
                hypothesis_tokens_by_track.get(track_number, []),
                phrase,
            )
            reference_occurrences += reference_count
            hypothesis_occurrences += hypothesis_count
            correct += min(reference_count, hypothesis_count)
        if reference_occurrences == 0:
            continue
        missed = max(reference_occurrences - correct, 0)
        extra = max(hypothesis_occurrences - correct, 0)
        rows.append(
            {
                "term_sha256": hashlib.sha256(normalize_text(term).encode("utf-8")).hexdigest(),
                "reference_occurrences": reference_occurrences,
                "correct_occurrences": correct,
                "missed_occurrences": missed,
                "extra_occurrences": extra,
                "recall": _ratio(correct, reference_occurrences),
                "precision": _ratio(correct, hypothesis_occurrences),
            }
        )
    reference_total = sum(item["reference_occurrences"] for item in rows)
    correct_total = sum(item["correct_occurrences"] for item in rows)
    hypothesis_total = sum(
        item["correct_occurrences"] + item["extra_occurrences"] for item in rows
    )
    return {
        "available": bool(rows),
        "reference_occurrences": reference_total,
        "correct_occurrences": correct_total,
        "missed_occurrences": sum(item["missed_occurrences"] for item in rows),
        "extra_occurrences": sum(item["extra_occurrences"] for item in rows),
        "recall": _ratio(correct_total, reference_total),
        "precision": _ratio(correct_total, hypothesis_total),
        "terms": rows,
    }


def _turn_iou(left: dict[str, Any], right: dict[str, Any]) -> float:
    intersection = max(0.0, min(left["end"], right["end"]) - max(left["start"], right["start"]))
    union = max(left["end"], right["end"]) - min(left["start"], right["start"])
    return intersection / union if union > 0 else (1.0 if left["start"] == right["start"] else 0.0)


def _hypothesis_turns_by_track(document: TranscriptDocument) -> dict[int, list[dict[str, Any]]]:
    result: dict[int, list[dict[str, Any]]] = {}
    for turn in document.turns:
        tracks = {reference.track_number for reference in turn.segments}
        if len(tracks) != 1:
            continue
        number = next(iter(tracks))
        result.setdefault(number, []).append(
            {
                "speaker": turn.speaker,
                "start": float(turn.start),
                "end": float(turn.end),
                "overlaps_other_speaker": bool(turn.overlaps_other_speaker),
            }
        )
    return result


def _percentile_nearest_rank(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def _timing_precision(document: TranscriptDocument) -> str:
    alignment = document.engine.alignment.casefold()
    warnings = " ".join(document.warnings).casefold()
    if "fallback" in alignment or "fallback" in warnings:
        return "window_fallback"
    segments = [segment for track in document.tracks for segment in track.segments]
    if segments and all(segment.words for segment in segments):
        return "word_aligned"
    return "segment_aligned"


def _timing_metrics(
    reference_tracks: list[dict[str, Any]],
    document: TranscriptDocument,
    *,
    capability_level: int,
) -> dict[str, Any]:
    precision = _timing_precision(document)
    if capability_level < 2:
        return {
            "available": False,
            "reason": "reference_capability_level_1",
            "timing_precision": precision,
        }
    hypothesis_by_track = _hypothesis_turns_by_track(document)
    reference_turn_count = 0
    matched = 0
    speaker_correct = 0
    start_errors: list[float] = []
    end_errors: list[float] = []
    ref_overlap_total = 0
    hyp_overlap_total = 0
    overlap_true_positive = 0
    unmatched_hypothesis = 0

    for track in reference_tracks:
        refs = list(track.get("turns") or [])
        reference_turn_count += len(refs)
        hyps = hypothesis_by_track.get(track["track_number"], [])
        available = set(range(len(hyps)))
        ref_overlap_total += sum(
            1 for item in refs if item.get("overlaps_other_speaker") is True
        )
        hyp_overlap_total += sum(
            1 for item in hyps if item.get("overlaps_other_speaker") is True
        )
        for ref in refs:
            choices: list[tuple[float, float, int]] = []
            for index in available:
                hyp = hyps[index]
                iou = _turn_iou(ref, hyp)
                if iou < _MIN_TURN_IOU:
                    continue
                boundary_error = abs(ref["start"] - hyp["start"]) + abs(
                    ref["end"] - hyp["end"]
                )
                # Pair turns by temporal evidence only. Speaker is an evaluated
                # outcome, not a matching preference; otherwise a weaker-overlap
                # same-speaker candidate can artificially inflate speaker accuracy.
                choices.append((-iou, boundary_error, index))
            if not choices:
                continue
            _, _, selected = min(choices)
            available.remove(selected)
            hyp = hyps[selected]
            matched += 1
            if normalize_text(ref["speaker"]) == normalize_text(hyp["speaker"]):
                speaker_correct += 1
            start_errors.append(abs(ref["start"] - hyp["start"]))
            end_errors.append(abs(ref["end"] - hyp["end"]))
            if (
                ref.get("overlaps_other_speaker") is True
                and hyp.get("overlaps_other_speaker") is True
            ):
                overlap_true_positive += 1
        unmatched_hypothesis += len(available)

    if reference_turn_count == 0:
        return {
            "available": False,
            "reason": "reference_has_no_timed_turns",
            "timing_precision": precision,
        }
    boundary_errors = start_errors + end_errors
    overlap_precision = _ratio(overlap_true_positive, hyp_overlap_total)
    overlap_recall = _ratio(overlap_true_positive, ref_overlap_total)
    overlap_f1 = (
        2 * overlap_precision * overlap_recall / (overlap_precision + overlap_recall)
        if overlap_precision is not None
        and overlap_recall is not None
        and overlap_precision + overlap_recall > 0
        else None
    )
    return {
        "available": True,
        "match_policy": {
            "schema_version": TURN_MATCH_VERSION,
            "same_track_first": True,
            "minimum_temporal_iou": _MIN_TURN_IOU,
        },
        "timing_precision": precision,
        "reference_turns": reference_turn_count,
        "matched_reference_turns": matched,
        "unmatched_reference_turns": reference_turn_count - matched,
        "unmatched_hypothesis_turns": unmatched_hypothesis,
        "turn_coverage": _ratio(matched, reference_turn_count),
        "speaker_accuracy": _ratio(speaker_correct, matched),
        "boundary_start_mae_seconds": (
            sum(start_errors) / len(start_errors) if start_errors else None
        ),
        "boundary_end_mae_seconds": (
            sum(end_errors) / len(end_errors) if end_errors else None
        ),
        "boundary_p50_seconds": statistics.median(boundary_errors)
        if boundary_errors
        else None,
        "boundary_p95_seconds": _percentile_nearest_rank(boundary_errors, 0.95),
        "overlap": {
            "reference_positive": ref_overlap_total,
            "hypothesis_positive": hyp_overlap_total,
            "true_positive": overlap_true_positive,
            "precision": overlap_precision,
            "recall": overlap_recall,
            "f1": overlap_f1,
        },
    }


def compute_quality_metrics(
    reference: dict[str, Any],
    document: TranscriptDocument,
) -> dict[str, Any]:
    if reference.get("normalization_policy") != normalization_policy():
        raise BenchmarkQualityError("BENCHMARK_NORMALIZATION_VERSION_MISMATCH")
    if document.source_sha256 != reference.get("source_sha256"):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SOURCE_MISMATCH")
    capability = reference.get("capability_level")
    if capability not in {1, 2}:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_CAPABILITY_UNSUPPORTED")

    reference_tracks = list(reference.get("tracks") or [])
    reference_numbers = {item["track_number"] for item in reference_tracks}
    hypothesis_numbers = {track.number for track in document.tracks}
    track_numbers = sorted(reference_numbers | hypothesis_numbers)

    per_track: list[dict[str, Any]] = []
    totals = {
        "substitutions": 0,
        "deletions": 0,
        "insertions": 0,
        "distance": 0,
        "reference_words": 0,
        "hypothesis_words": 0,
        "reference_characters": 0,
        "hypothesis_characters": 0,
        "character_distance": 0,
    }
    reference_by_track = {
        item["track_number"]: item for item in reference_tracks
    }
    for track_number in track_numbers:
        reference_text = reference_by_track.get(track_number, {}).get("text", "")
        hypothesis_text = _track_text(document, track_number)
        metrics = _quality_for_text(reference_text, hypothesis_text)
        state = (
            "matched"
            if track_number in reference_numbers and track_number in hypothesis_numbers
            else "missing_hypothesis"
            if track_number in reference_numbers
            else "extra_hypothesis"
        )
        row = {
            "track_number": track_number,
            "state": state,
            **metrics,
        }
        per_track.append(row)
        for key in totals:
            totals[key] += int(metrics[key])

    macro_values = [
        item["wer_normalized"]
        for item in per_track
        if item["wer_normalized"] is not None
    ]
    micro = {
        **totals,
        "wer_normalized": _ratio(totals["distance"], totals["reference_words"]),
        "cer_normalized": _ratio(
            totals["character_distance"], totals["reference_characters"]
        ),
        "macro_wer_normalized": (
            sum(macro_values) / len(macro_values) if macro_values else None
        ),
    }
    return {
        "metric_implementation_version": QUALITY_METRICS_VERSION,
        "normalization_policy": normalization_policy(),
        "normalization_policy_sha256": _policy_sha256(),
        "capability_level": capability,
        "per_track": per_track,
        "micro": micro,
        "glossary": _glossary_metrics(
            reference_tracks,
            document,
            list(reference.get("glossary_terms") or []),
        ),
        "timing": _timing_metrics(
            reference_tracks,
            document,
            capability_level=capability,
        ),
    }


def _quality_receipt_path(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    revision: int,
    reference_sha256: str,
) -> Path:
    if profile_id not in BENCHMARK_PROFILES:
        raise BenchmarkQualityError("BENCHMARK_PROFILE_INVALID")
    root = _safe_quality_root(data_root, benchmark_id)
    profile_root = root / profile_id
    if profile_root.exists() and (
        profile_root.is_symlink()
        or getattr(profile_root, "is_junction", lambda: False)()
    ):
        raise BenchmarkQualityError("BENCHMARK_QUALITY_PATH_INVALID")
    return profile_root / f"r{revision:06d}-{reference_sha256[:12]}.json"


def score_profile(
    data_root: Path,
    *,
    benchmark_id: str,
    profile_id: str,
    reference: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if profile_id not in BENCHMARK_PROFILES:
        raise BenchmarkQualityError("BENCHMARK_PROFILE_INVALID")
    reference = reference or active_reference(data_root, benchmark_id=benchmark_id)
    if reference is None:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_NOT_CONFIGURED")
    bundle = load_bundle(data_root, benchmark_id=benchmark_id, verify_profiles=True)
    profile_manifest, document = load_profile_transcript(
        data_root,
        benchmark_id=benchmark_id,
        profile_id=profile_id,
    )
    if (
        reference.get("benchmark_id") != benchmark_id
        or reference.get("source_sha256") != bundle["source_sha256"]
        or reference.get("sample_identity_sha256") != bundle["sample_identity_sha256"]
    ):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SAMPLE_MISMATCH")

    metrics = compute_quality_metrics(reference, document)
    benchmark_manifest_path = benchmark_root(data_root, benchmark_id) / "benchmark.json"
    try:
        benchmark_manifest_sha256 = sha256_bytes(benchmark_manifest_path.read_bytes())
    except OSError as exc:
        raise BenchmarkQualityError("BENCHMARK_MANIFEST_UNAVAILABLE") from exc
    reference_sha256 = reference["canonical_payload_sha256"]
    receipt = {
        "schema_version": QUALITY_RECEIPT_SCHEMA,
        "benchmark_id": benchmark_id,
        "benchmark_manifest_sha256": benchmark_manifest_sha256,
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "profile_id": profile_id,
        "profile_transcript_sha256": profile_manifest["transcript"]["sha256"],
        "reference_revision": reference["revision"],
        "reference_sha256": reference_sha256,
        "normalization_policy": normalization_policy(),
        "normalization_policy_sha256": _policy_sha256(),
        "metric_implementation_version": QUALITY_METRICS_VERSION,
        "capability_level": reference["capability_level"],
        "metrics": metrics,
    }
    path = _quality_receipt_path(
        data_root,
        benchmark_id,
        profile_id,
        reference["revision"],
        reference_sha256,
    )
    payload = canonical_json_bytes(receipt)
    if path.exists():
        try:
            existing = path.read_bytes()
        except OSError as exc:
            raise BenchmarkQualityError("BENCHMARK_QUALITY_RECEIPT_UNAVAILABLE") from exc
        if existing != payload:
            raise BenchmarkQualityError("BENCHMARK_QUALITY_RECEIPT_CONFLICT")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, payload)
    return {
        **receipt,
        "receipt_sha256": sha256_bytes(payload),
        "receipt_size_bytes": len(payload),
    }


def inspect_quality_errors(
    data_root: Path,
    *,
    benchmark_id: str,
    profile_id: str,
    maximum_regions: int = 200,
) -> dict[str, Any]:
    if profile_id not in BENCHMARK_PROFILES:
        raise BenchmarkQualityError("BENCHMARK_PROFILE_INVALID")
    if (
        isinstance(maximum_regions, bool)
        or not isinstance(maximum_regions, int)
        or not 1 <= maximum_regions <= 500
    ):
        raise BenchmarkQualityError("BENCHMARK_INSPECTION_LIMIT_INVALID")
    reference = active_reference(data_root, benchmark_id=benchmark_id)
    if reference is None:
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_NOT_CONFIGURED")
    _, document = load_profile_transcript(
        data_root,
        benchmark_id=benchmark_id,
        profile_id=profile_id,
    )
    if document.source_sha256 != reference.get("source_sha256"):
        raise BenchmarkQualityError("BENCHMARK_REFERENCE_SOURCE_MISMATCH")

    reference_by_track = {
        item["track_number"]: item for item in reference.get("tracks") or []
    }
    hypothesis_numbers = {track.number for track in document.tracks}
    track_numbers = sorted(set(reference_by_track) | hypothesis_numbers)
    regions: list[dict[str, Any]] = []
    truncated = False

    for track_number in track_numbers:
        reference_tokens = _words(reference_by_track.get(track_number, {}).get("text", ""))
        hypothesis_tokens = _words(_track_text(document, track_number))
        matcher = difflib.SequenceMatcher(
            a=reference_tokens,
            b=hypothesis_tokens,
            autojunk=False,
        )
        for tag, ref_start, ref_end, hyp_start, hyp_end in matcher.get_opcodes():
            if tag == "equal":
                continue
            if len(regions) >= maximum_regions:
                truncated = True
                break
            context = 4
            ref_left = max(0, ref_start - context)
            ref_right = min(len(reference_tokens), ref_end + context)
            hyp_left = max(0, hyp_start - context)
            hyp_right = min(len(hypothesis_tokens), hyp_end + context)
            regions.append(
                {
                    "track_number": track_number,
                    "kind": {
                        "replace": "substitution_region",
                        "delete": "deletion_region",
                        "insert": "insertion_region",
                    }.get(tag, "unmatched_region"),
                    "reference_word_range": [ref_start, ref_end],
                    "hypothesis_word_range": [hyp_start, hyp_end],
                    "reference_context": " ".join(reference_tokens[ref_left:ref_right]),
                    "hypothesis_context": " ".join(hypothesis_tokens[hyp_left:hyp_right]),
                }
            )
        if truncated:
            break

    glossary_findings: list[dict[str, Any]] = []
    for term in reference.get("glossary_terms") or []:
        phrase = _words(term)
        if not phrase:
            continue
        reference_occurrences = 0
        hypothesis_occurrences = 0
        correct = 0
        for number in track_numbers:
            reference_count = _count_phrase(
                _words(reference_by_track.get(number, {}).get("text", "")),
                phrase,
            )
            hypothesis_count = _count_phrase(
                _words(_track_text(document, number)),
                phrase,
            )
            reference_occurrences += reference_count
            hypothesis_occurrences += hypothesis_count
            correct += min(reference_count, hypothesis_count)
        if reference_occurrences <= 0:
            continue
        if correct == reference_occurrences and hypothesis_occurrences == reference_occurrences:
            continue
        glossary_findings.append(
            {
                "term": term,
                "reference_occurrences": reference_occurrences,
                "hypothesis_occurrences": hypothesis_occurrences,
                "correct_occurrences": correct,
                "missed_occurrences": max(reference_occurrences - hypothesis_occurrences, 0),
                "extra_occurrences": max(hypothesis_occurrences - reference_occurrences, 0),
            }
        )

    return {
        "schema_version": "tda_benchmark_quality_inspection_v1",
        "benchmark_id": benchmark_id,
        "profile_id": profile_id,
        "reference_revision": reference["revision"],
        "reference_sha256": reference["canonical_payload_sha256"],
        "normalization_policy": normalization_policy(),
        "private_text": True,
        "regions": regions,
        "truncated": truncated,
        "glossary_findings": glossary_findings,
    }


def score_all_profiles(
    data_root: Path,
    *,
    benchmark_id: str,
) -> dict[str, Any]:
    reference = active_reference(data_root, benchmark_id=benchmark_id)
    status = reference_status(data_root, benchmark_id=benchmark_id)
    if reference is None:
        return {
            "schema_version": "tda_benchmark_quality_summary_v1",
            "benchmark_id": benchmark_id,
            "reference": status,
            "quality_measured": False,
            "profiles": [],
            "winner": None,
            "composite_score": None,
        }
    profiles = [
        score_profile(
            data_root,
            benchmark_id=benchmark_id,
            profile_id=profile_id,
            reference=reference,
        )
        for profile_id in BENCHMARK_PROFILES
    ]
    return {
        "schema_version": "tda_benchmark_quality_summary_v1",
        "benchmark_id": benchmark_id,
        "reference": status,
        "quality_measured": True,
        "profiles": profiles,
        "winner": None,
        "composite_score": None,
    }
