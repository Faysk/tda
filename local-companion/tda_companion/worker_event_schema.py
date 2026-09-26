from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Callable, TypeAlias

Scalar: TypeAlias = str | int | float | bool | None
Validator: TypeAlias = Callable[[object], Scalar | object]

_INVALID = object()
_TECHNICAL_TEXT = re.compile(r"^[A-Za-z0-9_.:+/@-]+$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


@dataclass(frozen=True)
class SanitizedWorkerEvent:
    code: str
    data: dict[str, Scalar]
    schema_drift: bool
    dropped_fields: int


def _free_text(maximum: int) -> Validator:
    def validate(value: object) -> Scalar | object:
        if not isinstance(value, str):
            return _INVALID
        text = value.strip()
        if (
            not text
            or len(text) > maximum
            or "\0" in text
            or any(ord(char) < 32 or ord(char) == 127 for char in text)
            or any(0xD800 <= ord(char) <= 0xDFFF for char in text)
        ):
            return _INVALID
        return text

    return validate


def _technical_text(maximum: int = 160) -> Validator:
    free = _free_text(maximum)

    def validate(value: object) -> Scalar | object:
        text = free(value)
        if not isinstance(text, str) or _TECHNICAL_TEXT.fullmatch(text) is None:
            return _INVALID
        return text

    return validate


def _sha256(value: object) -> Scalar | object:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        return _INVALID
    return value.lower()


def _integer(*, minimum: int = 0, maximum: int = 2**63 - 1) -> Validator:
    def validate(value: object) -> Scalar | object:
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < minimum
            or value > maximum
        ):
            return _INVALID
        return value

    return validate


def _finite_number(
    *,
    minimum: float = 0.0,
    maximum: float = 1_000_000_000.0,
) -> Validator:
    def validate(value: object) -> Scalar | object:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return _INVALID
        result = float(value)
        if not math.isfinite(result) or result < minimum or result > maximum:
            return _INVALID
        return result

    return validate


def _boolean(value: object) -> Scalar | object:
    return value if isinstance(value, bool) else _INVALID


TOKEN = _technical_text()
SPEAKER = _free_text(160)
INT = _integer()
POSITIVE_INT = _integer(minimum=1)
DURATION_MS = _finite_number(maximum=86_400_000.0)
SECONDS = _finite_number(maximum=10_000_000.0)
PERCENT = _finite_number(maximum=100.0)

TRACK_FIELDS: dict[str, Validator] = {
    "stage": TOKEN,
    "track": POSITIVE_INT,
    "total_tracks": POSITIVE_INT,
    "speaker": SPEAKER,
}
ACTIVITY_FIELDS: dict[str, Validator] = {
    **TRACK_FIELDS,
    "window": POSITIVE_INT,
    "segment": POSITIVE_INT,
}
RUNTIME_FIELDS: dict[str, Validator] = {
    "stage": TOKEN,
    "runtime_version": TOKEN,
    "worker_sha256": _sha256,
    "duration_ms": DURATION_MS,
}
MODEL_FIELDS: dict[str, Validator] = {
    "stage": TOKEN,
    "device": TOKEN,
    "compute_type": TOKEN,
    "duration_ms": DURATION_MS,
    "preloaded": _boolean,
    "memory_error": _boolean,
}
ALIGNMENT_FAILURE_FIELDS: dict[str, Validator] = {
    "stage": TOKEN,
    "track": POSITIVE_INT,
    "window": POSITIVE_INT,
    "failure_class": TOKEN,
    "window_start_seconds": SECONDS,
    "window_end_seconds": SECONDS,
    "ownership_left_seconds": SECONDS,
    "ownership_right_seconds": SECONDS,
    "first_window": _boolean,
    "last_window": _boolean,
    "runtime_version": TOKEN,
    "worker_sha256": _sha256,
    "aligned_item": INT,
    "relative_start_seconds": SECONDS,
    "relative_end_seconds": SECONDS,
    "overflow_seconds": SECONDS,
    "previous_end_seconds": SECONDS,
    "aligned_word_count": INT,
    "owned_word_count": INT,
}


def _schema(*fields: tuple[str, Validator]) -> dict[str, Validator]:
    return dict(fields)


