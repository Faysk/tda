from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
from pathlib import Path
from typing import Any, Callable

from .atomic_storage import atomic_write
from .transcription_runs import (
    TranscriptionRunError,
    _atomic_bytes,
    _bounded_json,
    _bounded_transcript,
    _record_root_state,
    _root_fingerprint,
    _root_transcript_lock,
    list_runs,
    load_run,
    run_root,
    utc_now,
)

DELETE_SCHEMA_VERSION = "tda_local_run_delete_v1"
DELETE_RECEIPT_SCHEMA_VERSION = "tda_local_run_delete_receipt_v1"
_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,196}$")
_SOURCE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAX_TOMBSTONE_BYTES = 32 * 1024


class LocalRunDeleteError(RuntimeError):
    pass


def _junction(path: Path) -> bool:
    try:
        return bool(getattr(path, "is_junction", lambda: False)())
    except OSError:
        return True


def _safe_root(package_root: Path, name: str, *, create: bool) -> Path:
    package = package_root.resolve()
    raw = package / name
    if raw.exists() and (raw.is_symlink() or _junction(raw)):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_NAMESPACE_UNSAFE")
    if create:
        raw.mkdir(parents=True, exist_ok=True)
    resolved = raw.resolve()
    if resolved.parent != package:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_NAMESPACE_UNSAFE")
    return resolved


def _tombstone_path(package_root: Path, run_id: str, *, create_root: bool = False) -> Path:
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_RUN_ID_INVALID")
    root = _safe_root(package_root, ".run-deletions", create=create_root)
    path = root / f"{run_id}.json"
    if path.exists() and (path.is_symlink() or _junction(path)):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TOMBSTONE_UNSAFE")
    return path


def _trash_root(package_root: Path, run_id: str) -> Path:
    root = _safe_root(package_root, ".run-trash", create=True)
    path = root / run_id
    if path.exists() and (path.is_symlink() or _junction(path)):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TRASH_UNSAFE")
    path.mkdir(parents=True, exist_ok=True)
    resolved = path.resolve()
    if resolved.parent != root:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TRASH_UNSAFE")
    return resolved


def _bounded_tombstone(path: Path) -> dict[str, Any]:
    try:
        info = path.lstat()
    except FileNotFoundError as exc:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TOMBSTONE_MISSING") from exc
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= _MAX_TOMBSTONE_BYTES:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TOMBSTONE_INVALID")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TOMBSTONE_INVALID") from exc
    if not isinstance(value, dict):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TOMBSTONE_INVALID")
    return value


def _validate_tombstone(value: dict[str, Any], package_root: Path) -> dict[str, Any]:
    source_id = value.get("source_id")
    run_id = value.get("run_id")
    digest = value.get("transcript_sha256")
    if (
        value.get("schema_version") != DELETE_SCHEMA_VERSION
        or not isinstance(source_id, str)
        or not _SOURCE_ID.fullmatch(source_id)
        or source_id != package_root.resolve().name
        or not isinstance(run_id, str)
        or not _RUN_ID.fullmatch(run_id)
        or not isinstance(digest, str)
        or not _SHA256.fullmatch(digest)
        or not isinstance(value.get("deleted_at"), str)
        or not isinstance(value.get("review_existed"), bool)
    ):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_TOMBSTONE_INVALID")
    return value


def load_delete_tombstone(package_root: Path, run_id: str) -> dict[str, Any] | None:
    try:
        path = _tombstone_path(package_root, run_id)
    except LocalRunDeleteError:
        raise
    if not path.exists():
        return None
    return _validate_tombstone(_bounded_tombstone(path), package_root)


def run_deleted_local(
    package_root: Path,
    run_id: str,
    transcript_sha256: str | None = None,
) -> bool:
    try:
        tombstone = load_delete_tombstone(package_root, run_id)
    except LocalRunDeleteError:
        # A malformed deletion marker is never permission to expose a run.
        return True
    if tombstone is None:
        return False
    if transcript_sha256 is None:
        return True
    return tombstone.get("transcript_sha256") == transcript_sha256


def _write_tombstone(package_root: Path, manifest: dict[str, Any], *, review_existed: bool) -> dict[str, Any]:
    value = {
        "schema_version": DELETE_SCHEMA_VERSION,
        "source_id": manifest["source_id"],
        "run_id": manifest["run_id"],
        "transcript_sha256": manifest["transcript_sha256"],
        "job_id": manifest.get("job_id"),
        "attempt": manifest.get("attempt"),
        "origin": manifest.get("origin"),
        "review_existed": review_existed,
        "deleted_at": utc_now(),
    }
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    atomic_write(
        _tombstone_path(package_root, manifest["run_id"], create_root=True),
        payload,
    )
    return value


