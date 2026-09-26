"""Versioned filesystem commit policy; atomic visibility is not power-loss proof.

POSIX authority writes fence file content and every ancestor directory. Windows
authority writes fence file content then request same-volume write-through rename;
there is no claimed equivalent of POSIX directory fsync on Windows. See the
transcript-review-publication spec for supported guarantees and recovery.
"""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

StorageClass = Literal["authoritative", "projection", "checkpoint"]
_WINDOWS = os.name == "nt"


class AtomicStorageError(OSError):
    def __init__(self, stage: str, ambiguous: bool):
        self.stage = stage
        self.ambiguous = ambiguous
        super().__init__("LOCAL_WRITE_UNCONFIRMED" if ambiguous else "LOCAL_WRITE_FAILED")


def policy_name(storage_class: StorageClass = "authoritative") -> str:
    if storage_class == "projection":
        return "atomic_visibility_v1"
    if storage_class == "checkpoint":
        return "file_sync_atomic_visibility_v1"
    return "windows_file_sync_write_through_v1" if _WINDOWS else "posix_file_and_namespace_sync_v1"


def _directory_sync(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_namespace(directory: Path) -> None:
    if _WINDOWS:
        # Windows does not expose the POSIX directory-fsync contract here. Do not
        # disguise an ignored FlushFileBuffers error as a confirmed namespace fence.
        return
    directory = directory.absolute()
    # Includes newly created ancestors and namespaces left by a previous failed
    # writer. Do not infer durability merely because mkdir now says it exists.
    for candidate in (directory, *directory.parents):
        _directory_sync(candidate)


def _replace(source: Path, target: Path, storage_class: StorageClass) -> None:
    if not _WINDOWS or storage_class != "authoritative":
        os.replace(source, target)
        return
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    move = kernel.MoveFileExW
    move.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    move.restype = wintypes.BOOL
    # Same directory, no COPY_ALLOWED, no deferred move and no privilege escalation.
    if not move(str(source), str(target), 0x1 | 0x8):
        raise OSError(ctypes.get_last_error(), "WINDOWS_REPLACE_FAILED")


def atomic_write(path: Path, payload: bytes, *, storage_class: StorageClass = "authoritative") -> str:
    if storage_class not in {"authoritative", "projection", "checkpoint"}:
        raise ValueError("STORAGE_CLASS_INVALID")
    path = path.absolute()
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.partial")
    stage = "prepare"
    replaced = False
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        stage = "write"
        with temporary.open("xb") as handle:
            if handle.write(payload) != len(payload):
                raise OSError("SHORT_WRITE")
            handle.flush()
            if storage_class != "projection":
                stage = "file_sync"
                os.fsync(handle.fileno())
        stage = "replace"
        _replace(temporary, path, storage_class)
        replaced = True
        if storage_class == "authoritative":
            stage = "namespace_sync"
            sync_namespace(path.parent)
        return policy_name(storage_class)
    except OSError as exc:
        ambiguous = replaced or (stage == "replace" and not temporary.exists())
        raise AtomicStorageError(stage, ambiguous) from exc
    finally:
        # Orphan partials are never authority. A cleanup failure must not trigger
        # deletion or replacement of a possibly committed destination.
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
