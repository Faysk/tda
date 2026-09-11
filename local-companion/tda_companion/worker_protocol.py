from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

PROTOCOL_VERSION = "tda_worker_v1"
MAX_LINE_BYTES = 64 * 1024
JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
OUTPUT_TYPES = frozenset({"ready", "heartbeat", "stage", "progress", "event", "result", "cancelled", "error"})


class WorkerProtocolError(ValueError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _validate_job_id(value: Any) -> str:
    if not isinstance(value, str) or not JOB_ID_PATTERN.fullmatch(value):
        raise WorkerProtocolError("WORKER_JOB_ID_INVALID")
    return value


def _validate_attempt(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 1_000_000:
        raise WorkerProtocolError("WORKER_ATTEMPT_INVALID")
    return value


def _validate_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise WorkerProtocolError("WORKER_PAYLOAD_INVALID")
    return value


def _decode_json_line(line: str | bytes) -> dict[str, Any]:
    raw = line.encode("utf-8") if isinstance(line, str) else bytes(line)
    if not raw or len(raw) > MAX_LINE_BYTES:
        raise WorkerProtocolError("WORKER_LINE_SIZE_INVALID")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkerProtocolError("WORKER_JSON_INVALID") from exc
    if not isinstance(value, dict):
        raise WorkerProtocolError("WORKER_OBJECT_REQUIRED")
    return value


def _encode(value: dict[str, Any]) -> str:
    try:
        line = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise WorkerProtocolError("WORKER_JSON_ENCODE_FAILED") from exc
    if len(line.encode("utf-8")) > MAX_LINE_BYTES:
        raise WorkerProtocolError("WORKER_LINE_TOO_LARGE")
    return line + "\n"


@dataclass(frozen=True)
class WorkerRunCommand:
    job_id: str
    attempt: int
    kind: str
    payload: dict[str, Any]

    def encode(self) -> str:
        _validate_job_id(self.job_id)
        _validate_attempt(self.attempt)
        if self.kind != "synthetic.fixture":
            raise WorkerProtocolError("WORKER_KIND_UNSUPPORTED")
        _validate_payload(self.payload)
        return _encode(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "run",
                "job_id": self.job_id,
                "attempt": self.attempt,
                "kind": self.kind,
                "payload": self.payload,
            }
        )

    @classmethod
    def decode(cls, line: str | bytes) -> "WorkerRunCommand":
        value = _decode_json_line(line)
        if value.get("protocol") != PROTOCOL_VERSION or value.get("type") != "run":
            raise WorkerProtocolError("WORKER_COMMAND_INVALID")
        kind = value.get("kind")
        if kind != "synthetic.fixture":
            raise WorkerProtocolError("WORKER_KIND_UNSUPPORTED")
        payload = _validate_payload(value.get("payload"))
        units = payload.get("units")
        completed = payload.get("completed", 0)
        if isinstance(units, bool) or not isinstance(units, int) or not 1 <= units <= 100:
            raise WorkerProtocolError("WORKER_UNITS_INVALID")
        if isinstance(completed, bool) or not isinstance(completed, int) or not 0 <= completed <= units:
            raise WorkerProtocolError("WORKER_COMPLETED_INVALID")
        return cls(
            job_id=_validate_job_id(value.get("job_id")),
            attempt=_validate_attempt(value.get("attempt")),
            kind=kind,
            payload={"units": units, "completed": completed},
        )


@dataclass(frozen=True)
class WorkerCancelCommand:
    job_id: str
    attempt: int

    def encode(self) -> str:
        return _encode(
            {
                "protocol": PROTOCOL_VERSION,
                "type": "cancel",
                "job_id": _validate_job_id(self.job_id),
                "attempt": _validate_attempt(self.attempt),
            }
        )

    @classmethod
    def decode(cls, line: str | bytes) -> "WorkerCancelCommand":
        value = _decode_json_line(line)
        if value.get("protocol") != PROTOCOL_VERSION or value.get("type") != "cancel":
            raise WorkerProtocolError("WORKER_CANCEL_INVALID")
        return cls(
            job_id=_validate_job_id(value.get("job_id")),
            attempt=_validate_attempt(value.get("attempt")),
        )


@dataclass(frozen=True)
class WorkerMessage:
    job_id: str
    attempt: int
    seq: int
    type: str
    payload: dict[str, Any]
    at: str

    @classmethod
    def create(
        cls,
        *,
        job_id: str,
        attempt: int,
        seq: int,
        type: str,
        payload: dict[str, Any] | None = None,
    ) -> "WorkerMessage":
        return cls(
            job_id=_validate_job_id(job_id),
            attempt=_validate_attempt(attempt),
            seq=seq,
            type=type,
            payload=payload or {},
            at=_utc_now(),
        )

    def validate(self) -> None:
        _validate_job_id(self.job_id)
        _validate_attempt(self.attempt)
        if isinstance(self.seq, bool) or not isinstance(self.seq, int) or self.seq < 0:
            raise WorkerProtocolError("WORKER_SEQUENCE_INVALID")
        if self.type not in OUTPUT_TYPES:
            raise WorkerProtocolError("WORKER_MESSAGE_TYPE_INVALID")
        if not isinstance(self.at, str) or not self.at or len(self.at) > 128:
            raise WorkerProtocolError("WORKER_TIMESTAMP_INVALID")
        _validate_payload(self.payload)
        if self.type == "progress":
            completed = self.payload.get("completed")
            total = self.payload.get("total")
            if any(isinstance(value, bool) or not isinstance(value, int) for value in (completed, total)):
                raise WorkerProtocolError("WORKER_PROGRESS_INVALID")
            if total < 1 or completed < 0 or completed > total:
                raise WorkerProtocolError("WORKER_PROGRESS_RANGE")
        if self.type == "error":
            code = self.payload.get("code")
            if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,96}", code):
                raise WorkerProtocolError("WORKER_ERROR_CODE_INVALID")

    def encode(self) -> str:
        self.validate()
        return _encode(
            {
                "protocol": PROTOCOL_VERSION,
                "job_id": self.job_id,
                "attempt": self.attempt,
                "seq": self.seq,
                "at": self.at,
                "type": self.type,
                "payload": self.payload,
            }
        )

    @classmethod
    def decode(
        cls,
        line: str | bytes,
        *,
        expected_job_id: str | None = None,
        expected_attempt: int | None = None,
        previous_seq: int | None = None,
    ) -> "WorkerMessage":
        value = _decode_json_line(line)
        if value.get("protocol") != PROTOCOL_VERSION:
            raise WorkerProtocolError("WORKER_PROTOCOL_UNSUPPORTED")
        result = cls(
            job_id=_validate_job_id(value.get("job_id")),
            attempt=_validate_attempt(value.get("attempt")),
            seq=value.get("seq"),
            type=value.get("type"),
            payload=_validate_payload(value.get("payload")),
            at=value.get("at"),
        )
        result.validate()
        if expected_job_id is not None and result.job_id != expected_job_id:
            raise WorkerProtocolError("WORKER_JOB_MISMATCH")
        if expected_attempt is not None and result.attempt != expected_attempt:
            raise WorkerProtocolError("WORKER_ATTEMPT_MISMATCH")
        if previous_seq is not None and result.seq <= previous_seq:
            raise WorkerProtocolError("WORKER_SEQUENCE_REPLAY")
        return result
