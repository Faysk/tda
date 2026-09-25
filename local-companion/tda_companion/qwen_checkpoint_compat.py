from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable

from .asr_checkpoints import (
    CheckpointSignature,
    QwenTextCheckpointWindow,
    load_qwen_text_checkpoint,
)
from .craig import CraigTrack

_RUNTIME_VERSION = re.compile(r"(?:^|;)runtime=([0-9]+\.[0-9]+\.[0-9]+)(?:;|$)")
_WORKER_SHA256 = re.compile(r"(?:^|;)worker_sha256=([0-9a-f]{64})(?:;|$)")
# Exact worker accepted and promoted as companion-qwen-runtime-v1.0.10.
# Receipt: docs/companion/runtime-acceptance/
# companion-qwen-runtime-rc-v1.0.10-19d9b3b64238.json
_ACCEPTED_SOURCE_WORKERS = {
    ("1.0.10", "1.0.11"): frozenset(
        {"8c07e1c3bd34ecc53d49025a510c7547e7748b030ac6a90fdd70a2abc431e62e"}
    )
}
_LINEAGE_FIELDS = (
    "package_sha256",
    "profile_id",
    "engine",
    "model_id",
    "model_revision",
    "alignment",
    "alignment_revision",
    "context_sha256",
    "glossary_sha256",
)


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


def _worker_sha256(value: str) -> str | None:
    if not isinstance(value, str):
        return None
    match = _WORKER_SHA256.search(value)
    return None if match is None else match.group(1)


def _same_text_lineage(
    current: CheckpointSignature,
    template: CheckpointSignature,
) -> bool:
    # recipe_sha256 intentionally differs: current is strict-overlap-v3 while
    # the explicit template identifies the legacy strict-overlap-v2 text recipe.
    return all(
        getattr(current, field) == getattr(template, field)
        for field in _LINEAGE_FIELDS
    )


def _source_runtime_fingerprint(version: str, worker_sha256: str) -> str:
    return ";".join(
        (
            "checkpoint=qwen-track-v3",
            f"runtime={version}",
            f"worker_sha256={worker_sha256}",
        )
    )


def load_compatible_qwen_text_checkpoint(
    package_root: Path,
    signature: CheckpointSignature,
    track: CraigTrack,
    *,
    templates: Iterable[CheckpointSignature],
) -> CompatibleQwenTextCheckpoint | None:
    """Load one explicitly declared pre-alignment Qwen checkpoint lineage.

    The bridge never scans arbitrary checkpoint directories. For each approved
    runtime transition it reconstructs the *exact* legacy signature from the
    caller-provided legacy recipe plus the physically accepted source worker
    identity, then delegates all file/track/content hash validation to the
    canonical checkpoint loader.
    """
    current_version = _runtime_version(signature.runtime_fingerprint)
    current_worker = _worker_sha256(signature.runtime_fingerprint)
    if (
        signature.engine != "qwen3"
        or current_version is None
        or current_worker is None
    ):
        return None

    legacy_templates = tuple(templates)
    if not legacy_templates:
        return None

    matches: list[CompatibleQwenTextCheckpoint] = []
    for (source_version, target_version), accepted_workers in sorted(
        _ACCEPTED_SOURCE_WORKERS.items()
    ):
        if target_version != current_version:
            continue
        for worker_sha256 in sorted(accepted_workers):
            for template in legacy_templates:
                if not _same_text_lineage(signature, template):
                    continue
                candidate = replace(
                    template,
                    runtime_fingerprint=_source_runtime_fingerprint(
                        source_version,
                        worker_sha256,
                    ),
                )
                windows = load_qwen_text_checkpoint(package_root, candidate, track)
                if windows is None:
                    continue
                matches.append(
                    CompatibleQwenTextCheckpoint(
                        windows=windows,
                        source_runtime_version=source_version,
                        source_signature_sha256=candidate.digest(),
                    )
                )
                if len(matches) > 1:
                    # More than one declared legacy lineage matching the same
                    # current job is ambiguous. Never guess which text to reuse.
                    return None

    return matches[0] if matches else None
