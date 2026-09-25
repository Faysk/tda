from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .transcription_runs import TranscriptionRunError, load_run, run_root

REVIEW_SCHEMA_VERSION = "tda_local_review_draft_v1"
REVIEW_RESPONSE_SCHEMA_VERSION = "tda_local_review_v1"
REVIEW_LIST_SUMMARY_SCHEMA_VERSION = "tda_local_review_summary_v1"

_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,196}$")
_SOURCE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_ALLOWED_STATUS = frozenset({"draft", "reviewed", "approved_local"})
_MAX_DRAFT_BYTES = 32 * 1024 * 1024
_MAX_SEGMENTS = 100_000

_LOCKS: dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


class LocalReviewError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _lock_for(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _LOCKS_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[key] = lock
        return lock


def _atomic_json(path: Path, value: dict[str, Any]) -> bytes:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(payload) <= 0 or len(payload) > _MAX_DRAFT_BYTES:
        raise LocalReviewError("LOCAL_REVIEW_DRAFT_TOO_LARGE")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.partial")
    try:
        with temporary.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        return payload
    finally:
        temporary.unlink(missing_ok=True)


def _review_path(package_root: Path, run_id: str) -> Path:
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        raise LocalReviewError("LOCAL_REVIEW_RUN_ID_INVALID")
    package = package_root.resolve()
    revisions = (package / "revisions").resolve()
    if revisions.parent != package:
        raise LocalReviewError("LOCAL_REVIEW_ROOT_INVALID")
    directory = (revisions / run_id).resolve()
    if directory.parent != revisions:
        raise LocalReviewError("LOCAL_REVIEW_PATH_INVALID")
    return directory / "draft.json"


def _bounded_json(path: Path) -> tuple[dict[str, Any], bytes]:
    if path.is_symlink():
        raise LocalReviewError("LOCAL_REVIEW_DRAFT_SYMLINK")
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise LocalReviewError("LOCAL_REVIEW_DRAFT_MISSING") from exc
    if size <= 0 or size > _MAX_DRAFT_BYTES:
        raise LocalReviewError("LOCAL_REVIEW_DRAFT_SIZE_INVALID")
    try:
        payload = path.read_bytes()
        value = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LocalReviewError("LOCAL_REVIEW_DRAFT_INVALID") from exc
    if not isinstance(value, dict):
        raise LocalReviewError("LOCAL_REVIEW_DRAFT_INVALID")
    return value, payload


def review_listing_summary(
    package_root: Path,
    *,
    source_id: str,
    run_id: str,
    transcript_sha256: str,
) -> dict[str, Any] | None:
    """Return sanitized draft metadata without opening or creating a review."""

    path = _review_path(package_root, run_id)
    if not path.exists() and not path.is_symlink():
        return None
    try:
        draft, _payload = _bounded_json(path)
    except LocalReviewError:
        return {
            "schema_version": REVIEW_LIST_SUMMARY_SCHEMA_VERSION,
            "status": "invalid",
            "draft_revision": None,
            "updated_at": None,
        }

    revision = draft.get("draft_revision")
    status = draft.get("status")
    updated_at = draft.get("updated_at")
    valid_updated = False
    if isinstance(updated_at, str) and 0 < len(updated_at) <= 64:
        try:
            datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
            valid_updated = True
        except ValueError:
            valid_updated = False

    if (
        draft.get("schema_version") != REVIEW_SCHEMA_VERSION
        or draft.get("source_id") != source_id
        or draft.get("run_id") != run_id
        or draft.get("base_transcript_sha256") != transcript_sha256
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 0
        or status not in _ALLOWED_STATUS
        or not valid_updated
    ):
        return {
            "schema_version": REVIEW_LIST_SUMMARY_SCHEMA_VERSION,
            "status": "invalid",
            "draft_revision": None,
            "updated_at": None,
        }

    return {
        "schema_version": REVIEW_LIST_SUMMARY_SCHEMA_VERSION,
        "status": status,
        "draft_revision": revision,
        "updated_at": updated_at,
    }


def _load_base(package_root: Path, source_id: str, run_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if not isinstance(source_id, str) or not _SOURCE_ID.fullmatch(source_id):
        raise LocalReviewError("LOCAL_REVIEW_SOURCE_ID_INVALID")
    if package_root.resolve().name != source_id:
        raise LocalReviewError("LOCAL_REVIEW_SOURCE_MISMATCH")
    try:
        manifest = load_run(package_root, run_id, verify_content=True)
    except TranscriptionRunError as exc:
        raise LocalReviewError("LOCAL_REVIEW_BASE_RUN_INVALID") from exc
    transcript_path = run_root(package_root, run_id) / "transcript.json"
    try:
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LocalReviewError("LOCAL_REVIEW_BASE_TRANSCRIPT_INVALID") from exc
    if not isinstance(transcript, dict) or transcript.get("schema_version") != "tda_transcript_v1":
        raise LocalReviewError("LOCAL_REVIEW_BASE_TRANSCRIPT_INVALID")
    if transcript.get("source_sha256") != manifest.get("source_sha256"):
        raise LocalReviewError("LOCAL_REVIEW_BASE_TRANSCRIPT_MISMATCH")
    return manifest, transcript


def _base_segments(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    tracks = transcript.get("tracks")
    if not isinstance(tracks, list):
        raise LocalReviewError("LOCAL_REVIEW_BASE_TRACKS_INVALID")
    segments: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for track in tracks:
        if not isinstance(track, dict):
            raise LocalReviewError("LOCAL_REVIEW_BASE_TRACK_INVALID")
        number = track.get("number")
        speaker = track.get("speaker")
        raw_segments = track.get("segments")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1:
            raise LocalReviewError("LOCAL_REVIEW_BASE_TRACK_INVALID")
        if not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 160:
            raise LocalReviewError("LOCAL_REVIEW_BASE_TRACK_INVALID")
        if not isinstance(raw_segments, list):
            raise LocalReviewError("LOCAL_REVIEW_BASE_SEGMENTS_INVALID")
        for segment in raw_segments:
            if not isinstance(segment, dict):
                raise LocalReviewError("LOCAL_REVIEW_BASE_SEGMENT_INVALID")
            segment_id = segment.get("id")
            start = segment.get("start")
            end = segment.get("end")
            text = segment.get("text")
            if (
                not isinstance(segment_id, str)
                or not segment_id
                or len(segment_id) > 256
                or isinstance(start, bool)
                or isinstance(end, bool)
                or not isinstance(start, (int, float))
                or not isinstance(end, (int, float))
                or float(end) < float(start)
                or not isinstance(text, str)
                or not text.strip()
                or len(text) > 100_000
            ):
                raise LocalReviewError("LOCAL_REVIEW_BASE_SEGMENT_INVALID")
            key = (number, segment_id)
            if key in seen:
                raise LocalReviewError("LOCAL_REVIEW_BASE_SEGMENT_DUPLICATE")
            seen.add(key)
            segments.append(
                {
                    "track_number": number,
                    "segment_id": segment_id,
                    "start": float(start),
                    "end": float(end),
                    "text": text,
                    "speaker": speaker,
                    "reviewed": False,
                }
            )
            if len(segments) > _MAX_SEGMENTS:
                raise LocalReviewError("LOCAL_REVIEW_SEGMENT_LIMIT")
    return segments


def _warnings(transcript: dict[str, Any]) -> list[str]:
    raw = transcript.get("warnings", [])
    if not isinstance(raw, list):
        return []
    values: list[str] = []
    for value in raw:
        if isinstance(value, str) and value and len(value) <= 1024:
            values.append(value)
    return values[:1000]


def _validate_segment_payload(
    candidate: Any,
    base: dict[tuple[int, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    if not isinstance(candidate, list) or len(candidate) != len(base):
        raise LocalReviewError("LOCAL_REVIEW_SEGMENTS_INVALID")
    values: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for raw in candidate:
        if not isinstance(raw, dict):
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_INVALID")
        number = raw.get("track_number")
        segment_id = raw.get("segment_id")
        text = raw.get("text")
        speaker = raw.get("speaker")
        reviewed = raw.get("reviewed")
        if isinstance(number, bool) or not isinstance(number, int):
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_INVALID")
        if not isinstance(segment_id, str):
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_INVALID")
        key = (number, segment_id)
        original = base.get(key)
        if original is None or key in seen:
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_IDENTITY_MISMATCH")
        seen.add(key)
        if raw.get("start") != original["start"] or raw.get("end") != original["end"]:
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_TIMING_IMMUTABLE")
        if not isinstance(text, str) or not text.strip() or len(text) > 100_000:
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_TEXT_INVALID")
        if not isinstance(speaker, str) or not speaker.strip() or len(speaker) > 160:
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_SPEAKER_INVALID")
        if not isinstance(reviewed, bool):
            raise LocalReviewError("LOCAL_REVIEW_SEGMENT_REVIEWED_INVALID")
        values.append(
            {
                "track_number": number,
                "segment_id": segment_id,
                "start": original["start"],
                "end": original["end"],
                "text": text,
                "speaker": speaker,
                "reviewed": reviewed,
            }
        )
    if seen != set(base):
        raise LocalReviewError("LOCAL_REVIEW_SEGMENT_IDENTITY_MISMATCH")
    return values


def _summary(segments: list[dict[str, Any]], base_segments: list[dict[str, Any]], warnings: list[str]) -> dict[str, Any]:
    base = {
        (item["track_number"], item["segment_id"]): item
        for item in base_segments
    }
    reviewed = sum(1 for item in segments if item["reviewed"])
    edited = 0
    word_count = 0
    for item in segments:
        original = base[(item["track_number"], item["segment_id"])]
        if item["text"] != original["text"] or item["speaker"] != original["speaker"]:
            edited += 1
        word_count += len(item["text"].strip().split())
    total = len(segments)
    return {
        "reviewed_segments": reviewed,
        "total_segments": total,
        "review_percent": round((reviewed / total) * 100, 1) if total else 100.0,
        "edited_segments": edited,
        "word_count": word_count,
        "warning_count": len(warnings),
    }


def _response(
    draft: dict[str, Any],
    payload: bytes,
    *,
    manifest: dict[str, Any],
    base_segments: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    segments = draft.get("segments")
    if not isinstance(segments, list):
        raise LocalReviewError("LOCAL_REVIEW_DRAFT_INVALID")
    stats = manifest.get("stats") if isinstance(manifest.get("stats"), dict) else {}
    return {
        "schema_version": REVIEW_RESPONSE_SCHEMA_VERSION,
        "source_id": draft["source_id"],
        "run_id": draft["run_id"],
        "base_transcript_sha256": draft["base_transcript_sha256"],
        "draft_revision": draft["draft_revision"],
        "draft_sha256": hashlib.sha256(payload).hexdigest(),
        "status": draft["status"],
        "created_at": draft["created_at"],
        "updated_at": draft["updated_at"],
        "lineage": {
            "profile_id": manifest.get("profile_id"),
            "engine": manifest.get("engine"),
            "model": manifest.get("model"),
            "model_revision": manifest.get("model_revision"),
            "device": manifest.get("device"),
            "compute_type": manifest.get("compute_type"),
            "alignment": manifest.get("alignment"),
            "completed_at": manifest.get("completed_at"),
            "execution_lineage": (
                manifest.get("execution_lineage")
                if isinstance(manifest.get("execution_lineage"), dict)
                else None
            ),
        },
        "stats": {
            "audio_work_seconds": stats.get("audio_work_seconds"),
            "processing_seconds": stats.get("processing_seconds"),
            "session_duration_seconds": stats.get("session_duration_seconds"),
            "rtf": stats.get("rtf"),
            "word_count": stats.get("word_count"),
            "segment_count": stats.get("segment_count"),
            "track_count": stats.get("track_count"),
        },
        "warnings": warnings,
        "review": _summary(segments, base_segments, warnings),
        "segments": segments,
        "sync": {"status": "not_configured"},
    }


def open_review(package_root: Path, *, source_id: str, run_id: str) -> dict[str, Any]:
    path = _review_path(package_root, run_id)
    with _lock_for(path):
        manifest, transcript = _load_base(package_root, source_id, run_id)
        base_segments = _base_segments(transcript)
        warnings = _warnings(transcript)
        if path.exists():
            draft, payload = _bounded_json(path)
            if (
                draft.get("schema_version") != REVIEW_SCHEMA_VERSION
                or draft.get("source_id") != source_id
                or draft.get("run_id") != run_id
                or draft.get("base_transcript_sha256") != manifest.get("transcript_sha256")
                or isinstance(draft.get("draft_revision"), bool)
                or not isinstance(draft.get("draft_revision"), int)
                or draft.get("draft_revision") < 0
                or draft.get("status") not in _ALLOWED_STATUS
            ):
                raise LocalReviewError("LOCAL_REVIEW_DRAFT_INVALID")
            base_map = {
                (item["track_number"], item["segment_id"]): item
                for item in base_segments
            }
            draft["segments"] = _validate_segment_payload(draft.get("segments"), base_map)
            return _response(
                draft,
                payload,
                manifest=manifest,
                base_segments=base_segments,
                warnings=warnings,
            )

        now = utc_now()
        draft = {
            "schema_version": REVIEW_SCHEMA_VERSION,
            "source_id": source_id,
            "run_id": run_id,
            "base_transcript_sha256": manifest["transcript_sha256"],
            "draft_revision": 0,
            "status": "draft",
            "created_at": now,
            "updated_at": now,
            "segments": base_segments,
        }
        payload = _atomic_json(path, draft)
        return _response(
            draft,
            payload,
            manifest=manifest,
            base_segments=base_segments,
            warnings=warnings,
        )


def save_review(
    package_root: Path,
    *,
    source_id: str,
    run_id: str,
    value: Any,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise LocalReviewError("LOCAL_REVIEW_REQUEST_INVALID")
    expected = value.get("expected_draft_revision")
    status = value.get("status")
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
        raise LocalReviewError("LOCAL_REVIEW_EXPECTED_REVISION_INVALID")
    if status not in _ALLOWED_STATUS:
        raise LocalReviewError("LOCAL_REVIEW_STATUS_INVALID")

    path = _review_path(package_root, run_id)
    with _lock_for(path):
        current = open_review(package_root, source_id=source_id, run_id=run_id)
        if current["draft_revision"] != expected:
            raise LocalReviewError("LOCAL_REVIEW_DRAFT_CONFLICT")

        manifest, transcript = _load_base(package_root, source_id, run_id)
        base_segments = _base_segments(transcript)
        base_map = {
            (item["track_number"], item["segment_id"]): item
            for item in base_segments
        }
        segments = _validate_segment_payload(value.get("segments"), base_map)
        now = utc_now()
        draft = {
            "schema_version": REVIEW_SCHEMA_VERSION,
            "source_id": source_id,
            "run_id": run_id,
            "base_transcript_sha256": manifest["transcript_sha256"],
            "draft_revision": expected + 1,
            "status": status,
            "created_at": current["created_at"],
            "updated_at": now,
            "segments": segments,
        }
        payload = _atomic_json(path, draft)
        return _response(
            draft,
            payload,
            manifest=manifest,
            base_segments=base_segments,
            warnings=_warnings(transcript),
        )
