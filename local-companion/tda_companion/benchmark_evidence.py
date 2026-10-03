from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from .atomic_storage import atomic_write
from .transcript import TranscriptDocument

BUNDLE_SCHEMA = "tda_benchmark_bundle_v1"
PROFILE_SCHEMA = "tda_benchmark_profile_artifact_v1"
METRICS_SCHEMA = "tda_benchmark_metrics_v1"
EVENT_SCHEMA = "tda_benchmark_event_v1"
TELEMETRY_SCHEMA = "tda_benchmark_telemetry_v1"
CANONICAL_PROFILES = (
    "whisper-turbo",
    "whisper-detailed",
    "qwen-fast",
    "qwen-quality",
)
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,95}$")
_MAX_JSON_BYTES = 64 * 1024 * 1024
_MAX_EVENTS = 20_000
_MAX_EVENT_BYTES = 4 * 1024
_MAX_EVENT_FILE_BYTES = 8 * 1024 * 1024
_ZIP_DATE = (1980, 1, 1, 0, 0, 0)

_EVENT_DATA_KEYS = frozenset(
    {
        "stage",
        "track",
        "total_tracks",
        "window",
        "segment",
        "completed",
        "total",
        "unit",
        "downloaded_bytes",
        "total_bytes",
        "profile",
        "profile_id",
        "reason",
        "compute_type",
        "count",
        "returncode",
    }
)
_PATHISH = re.compile(
    r"(?:[A-Za-z]:[\\/]|/(?:home|Users|tmp|var|opt|mnt)/|authorization|cookie|bearer|token|@)",
    re.IGNORECASE,
)


