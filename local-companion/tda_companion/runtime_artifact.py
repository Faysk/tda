"""Small, content-free identity copied from the selected install seal at dispatch."""
from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Mapping
from pathlib import Path

RUNTIME_ARTIFACT_ENV = "TDA_ASR_RUNTIME_ARTIFACT"
_SHA = re.compile(r"[0-9a-f]{64}")
_IDS = {"whisper": "whisper-ctranslate2", "qwen": "qwen3-transformers"}
_MAX_MARKER_BYTES = 16 * 1024


class RuntimeArtifactError(RuntimeError):
    def __init__(self, code: str = "ASR_RUNTIME_IDENTITY_INVALID"):
        super().__init__(code)
        self.code = code


def runtime_artifact(value: object, *, family: str | None, version: str | None) -> dict[str, str | None] | None:
    if not isinstance(value, Mapping) or family not in _IDS:
        return None
    if value.get("runtime_id") != _IDS[family] or value.get("version") != version:
        return None
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        return None
    worker = value.get("worker_sha256")
    archive = value.get("archive_sha256")
    if not isinstance(worker, str) or not _SHA.fullmatch(worker):
        return None
    if archive is not None and (not isinstance(archive, str) or not _SHA.fullmatch(archive)):
        return None
    return {"runtime_id": _IDS[family], "version": version, "worker_sha256": worker, "archive_sha256": archive}


def artifact_from_environment(environment: Mapping[str, str]) -> dict[str, str | None] | None:
    raw = environment.get(RUNTIME_ARTIFACT_ENV)
    if not isinstance(raw, str) or len(raw) > 1024:
        return None
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return runtime_artifact(value, family=environment.get("TDA_ASR_RUNTIME_FAMILY"), version=environment.get("TDA_ASR_RUNTIME_VERSION"))


def verify_frozen_runtime_artifact(
    environment: Mapping[str, str] | None = None,
    *,
    executable: Path | None = None,
    frozen: bool | None = None,
) -> dict[str, str | None] | None:
    """Confirm the frozen child sees the exact sealed artifact selected by its parent.

    Source/development workers may have no official artifact seal and therefore
    remain explicitly partial. Frozen workers fail closed when the injected
    identity is missing, malformed, or differs from the adjacent runtime marker.
    """

    values = environment if environment is not None else os.environ
    expected = artifact_from_environment(values)
    is_frozen = bool(getattr(sys, "frozen", False)) if frozen is None else bool(frozen)
    if not is_frozen:
        return expected
    if expected is None:
        raise RuntimeArtifactError()

    candidate = (executable or Path(sys.executable)).resolve().parent / ".tda-runtime.json"
    try:
        if candidate.stat().st_size <= 0 or candidate.stat().st_size > _MAX_MARKER_BYTES:
            raise RuntimeArtifactError()
        marker = json.loads(candidate.read_text(encoding="utf-8"))
    except RuntimeArtifactError:
        raise
    except (OSError, ValueError, TypeError) as exc:
        raise RuntimeArtifactError() from exc

    if not isinstance(marker, Mapping) or marker.get("schema") != "tda_asr_runtime_v1":
        raise RuntimeArtifactError()
    actual = runtime_artifact(
        marker,
        family=values.get("TDA_ASR_RUNTIME_FAMILY"),
        version=values.get("TDA_ASR_RUNTIME_VERSION"),
    )
    if actual is None or actual != expected:
        raise RuntimeArtifactError()
    return expected