_SCHEMAS: dict[str, dict[str, Validator]] = {
    "QWEN_WINDOW_TRANSCRIBED": {
        **ACTIVITY_FIELDS,
    },
    "WHISPER_SEGMENT_TRANSCRIBED": {
        **ACTIVITY_FIELDS,
    },
    "MODEL_DOWNLOAD_PROGRESS": {
        "stage": TOKEN,
        "profile": TOKEN,
        "profile_id": TOKEN,
        "reason": TOKEN,
        "downloaded_bytes": INT,
        "total_bytes": INT,
    },
    "TRACK_STARTED": TRACK_FIELDS,
    "TRACK_ALIGNMENT_STARTED": TRACK_FIELDS,
    "TRACK_ENERGY_STARTED": TRACK_FIELDS,
    "TRACK_COMPLETED": TRACK_FIELDS,
    "ASR_CHECKPOINT_REUSED": {
        **TRACK_FIELDS,
    },
    "ASR_CHECKPOINT_SAVED": {
        **TRACK_FIELDS,
    },
    "ASR_CHECKPOINT_WRITE_SKIPPED": {
        **TRACK_FIELDS,
    },
    "ASR_TEXT_CHECKPOINT_SAVED": {
        **TRACK_FIELDS,
    },
    "ASR_TEXT_CHECKPOINT_WRITE_SKIPPED": {
        **TRACK_FIELDS,
    },
    "ASR_TEXT_CHECKPOINT_REUSED": {
        **TRACK_FIELDS,
    },
    "ASR_TEXT_CHECKPOINT_COMPAT_REUSED": {
        **TRACK_FIELDS,
        "source_runtime_version": TOKEN,
        "source_signature_sha256": _sha256,
    },
    "ASR_CHECKPOINT_FAST_PATH": {
        "stage": TOKEN,
        "total_tracks": POSITIVE_INT,
        "compute_type": TOKEN,
    },
    "ASR_CHECKPOINT_SCAN_COMPLETED": {
        "stage": TOKEN,
        "track_count": INT,
        "aligned_reused": INT,
        "text_reused": INT,
        "text_compat_reused": INT,
        "pending_asr": INT,
        "duration_ms": DURATION_MS,
    },
    "QWEN_RUNTIME_FINGERPRINT_READY": RUNTIME_FIELDS,
    "QWEN_ALIGNMENT_WINDOW_FAILED": ALIGNMENT_FAILURE_FIELDS,
    "QWEN_ALIGNMENT_TRAILING_OVERFLOW_IGNORED": {
        "stage": TOKEN,
        "track": POSITIVE_INT,
        "window": POSITIVE_INT,
        "count": POSITIVE_INT,
    },
    "QWEN_ALIGNMENT_WINDOW_RECOVERY_STARTED": {
        "stage": TOKEN,
        "track": POSITIVE_INT,
        "window": POSITIVE_INT,
        "failure_class": TOKEN,
        "context_seconds": SECONDS,
    },
    "QWEN_ALIGNMENT_WINDOW_RECOVERED": {
        "stage": TOKEN,
        "track": POSITIVE_INT,
        "window": POSITIVE_INT,
        "context_seconds": SECONDS,
    },
    "QWEN_ALIGNMENT_WINDOW_RECOVERY_FAILED": {
        "stage": TOKEN,
        "track": POSITIVE_INT,
        "window": POSITIVE_INT,
        "failure_class": TOKEN,
        "context_seconds": SECONDS,
    },
    "QWEN_ALIGNMENT_FALLBACK": {
        "stage": TOKEN,
        "track": POSITIVE_INT,
        "window": POSITIVE_INT,
    },
    "WHISPER_RUNTIME_IMPORT_STARTED": {
        "stage": TOKEN,
        "preloaded": _boolean,
    },
    "WHISPER_RUNTIME_IMPORT_READY": {
        "stage": TOKEN,
        "preloaded": _boolean,
        "duration_ms": DURATION_MS,
    },
    "WHISPER_MODEL_CONSTRUCT_STARTED": MODEL_FIELDS,
    "WHISPER_MODEL_CONSTRUCT_READY": MODEL_FIELDS,
    "WHISPER_MODEL_CONSTRUCT_FAILED": MODEL_FIELDS,
    "WHISPER_MODEL_FALLBACK_STARTED": MODEL_FIELDS,
    "WHISPER_MODEL_FALLBACK_READY": MODEL_FIELDS,
    "WHISPER_MODEL_FALLBACK_FAILED": MODEL_FIELDS,
    "INCOMPLETE_RUNS_CLEANED": {
        "stage": TOKEN,
        "count": INT,
    },
    "SOURCE_VALIDATED": {
        "stage": TOKEN,
        "track_count": INT,
    },
    "RUN_COMMIT_FENCE_WON": {
        "stage": TOKEN,
        "attempt": POSITIVE_INT,
    },
    "COMPATIBILITY_MIRROR_WRITE_FAILED": {
        "stage": TOKEN,
        "reason": TOKEN,
    },
    "COMPATIBILITY_MIRROR_LEGACY_PRESERVED": {
        "stage": TOKEN,
        "reason": TOKEN,
    },
}


def sanitize_worker_event(payload: object) -> SanitizedWorkerEvent:
    if not isinstance(payload, dict):
        return SanitizedWorkerEvent(
            code="WORKER_EVENT_UNRECOGNIZED",
            data={},
            schema_drift=True,
            dropped_fields=1,
        )

    raw_code = payload.get("code")
    schema = _SCHEMAS.get(raw_code) if isinstance(raw_code, str) else None
    if schema is None:
        return SanitizedWorkerEvent(
            code="WORKER_EVENT_UNRECOGNIZED",
            data={},
            schema_drift=True,
            dropped_fields=max(1, len(payload) - (1 if "code" in payload else 0)),
        )

    data: dict[str, Scalar] = {}
    dropped = 0
    for key, value in payload.items():
        if key == "code":
            continue
        validator = schema.get(key)
        if validator is None:
            dropped += 1
            continue
        clean = validator(value)
        if clean is _INVALID:
            dropped += 1
            continue
        data[key] = clean  # type: ignore[assignment]

    return SanitizedWorkerEvent(
        code=raw_code,
        data=data,
        schema_drift=dropped > 0,
        dropped_fields=dropped,
    )