class BenchmarkEvidenceError(ValueError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _canonical(value: Mapping[str, Any] | Sequence[Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha_text(value: str) -> str:
    return _sha_bytes(value.encode("utf-8"))


def _identifier(value: Any, code: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise BenchmarkEvidenceError(code)
    return value


def _sha(value: Any, code: str) -> str:
    if not isinstance(value, str):
        raise BenchmarkEvidenceError(code)
    normalized = value.lower()
    if not _SHA256.fullmatch(normalized):
        raise BenchmarkEvidenceError(code)
    return normalized


def benchmark_id_for(job_id: str, attempt: int) -> str:
    _identifier(job_id, "BENCHMARK_JOB_ID_INVALID")
    if isinstance(attempt, bool) or not isinstance(attempt, int) or attempt < 1:
        raise BenchmarkEvidenceError("BENCHMARK_ATTEMPT_INVALID")
    digest = hashlib.sha256(f"{job_id}:{attempt}".encode("utf-8")).hexdigest()[:24]
    return f"benchmark-{digest}"


def sample_identity_for_package(package: Any, *, sample_seconds: float = 300.0) -> str:
    if sample_seconds != 300.0:
        raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_INVALID")
    source_sha256 = _sha(getattr(package, "source_sha256", None), "BENCHMARK_SOURCE_HASH_INVALID")
    tracks = getattr(package, "tracks", None)
    if not isinstance(tracks, (tuple, list)) or not tracks:
        raise BenchmarkEvidenceError("BENCHMARK_TRACKS_INVALID")
    payload = {
        "schema": "tda_benchmark_sample_v1",
        "source_sha256": source_sha256,
        "start_seconds": 0.0,
        "end_seconds": 300.0,
        "tracks": [
            {
                "number": int(getattr(track, "number")),
                "sha256": _sha(getattr(track, "sha256", None), "BENCHMARK_TRACK_HASH_INVALID"),
            }
            for track in tracks
        ],
    }
    return _sha_bytes(_canonical(payload))


def _junction(path: Path) -> bool:
    checker = getattr(path, "is_junction", None)
    return bool(checker()) if callable(checker) else False


def _reject_link(path: Path, code: str) -> None:
    if path.is_symlink() or _junction(path):
        raise BenchmarkEvidenceError(code)


def benchmarks_root(package_root: Path) -> Path:
    package = package_root.resolve()
    _reject_link(package_root, "BENCHMARK_PACKAGE_ROOT_UNSAFE")
    root = package / "benchmarks"
    _reject_link(root, "BENCHMARK_ROOT_UNSAFE")
    root.mkdir(parents=True, exist_ok=True)
    if root.resolve().parent != package:
        raise BenchmarkEvidenceError("BENCHMARK_ROOT_UNSAFE")
    return root


def bundle_root(package_root: Path, benchmark_id: str) -> Path:
    benchmark_id = _identifier(benchmark_id, "BENCHMARK_ID_INVALID")
    root = benchmarks_root(package_root)
    candidate = root / benchmark_id
    _reject_link(candidate, "BENCHMARK_PATH_UNSAFE")
    if candidate.resolve().parent != root.resolve():
        raise BenchmarkEvidenceError("BENCHMARK_PATH_UNSAFE")
    return candidate


def _profile_root(package_root: Path, benchmark_id: str, profile_id: str) -> Path:
    if profile_id not in CANONICAL_PROFILES:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_INVALID")
    root = bundle_root(package_root, benchmark_id)
    profiles = root / "profiles"
    _reject_link(profiles, "BENCHMARK_PROFILE_ROOT_UNSAFE")
    profiles.mkdir(parents=True, exist_ok=True)
    candidate = profiles / profile_id
    _reject_link(candidate, "BENCHMARK_PROFILE_PATH_UNSAFE")
    if candidate.resolve().parent != profiles.resolve():
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_PATH_UNSAFE")
    return candidate


def _write_bytes(path: Path, payload: bytes) -> dict[str, Any]:
    if len(payload) > _MAX_JSON_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_TOO_LARGE")
    atomic_write(path, payload)
    return {"sha256": _sha_bytes(payload), "size_bytes": len(payload)}


def _read_verified(path: Path, descriptor: Mapping[str, Any], code: str) -> bytes:
    _reject_link(path, f"{code}_PATH_UNSAFE")
    digest = _sha(descriptor.get("sha256"), f"{code}_HASH_INVALID")
    size = descriptor.get("size_bytes")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0 or size > _MAX_JSON_BYTES:
        raise BenchmarkEvidenceError(f"{code}_SIZE_INVALID")
    try:
        stat = path.stat()
        if not path.is_file() or stat.st_size != size:
            raise BenchmarkEvidenceError(f"{code}_SIZE_MISMATCH")
        raw = path.read_bytes()
    except FileNotFoundError as exc:
        raise BenchmarkEvidenceError(f"{code}_MISSING") from exc
    except OSError as exc:
        raise BenchmarkEvidenceError(f"{code}_READ_FAILED") from exc
    if _sha_bytes(raw) != digest:
        raise BenchmarkEvidenceError(f"{code}_HASH_MISMATCH")
    return raw


def _json(raw: bytes, code: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkEvidenceError(f"{code}_INVALID") from exc
    if not isinstance(value, dict):
        raise BenchmarkEvidenceError(f"{code}_INVALID")
    return value


def sanitize_benchmark_event(
    value: Mapping[str, Any],
    *,
    benchmark_id: str,
    profile_id: str,
    attempt: int,
    seq: int,
    relative_ms: int,
) -> dict[str, Any]:
    _identifier(benchmark_id, "BENCHMARK_ID_INVALID")
    if profile_id not in CANONICAL_PROFILES:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_INVALID")
    if isinstance(attempt, bool) or not isinstance(attempt, int) or attempt < 1:
        raise BenchmarkEvidenceError("BENCHMARK_ATTEMPT_INVALID")
    if isinstance(seq, bool) or not isinstance(seq, int) or seq < 1:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_SEQ_INVALID")
    if isinstance(relative_ms, bool) or not isinstance(relative_ms, int) or relative_ms < 0:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_TIME_INVALID")

    raw_type = value.get("type", "event")
    event_type = raw_type if raw_type in {"stage", "event", "progress", "warning", "error", "terminal"} else "event"
    code = value.get("code")
    if code is not None and (not isinstance(code, str) or not _CODE.fullmatch(code)):
        code = "BENCHMARK_EVENT_REDACTED"
    stage = value.get("stage")
    if not isinstance(stage, str) or not re.fullmatch(r"[a-z0-9_-]{1,64}", stage):
        stage = None

    raw_data = value.get("data") if isinstance(value.get("data"), dict) else value
    data: dict[str, Any] = {}
    for key in sorted(_EVENT_DATA_KEYS):
        item = raw_data.get(key) if isinstance(raw_data, Mapping) else None
        if item is None or key in {"stage", "profile", "profile_id"}:
            continue
        if isinstance(item, bool):
            data[key] = item
        elif isinstance(item, int) and abs(item) <= (1 << 53) - 1:
            data[key] = item
        elif isinstance(item, float) and math.isfinite(item) and abs(item) <= (1 << 53) - 1:
            data[key] = item
        elif isinstance(item, str) and len(item) <= 160 and not _PATHISH.search(item):
            data[key] = item

    event = {
        "schema_version": EVENT_SCHEMA,
        "seq": seq,
        "relative_ms": relative_ms,
        "benchmark_id": benchmark_id,
        "attempt": attempt,
        "profile_id": profile_id,
        "type": event_type,
        "stage": stage,
        "code": code,
        "data": data,
    }
    encoded = _canonical(event)
    if len(encoded) > _MAX_EVENT_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_TOO_LARGE")
    return event


def _events_payload(events: Iterable[Mapping[str, Any]]) -> bytes:
    rows = list(events)
    if len(rows) > _MAX_EVENTS:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_COUNT_LIMIT")
    payload = b"".join(_canonical(row) + b"\n" for row in rows)
    if len(payload) > _MAX_EVENT_FILE_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_FILE_LIMIT")
    return payload


def _percentile(values: Sequence[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return round(float(ordered[index]), 6)


def summarize_telemetry(
    samples: Iterable[Mapping[str, Any]],
    *,
    interval_ms: int,
    expected_samples: int,
    expected_gpu_identity: str | None = None,
) -> dict[str, Any]:
    if isinstance(interval_ms, bool) or not isinstance(interval_ms, int) or interval_ms < 100:
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_INTERVAL_INVALID")
    if isinstance(expected_samples, bool) or not isinstance(expected_samples, int) or expected_samples < 1:
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_EXPECTED_INVALID")
    rows = list(samples)
    if len(rows) > 10_000:
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_COUNT_LIMIT")
    numeric_keys = (
        "gpu_utilization_percent",
        "vram_used_bytes",
        "vram_total_bytes",
        "temperature_c",
        "power_w",
        "cpu_utilization_percent",
        "ram_used_bytes",
        "ram_percent",
    )
    sanitized: list[dict[str, Any]] = []
    previous_ms = -1
    for seq, raw in enumerate(rows, start=1):
        relative_ms = raw.get("relative_ms")
        if (
            isinstance(relative_ms, bool)
            or not isinstance(relative_ms, int)
            or relative_ms < 0
            or relative_ms < previous_ms
        ):
            raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_TIME_INVALID")
        previous_ms = relative_ms
        gpu_identity = raw.get("gpu_identity")
        if gpu_identity is not None:
            if not isinstance(gpu_identity, str) or not 1 <= len(gpu_identity) <= 160 or _PATHISH.search(gpu_identity):
                raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_GPU_INVALID")
            if expected_gpu_identity is not None and gpu_identity != expected_gpu_identity:
                raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_GPU_MISMATCH")
        row: dict[str, Any] = {
            "schema_version": TELEMETRY_SCHEMA,
            "seq": seq,
            "relative_ms": relative_ms,
            "gpu_identity": gpu_identity,
        }
        for key in numeric_keys:
            value = raw.get(key)
            if value is None:
                row[key] = None
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)) or float(value) < 0:
                raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_VALUE_INVALID")
            row[key] = float(value)
        sanitized.append(row)

    def values(key: str) -> list[float]:
        return [float(row[key]) for row in sanitized if row.get(key) is not None]

    def average(key: str) -> float | None:
        selected = values(key)
        return None if not selected else round(sum(selected) / len(selected), 6)

    coverage = min(1.0, len(sanitized) / expected_samples)
    return {
        "schema_version": "tda_benchmark_telemetry_summary_v1",
        "sampler": "synthetic-or-platform",
        "interval_ms": interval_ms,
        "expected_samples": expected_samples,
        "captured_samples": len(sanitized),
        "coverage": round(coverage, 6),
        "missing_reason": "SAMPLER_NOT_AVAILABLE" if not sanitized else None,
        "gpu_identity": expected_gpu_identity,
        "vram_peak_bytes": max(values("vram_used_bytes"), default=None),
        "vram_average_bytes": average("vram_used_bytes"),
        "vram_p95_bytes": _percentile(values("vram_used_bytes"), 0.95),
        "gpu_utilization_average_percent": average("gpu_utilization_percent"),
        "gpu_utilization_p95_percent": _percentile(values("gpu_utilization_percent"), 0.95),
        "gpu_utilization_peak_percent": max(values("gpu_utilization_percent"), default=None),
        "cpu_average_percent": average("cpu_utilization_percent"),
        "cpu_p95_percent": _percentile(values("cpu_utilization_percent"), 0.95),
        "ram_peak_bytes": max(values("ram_used_bytes"), default=None),
        "temperature_max_c": max(values("temperature_c"), default=None),
        "power_average_w": average("power_w"),
        "power_peak_w": max(values("power_w"), default=None),
        "samples": sanitized,
    }


def build_metrics(
    document: TranscriptDocument,
    receipt: Mapping[str, Any],
    *,
    benchmark_id: str,
    sample_identity_sha256: str,
    context: str,
    glossary: str,
) -> dict[str, Any]:
    document.validate()
    processing = document.stats.processing_metrics
    if not isinstance(processing, dict) or processing.get("version") != "engine_processing_v1":
        raise BenchmarkEvidenceError("BENCHMARK_PROCESSING_METRICS_REQUIRED")
    lineage = receipt.get("execution_lineage")
    if not isinstance(lineage, dict):
        raise BenchmarkEvidenceError("BENCHMARK_EXECUTION_LINEAGE_REQUIRED")
    profile_id = str(receipt.get("profile_id"))
    if profile_id not in CANONICAL_PROFILES or document.engine.profile != profile_id:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MISMATCH")
    return {
        "schema_version": METRICS_SCHEMA,
        "benchmark_id": benchmark_id,
        "profile_id": profile_id,
        "sample_identity_sha256": _sha(sample_identity_sha256, "BENCHMARK_SAMPLE_HASH_INVALID"),
        "processing_timing_version": processing["version"],
        "stage_seconds": dict(processing["stage_seconds"]),
        "total_processing_seconds": processing["total_processing_seconds"],
        "external_preparation_included": processing["external_preparation_included"],
        "fresh_asr_tracks": processing["fresh_asr_tracks"],
        "text_checkpoint_reused_tracks": processing["text_checkpoint_reused_tracks"],
        "completed_checkpoint_reused_tracks": processing["completed_checkpoint_reused_tracks"],
        "fresh_audio_work_seconds": processing["fresh_audio_work_seconds"],
        "reused_audio_work_seconds": processing["reused_audio_work_seconds"],
        "fresh_calibration_eligible": processing["fresh_calibration_eligible"],
        "audio_work_seconds": document.stats.audio_work_seconds,
        "session_duration_seconds": document.stats.session_duration_seconds,
        "rtf": document.stats.rtf,
        "word_count": document.stats.word_count,
        "segment_count": document.stats.segment_count,
        "turn_count": document.stats.turn_count,
        "track_count": document.stats.track_count,
        "deduplicated_segment_count": document.stats.deduplicated_segment_count,
        "warning_count": len(document.warnings),
        "warnings": [
            warning
            for warning in document.warnings
            if isinstance(warning, str)
            and len(warning) <= 256
            and _PATHISH.search(warning) is None
        ][:256],
        "engine": {
            "engine": document.engine.engine,
            "model": document.engine.model,
            "model_revision": document.engine.model_revision,
            "compute_type": document.engine.compute_type,
            "alignment": document.engine.alignment,
        },
        "execution_lineage": lineage,
        "context_sha256": _sha_text(context),
        "context_length": len(context),
        "glossary_sha256": _sha_text(glossary),
        "glossary_length": len(glossary),
        "telemetry": {
            "available": False,
            "sampler": None,
            "interval_ms": None,
            "captured_samples": 0,
            "coverage": None,
            "missing_reason": "SAMPLER_NOT_AVAILABLE",
        },
    }


def write_profile_artifact(
    package_root: Path,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    sample_identity_sha256: str,
    document: TranscriptDocument,
    receipt: Mapping[str, Any],
    context: str,
    glossary: str,
    events: Iterable[Mapping[str, Any]] = (),
    telemetry_samples: Iterable[Mapping[str, Any]] | None = None,
    telemetry_interval_ms: int = 1000,
    telemetry_expected_samples: int = 300,
    telemetry_gpu_identity: str | None = None,
) -> dict[str, Any]:
    profile_id = str(receipt.get("profile_id"))
    root = _profile_root(package_root, benchmark_id, profile_id)
    root.mkdir(parents=True, exist_ok=True)
    if (root / "profile.json").exists():
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ALREADY_COMMITTED")

    transcript_payload = _canonical(document.as_dict())
    transcript_meta = _write_bytes(root / "transcript.json", transcript_payload)
    metrics = build_metrics(
        document,
        receipt,
        benchmark_id=benchmark_id,
        sample_identity_sha256=sample_identity_sha256,
        context=context,
        glossary=glossary,
    )
    telemetry_meta = None
    if telemetry_samples is not None:
        telemetry = summarize_telemetry(
            telemetry_samples,
            interval_ms=telemetry_interval_ms,
            expected_samples=telemetry_expected_samples,
            expected_gpu_identity=telemetry_gpu_identity,
        )
        telemetry_rows = telemetry.pop("samples")
        telemetry_payload = _events_payload(telemetry_rows)
        telemetry_meta = _write_bytes(root / "telemetry.jsonl", telemetry_payload)
        metrics["telemetry"] = telemetry
    metrics_meta = _write_bytes(root / "metrics.json", _canonical(metrics))
    event_payload = _events_payload(events)
    events_meta = _write_bytes(root / "events.jsonl", event_payload)

    artifacts = {
        "transcript.json": transcript_meta,
        "metrics.json": metrics_meta,
        "events.jsonl": events_meta,
    }
    if telemetry_meta is not None:
        artifacts["telemetry.jsonl"] = telemetry_meta

    manifest = {
        "schema_version": PROFILE_SCHEMA,
        "benchmark_id": benchmark_id,
        "job_id": _identifier(job_id, "BENCHMARK_JOB_ID_INVALID"),
        "attempt": attempt,
        "profile_id": profile_id,
        "sample_identity_sha256": _sha(sample_identity_sha256, "BENCHMARK_SAMPLE_HASH_INVALID"),
        "transcript_schema_version": document.schema_version,
        "artifacts": artifacts,
        "execution_lineage": receipt.get("execution_lineage"),
        "completed_at": utc_now(),
    }
    manifest_meta = _write_bytes(root / "profile.json", _canonical(manifest))
    return {**manifest, "profile_manifest": manifest_meta}


def _load_profile_manifest(
    package_root: Path,
    benchmark_id: str,
    profile_id: str,
    *,
    verify_artifacts: bool,
) -> dict[str, Any]:
    root = _profile_root(package_root, benchmark_id, profile_id)
    try:
        raw = (root / "profile.json").read_bytes()
    except FileNotFoundError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_INCOMPLETE") from exc
    except OSError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_READ_FAILED") from exc
    if len(raw) > _MAX_JSON_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_TOO_LARGE")
    value = _json(raw, "BENCHMARK_PROFILE_MANIFEST")
    if (
        value.get("schema_version") != PROFILE_SCHEMA
        or value.get("benchmark_id") != benchmark_id
        or value.get("profile_id") != profile_id
    ):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_MISMATCH")
    artifacts = value.get("artifacts")
    if not isinstance(artifacts, dict):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ARTIFACTS_INVALID")
    for required in ("transcript.json", "metrics.json", "events.jsonl"):
        descriptor = artifacts.get(required)
        if not isinstance(descriptor, dict):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ARTIFACTS_INVALID")
        if verify_artifacts:
            _read_verified(root / required, descriptor, "BENCHMARK_PROFILE_ARTIFACT")
    return value


def commit_bundle(
    package_root: Path,
    *,
    benchmark_id: str,
    source_id: str,
    source_sha256: str,
    job_id: str,
    attempt: int,
    sample_identity_sha256: str,
    sample_seconds: float,
    track_count: int,
    audio_work_seconds: float,
    context: str = "",
    glossary: str = "",
    profiles: Sequence[str] = CANONICAL_PROFILES,
) -> dict[str, Any]:
    if tuple(profiles) != CANONICAL_PROFILES:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_SET_INVALID")
    if sample_seconds != 300.0:
        raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_INVALID")
    if isinstance(track_count, bool) or not isinstance(track_count, int) or track_count < 1:
        raise BenchmarkEvidenceError("BENCHMARK_TRACK_COUNT_INVALID")
    if (
        isinstance(audio_work_seconds, bool)
        or not isinstance(audio_work_seconds, (int, float))
        or not math.isfinite(float(audio_work_seconds))
        or float(audio_work_seconds) <= 0
    ):
        raise BenchmarkEvidenceError("BENCHMARK_AUDIO_WORK_INVALID")

    root = bundle_root(package_root, benchmark_id)
    if (root / "benchmark.json").exists():
        raise BenchmarkEvidenceError("BENCHMARK_ALREADY_COMMITTED")
    profile_entries: list[dict[str, Any]] = []
    for profile_id in CANONICAL_PROFILES:
        manifest = _load_profile_manifest(
            package_root,
            benchmark_id,
            profile_id,
            verify_artifacts=True,
        )
        if (
            manifest.get("job_id") != job_id
            or manifest.get("attempt") != attempt
            or manifest.get("sample_identity_sha256") != sample_identity_sha256
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_BINDING_MISMATCH")
        profile_raw = (root / "profiles" / profile_id / "profile.json").read_bytes()
        transcript = manifest["artifacts"]["transcript.json"]
        metrics = manifest["artifacts"]["metrics.json"]
        events = manifest["artifacts"]["events.jsonl"]
        telemetry = manifest["artifacts"].get("telemetry.jsonl")
        profile_entries.append(
            {
                "profile_id": profile_id,
                "profile_manifest": {
                    "path": f"profiles/{profile_id}/profile.json",
                    "sha256": _sha_bytes(profile_raw),
                    "size_bytes": len(profile_raw),
                },
                "transcript": {
                    "path": f"profiles/{profile_id}/transcript.json",
                    "sha256": transcript["sha256"],
                    "size_bytes": transcript["size_bytes"],
                },
                "metrics": {
                    "path": f"profiles/{profile_id}/metrics.json",
                    "sha256": metrics["sha256"],
                    "size_bytes": metrics["size_bytes"],
                },
                "events": {
                    "path": f"profiles/{profile_id}/events.jsonl",
                    "sha256": events["sha256"],
                    "size_bytes": events["size_bytes"],
                },
                "telemetry": (
                    {
                        "path": f"profiles/{profile_id}/telemetry.jsonl",
                        "sha256": telemetry["sha256"],
                        "size_bytes": telemetry["size_bytes"],
                    }
                    if isinstance(telemetry, dict)
                    else None
                ),
                # Additive aliases keep the first evidence-v1 physical receipt compatible.
                "profile_manifest_sha256": _sha_bytes(profile_raw),
                "profile_manifest_size_bytes": len(profile_raw),
                "transcript_sha256": transcript["sha256"],
                "metrics_sha256": metrics["sha256"],
                "events_sha256": events["sha256"],
            }
        )

    manifest = {
        "schema_version": BUNDLE_SCHEMA,
        "benchmark_id": benchmark_id,
        "source_id": _identifier(source_id, "BENCHMARK_SOURCE_ID_INVALID"),
        "source_sha256": _sha(source_sha256, "BENCHMARK_SOURCE_HASH_INVALID"),
        "job_id": _identifier(job_id, "BENCHMARK_JOB_ID_INVALID"),
        "attempt": attempt,
        "sample_identity_sha256": _sha(sample_identity_sha256, "BENCHMARK_SAMPLE_HASH_INVALID"),
        "sample": {"start_seconds": 0.0, "end_seconds": 300.0},
        "sample_seconds": 300.0,
        "track_count": track_count,
        "audio_work_seconds": round(float(audio_work_seconds), 3),
        "context_sha256": _sha_text(context),
        "context_length": len(context),
        "glossary_sha256": _sha_text(glossary),
        "glossary_length": len(glossary),
        "execution_mode": "prepared_artifacts_fresh_worker_per_profile_v2_evidence",
        "profile_order": list(CANONICAL_PROFILES),
        "status": "completed",
        "profiles": profile_entries,
        "committed_at": utc_now(),
    }
    _write_bytes(root / "benchmark.json", _canonical(manifest))
    return manifest


def load_bundle(
    package_root: Path,
    benchmark_id: str,
    *,
    verify_artifacts: bool = True,
) -> dict[str, Any]:
    root = bundle_root(package_root, benchmark_id)
    path = root / "benchmark.json"
    _reject_link(path, "BENCHMARK_MANIFEST_PATH_UNSAFE")
    try:
        raw = path.read_bytes()
    except FileNotFoundError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_INCOMPLETE") from exc
    except OSError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_READ_FAILED") from exc
    if len(raw) > _MAX_JSON_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_TOO_LARGE")
    value = _json(raw, "BENCHMARK_MANIFEST")
    if (
        value.get("schema_version") != BUNDLE_SCHEMA
        or value.get("benchmark_id") != benchmark_id
        or value.get("status") != "completed"
        or value.get("profile_order") != list(CANONICAL_PROFILES)
    ):
        raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_MISMATCH")
    profiles = value.get("profiles")
    if not isinstance(profiles, list) or [item.get("profile_id") for item in profiles if isinstance(item, dict)] != list(CANONICAL_PROFILES):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_SET_INVALID")
    for entry in profiles:
        profile_id = str(entry["profile_id"])
        profile_path = root / "profiles" / profile_id / "profile.json"
        profile_descriptor = entry.get("profile_manifest")
        if (
            not isinstance(profile_descriptor, dict)
            or profile_descriptor.get("path") != f"profiles/{profile_id}/profile.json"
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_PATH_MISMATCH")
        profile_raw = _read_verified(
            profile_path,
            profile_descriptor,
            "BENCHMARK_PROFILE_MANIFEST",
        )
        profile = _json(profile_raw, "BENCHMARK_PROFILE_MANIFEST")
        if (
            profile.get("benchmark_id") != benchmark_id
            or profile.get("profile_id") != profile_id
            or profile.get("job_id") != value.get("job_id")
            or profile.get("attempt") != value.get("attempt")
            or profile.get("sample_identity_sha256") != value.get("sample_identity_sha256")
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_MISMATCH")
        artifacts = profile.get("artifacts")
        if not isinstance(artifacts, dict):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ARTIFACTS_INVALID")
        for top_name, filename in (
            ("transcript", "transcript.json"),
            ("metrics", "metrics.json"),
            ("events", "events.jsonl"),
        ):
            top_descriptor = entry.get(top_name)
            profile_descriptor = artifacts.get(filename)
            if (
                not isinstance(top_descriptor, dict)
                or not isinstance(profile_descriptor, dict)
                or top_descriptor.get("path") != f"profiles/{profile_id}/{filename}"
                or top_descriptor.get("sha256") != profile_descriptor.get("sha256")
                or top_descriptor.get("size_bytes") != profile_descriptor.get("size_bytes")
            ):
                raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_DESCRIPTOR_MISMATCH")
        top_telemetry = entry.get("telemetry")
        profile_telemetry = artifacts.get("telemetry.jsonl")
        if (top_telemetry is None) != (profile_telemetry is None):
            raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_DESCRIPTOR_MISMATCH")
        if isinstance(top_telemetry, dict) and isinstance(profile_telemetry, dict):
            if (
                top_telemetry.get("path") != f"profiles/{profile_id}/telemetry.jsonl"
                or top_telemetry.get("sha256") != profile_telemetry.get("sha256")
                or top_telemetry.get("size_bytes") != profile_telemetry.get("size_bytes")
            ):
                raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_DESCRIPTOR_MISMATCH")
        if verify_artifacts:
            _load_profile_manifest(package_root, benchmark_id, profile_id, verify_artifacts=True)
    return value


def bundle_descriptor(package_root: Path, benchmark_id: str) -> dict[str, Any]:
    manifest = load_bundle(package_root, benchmark_id, verify_artifacts=True)
    root = bundle_root(package_root, benchmark_id)
    manifest_raw = (root / "benchmark.json").read_bytes()
    total_size = len(manifest_raw)
    for entry in manifest["profiles"]:
        for name in ("profile_manifest", "transcript", "metrics", "events", "telemetry"):
            descriptor = entry.get(name)
            if isinstance(descriptor, dict):
                total_size += int(descriptor.get("size_bytes", 0))
    return {
        "benchmark_id": benchmark_id,
        "schema_version": BUNDLE_SCHEMA,
        "manifest_sha256": _sha_bytes(manifest_raw),
        "manifest_size_bytes": len(manifest_raw),
        "bundle_size_bytes": total_size,
        "profile_count": len(CANONICAL_PROFILES),
    }


def load_profile_transcript(package_root: Path, benchmark_id: str, profile_id: str) -> TranscriptDocument:
    load_bundle(package_root, benchmark_id, verify_artifacts=False)
    manifest = _load_profile_manifest(package_root, benchmark_id, profile_id, verify_artifacts=False)
    descriptor = manifest["artifacts"]["transcript.json"]
    raw = _read_verified(
        _profile_root(package_root, benchmark_id, profile_id) / "transcript.json",
        descriptor,
        "BENCHMARK_TRANSCRIPT",
    )
    return TranscriptDocument.from_dict(_json(raw, "BENCHMARK_TRANSCRIPT"))


def load_profile_metrics(package_root: Path, benchmark_id: str, profile_id: str) -> dict[str, Any]:
    load_bundle(package_root, benchmark_id, verify_artifacts=False)
    manifest = _load_profile_manifest(package_root, benchmark_id, profile_id, verify_artifacts=False)
    raw = _read_verified(
        _profile_root(package_root, benchmark_id, profile_id) / "metrics.json",
        manifest["artifacts"]["metrics.json"],
        "BENCHMARK_METRICS",
    )
    value = _json(raw, "BENCHMARK_METRICS")
    if (
        value.get("schema_version") != METRICS_SCHEMA
        or value.get("benchmark_id") != benchmark_id
        or value.get("profile_id") != profile_id
    ):
        raise BenchmarkEvidenceError("BENCHMARK_METRICS_MISMATCH")
    return value


def load_profile_events(package_root: Path, benchmark_id: str, profile_id: str) -> list[dict[str, Any]]:
    load_bundle(package_root, benchmark_id, verify_artifacts=False)
    manifest = _load_profile_manifest(package_root, benchmark_id, profile_id, verify_artifacts=False)
    raw = _read_verified(
        _profile_root(package_root, benchmark_id, profile_id) / "events.jsonl",
        manifest["artifacts"]["events.jsonl"],
        "BENCHMARK_EVENTS",
    )
    if len(raw) > _MAX_EVENT_FILE_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_FILE_LIMIT")
    rows: list[dict[str, Any]] = []
    for line in raw.splitlines():
        if not line:
            continue
        if len(line) > _MAX_EVENT_BYTES:
            raise BenchmarkEvidenceError("BENCHMARK_EVENT_TOO_LARGE")
        value = _json(line, "BENCHMARK_EVENT")
        if (
            value.get("schema_version") != EVENT_SCHEMA
            or value.get("benchmark_id") != benchmark_id
            or value.get("profile_id") != profile_id
        ):
            raise BenchmarkEvidenceError("BENCHMARK_EVENT_MISMATCH")
        rows.append(value)
        if len(rows) > _MAX_EVENTS:
            raise BenchmarkEvidenceError("BENCHMARK_EVENT_COUNT_LIMIT")
    return rows


def transcript_text(document: TranscriptDocument, *, timestamps: bool = True) -> str:
    document.validate()
    lines: list[str] = []
    if document.turns:
        for turn in document.turns:
            prefix = f"[{_clock(turn.start)}] " if timestamps else ""
            lines.append(f"{prefix}{turn.speaker}\n{turn.text.strip()}")
    else:
        segments = [
            (track.timeline_offset_seconds + segment.start, track.speaker, segment.text)
            for track in document.tracks
            for segment in track.segments
        ]
        for start, speaker, text in sorted(segments):
            prefix = f"[{_clock(start)}] " if timestamps else ""
            lines.append(f"{prefix}{speaker}\n{text.strip()}")
    return "\n\n".join(lines).rstrip() + "\n"


def _clock(seconds: float, *, srt: bool = False) -> str:
    total_ms = max(0, round(float(seconds) * 1000))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    separator = "," if srt else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def _timed_rows(document: TranscriptDocument) -> list[tuple[float, float, str, str]]:
    document.validate()
    rows: list[tuple[float, float, str, str]] = []
    if document.turns:
        rows.extend((turn.start, turn.end, turn.speaker, turn.text.strip()) for turn in document.turns)
    else:
        for track in document.tracks:
            for segment in track.segments:
                rows.append(
                    (
                        track.timeline_offset_seconds + segment.start,
                        track.timeline_offset_seconds + segment.end,
                        track.speaker,
                        segment.text.strip(),
                    )
                )
    rows.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
    previous = 0.0
    validated: list[tuple[float, float, str, str]] = []
    for start, end, speaker, text in rows:
        if start < 0 or end < start or start + 0.001 < previous:
            raise BenchmarkEvidenceError("BENCHMARK_TIMED_EXPORT_INVALID")
        previous = start
        validated.append((start, end, speaker, text))
    return validated


def transcript_vtt(document: TranscriptDocument) -> str:
    rows = _timed_rows(document)
    body = ["WEBVTT", ""]
    for start, end, speaker, text in rows:
        body.extend([f"{_clock(start)} --> {_clock(end)}", f"{speaker}: {text}", ""])
    return "\n".join(body)


def transcript_srt(document: TranscriptDocument) -> str:
    rows = _timed_rows(document)
    body: list[str] = []
    for index, (start, end, speaker, text) in enumerate(rows, start=1):
        body.extend(
            [
                str(index),
                f"{_clock(start, srt=True)} --> {_clock(end, srt=True)}",
                f"{speaker}: {text}",
                "",
            ]
        )
    return "\n".join(body)


def deterministic_private_zip(package_root: Path, benchmark_id: str) -> bytes:
    manifest = load_bundle(package_root, benchmark_id, verify_artifacts=True)
    root = bundle_root(package_root, benchmark_id)
    entries: dict[str, bytes] = {"benchmark.json": _canonical(manifest)}
    for profile_id in CANONICAL_PROFILES:
        profile_root = root / "profiles" / profile_id
        profile = _load_profile_manifest(package_root, benchmark_id, profile_id, verify_artifacts=True)
        for filename in ("profile.json", "transcript.json", "metrics.json", "events.jsonl"):
            entries[f"profiles/{profile_id}/{filename}"] = (profile_root / filename).read_bytes()
        document = load_profile_transcript(package_root, benchmark_id, profile_id)
        entries[f"profiles/{profile_id}/transcript.txt"] = transcript_text(document).encode("utf-8")
        entries[f"profiles/{profile_id}/transcript.vtt"] = transcript_vtt(document).encode("utf-8")
        entries[f"profiles/{profile_id}/transcript.srt"] = transcript_srt(document).encode("utf-8")
        telemetry = profile.get("artifacts", {}).get("telemetry.jsonl")
        if isinstance(telemetry, dict):
            entries[f"profiles/{profile_id}/telemetry.jsonl"] = _read_verified(
                profile_root / "telemetry.jsonl", telemetry, "BENCHMARK_TELEMETRY"
            )
    for folder in ("reference", "quality"):
        candidate = root / folder
        if candidate.exists():
            _reject_link(candidate, "BENCHMARK_EXPORT_PATH_UNSAFE")
            for path in sorted(candidate.rglob("*.json")):
                if path.is_symlink() or _junction(path):
                    raise BenchmarkEvidenceError("BENCHMARK_EXPORT_PATH_UNSAFE")
                relative = path.relative_to(root).as_posix()
                entries[relative] = path.read_bytes()

    buffer = io.BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(entries):
            if name.lower().endswith((".flac", ".wav", ".mp3", ".m4a", ".ogg", ".opus")):
                raise BenchmarkEvidenceError("BENCHMARK_EXPORT_AUDIO_FORBIDDEN")
            info = ZipInfo(name, date_time=_ZIP_DATE)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, entries[name])
    return buffer.getvalue()


def remove_incomplete_bundles(package_root: Path) -> int:
    root = benchmarks_root(package_root)
    removed = 0
    for candidate in tuple(root.iterdir()):
        if not candidate.is_dir() or candidate.is_symlink() or _junction(candidate):
            continue
        if not _ID.fullmatch(candidate.name):
            continue
        if (candidate / "benchmark.json").exists():
            continue
        shutil.rmtree(candidate)
        removed += 1
    return removed
