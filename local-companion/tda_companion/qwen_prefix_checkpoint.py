from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from .asr_checkpoints import (
    MAX_CHECKPOINT_BYTES,
    CheckpointSignature,
    QwenTextCheckpointWindow,
    _canonical_json_hash,
    _checkpoint_directory,
    _checkpoint_file,
    _track_descriptor,
    _validated_qwen_text_windows,
)
from .craig import CraigTrack

QWEN_TEXT_PREFIX_SCHEMA = "tda_qwen_text_prefix_v1"
QWEN_TEXT_PREFIX_NAMESPACE = "qwen-text-prefix-v1"
QWEN_TEXT_PREFIX_FLUSH_WINDOWS = 8


def _prefix_path(
    package_root: Path,
    signature: CheckpointSignature,
    track_number: int,
    *,
    create_parent: bool = False,
) -> Path:
    if track_number < 1:
        raise ValueError("CHECKPOINT_TRACK_NUMBER_INVALID")
    root = _checkpoint_directory(
        package_root,
        signature,
        namespace=QWEN_TEXT_PREFIX_NAMESPACE,
        create=create_parent,
    )
    return root / f"track-{track_number:04d}.json"


def load_qwen_text_prefix_checkpoint(
    package_root: Path,
    signature: CheckpointSignature,
    track: CraigTrack,
) -> tuple[QwenTextCheckpointWindow, ...] | None:
    if signature.engine != "qwen3":
        return None
    try:
        path = _checkpoint_file(
            package_root,
            _prefix_path(package_root, signature, track.number),
            allow_missing=True,
        )
        stat = path.stat()
    except (FileNotFoundError, OSError, ValueError):
        return None
    if stat.st_size <= 0 or stat.st_size > MAX_CHECKPOINT_BYTES:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or value.get("schema") != QWEN_TEXT_PREFIX_SCHEMA:
        return None
    if value.get("signature") != signature.as_dict() or value.get("signature_sha256") != signature.digest():
        return None
    descriptor = _track_descriptor(track)
    if value.get("track") != descriptor:
        return None
    windows_value = value.get("windows")
    content = {"track": descriptor, "windows": windows_value}
    if value.get("content_sha256") != _canonical_json_hash(content):
        return None
    try:
        return _validated_qwen_text_windows(windows_value)
    except (TypeError, ValueError):
        return None


def save_qwen_text_prefix_checkpoint(
    package_root: Path,
    signature: CheckpointSignature,
    track: CraigTrack,
    windows: Iterable[QwenTextCheckpointWindow],
) -> Path:
    if signature.engine != "qwen3":
        raise ValueError("QWEN_TEXT_PREFIX_SIGNATURE_INVALID")
    values = tuple(windows)
    if not values:
        raise ValueError("QWEN_TEXT_CHECKPOINT_WINDOWS_INVALID")
    windows_value = [asdict(window) for window in values]
    _validated_qwen_text_windows(windows_value)
    descriptor = _track_descriptor(track)
    content = {"track": descriptor, "windows": windows_value}
    payload = {
        "schema": QWEN_TEXT_PREFIX_SCHEMA,
        "signature": signature.as_dict(),
        "signature_sha256": signature.digest(),
        "content_sha256": _canonical_json_hash(content),
        **content,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_CHECKPOINT_BYTES:
        raise ValueError("CHECKPOINT_SIZE_LIMIT")
    path = _prefix_path(package_root, signature, track.number, create_parent=True)
    path = _checkpoint_file(package_root, path, allow_missing=True)
    temporary = path.with_name(path.name + f".{uuid4().hex}.partial")
    try:
        _checkpoint_file(package_root, temporary, allow_missing=True)
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        _prefix_path(package_root, signature, track.number, create_parent=False)
        _checkpoint_file(package_root, path, allow_missing=True)
        os.replace(temporary, path)
        _checkpoint_file(package_root, path, allow_missing=False)
        return path
    finally:
        temporary.unlink(missing_ok=True)


def clear_qwen_text_prefix_checkpoint(
    package_root: Path,
    signature: CheckpointSignature,
    track: CraigTrack,
) -> None:
    try:
        path = _checkpoint_file(
            package_root,
            _prefix_path(package_root, signature, track.number),
            allow_missing=True,
        )
        path.unlink(missing_ok=True)
    except (OSError, ValueError):
        return


def should_flush_qwen_text_prefix(window_count: int) -> bool:
    return window_count == 1 or (
        window_count > 1 and window_count % QWEN_TEXT_PREFIX_FLUSH_WINDOWS == 0
    )
