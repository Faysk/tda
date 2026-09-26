"""Small, content-free identity copied from the selected install seal at dispatch."""
from __future__ import annotations

import json
import re
from collections.abc import Mapping

RUNTIME_ARTIFACT_ENV = "TDA_ASR_RUNTIME_ARTIFACT"
_SHA = re.compile(r"[0-9a-f]{64}")
_IDS = {"whisper": "whisper-ctranslate2", "qwen": "qwen3-transformers"}


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
