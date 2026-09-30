from __future__ import annotations

import hashlib
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .atomic_storage import AtomicStorageError, atomic_write
from .review_text import count_words_v1, valid_review_string_v1
from .session_assemblies import (
    SessionAssemblyError,
    assembly_root,
    load_session_assembly_transcript,
)
from .session_timeline import classify_start_time

ASSEMBLY_REVIEW_SCHEMA_VERSION = "tda_session_assembly_review_draft_v1"
ASSEMBLY_REVIEW_RESPONSE_SCHEMA_VERSION = "tda_session_assembly_review_v1"
ASSEMBLY_REVIEW_APPROVAL_SCHEMA_VERSION = "tda_session_assembly_review_approval_v1"
ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT = "tda_session_assembly_review_cas_v1"
_MAX_BYTES = 64 * 1024 * 1024
_MAX_APPROVAL_BYTES = 8 * 1024
_MAX_SEGMENTS = 100_000
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_ALLOWED_STATUS = frozenset({"draft", "reviewed", "approved_local"})
_LOCKS: dict[str, threading.RLock] = {}
_LOCK_GUARD = threading.Lock()


class SessionAssemblyReviewError(RuntimeError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _lock_for(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _LOCK_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _LOCKS[key] = lock
        return lock


def _draft_path(data_root: Path, campaign_id: str, session_id: str, assembly_id: str) -> Path:
    return assembly_root(data_root, campaign_id, session_id, assembly_id) / "review" / "draft.json"


def _approval_path(path: Path) -> Path:
    return path.with_name("approval.json")


def _canonical(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _atomic_json(path: Path, value: dict[str, Any], maximum: int = _MAX_BYTES) -> bytes:
    payload = _canonical(value)
    if not 0 < len(payload) <= maximum:
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_TOO_LARGE")
    try:
        atomic_write(path, payload, storage_class="authoritative")
    except AtomicStorageError as exc:
        raise SessionAssemblyReviewError(
            "SESSION_ASSEMBLY_REVIEW_WRITE_UNCONFIRMED" if exc.ambiguous
            else "SESSION_ASSEMBLY_REVIEW_WRITE_FAILED"
        ) from exc
    return payload


def _read_json(path: Path, maximum: int, missing_code: str, invalid_code: str) -> tuple[dict[str, Any], bytes]:
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise SessionAssemblyReviewError(invalid_code)
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise SessionAssemblyReviewError(missing_code) from exc
    if not 0 < size <= maximum:
        raise SessionAssemblyReviewError(invalid_code)
    try:
        with path.open("rb") as handle:
            payload = handle.read(maximum + 1)
        if len(payload) != size:
            raise OSError("SHORT_READ")
        value = json.loads(payload.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SessionAssemblyReviewError(invalid_code) from exc
    if not isinstance(value, dict):
        raise SessionAssemblyReviewError(invalid_code)
    return value, payload


def _absolute_time_fields(segment: dict[str, Any]) -> dict[str, Any]:
    state = segment.get("absolute_time_state")
    start = segment.get("absolute_start")
    end = segment.get("absolute_end")
    source = segment.get("absolute_time_source")
    if state == "unavailable":
        if start is not None or end is not None or source is not None:
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_ABSOLUTE_TIME_INVALID")
        return {
            "absolute_start": None,
            "absolute_end": None,
            "absolute_time_state": "unavailable",
            "absolute_time_source": None,
        }
    if state != "trusted_absolute":
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_ABSOLUTE_TIME_INVALID")
    if (
        not isinstance(start, str)
        or not isinstance(end, str)
        or not isinstance(source, str)
        or not source
        or len(source) > 160
        or classify_start_time(start)["confidence"] != "trusted_absolute"
        or classify_start_time(end)["confidence"] != "trusted_absolute"
    ):
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_ABSOLUTE_TIME_INVALID")
    try:
        start_instant = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_instant = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_ABSOLUTE_TIME_INVALID") from exc
    if end_instant < start_instant:
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_ABSOLUTE_TIME_INVALID")
    return {
        "absolute_start": start,
        "absolute_end": end,
        "absolute_time_state": "trusted_absolute",
        "absolute_time_source": source,
    }


def _base_segments(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    raw = transcript.get("segments")
    if not isinstance(raw, list) or len(raw) > _MAX_SEGMENTS:
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_BASE_INVALID")
    values: list[dict[str, Any]] = []
    seen: set[str] = set()
    for segment in raw:
        if not isinstance(segment, dict):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_BASE_INVALID")
        segment_id = segment.get("assembly_segment_id")
        immutable = {
            key: segment.get(key)
            for key in (
                "part_id",
                "source_id",
                "run_id",
                "source_segment_id",
                "track_number",
                "participant_id",
                "start",
                "end",
            )
        }
        absolute_time = _absolute_time_fields(segment)
        text = segment.get("text")
        speaker = segment.get("speaker")
        if (
            not isinstance(segment_id, str)
            or _SHA256.fullmatch(segment_id) is None
            or segment_id in seen
            or not isinstance(text, str)
            or not valid_review_string_v1(text, "text")
            or not isinstance(speaker, str)
            or not valid_review_string_v1(speaker, "speaker")
        ):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_BASE_INVALID")
        seen.add(segment_id)
        values.append(
            {
                "assembly_segment_id": segment_id,
                **immutable,
                **absolute_time,
                "text": text,
                "speaker": speaker,
                "reviewed": False,
            }
        )
    return values


def _validate_segments(candidate: Any, base_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(candidate, list) or len(candidate) != len(base_segments):
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENTS_INVALID")
    base = {row["assembly_segment_id"]: row for row in base_segments}
    values: dict[str, dict[str, Any]] = {}
    immutable_fields = (
        "part_id",
        "source_id",
        "run_id",
        "source_segment_id",
        "track_number",
        "participant_id",
        "start",
        "end",
        "absolute_start",
        "absolute_end",
        "absolute_time_state",
        "absolute_time_source",
    )
    for raw in candidate:
        if not isinstance(raw, dict):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENT_INVALID")
        segment_id = raw.get("assembly_segment_id")
        original = base.get(segment_id)
        if original is None or segment_id in values:
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENT_IDENTITY_MISMATCH")
        if any(raw.get(field) != original[field] for field in immutable_fields):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENT_PROVENANCE_IMMUTABLE")
        text = raw.get("text")
        speaker = raw.get("speaker")
        reviewed = raw.get("reviewed")
        if not isinstance(text, str) or not valid_review_string_v1(text, "text"):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENT_TEXT_INVALID")
        if not isinstance(speaker, str) or not valid_review_string_v1(speaker, "speaker"):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENT_SPEAKER_INVALID")
        if not isinstance(reviewed, bool):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENT_REVIEWED_INVALID")
        values[segment_id] = {
            "assembly_segment_id": segment_id,
            **{field: original[field] for field in immutable_fields},
            "text": text,
            "speaker": speaker,
            "reviewed": reviewed,
        }
    if set(values) != set(base):
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SEGMENT_IDENTITY_MISMATCH")
    return [values[row["assembly_segment_id"]] for row in base_segments]


def _approval(path: Path, draft: dict[str, Any], payload: bytes) -> dict[str, Any] | None:
    approval_path = _approval_path(path)
    if not approval_path.is_file():
        return None
    try:
        value, _ = _read_json(
            approval_path,
            _MAX_APPROVAL_BYTES,
            "SESSION_ASSEMBLY_REVIEW_APPROVAL_MISSING",
            "SESSION_ASSEMBLY_REVIEW_APPROVAL_INVALID",
        )
    except SessionAssemblyReviewError:
        return None
    draft_sha = hashlib.sha256(payload).hexdigest()
    if (
        value.get("schema_version") != ASSEMBLY_REVIEW_APPROVAL_SCHEMA_VERSION
        or value.get("assembly_id") != draft.get("assembly_id")
        or value.get("base_transcript_sha256") != draft.get("base_transcript_sha256")
        or value.get("approved_draft_revision") != draft.get("draft_revision")
        or value.get("approved_draft_sha256") != draft_sha
        or not isinstance(value.get("approved_at"), str)
    ):
        return None
    return value


def _summary(segments: list[dict[str, Any]], base: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = {row["assembly_segment_id"]: row for row in base}
    reviewed = sum(1 for row in segments if row["reviewed"])
    edited = sum(
        1
        for row in segments
        if row["text"] != by_id[row["assembly_segment_id"]]["text"]
        or row["speaker"] != by_id[row["assembly_segment_id"]]["speaker"]
    )
    total = len(segments)
    return {
        "reviewed_segments": reviewed,
        "total_segments": total,
        "review_percent": round((reviewed / total) * 100, 1) if total else 100.0,
        "edited_segments": edited,
        "word_count": sum(count_words_v1(row["text"]) for row in segments),
    }


def _response(
    manifest: dict[str, Any],
    draft: dict[str, Any],
    payload: bytes | None,
    base_segments: list[dict[str, Any]],
    *,
    path: Path,
) -> dict[str, Any]:
    approval = _approval(path, draft, payload) if payload is not None else None
    stored = draft["status"]
    effective = (
        "approved_local"
        if approval is not None
        else "reviewed"
        if stored == "approved_local"
        else stored
    )
    return {
        "schema_version": ASSEMBLY_REVIEW_RESPONSE_SCHEMA_VERSION,
        "snapshot_contract": ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT,
        "persistence": "persisted" if payload is not None else "ephemeral_base",
        "base": {
            "kind": "session_assembly",
            "assembly_id": manifest["assembly_id"],
            "transcript_sha256": manifest["transcript_sha256"],
            "inputs_sha256": manifest["inputs_sha256"],
        },
        "draft_revision": draft["draft_revision"],
        "draft_sha256": hashlib.sha256(payload).hexdigest() if payload is not None else None,
        "status": effective,
        "approval_current": approval is not None,
        "approval_blocked": manifest.get("participant_approval_blocked") is True,
        "approved_at": approval.get("approved_at") if approval is not None else None,
        "created_at": draft["created_at"],
        "updated_at": draft["updated_at"],
        "review": _summary(draft["segments"], base_segments),
        "segments": draft["segments"],
    }


def _snapshot(
    data_root: Path,
    campaign_id: str,
    session_id: str,
    assembly_id: str,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    try:
        manifest, transcript = load_session_assembly_transcript(
            data_root,
            campaign_id,
            session_id,
            assembly_id,
        )
    except SessionAssemblyError as exc:
        raise SessionAssemblyReviewError(str(exc)) from exc
    return manifest, transcript, _base_segments(transcript)


def open_assembly_review(
    data_root: Path,
    campaign_id: str,
    session_id: str,
    assembly_id: str,
    *,
    base_only: bool = False,
) -> dict[str, Any]:
    path = _draft_path(data_root, campaign_id, session_id, assembly_id)
    with _lock_for(path):
        manifest, _transcript, base_segments = _snapshot(
            data_root, campaign_id, session_id, assembly_id
        )
        if not base_only and path.is_file():
            draft, payload = _read_json(
                path,
                _MAX_BYTES,
                "SESSION_ASSEMBLY_REVIEW_DRAFT_MISSING",
                "SESSION_ASSEMBLY_REVIEW_DRAFT_INVALID",
            )
            if (
                draft.get("schema_version") != ASSEMBLY_REVIEW_SCHEMA_VERSION
                or draft.get("assembly_id") != assembly_id
                or draft.get("base_transcript_sha256") != manifest["transcript_sha256"]
                or draft.get("status") not in _ALLOWED_STATUS
                or isinstance(draft.get("draft_revision"), bool)
                or not isinstance(draft.get("draft_revision"), int)
                or draft["draft_revision"] < 1
            ):
                raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_DRAFT_INVALID")
            draft["segments"] = _validate_segments(draft.get("segments"), base_segments)
            return _response(manifest, draft, payload, base_segments, path=path)
        draft = {
            "schema_version": ASSEMBLY_REVIEW_SCHEMA_VERSION,
            "assembly_id": assembly_id,
            "base_transcript_sha256": manifest["transcript_sha256"],
            "draft_revision": None,
            "status": "draft",
            "created_at": None,
            "updated_at": None,
            "segments": base_segments,
        }
        return _response(manifest, draft, None, base_segments, path=path)


def save_assembly_review(
    data_root: Path,
    campaign_id: str,
    session_id: str,
    assembly_id: str,
    value: Any,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_REQUEST_INVALID")
    if value.get("snapshot_contract") != ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT:
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_SNAPSHOT_CONTRACT_REQUIRED")
    expected = value.get("expected")
    status = value.get("status")
    if not isinstance(expected, dict) or status not in _ALLOWED_STATUS:
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_REQUEST_INVALID")
    absent = expected.get("persistence") == "ephemeral_base"
    if absent:
        valid_expected = (
            set(expected) == {"persistence", "base_transcript_sha256"}
            and isinstance(expected.get("base_transcript_sha256"), str)
            and _SHA256.fullmatch(expected["base_transcript_sha256"]) is not None
        )
    else:
        valid_expected = (
            set(expected) == {"persistence", "draft_revision", "draft_sha256"}
            and expected.get("persistence") == "persisted"
            and isinstance(expected.get("draft_revision"), int)
            and not isinstance(expected.get("draft_revision"), bool)
            and expected["draft_revision"] >= 1
            and isinstance(expected.get("draft_sha256"), str)
            and _SHA256.fullmatch(expected["draft_sha256"]) is not None
        )
    if not valid_expected:
        raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_EXPECTED_SNAPSHOT_INVALID")

    path = _draft_path(data_root, campaign_id, session_id, assembly_id)
    with _lock_for(path):
        manifest, _transcript, base_segments = _snapshot(
            data_root, campaign_id, session_id, assembly_id
        )
        current = open_assembly_review(
            data_root,
            campaign_id,
            session_id,
            assembly_id,
            base_only=False,
        )
        if (
            current["persistence"] != expected["persistence"]
            or (
                absent
                and current["base"]["transcript_sha256"]
                != expected["base_transcript_sha256"]
            )
            or (
                not absent
                and (
                    current["draft_revision"] != expected["draft_revision"]
                    or current["draft_sha256"] != expected["draft_sha256"]
                )
            )
        ):
            raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_DRAFT_CONFLICT")
        segments = _validate_segments(value.get("segments"), base_segments)
        current_segments = _validate_segments(current["segments"], base_segments)

        if status == "approved_local":
            if manifest.get("participant_approval_blocked") is True:
                raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_APPROVAL_BLOCKED")
            if absent or segments != current_segments:
                raise SessionAssemblyReviewError("SESSION_ASSEMBLY_REVIEW_APPROVAL_REQUIRES_SAVED_DRAFT")
            draft, draft_payload = _read_json(
                path,
                _MAX_BYTES,
                "SESSION_ASSEMBLY_REVIEW_DRAFT_MISSING",
                "SESSION_ASSEMBLY_REVIEW_DRAFT_INVALID",
            )
            approval = {
                "schema_version": ASSEMBLY_REVIEW_APPROVAL_SCHEMA_VERSION,
                "assembly_id": assembly_id,
                "base_transcript_sha256": manifest["transcript_sha256"],
                "approved_draft_revision": draft["draft_revision"],
                "approved_draft_sha256": hashlib.sha256(draft_payload).hexdigest(),
                "approved_at": _utc_now(),
            }
            _atomic_json(_approval_path(path), approval, _MAX_APPROVAL_BYTES)
            return _response(manifest, draft, draft_payload, base_segments, path=path)

        if not absent and status == current["status"] and segments == current_segments:
            return current
        now = _utc_now()
        draft = {
            "schema_version": ASSEMBLY_REVIEW_SCHEMA_VERSION,
            "assembly_id": assembly_id,
            "base_transcript_sha256": manifest["transcript_sha256"],
            "draft_revision": 1 if absent else expected["draft_revision"] + 1,
            "status": status,
            "created_at": now if absent else current["created_at"],
            "updated_at": now,
            "segments": segments,
        }
        payload = _atomic_json(path, draft)
        return _response(manifest, draft, payload, base_segments, path=path)
