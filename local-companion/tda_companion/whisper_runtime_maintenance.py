from __future__ import annotations

import json
from pathlib import Path

from .asr_runtime import (
    RUNTIME_SCHEMA,
    WHISPER_RUNTIME_ID,
    WHISPER_WORKER_EXE,
    _atomic_json,
    _valid_recovery_runtime_directory,
    _worker_metadata_sha256,
    install_whisper_runtime_archive,
    whisper_root,
    whisper_version_root,
)
from .asr_runtime_updates import download_whisper_runtime, fetch_whisper_runtime_manifest
from .installation_lock import InstallationLockError, whisper_runtime_maintenance_lock
from .runtime_compat import version_tuple, whisper_runtime_version_compatible


class WhisperRuntimeMaintenanceError(RuntimeError):
    pass


def _version(value: object) -> tuple[int, int, int]:
    if not isinstance(value, str):
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_VERSION_INVALID")
    try:
        return version_tuple(value)
    except ValueError as exc:
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_VERSION_INVALID") from exc


def _ready_current_version(runtime_root: Path) -> str:
    # Rollback inspection is deliberately read-only. The normal runtime inspector
    # may reseal benign metadata drift for an active runtime; recovery must not
    # mutate versioned evidence while deciding whether it is safe to switch.
    parent = whisper_root(runtime_root)
    try:
        selector = json.loads((parent / "current.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WhisperRuntimeMaintenanceError(
            "WHISPER_RUNTIME_ROLLBACK_CURRENT_INVALID"
        ) from exc
    version = selector.get("version") if isinstance(selector, dict) else None
    if (
        not isinstance(selector, dict)
        or selector.get("schema") != RUNTIME_SCHEMA
        or selector.get("runtime_id") != WHISPER_RUNTIME_ID
        or not isinstance(version, str)
    ):
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_CURRENT_INVALID")
    _version(version)
    if not _preserved_candidate(whisper_version_root(runtime_root, version), version):
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_CURRENT_INVALID")
    return version


def _preserved_candidate(path: Path, version: str) -> bool:
    """Verify inactive runtime identity, worker bytes and metadata before selection."""
    if not _valid_recovery_runtime_directory(path, version):
        return False
    marker_path = path / ".tda-runtime.json"
    worker = path / WHISPER_WORKER_EXE
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        metadata_sha256 = _worker_metadata_sha256(worker)
    except (OSError, json.JSONDecodeError, RuntimeError):
        return False
    if not isinstance(marker, dict):
        return False
    sealed = marker.get("worker_metadata_sha256")
    if sealed is not None and (
        not isinstance(sealed, str)
        or len(sealed) != 64
        or any(char not in "0123456789abcdef" for char in sealed)
    ):
        return False
    # Preserved runtime bytes/metadata are immutable rollback evidence. Legacy
    # markers without a metadata seal remain verifiable by the worker SHA-256,
    # but an existing seal must match exactly; rollback never rewrites it.
    if sealed is not None and sealed != metadata_sha256:
        return False
    return True


def _verified_worker_sha256(runtime_root: Path, version: str) -> str:
    marker_path = whisper_version_root(runtime_root, version) / ".tda-runtime.json"
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WhisperRuntimeMaintenanceError(
            "WHISPER_RUNTIME_ROLLBACK_TARGET_INVALID"
        ) from exc
    digest = marker.get("worker_sha256") if isinstance(marker, dict) else None
    if not isinstance(digest, str) or len(digest) != 64:
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_TARGET_INVALID")
    return digest


def list_whisper_runtime_rollback_candidates(runtime_root: Path) -> list[str]:
    try:
        current = _ready_current_version(runtime_root)
    except WhisperRuntimeMaintenanceError:
        return []
    current_tuple = _version(current)
    parent = whisper_root(runtime_root)
    try:
        entries = list(parent.iterdir())
    except OSError:
        return []

    candidates: list[str] = []
    for entry in entries:
        name = entry.name
        try:
            parsed = version_tuple(name)
        except ValueError:
            continue
        if parsed >= current_tuple or not whisper_runtime_version_compatible(name):
            continue
        if _preserved_candidate(entry, name):
            candidates.append(name)
    return sorted(candidates, key=version_tuple, reverse=True)


def _activate_preserved_runtime(runtime_root: Path, target_version: str, current_version: str) -> dict[str, object]:
    target = whisper_version_root(runtime_root, target_version)
    if not _preserved_candidate(target, target_version):
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_TARGET_INVALID")

    parent = whisper_root(runtime_root)
    selector = parent / "current.json"
    previous = {
        "schema": RUNTIME_SCHEMA,
        "runtime_id": WHISPER_RUNTIME_ID,
        "version": current_version,
    }
    selected = {
        "schema": RUNTIME_SCHEMA,
        "runtime_id": WHISPER_RUNTIME_ID,
        "version": target_version,
    }

    try:
        _atomic_json(selector, selected)
        try:
            selected_version = _ready_current_version(runtime_root)
        except WhisperRuntimeMaintenanceError as exc:
            raise WhisperRuntimeMaintenanceError(
                "WHISPER_RUNTIME_ROLLBACK_VERIFY_FAILED"
            ) from exc
        if selected_version != target_version:
            raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_VERIFY_FAILED")
        worker_sha256 = _verified_worker_sha256(runtime_root, target_version)
    except Exception as exc:
        try:
            _atomic_json(selector, previous)
            restored_version = _ready_current_version(runtime_root)
        except Exception as restore_exc:
            raise WhisperRuntimeMaintenanceError(
                "WHISPER_RUNTIME_ROLLBACK_RESTORE_FAILED"
            ) from restore_exc
        if restored_version != current_version:
            raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_RESTORE_FAILED") from exc
        if isinstance(exc, WhisperRuntimeMaintenanceError):
            raise
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_SWITCH_FAILED") from exc

    return {
        "accepted": True,
        "status": "ready",
        "version": target_version,
        "previous_version": current_version,
        "source": "preserved",
        "worker_sha256": worker_sha256,
    }


def _rollback_whisper_runtime_locked(
    runtime_root: Path,
    cache_root: Path,
    *,
    target_version: str,
    prefer_bits: bool = True,
) -> dict[str, object]:
    current_version = _ready_current_version(runtime_root)
    current_tuple = _version(current_version)
    target_tuple = _version(target_version)
    if target_tuple >= current_tuple:
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_TARGET_NOT_OLDER")
    if not whisper_runtime_version_compatible(target_version):
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_TARGET_INCOMPATIBLE")

    target = whisper_version_root(runtime_root, target_version)
    if target.exists() or target.is_symlink():
        if not _preserved_candidate(target, target_version):
            # Existing but corrupt bytes are never silently repaired as part of
            # rollback. Keep the current selected runtime untouched and require
            # an explicit repair/reinstall workflow instead.
            raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_TARGET_INVALID")
        return _activate_preserved_runtime(runtime_root, target_version, current_version)

    manifest = fetch_whisper_runtime_manifest(version=target_version)
    if manifest.version != target_version:
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_MANIFEST_MISMATCH")
    archive = download_whisper_runtime(
        manifest,
        cache_root,
        prefer_bits=prefer_bits,
    )
    try:
        installed = install_whisper_runtime_archive(
            archive,
            runtime_root,
            version=target_version,
            expected_sha256=manifest.sha256,
            replace_corrupt=False,
        )
    except RuntimeError as exc:
        raise WhisperRuntimeMaintenanceError(
            str(exc) or "WHISPER_RUNTIME_ROLLBACK_INSTALL_FAILED"
        ) from exc

    try:
        verified_version = _ready_current_version(runtime_root)
    except WhisperRuntimeMaintenanceError:
        verified_version = None
    if verified_version != target_version:
        parent = whisper_root(runtime_root)
        try:
            _atomic_json(
                parent / "current.json",
                {
                    "schema": RUNTIME_SCHEMA,
                    "runtime_id": WHISPER_RUNTIME_ID,
                    "version": current_version,
                },
            )
            restored_version = _ready_current_version(runtime_root)
        except Exception as exc:
            raise WhisperRuntimeMaintenanceError(
                "WHISPER_RUNTIME_ROLLBACK_RESTORE_FAILED"
            ) from exc
        if restored_version != current_version:
            raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_RESTORE_FAILED")
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_VERIFY_FAILED")
    return {
        "accepted": True,
        "status": "ready",
        "version": target_version,
        "previous_version": current_version,
        "source": "download",
        "worker_sha256": installed.get("worker_sha256"),
    }


def rollback_whisper_runtime(
    runtime_root: Path,
    cache_root: Path,
    *,
    target_version: str,
    prefer_bits: bool = True,
) -> dict[str, object]:
    try:
        with whisper_runtime_maintenance_lock():
            return _rollback_whisper_runtime_locked(
                runtime_root,
                cache_root,
                target_version=target_version,
                prefer_bits=prefer_bits,
            )
    except InstallationLockError as exc:
        raise WhisperRuntimeMaintenanceError(
            "WHISPER_RUNTIME_ROLLBACK_MAINTENANCE_BUSY"
        ) from exc
