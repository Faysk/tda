from __future__ import annotations

import json
import os
import re
from dataclasses import asdict
from pathlib import Path
from typing import Mapping

from .asr_quality import QualityMetrics, QualityThresholds, apply_quality_thresholds
from .transcript import TranscriptDocument

RECEIPT_SCHEMA = "tda_asr_quality_receipt_v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class AsrQualityReceiptError(ValueError):
    pass


def _sha256(value: str, field: str) -> str:
    normalized = str(value).strip().lower()
    if not _SHA256.fullmatch(normalized):
        raise AsrQualityReceiptError(f"{field}:SHA256_INVALID")
    return normalized


def _safe_runtime(values: Mapping[str, str] | None) -> dict[str, str]:
    if values is None:
        return {}
    output: dict[str, str] = {}
    for key, value in sorted(values.items()):
        name = str(key).strip()[:80]
        text = str(value).strip()[:160]
        if not name or not text:
            continue
        output[name] = text
    return output


def build_quality_receipt(
    document: TranscriptDocument,
    metrics: QualityMetrics,
    *,
    reference_sha256: str,
    hypothesis_sha256: str,
    thresholds: QualityThresholds | None = None,
    runtime: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Build a content-only benchmark receipt.

    The receipt intentionally contains no transcript/reference text and no filesystem
    paths. A measured receipt has no pass/fail claim until thresholds are supplied.
    """

    document.validate()
    gate: dict[str, object] | None = None
    if thresholds is not None:
        result = apply_quality_thresholds(metrics, thresholds)
        gate = {
            "thresholds": asdict(thresholds),
            "passed": result.passed,
            "failures": list(result.failures),
        }

    return {
        "schema": RECEIPT_SCHEMA,
        "source": {
            "recording_id": document.recording_id,
            "source_sha256": _sha256(document.source_sha256, "source_sha256"),
            "reference_sha256": _sha256(reference_sha256, "reference_sha256"),
            "hypothesis_sha256": _sha256(hypothesis_sha256, "hypothesis_sha256"),
        },
        "engine": {
            "engine": document.engine.engine,
            "model": document.engine.model,
            "model_revision": document.engine.model_revision,
            "profile": document.engine.profile,
            "device": document.engine.device,
            "compute_type": document.engine.compute_type,
            "alignment": document.engine.alignment,
        },
        "runtime": _safe_runtime(runtime),
        "metrics": asdict(metrics),
        "gate": gate,
    }


def serialize_quality_receipt(receipt: Mapping[str, object]) -> bytes:
    if receipt.get("schema") != RECEIPT_SCHEMA:
        raise AsrQualityReceiptError("receipt:SCHEMA_INVALID")
    return json.dumps(
        dict(receipt),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def write_quality_receipt_atomic(path: Path, receipt: Mapping[str, object]) -> None:
    target = path.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".partial")
    payload = serialize_quality_receipt(receipt)
    with temporary.open("wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)
