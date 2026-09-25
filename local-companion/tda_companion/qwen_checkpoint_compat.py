from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .asr_checkpoints import (
    MAX_CHECKPOINT_BYTES,
    QWEN_TEXT_CHECKPOINT_NAMESPACE,
    QWEN_TEXT_CHECKPOINT_SCHEMA,
    CheckpointSignature,
    QwenTextCheckpointWindow,
    load_qwen_text_checkpoint,
)
from .craig import CraigTrack

_RUNTIME_VERSION = re.compile(r"(?:^|;)runtime=([0-9]+\.[0-9]+\.[0-9]+)(?:;|$)")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_RUNTIME_COMPATIBILITY = frozenset({("1.0.10", "1.0.11")})
_MAX_CHECKPOINT_ROOTS = 256


@dataclass(frozen=True)
class CompatibleQwenTextCheckpoint:
    windows: tuple[QwenTextCheckpointWindow, ...]
    source_runtime_version: str
    source_signature_sha256: str


def _runtime_version(value: str) -> str | None:
    if not isinstance(value, str):
        return None
    match = _RUNTIME_VERSION.search(value)
    return None if match is None else match.group(1)


def _compatible_signature(
    candidate: CheckpointSignature,
    *,
    current: CheckpointSignature,
    template: CheckpointSignature,
) -> bool:
    current_version = _runtime_version(current.runtime_fingerprint)
    candidate_version = _runtime_version(candidate.runtime_fingerprint)
    if (
        current_version is None
        or candidate_version is None
        or (candidate_version, current_version) not in _RUNTIME_COMPATIBILITY
    ):
        return False
    candidate_value = candidate.as_dict()
    template_value = template.as_dict()
    return all(
        candidate_value[key] == value
        for key, value in template_value.items()
        if key != "runtime_fingerprint"
    )


def _candidate_signature(path: Path, *, expected_digest: str) -> CheckpointSignature | None:
    try:
        if path.is_symlink():
            return None
        stat = path.stat()
    except (FileNotFoundError, OSError):
        return None
    if stat.st_size <= 0 or stat.st_size > MAX_CHECKPOINT_BYTES:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or value.get("schema") != QWEN_TEXT_CHECKPOINT_SCHEMA:
        return None
    raw = value.get("signature")
    if not isinstance(raw, dict):
        return None
    try:
        signature = CheckpointSignature(**raw)
    except (TypeError, ValueError):
        return None
    if signature.as_dict() != raw:
        return None
    if signature.digest() != expected_digest or value.get("signature_sha256") != expected_digest:
        return None
    return signature


def load_compatible_qwen_text_checkpoint(
    package_root: Path,
    signature: CheckpointSignature,
    track: CraigTrack,
    *,
    templates: Iterable[CheckpointSignature],
) -> CompatibleQwenTextCheckpoint | None:
    """Reuse one explicitly declared Qwen pre-alignment text lineage.

    Exact current-signature lookup remains owned by asr_checkpoints. This bridge
    is only for an explicitly approved runtime/policy transition and delegates
    full checkpoint content/track/hash validation back to the canonical loader.
    """
    if signature.engine != "qwen3" or _runtime_version(signature.runtime_fingerprint) is None:
        return None
    candidates = tuple(templates)
    if not candidates:
        return None

    base = package_root.resolve() / ".checkpoints"
    try:
        if base.is_symlink() or not base.is_dir():
            return None
        roots = sorted(base.iterdir(), key=lambda item: item.name)
    except OSError:
        return None
    if len(roots) > _MAX_CHECKPOINT_ROOTS:
        return None

    matches: list[CompatibleQwenTextCheckpoint] = []
    for root in roots:
        if (
            root.is_symlink()
            or not root.is_dir()
            or _SHA256.fullmatch(root.name) is None
        ):
            continue
        namespace = root / QWEN_TEXT_CHECKPOINT_NAMESPACE
        if namespace.is_symlink():
            continue
        path = namespace / f"track-{track.number:04d}.json"
        candidate = _candidate_signature(path, expected_digest=root.name)
        if candidate is None:
            continue
        if not any(
            _compatible_signature(candidate, current=signature, template=template)
            for template in candidates
        ):
            continue
        windows = load_qwen_text_checkpoint(package_root, candidate, track)
        if windows is None:
            continue
        source_runtime_version = _runtime_version(candidate.runtime_fingerprint)
        if source_runtime_version is None:
            continue
        matches.append(
            CompatibleQwenTextCheckpoint(
                windows=windows,
                source_runtime_version=source_runtime_version,
                source_signature_sha256=candidate.digest(),
            )
        )
        if len(matches) > 1:
            # Ambiguous lineage is not a recovery opportunity. Fail closed.
            return None

    return matches[0] if matches else None