def _safe_revision_dir(package_root: Path, run_id: str) -> Path:
    package = package_root.resolve()
    revisions = package / "revisions"
    if revisions.exists() and (revisions.is_symlink() or _junction(revisions)):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_REVISION_UNSAFE")
    raw = revisions / run_id
    if raw.exists() and (raw.is_symlink() or _junction(raw)):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_REVISION_UNSAFE")
    if revisions.exists() and revisions.resolve().parent != package:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_REVISION_UNSAFE")
    return raw


def _safe_run_dir(package_root: Path, run_id: str) -> Path:
    package = package_root.resolve()
    runs = package / "runs"
    raw = runs / run_id
    if runs.exists() and (runs.is_symlink() or _junction(runs)):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_RUN_UNSAFE")
    if raw.exists() and (raw.is_symlink() or _junction(raw)):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_RUN_UNSAFE")
    resolved = run_root(package_root, run_id)
    if resolved.parent != runs.resolve():
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_RUN_UNSAFE")
    return raw


def _root_state(package_root: Path) -> dict[str, Any] | None:
    path = package_root.resolve() / "root-transcript-state.json"
    try:
        value = _bounded_json(path)
    except TranscriptionRunError:
        return None
    if value.get("schema_version") != "tda_root_transcript_state_v1":
        return None
    try:
        fingerprint = _root_fingerprint(package_root)
    except OSError:
        return None
    if fingerprint is None or value.get("fingerprint") != fingerprint:
        return None
    return value


def _remaining_manifest(package_root: Path, deleted_run_id: str) -> dict[str, Any] | None:
    for summary in list_runs(package_root, verify_content=False):
        run_id = summary.get("run_id")
        digest = summary.get("transcript_sha256")
        if (
            not isinstance(run_id, str)
            or run_id == deleted_run_id
            or not isinstance(digest, str)
            or run_deleted_local(package_root, run_id, digest)
        ):
            continue
        try:
            return load_run(package_root, run_id, verify_content=True)
        except TranscriptionRunError:
            continue
    return None


def _reconcile_root_projection(package_root: Path, tombstone: dict[str, Any]) -> None:
    with _root_transcript_lock(package_root):
        state = _root_state(package_root)
        if (
            state is None
            or state.get("kind") not in {"compatibility_mirror", "legacy_preserved"}
            or state.get("run_id") != tombstone["run_id"]
            or state.get("transcript_sha256") != tombstone["transcript_sha256"]
        ):
            return

        target = package_root.resolve() / "transcript.json"
        if not target.exists() or target.is_symlink() or _junction(target):
            raise LocalRunDeleteError("LOCAL_RUN_DELETE_ROOT_UNSAFE")
        payload = _bounded_transcript(target)
        if hashlib.sha256(payload).hexdigest() != tombstone["transcript_sha256"]:
            raise LocalRunDeleteError("LOCAL_RUN_DELETE_ROOT_CHANGED")

        replacement = _remaining_manifest(package_root, tombstone["run_id"])
        if replacement is None:
            try:
                target.unlink()
            except OSError as exc:
                raise LocalRunDeleteError("LOCAL_RUN_DELETE_ROOT_UPDATE_FAILED") from exc
            return

        source = run_root(package_root, replacement["run_id"]) / "transcript.json"
        replacement_payload = _bounded_transcript(source)
        if hashlib.sha256(replacement_payload).hexdigest() != replacement["transcript_sha256"]:
            raise LocalRunDeleteError("LOCAL_RUN_DELETE_REPLACEMENT_INVALID")
        _atomic_bytes(target, replacement_payload)
        _record_root_state(package_root, "compatibility_mirror", replacement)


def _quarantine(path: Path, destination: Path) -> None:
    if not path.exists():
        return
    if path.is_symlink() or _junction(path):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_NAMESPACE_UNSAFE")
    if destination.exists():
        if destination.is_symlink() or _junction(destination):
            raise LocalRunDeleteError("LOCAL_RUN_DELETE_TRASH_UNSAFE")
        shutil.rmtree(destination)
    try:
        os.replace(path, destination)
    except OSError as exc:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_QUARANTINE_FAILED") from exc


