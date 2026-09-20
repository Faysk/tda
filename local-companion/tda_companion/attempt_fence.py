from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Literal

AttemptOutcome = Literal["cancel", "commit"]

_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_MAX_ATTEMPT = 1_000_000
_MAX_FENCE_BYTES = 16
_FENCE_DIR = ".attempt-fences"


class AttemptFenceError(RuntimeError):
    pass


def _attempt_key(job_id: str, attempt: int) -> str:
    if not isinstance(job_id, str) or _JOB_ID.fullmatch(job_id) is None:
        raise AttemptFenceError("ATTEMPT_FENCE_JOB_ID_INVALID")
    if isinstance(attempt, bool) or not isinstance(attempt, int) or not 1 <= attempt <= _MAX_ATTEMPT:
        raise AttemptFenceError("ATTEMPT_FENCE_ATTEMPT_INVALID")
    return f"run-{job_id}-a{attempt}"


def _fence_path(package_root: Path, job_id: str, attempt: int) -> Path:
    package = package_root.resolve()
    root = package / _FENCE_DIR
    if root.is_symlink():
        raise AttemptFenceError("ATTEMPT_FENCE_PATH_SYMLINK")
    if root.exists() and not root.is_dir():
        raise AttemptFenceError("ATTEMPT_FENCE_PATH_INVALID")
    return root / f"{_attempt_key(job_id, attempt)}.decision"


def _read_fence(path: Path) -> AttemptOutcome:
    if path.is_symlink():
        raise AttemptFenceError("ATTEMPT_FENCE_PATH_SYMLINK")
    try:
        stat = path.stat()
    except OSError as exc:
        raise AttemptFenceError("ATTEMPT_FENCE_READ_FAILED") from exc
    if stat.st_size <= 0 or stat.st_size > _MAX_FENCE_BYTES:
        raise AttemptFenceError("ATTEMPT_FENCE_INVALID")
    try:
        value = path.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError) as exc:
        raise AttemptFenceError("ATTEMPT_FENCE_READ_FAILED") from exc
    if value not in {"cancel", "commit"}:
        raise AttemptFenceError("ATTEMPT_FENCE_INVALID")
    return value  # type: ignore[return-value]


def read_attempt_outcome(
    package_root: Path,
    job_id: str,
    attempt: int,
) -> AttemptOutcome | None:
    path = _fence_path(package_root, job_id, attempt)
    try:
        return _read_fence(path)
    except AttemptFenceError as exc:
        if exc.args and exc.args[0] == "ATTEMPT_FENCE_READ_FAILED" and not path.exists():
            return None
        raise


def claim_attempt_outcome(
    package_root: Path,
    job_id: str,
    attempt: int,
    decision: AttemptOutcome,
) -> AttemptOutcome:
    if decision not in {"cancel", "commit"}:
        raise AttemptFenceError("ATTEMPT_FENCE_DECISION_INVALID")

    path = _fence_path(package_root, job_id, attempt)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Re-evaluate after mkdir so a pre-existing symlink cannot redirect the
    # cross-process winner marker outside the staged Craig package.
    path = _fence_path(package_root, job_id, attempt)

    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        descriptor = os.open(path, flags, 0o600)
    except FileExistsError:
        return _read_fence(path)
    except OSError as exc:
        raise AttemptFenceError("ATTEMPT_FENCE_WRITE_FAILED") from exc

    payload = f"{decision}\n".encode("ascii")
    try:
        written = os.write(descriptor, payload)
        if written != len(payload):
            raise OSError("short fence write")
        os.fsync(descriptor)
    except OSError as exc:
        try:
            os.close(descriptor)
        finally:
            path.unlink(missing_ok=True)
        raise AttemptFenceError("ATTEMPT_FENCE_WRITE_FAILED") from exc
    else:
        os.close(descriptor)
    return decision
