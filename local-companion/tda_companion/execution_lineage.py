from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping
from typing import Any

from . import VERSION
from .telemetry import SystemTelemetry
from .transcript import TranscriptDocument

EXECUTION_LINEAGE_SCHEMA_VERSION = "tda_execution_lineage_v1"
_CUDA_DEVICE = re.compile(r"^cuda(?::(?P<index>[0-9]{1,2}))?$", re.IGNORECASE)


def _bounded_text(value: object, maximum: int = 160) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or any(ord(char) < 32 or ord(char) == 127 for char in text):
        return None
    return text[:maximum]


def _gpu_index(device: str) -> int | None:
    match = _CUDA_DEVICE.fullmatch(device.strip())
    if match is None:
        return None
    raw = match.group("index")
    return int(raw) if raw is not None else 0


def capture_execution_lineage(
    document: TranscriptDocument,
    *,
    snapshot: Mapping[str, Any] | None = None,
    environ: Mapping[str, str] | None = None,
    asr_text_runtime_versions: Iterable[str] | None = None,
    asr_text_checkpoint_signatures: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Capture a sanitized, best-effort execution fingerprint at run commit time.

    This deliberately excludes hostname, username, paths, utilization samples and
    transcript/audio content. Missing hardware sensors remain nullable and can never
    make a successful ASR run fail.
    """

    environment = environ if environ is not None else os.environ
    engine = document.engine
    device = _bounded_text(engine.device, 64) or "unknown"
    runtime_family = _bounded_text(environment.get("TDA_ASR_RUNTIME_FAMILY"), 64)
    runtime_version = _bounded_text(environment.get("TDA_ASR_RUNTIME_VERSION"), 128)

    gpu: dict[str, Any] | None = None
    index = _gpu_index(device)
    if index is not None:
        value: Mapping[str, Any] = snapshot or {}
        if snapshot is None:
            try:
                candidate = SystemTelemetry().snapshot()
                if isinstance(candidate, dict):
                    value = candidate
            except Exception:
                value = {}

        rows = value.get("gpus")
        if isinstance(rows, list):
            row = next(
                (
                    candidate
                    for candidate in rows
                    if isinstance(candidate, dict) and candidate.get("index") == index
                ),
                None,
            )
            if isinstance(row, dict):
                total = row.get("memory_total_bytes")
                vram_total_bytes = (
                    max(0, int(total))
                    if isinstance(total, int) and not isinstance(total, bool)
                    else None
                )
                gpu = {
                    "vendor": "NVIDIA",
                    "index": index,
                    "model": _bounded_text(row.get("name"), 160),
                    "vram_total_bytes": vram_total_bytes,
                    "compute_capability": _bounded_text(
                        row.get("compute_capability"),
                        32,
                    ),
                    "driver_version": _bounded_text(row.get("driver_version"), 64),
                }

    lineage: dict[str, Any] = {
        "schema_version": EXECUTION_LINEAGE_SCHEMA_VERSION,
        "companion_version": VERSION,
        "runtime_family": runtime_family,
        "runtime_version": runtime_version,
        "device": device,
        "compute_type": _bounded_text(engine.compute_type, 64),
        "gpu": gpu,
    }

    reused_runtime_versions = sorted(
        {
            value
            for raw in (asr_text_runtime_versions or ())
            if (value := _bounded_text(raw, 32)) is not None
            and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value)
        }
    )
    reused_checkpoint_signatures = sorted(
        {
            value.lower()
            for raw in (asr_text_checkpoint_signatures or ())
            if (value := _bounded_text(raw, 64)) is not None
            and re.fullmatch(r"[0-9a-fA-F]{64}", value)
        }
    )
    if reused_runtime_versions:
        lineage["asr_text_runtime_versions"] = reused_runtime_versions[:8]
    if reused_checkpoint_signatures:
        lineage["asr_text_checkpoint_signatures"] = reused_checkpoint_signatures[:8]
    return lineage