def _finish_delete(
    package_root: Path,
    tombstone: dict[str, Any],
    *,
    mark_result_deleted: Callable[[str, str, str], object] | None = None,
) -> None:
    _reconcile_root_projection(package_root, tombstone)

    job_id = tombstone.get("job_id")
    if isinstance(job_id, str) and mark_result_deleted is not None:
        try:
            mark_result_deleted(
                job_id,
                tombstone["run_id"],
                tombstone["transcript_sha256"],
            )
        except Exception as exc:
            raise LocalRunDeleteError("LOCAL_RUN_DELETE_RESULT_STATE_FAILED") from exc

    run_dir = _safe_run_dir(package_root, tombstone["run_id"])
    review_dir = _safe_revision_dir(package_root, tombstone["run_id"])
    trash = _trash_root(package_root, tombstone["run_id"])
    _quarantine(run_dir, trash / "run")
    _quarantine(review_dir, trash / "review")
    try:
        shutil.rmtree(trash)
    except OSError:
        # Logical deletion is already fenced by the tombstone and quarantine.
        pass


def delete_completed_run(
    package_root: Path,
    *,
    source_id: str,
    run_id: str,
    transcript_sha256: str,
    mark_result_deleted: Callable[[str, str, str], object] | None = None,
) -> dict[str, Any]:
    if (
        not isinstance(source_id, str)
        or not _SOURCE_ID.fullmatch(source_id)
        or source_id != package_root.resolve().name
    ):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_SOURCE_INVALID")
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_RUN_ID_INVALID")
    if not isinstance(transcript_sha256, str) or not _SHA256.fullmatch(transcript_sha256):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_SHA_INVALID")

    existing = load_delete_tombstone(package_root, run_id)
    if existing is not None:
        if existing["transcript_sha256"] != transcript_sha256:
            raise LocalRunDeleteError("LOCAL_RUN_DELETE_STALE")
        _finish_delete(package_root, existing, mark_result_deleted=mark_result_deleted)
        return {
            "schema_version": DELETE_RECEIPT_SCHEMA_VERSION,
            "source_id": source_id,
            "run_id": run_id,
            "transcript_sha256": transcript_sha256,
            "deleted": True,
            "review_deleted": existing["review_existed"],
            "cloud_changed": False,
        }

    try:
        manifest = load_run(package_root, run_id, verify_content=True)
    except TranscriptionRunError as exc:
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_RUN_NOT_FOUND") from exc
    if (
        manifest.get("source_id") != source_id
        or manifest.get("transcript_sha256") != transcript_sha256
    ):
        raise LocalRunDeleteError("LOCAL_RUN_DELETE_STALE")

    _safe_run_dir(package_root, run_id)
    review_dir = _safe_revision_dir(package_root, run_id)
    review_existed = review_dir.exists()
    tombstone = _write_tombstone(package_root, manifest, review_existed=review_existed)
    _finish_delete(package_root, tombstone, mark_result_deleted=mark_result_deleted)
    return {
        "schema_version": DELETE_RECEIPT_SCHEMA_VERSION,
        "source_id": source_id,
        "run_id": run_id,
        "transcript_sha256": transcript_sha256,
        "deleted": True,
        "review_deleted": review_existed,
        "cloud_changed": False,
    }


def maintain_deleted_runs(
    data_root: Path,
    *,
    mark_result_deleted: Callable[[str, str, str], object] | None = None,
) -> dict[str, int]:
    counts = {"completed": 0, "failed": 0}
    staging = data_root.resolve() / "staging"
    if not staging.is_dir():
        return counts
    for package_root in staging.iterdir():
        if (
            not package_root.is_dir()
            or package_root.is_symlink()
            or _junction(package_root)
            or not _SOURCE_ID.fullmatch(package_root.name)
        ):
            continue
        tombstones = package_root / ".run-deletions"
        if not tombstones.is_dir() or tombstones.is_symlink() or _junction(tombstones):
            continue
        for path in tombstones.iterdir():
            if path.suffix != ".json" or not _RUN_ID.fullmatch(path.stem):
                continue
            try:
                value = _validate_tombstone(_bounded_tombstone(path), package_root)
                _finish_delete(package_root, value, mark_result_deleted=mark_result_deleted)
                counts["completed"] += 1
            except (OSError, LocalRunDeleteError, TranscriptionRunError):
                counts["failed"] += 1
    return counts
