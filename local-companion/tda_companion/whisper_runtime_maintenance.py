from __future__ import annotations

import json
from pathlib import Path

from .asr_runtime import (
    RUNTIME_SCHEMA,
    WHISPER_RUNTIME_ID,
    WHISPER_WORKER_EXE,
    _atomic_json,
    _valid_recovery_runtime_directory,
    inspect_whisper_runtime,
    install_whisper_runtime_archive,
    whisper_root,
    whisper_version_root,
)
from .asr_runtime_updates import download_whisper_runtime, fetch_whisper_runtime_manifest
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
    state = inspect_whisper_runtime(runtime_root, verify_worker=True)
    version = state.get("version")
    if state.get("status") != "ready" or not isinstance(version, str):
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_CURRENT_INVALID")
    return version


def _preserved_candidate(path: Path, version: str) -> bool:
    if path.is_symlink() or not path.is_dir():
        return False
    try:
        marker = json.loads((path / ".tda-runtime.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return bool(
        isinstance(marker, dict)
        and marker.get("schema") == RUNTIME_SCHEMA
        and marker.get("runtime_id") == WHISPER_RUNTIME_ID
        and marker.get("version") == version
        and marker.get("worker") == WHISPER_WORKER_EXE
        and isinstance(marker.get("worker_sha256"), str)
    )


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
    if not _valid_recovery_runtime_directory(target, target_version):
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
        verified = inspect_whisper_runtime(runtime_root, verify_worker=True)
        if verified.get("status") != "ready" or verified.get("version") != target_version:
            raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_VERIFY_FAILED")
    except BaseException as exc:
        try:
            _atomic_json(selector, previous)
            restored = inspect_whisper_runtime(runtime_root, verify_worker=True)
        except BaseException as restore_exc:
            raise WhisperRuntimeMaintenanceError(
                "WHISPER_RUNTIME_ROLLBACK_RESTORE_FAILED"
            ) from restore_exc
        if restored.get("status") != "ready" or restored.get("version") != current_version:
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
        "worker_sha256": verified.get("worker_sha256"),
    }


def rollback_whisper_runtime(
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
    if _valid_recovery_runtime_directory(target, target_version):
        return _activate_preserved_runtime(runtime_root, target_version, current_version)

    manifest = fetch_whisper_runtime_manifest(version=target_version)
    if manifest.version != target_version:
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_MANIFEST_MISMATCH")
    archive = download_whisper_runtime(
        manifest,
        cache_root,
        prefer_bits=prefer_bits,
    )
    replacing = target.exists() or target.is_symlink()
    try:
        installed = install_whisper_runtime_archive(
            archive,
            runtime_root,
            version=target_version,
            expected_sha256=manifest.sha256,
            replace_corrupt=replacing,
        )
    except RuntimeError as exc:
        raise WhisperRuntimeMaintenanceError(
            str(exc) or "WHISPER_RUNTIME_ROLLBACK_INSTALL_FAILED"
        ) from exc

    verified = inspect_whisper_runtime(runtime_root, verify_worker=True)
    if verified.get("status") != "ready" or verified.get("version") != target_version:
        raise WhisperRuntimeMaintenanceError("WHISPER_RUNTIME_ROLLBACK_VERIFY_FAILED")
    return {
        "accepted": True,
        "status": "ready",
        "version": target_version,
        "previous_version": current_version,
        "source": "download",
        "worker_sha256": installed.get("worker_sha256"),
    }
