"""Immutable local Benchmark evidence bundles and deterministic private exports."""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import statistics
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from .atomic_storage import AtomicStorageError, atomic_write, confirm_existing_file
from .benchmark_bundles import (
    BenchmarkBundleError,
    benchmark_id_for as core_benchmark_id_for,
    benchmark_sample_identity_from_descriptor,
    claim_benchmark_outcome,
    load_benchmark_bundle as load_legacy_bundle,
    read_benchmark_transcript as read_legacy_transcript,
)
from .transcript import TranscriptDocument, TranscriptValidationError
from .worker_event_schema import sanitize_worker_event

BUNDLE_SCHEMA = "tda_benchmark_bundle_v1"
PROFILE_SCHEMA = "tda_benchmark_profile_artifact_v1"
METRICS_SCHEMA = "tda_benchmark_metrics_v1"
EVENT_SCHEMA = "tda_benchmark_event_v1"
TELEMETRY_SCHEMA = "tda_benchmark_telemetry_v1"
TELEMETRY_SAMPLE_SCHEMA = "tda_benchmark_telemetry_sample_v1"
FAILED_DIAGNOSTICS_SCHEMA = "tda_benchmark_failed_profile_v1"
EXPORT_SCHEMA = "tda_benchmark_private_export_v1"
PROFILES = ("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality")
_BENCHMARK_ID = re.compile(
    r"^(?:benchmark-[0-9a-f]{32}|benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5})$"
)
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAX_JSON_BYTES = 16 * 1024 * 1024
_MAX_JSONL_BYTES = 8 * 1024 * 1024
_MAX_EVENTS = 20_000
_MAX_TELEMETRY_SAMPLES = 2_000
_REQUIRED_PROFILE_ARTIFACTS = frozenset({"profile", "transcript", "metrics", "events"})
_OPTIONAL_PROFILE_ARTIFACTS = frozenset({"telemetry"})
_PROFILE_ARTIFACT_FILENAMES = {
    "profile": "profile.json",
    "transcript": "transcript.json",
    "metrics": "metrics.json",
    "events": "events.jsonl",
    "telemetry": "telemetry.jsonl",
}
_REPARSE_POINT = 0x400
_BENCHMARK_EVENT_DATA_FIELDS = frozenset({
    "stage", "track", "total_tracks", "segment", "window", "profile",
    "device", "compute_type", "runtime_version", "worker_sha256",
    "source_runtime_version", "source_signature_sha256",
    "track_count", "count", "sample_count", "aligned_reused", "text_reused",
    "text_compat_reused", "text_prefix_windows_reused", "reused_window_count",
    "durable_window_count", "pending_asr", "aligned_item", "aligned_word_count",
    "owned_word_count", "completed_window_count", "completed_segment_count",
    "downloaded_bytes", "total_bytes", "preloaded", "memory_error",
    "first_window", "last_window", "context_seconds", "window_start_seconds",
    "window_end_seconds", "ownership_left_seconds", "ownership_right_seconds",
    "overflow_seconds", "previous_end_seconds", "start_seconds", "end_seconds",
    "relative_start_seconds", "relative_end_seconds", "duration_ms",
    "peak_dbfs", "rms_dbfs", "silence_peak_threshold_dbfs",
    "silence_rms_threshold_dbfs", "failure_class", "reason",
    "completed", "total", "unit", "code",
})


class BenchmarkEvidenceError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def benchmark_id_for(job_id: str, attempt: int) -> str:
    try:
        return core_benchmark_id_for(job_id, attempt)
    except BenchmarkBundleError as exc:
        raise BenchmarkEvidenceError(str(exc)) from exc

def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path, maximum: int) -> tuple[str, int, bytes]:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_UNAVAILABLE") from exc
    if size < 1 or size > maximum:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SIZE_INVALID")
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_UNAVAILABLE") from exc
    if len(payload) != size:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SIZE_INVALID")
    return _sha256(payload), size, payload


def _is_reparse(path: Path) -> bool:
    try:
        attrs = getattr(path.stat(follow_symlinks=False), "st_file_attributes", 0)
    except (OSError, TypeError):
        return False
    return bool(attrs & _REPARSE_POINT)


def _check_owned_tree(root: Path, candidate: Path) -> None:
    root_abs = root.absolute()
    candidate_abs = candidate.absolute()
    try:
        candidate_abs.relative_to(root_abs)
    except ValueError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_PATH_ESCAPE") from exc
    current = root_abs
    for part in candidate_abs.relative_to(root_abs).parts:
        current = current / part
        if current.exists() and (current.is_symlink() or _is_reparse(current)):
            raise BenchmarkEvidenceError("BENCHMARK_PATH_REPARSE_REJECTED")


def benchmarks_root(data_root: Path) -> Path:
    root = data_root.absolute() / "benchmarks"
    _check_owned_tree(data_root.absolute(), root)
    return root


def benchmark_root(data_root: Path, benchmark_id: str) -> Path:
    if not isinstance(benchmark_id, str) or _BENCHMARK_ID.fullmatch(benchmark_id) is None:
        raise BenchmarkEvidenceError("BENCHMARK_ID_INVALID")
    root = benchmarks_root(data_root)
    destination = root / benchmark_id
    _check_owned_tree(root, destination)
    return destination


def profile_root(data_root: Path, benchmark_id: str, profile_id: str) -> Path:
    if profile_id not in PROFILES:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_INVALID")
    root = benchmark_root(data_root, benchmark_id)
    destination = root / "profiles" / profile_id
    _check_owned_tree(root, destination)
    return destination


def _descriptor(path: Path, *, maximum: int = _MAX_JSON_BYTES) -> dict[str, Any]:
    digest, size, _ = _sha256_file(path, maximum)
    return {"artifact": path.name, "sha256": digest, "size_bytes": size}


def _verified_descriptor_path(
    root: Path,
    profile_id: str,
    artifact: str,
    descriptor: Mapping[str, Any],
) -> Path:
    filename = _PROFILE_ARTIFACT_FILENAMES.get(artifact)
    if filename is None:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_INVALID")
    expected_relative = f"profiles/{profile_id}/{filename}"
    if (
        descriptor.get("artifact") != filename
        or descriptor.get("path") != expected_relative
        or not isinstance(descriptor.get("sha256"), str)
        or _SHA256.fullmatch(descriptor["sha256"]) is None
        or isinstance(descriptor.get("size_bytes"), bool)
        or not isinstance(descriptor.get("size_bytes"), int)
        or descriptor["size_bytes"] < 1
    ):
        raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
    path = root / expected_relative
    _check_owned_tree(root, path)
    return path


def _read_json(path: Path, *, maximum: int = _MAX_JSON_BYTES) -> dict[str, Any]:
    _, _, payload = _sha256_file(path, maximum)
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_JSON_INVALID") from exc
    if not isinstance(value, dict):
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_JSON_INVALID")
    return value


def _atomic_bytes(path: Path, payload: bytes) -> None:
    try:
        atomic_write(path, payload)
        return
    except AtomicStorageError as exc:
        if not exc.ambiguous or not path.is_file() or path.is_symlink() or _is_reparse(path):
            raise
    try:
        if path.stat().st_size != len(payload):
            raise BenchmarkEvidenceError("BENCHMARK_ATOMIC_WRITE_MISMATCH")
        if _sha256_file(path, max(len(payload), 1))[0] != _sha256(payload):
            raise BenchmarkEvidenceError("BENCHMARK_ATOMIC_WRITE_MISMATCH")
        confirm_existing_file(path)
    except (OSError, AtomicStorageError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_ATOMIC_WRITE_UNCONFIRMED") from exc


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    payload = _canonical_json(dict(value))
    if len(payload) > _MAX_JSON_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SIZE_INVALID")
    _atomic_bytes(path, payload)


def _semantic_document_sha256(document: TranscriptDocument) -> str:
    value = document.as_dict()
    value.pop("created_at", None)
    return _sha256(_canonical_json(value))


def _validate_transcript_paths(document: TranscriptDocument) -> None:
    for track in document.tracks:
        filename = track.source_filename
        if (
            Path(filename).is_absolute()
            or "/" in filename
            or "\\" in filename
            or "\0" in filename
        ):
            raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_PATH_INVALID")


def _validate_sample_descriptor(
    descriptor: Mapping[str, Any],
    *,
    source_sha256: str,
    sample_seconds: float,
    sample_identity_sha256: str,
) -> dict[str, Any]:
    try:
        normalized = {
            "schema": descriptor.get("schema"),
            "source_sha256": descriptor.get("source_sha256"),
            "start_seconds": descriptor.get("start_seconds"),
            "end_seconds": descriptor.get("end_seconds"),
            "tracks": [dict(item) for item in descriptor.get("tracks", [])],
        }
    except (TypeError, ValueError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID") from exc
    tracks = normalized["tracks"]
    seen: set[int] = set()
    if (
        normalized["schema"] != "tda_benchmark_sample_v1"
        or normalized["source_sha256"] != source_sha256
        or normalized["start_seconds"] != 0.0
        or normalized["end_seconds"] != sample_seconds
        or not isinstance(tracks, list)
        or not tracks
    ):
        raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
    for item in tracks:
        number = item.get("number")
        digest = item.get("sha256")
        if (
            isinstance(number, bool)
            or not isinstance(number, int)
            or number < 1
            or number in seen
            or not isinstance(digest, str)
            or _SHA256.fullmatch(digest) is None
        ):
            raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
        seen.add(number)
    try:
        expected = benchmark_sample_identity_from_descriptor(normalized)
    except BenchmarkBundleError as exc:
        raise BenchmarkEvidenceError(str(exc)) from exc
    if expected != sample_identity_sha256:
        raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_IDENTITY_MISMATCH")
    return normalized


def _hash_private_text(value: str) -> dict[str, Any]:
    payload = value.encode("utf-8")
    return {"sha256": _sha256(payload), "length": len(value), "utf8_bytes": len(payload)}


def _manifest_payload_sha256(manifest: Mapping[str, Any]) -> str:
    payload = dict(manifest)
    payload.pop("manifest_payload_sha256", None)
    return _sha256(_canonical_json(payload))


def _read_bundle_manifest(data_root: Path, benchmark_id: str) -> dict[str, Any]:
    root = benchmark_root(data_root, benchmark_id)
    manifest = _read_json(root / "benchmark.json")
    profiles = manifest.get("profiles")
    sample = manifest.get("sample")
    source_sha256 = manifest.get("source_sha256")
    source_id = manifest.get("source_id")
    sample_identity = manifest.get("sample_identity_sha256")
    integrity = manifest.get("manifest_payload_sha256")
    attempt = manifest.get("attempt")
    sample_seconds = manifest.get("sample_seconds")
    track_count = manifest.get("track_count")
    audio_work_seconds = manifest.get("audio_work_seconds")
    if (
        manifest.get("schema_version") != BUNDLE_SCHEMA
        or manifest.get("status") != "completed"
        or manifest.get("benchmark_id") != benchmark_id
        or manifest.get("profile_order") != list(PROFILES)
        or not isinstance(manifest.get("job_id"), str)
        or not manifest["job_id"]
        or isinstance(attempt, bool)
        or not isinstance(attempt, int)
        or attempt < 1
        or not isinstance(source_sha256, str)
        or _SHA256.fullmatch(source_sha256) is None
        or source_id != f"craig-{source_sha256}"
        or not isinstance(sample_identity, str)
        or _SHA256.fullmatch(sample_identity) is None
        or isinstance(sample_seconds, bool)
        or not isinstance(sample_seconds, (int, float))
        or float(sample_seconds) != 300.0
        or isinstance(track_count, bool)
        or not isinstance(track_count, int)
        or track_count < 1
        or isinstance(audio_work_seconds, bool)
        or not isinstance(audio_work_seconds, (int, float))
        or not math.isfinite(float(audio_work_seconds))
        or float(audio_work_seconds) < 0
        or not isinstance(sample, dict)
        or sample.get("start_seconds") != 0.0
        or sample.get("end_seconds") != sample_seconds
        or not isinstance(profiles, list)
        or [item.get("profile_id") for item in profiles if isinstance(item, dict)] != list(PROFILES)
        or not isinstance(integrity, str)
        or _SHA256.fullmatch(integrity) is None
    ):
        raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
    if _manifest_payload_sha256(manifest) != integrity:
        raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INTEGRITY_FAILED")
    return manifest


def bundle_manifest_sha256(data_root: Path, benchmark_id: str) -> str:
    _read_bundle_manifest(data_root, benchmark_id)
    digest, _, _ = _sha256_file(
        benchmark_root(data_root, benchmark_id) / "benchmark.json",
        _MAX_JSON_BYTES,
    )
    return digest


def write_profile_artifact(
    data_root: Path,
    document: TranscriptDocument,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    profile_id: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    execution_lineage: Mapping[str, Any],
) -> dict[str, Any]:
    """Commit one profile transcript/metrics. profile.json is the profile commit marker."""
    if profile_id not in PROFILES or document.engine.profile != profile_id:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MISMATCH")
    if _SHA256.fullmatch(sample_identity_sha256) is None or sample_seconds != 300.0:
        raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_IDENTITY_INVALID")
    document.validate()
    destination = profile_root(data_root, benchmark_id, profile_id)
    if (destination / "profile.json").exists():
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ALREADY_COMMITTED")
    destination.mkdir(parents=True, exist_ok=True)
    _check_owned_tree(benchmark_root(data_root, benchmark_id), destination)
    try:
        transcript_path = destination / "transcript.json"
        document.write_atomic(transcript_path)
        transcript = _descriptor(transcript_path)
        processing = document.stats.processing_metrics
        if not isinstance(processing, dict) or processing.get("version") != "engine_processing_v1":
            raise BenchmarkEvidenceError("BENCHMARK_PROCESSING_METRICS_REQUIRED")
        metrics = {
            "schema_version": METRICS_SCHEMA,
            "benchmark_id": benchmark_id,
            "job_id": job_id,
            "attempt": attempt,
            "profile_id": profile_id,
            "sample_identity_sha256": sample_identity_sha256,
            "sample_seconds": sample_seconds,
            "processing_metrics": processing,
            "processing_seconds": document.stats.processing_seconds,
            "rtf": document.stats.rtf,
            "audio_work_seconds": document.stats.audio_work_seconds,
            "session_duration_seconds": document.stats.session_duration_seconds,
            "track_count": document.stats.track_count,
            "word_count": document.stats.word_count,
            "segment_count": document.stats.segment_count,
            "turn_count": document.stats.turn_count,
            "deduplicated_segment_count": document.stats.deduplicated_segment_count,
            "warning_count": len(document.warnings),
            "execution_lineage": dict(execution_lineage),
            "external_preparation_included": False,
            "instrumentation_mode": "async_telemetry_sampler_v2",
            "event_policy": "protocol_semantic_events_v1_excludes_heartbeat",
        }
        metrics_path = destination / "metrics.json"
        _write_json(metrics_path, metrics)
        profile = {
            "schema_version": PROFILE_SCHEMA,
            "benchmark_id": benchmark_id,
            "job_id": job_id,
            "attempt": attempt,
            "profile_id": profile_id,
            "source_sha256": document.source_sha256.lower(),
            "sample_identity_sha256": sample_identity_sha256,
            "sample_seconds": sample_seconds,
            "transcript": transcript,
            "metrics": _descriptor(metrics_path),
            "execution_lineage": dict(execution_lineage),
            "completed_at": utc_now(),
        }
        _write_json(destination / "profile.json", profile)
        return profile
    except BaseException as exc:
        if not (isinstance(exc, AtomicStorageError) and exc.ambiguous) and not (destination / "profile.json").is_file():
            for child in ("transcript.json", "metrics.json", "events.jsonl", "telemetry.jsonl"):
                try:
                    (destination / child).unlink(missing_ok=True)
                except OSError:
                    pass
            try:
                destination.rmdir()
            except OSError:
                pass
        raise


def sanitize_benchmark_message(
    message: Any,
    *,
    benchmark_id: str,
    profile_id: str,
    sample_identity_sha256: str,
    relative_ms: int,
) -> dict[str, Any] | None:
    kind = getattr(message, "type", None)
    payload = getattr(message, "payload", None)
    if not isinstance(payload, dict) or kind == "heartbeat":
        return None
    row: dict[str, Any] = {
        "schema_version": EVENT_SCHEMA,
        "seq": int(getattr(message, "seq", 0)),
        "at": str(getattr(message, "at", ""))[:128],
        "relative_ms": max(0, int(relative_ms)),
        "benchmark_id": benchmark_id,
        "attempt": int(getattr(message, "attempt", 0)),
        "profile_id": profile_id,
        "sample_identity_sha256": sample_identity_sha256,
        "type": str(kind),
        "stage": None,
        "code": None,
        "data": {},
    }
    if kind == "event":
        clean = sanitize_worker_event(payload)
        row["code"] = clean.code
        row["data"] = {
            key: value
            for key, value in clean.data.items()
            if key in _BENCHMARK_EVENT_DATA_FIELDS
        }
        stage = clean.data.get("stage")
        if isinstance(stage, str):
            row["stage"] = stage[:64]
    elif kind == "stage":
        stage = payload.get("stage")
        if isinstance(stage, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", stage):
            row["stage"] = stage
        else:
            row["stage"] = "worker"
    elif kind == "progress":
        safe: dict[str, Any] = {}
        for key in ("completed", "total"):
            value = payload.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1_000_000:
                safe[key] = value
        for key in ("unit", "stage"):
            value = payload.get(key)
            if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", value):
                safe[key] = value
        row["stage"] = safe.get("stage")
        row["data"] = safe
    elif kind == "ready":
        row["code"] = "WORKER_READY"
    elif kind in {"result", "cancelled", "error"}:
        row["code"] = {
            "result": "WORKER_RESULT",
            "cancelled": "WORKER_CANCELLED",
            "error": "WORKER_ERROR",
        }[kind]
        code = payload.get("code")
        if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,96}", code):
            row["data"] = {"code": code}
        stage = payload.get("stage")
        if isinstance(stage, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", stage):
            row["stage"] = stage
    else:
        return None
    return row


def _validated_event_row(
    raw: Mapping[str, Any],
    *,
    benchmark_id: str,
    profile_id: str,
) -> dict[str, Any]:
    allowed = {
        "schema_version",
        "seq",
        "at",
        "relative_ms",
        "benchmark_id",
        "attempt",
        "profile_id",
        "sample_identity_sha256",
        "type",
        "stage",
        "code",
        "data",
    }
    row = dict(raw)
    if set(row) != allowed:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_FIELDS_INVALID")
    if (
        row.get("schema_version") != EVENT_SCHEMA
        or row.get("benchmark_id") != benchmark_id
        or row.get("profile_id") != profile_id
        or isinstance(row.get("seq"), bool)
        or not isinstance(row.get("seq"), int)
        or row["seq"] < 0
        or isinstance(row.get("relative_ms"), bool)
        or not isinstance(row.get("relative_ms"), int)
        or row["relative_ms"] < 0
        or isinstance(row.get("attempt"), bool)
        or not isinstance(row.get("attempt"), int)
        or row["attempt"] < 1
        or not isinstance(row.get("at"), str)
        or len(row["at"]) > 128
        or not isinstance(row.get("sample_identity_sha256"), str)
        or _SHA256.fullmatch(row["sample_identity_sha256"]) is None
        or row.get("type") not in {"ready", "stage", "progress", "event", "result", "cancelled", "error"}
        or (row.get("stage") is not None and (
            not isinstance(row["stage"], str)
            or re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", row["stage"]) is None
        ))
        or (row.get("code") is not None and (
            not isinstance(row["code"], str)
            or re.fullmatch(r"[A-Z0-9_]{1,96}", row["code"]) is None
        ))
        or not isinstance(row.get("data"), dict)
        or any(key not in _BENCHMARK_EVENT_DATA_FIELDS for key in row["data"])
        or any(
            isinstance(value, str) and (len(value) > 256 or "\0" in value)
            for value in row["data"].values()
        )
    ):
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_INVALID")
    encoded_data = _canonical_json(row["data"])
    if len(encoded_data) > 4096:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_DATA_TOO_LARGE")
    return row


def _event_jsonl(
    events: Iterable[Mapping[str, Any]],
    *,
    benchmark_id: str,
    profile_id: str,
    required_terminal: str,
) -> bytes:
    rows = [
        _validated_event_row(row, benchmark_id=benchmark_id, profile_id=profile_id)
        for row in events
    ]
    if not rows or len(rows) > _MAX_EVENTS:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_COUNT_INVALID")
    if any(right["seq"] <= left["seq"] for left, right in zip(rows, rows[1:])):
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_SEQUENCE_INVALID")
    if required_terminal not in {"result", "cancelled", "error"} or rows[-1]["type"] != required_terminal:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_TERMINAL_INVALID")
    payload = b"".join(_canonical_json(row) + b"\n" for row in rows)
    if len(payload) > _MAX_JSONL_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_EVENT_SIZE_INVALID")
    return payload


def write_profile_events(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    events: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    destination = profile_root(data_root, benchmark_id, profile_id)
    if not (destination / "profile.json").is_file():
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_UNCOMMITTED")
    payload = _event_jsonl(
        events,
        benchmark_id=benchmark_id,
        profile_id=profile_id,
        required_terminal="result",
    )
    path = destination / "events.jsonl"
    if path.exists():
        raise BenchmarkEvidenceError("BENCHMARK_EVENTS_ALREADY_COMMITTED")
    atomic_write(path, payload)
    return _descriptor(path, maximum=_MAX_JSONL_BYTES)


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))
    return round(float(ordered[index]), 3)


def _metric(values: Iterable[Any], mode: str) -> float | None:
    nums = [float(value) for value in values if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))]
    if not nums:
        return None
    if mode == "max":
        return round(max(nums), 3)
    if mode == "avg":
        return round(statistics.fmean(nums), 3)
    if mode == "p95":
        return _percentile(nums, 0.95)
    raise ValueError("BENCHMARK_TELEMETRY_AGGREGATE_INVALID")


def normalize_telemetry_samples(
    samples: Iterable[Mapping[str, Any]],
    *,
    lineage: Mapping[str, Any],
    interval_ms: int,
    elapsed_ms: int | None = None,
) -> dict[str, Any]:
    rows = list(samples)[:_MAX_TELEMETRY_SAMPLES]
    expected_gpu = lineage.get("gpu") if isinstance(lineage.get("gpu"), dict) else {}
    expected_uuid = expected_gpu.get("uuid")
    expected_pci = expected_gpu.get("pci_bus_id")
    expected_model = expected_gpu.get("model")
    output: list[dict[str, Any]] = []
    for index, sample in enumerate(rows):
        cpu = sample.get("cpu") if isinstance(sample.get("cpu"), dict) else {}
        memory = sample.get("memory") if isinstance(sample.get("memory"), dict) else {}
        gpus = sample.get("gpus") if isinstance(sample.get("gpus"), list) else []
        selected = None
        for gpu in gpus:
            if not isinstance(gpu, dict):
                continue
            if expected_uuid and gpu.get("uuid") == expected_uuid:
                selected = gpu
                break
            if expected_pci and gpu.get("pci_bus_id") == expected_pci:
                selected = gpu
                break
        if selected is None and not expected_uuid and not expected_pci and expected_model:
            model_matches = [
                gpu
                for gpu in gpus
                if isinstance(gpu, dict) and gpu.get("name") == expected_model
            ]
            if len(model_matches) == 1:
                selected = model_matches[0]
        output.append({
            "seq": index,
            "sampled_at": str(sample.get("sampled_at") or "")[:128],
            "cpu_utilization_percent": cpu.get("utilization_percent"),
            "memory_used_bytes": memory.get("used_bytes"),
            "memory_percent": memory.get("percent"),
            "gpu_utilization_percent": selected.get("utilization_percent") if selected else None,
            "gpu_memory_used_bytes": selected.get("memory_used_bytes") if selected else None,
            "gpu_memory_total_bytes": selected.get("memory_total_bytes") if selected else None,
            "gpu_temperature_c": selected.get("temperature_c") if selected else None,
            "gpu_power_w": selected.get("power_w") if selected else None,
        })
    expected_samples = (
        max(1, math.ceil(max(0, elapsed_ms) / interval_ms))
        if elapsed_ms is not None and interval_ms > 0
        else max(len(output), 1)
    )
    gpu_present = sum(1 for row in output if row["gpu_utilization_percent"] is not None)
    aggregates = {
        "cpu_avg_percent": _metric((row["cpu_utilization_percent"] for row in output), "avg"),
        "cpu_p95_percent": _metric((row["cpu_utilization_percent"] for row in output), "p95"),
        "ram_peak_bytes": _metric((row["memory_used_bytes"] for row in output), "max"),
        "gpu_utilization_avg_percent": _metric((row["gpu_utilization_percent"] for row in output), "avg"),
        "gpu_utilization_p95_percent": _metric((row["gpu_utilization_percent"] for row in output), "p95"),
        "gpu_utilization_peak_percent": _metric((row["gpu_utilization_percent"] for row in output), "max"),
        "vram_peak_bytes": _metric((row["gpu_memory_used_bytes"] for row in output), "max"),
        "temperature_max_c": _metric((row["gpu_temperature_c"] for row in output), "max"),
        "power_avg_w": _metric((row["gpu_power_w"] for row in output), "avg"),
        "power_peak_w": _metric((row["gpu_power_w"] for row in output), "max"),
    }
    return {
        "schema_version": TELEMETRY_SCHEMA,
        "sampler": "psutil+nvml_best_effort_v1",
        "interval_ms": interval_ms,
        "sampling_mode": "daemon_thread_outside_engine_processing_timer_v1",
        "captured_samples": len(output),
        "expected_samples": expected_samples,
        "coverage": round(min(len(output), expected_samples) / expected_samples, 6),
        "gpu_sample_coverage": round(min(gpu_present, expected_samples) / expected_samples, 6),
        "missing_reason": None if output else "sampler_unavailable",
        "selected_gpu": {
            "uuid": expected_uuid,
            "pci_bus_id": expected_pci,
            "model": expected_model,
        },
        "aggregates": aggregates,
        "samples": output,
    }


def _telemetry_jsonl(
    telemetry: Mapping[str, Any],
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    profile_id: str,
    sample_identity_sha256: str,
) -> bytes:
    samples = telemetry.get("samples")
    if not isinstance(samples, list) or len(samples) > _MAX_TELEMETRY_SAMPLES:
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_SAMPLES_INVALID")
    summary = {
        key: value
        for key, value in telemetry.items()
        if key != "samples"
    }
    summary.update({
        "record_type": "summary",
        "benchmark_id": benchmark_id,
        "job_id": job_id,
        "attempt": attempt,
        "profile_id": profile_id,
        "sample_identity_sha256": sample_identity_sha256,
    })
    rows = [_canonical_json(summary)]
    for sample in samples:
        if not isinstance(sample, dict):
            raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_SAMPLE_INVALID")
        row = {
            "schema_version": TELEMETRY_SAMPLE_SCHEMA,
            "record_type": "sample",
            "benchmark_id": benchmark_id,
            "job_id": job_id,
            "attempt": attempt,
            "profile_id": profile_id,
            "sample_identity_sha256": sample_identity_sha256,
            **sample,
        }
        rows.append(_canonical_json(row))
    payload = b"\n".join(rows) + b"\n"
    if len(payload) > _MAX_JSONL_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_SIZE_INVALID")
    return payload


def write_profile_telemetry(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    telemetry: Mapping[str, Any],
) -> dict[str, Any]:
    destination = profile_root(data_root, benchmark_id, profile_id)
    profile = _read_json(destination / "profile.json")
    if (
        profile.get("benchmark_id") != benchmark_id
        or profile.get("profile_id") != profile_id
        or not isinstance(profile.get("job_id"), str)
        or isinstance(profile.get("attempt"), bool)
        or not isinstance(profile.get("attempt"), int)
        or not isinstance(profile.get("sample_identity_sha256"), str)
    ):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    path = destination / "telemetry.jsonl"
    if path.exists():
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_ALREADY_COMMITTED")
    payload = _telemetry_jsonl(
        telemetry,
        benchmark_id=benchmark_id,
        job_id=profile["job_id"],
        attempt=profile["attempt"],
        profile_id=profile_id,
        sample_identity_sha256=profile["sample_identity_sha256"],
    )
    atomic_write(path, payload)
    return _descriptor(path, maximum=_MAX_JSONL_BYTES)


def telemetry_summary_from_bytes(payload: bytes) -> dict[str, Any]:
    first = payload.splitlines()[0] if payload else b""
    try:
        value = json.loads(first)
    except (UnicodeDecodeError, json.JSONDecodeError, IndexError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_JSONL_INVALID") from exc
    if not isinstance(value, dict) or value.get("schema_version") != TELEMETRY_SCHEMA:
        raise BenchmarkEvidenceError("BENCHMARK_TELEMETRY_JSONL_INVALID")
    return value


def write_failed_profile_diagnostics(
    data_root: Path,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    profile_id: str,
    sample_identity_sha256: str,
    terminal: str,
    failure_payload: Mapping[str, Any],
    events: Iterable[Mapping[str, Any]],
    telemetry: Mapping[str, Any],
) -> dict[str, Any]:
    if terminal not in {"cancelled", "error"}:
        raise BenchmarkEvidenceError("BENCHMARK_FAILURE_TERMINAL_INVALID")
    root = benchmark_root(data_root, benchmark_id)
    destination = root / "partial" / profile_id / f"attempt-{attempt:04d}"
    _check_owned_tree(root, destination)
    marker = destination / "failure.json"
    if marker.exists():
        raise BenchmarkEvidenceError("BENCHMARK_FAILURE_ALREADY_COMMITTED")
    destination.mkdir(parents=True, exist_ok=True)
    event_payload = _event_jsonl(
        events,
        benchmark_id=benchmark_id,
        profile_id=profile_id,
        required_terminal=terminal,
    )
    telemetry_payload = _telemetry_jsonl(
        telemetry,
        benchmark_id=benchmark_id,
        job_id=job_id,
        attempt=attempt,
        profile_id=profile_id,
        sample_identity_sha256=sample_identity_sha256,
    )
    atomic_write(destination / "events.jsonl", event_payload)
    atomic_write(destination / "telemetry.jsonl", telemetry_payload)
    code = failure_payload.get("code")
    stage = failure_payload.get("stage")
    failure = {
        "schema_version": FAILED_DIAGNOSTICS_SCHEMA,
        "benchmark_id": benchmark_id,
        "job_id": job_id,
        "attempt": attempt,
        "profile_id": profile_id,
        "sample_identity_sha256": sample_identity_sha256,
        "terminal": terminal,
        "code": code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,96}", code) else None,
        "stage": stage if isinstance(stage, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", stage) else None,
        "events": _descriptor(destination / "events.jsonl", maximum=_MAX_JSONL_BYTES),
        "telemetry": _descriptor(destination / "telemetry.jsonl", maximum=_MAX_JSONL_BYTES),
        "completed_at": utc_now(),
    }
    _write_json(marker, failure)
    return failure


def finalize_bundle(
    data_root: Path,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    source_id: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    context: str,
    glossary: str,
    execution_mode: str,
) -> dict[str, Any]:
    root = benchmark_root(data_root, benchmark_id)
    if (root / "benchmark.json").exists():
        raise BenchmarkEvidenceError("BENCHMARK_ALREADY_COMMITTED")
    profile_entries: list[dict[str, Any]] = []
    source_sha256: str | None = None
    track_count: int | None = None
    audio_work_seconds: float | None = None
    total_size = 0
    for profile_id in PROFILES:
        destination = profile_root(data_root, benchmark_id, profile_id)
        profile = _read_json(destination / "profile.json")
        if (
            profile.get("schema_version") != PROFILE_SCHEMA
            or profile.get("benchmark_id") != benchmark_id
            or profile.get("profile_id") != profile_id
            or profile.get("job_id") != job_id
            or profile.get("attempt") != attempt
            or profile.get("sample_identity_sha256") != sample_identity_sha256
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")
        current_source = profile.get("source_sha256")
        if not isinstance(current_source, str) or _SHA256.fullmatch(current_source) is None:
            raise BenchmarkEvidenceError("BENCHMARK_SOURCE_IDENTITY_INVALID")
        if source_sha256 is None:
            source_sha256 = current_source
        elif source_sha256 != current_source:
            raise BenchmarkEvidenceError("BENCHMARK_SOURCE_IDENTITY_MISMATCH")
        artifacts: dict[str, Any] = {}
        for filename, maximum in (
            ("profile.json", _MAX_JSON_BYTES),
            ("transcript.json", _MAX_JSON_BYTES),
            ("metrics.json", _MAX_JSON_BYTES),
            ("events.jsonl", _MAX_JSONL_BYTES),
            ("telemetry.jsonl", _MAX_JSONL_BYTES),
        ):
            path = destination / filename
            if filename == "telemetry.jsonl" and not path.exists():
                continue
            if not path.is_file():
                raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ARTIFACT_MISSING")
            descriptor = _descriptor(path, maximum=maximum)
            descriptor["path"] = f"profiles/{profile_id}/{filename}"
            artifacts[filename.removesuffix(".json").removesuffix(".jsonl")] = descriptor
            total_size += int(descriptor["size_bytes"])
        transcript_payload = _sha256_file(destination / "transcript.json", _MAX_JSON_BYTES)[2]
        try:
            transcript = TranscriptDocument.from_dict(json.loads(transcript_payload))
        except (json.JSONDecodeError, UnicodeDecodeError, TranscriptValidationError) as exc:
            raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_INVALID") from exc
        if transcript.source_sha256.lower() != source_sha256 or transcript.engine.profile != profile_id:
            raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_IDENTITY_MISMATCH")
        metrics = _read_json(destination / "metrics.json")
        current_track_count = metrics.get("track_count")
        current_audio_work = metrics.get("audio_work_seconds")
        if (
            isinstance(current_track_count, bool)
            or not isinstance(current_track_count, int)
            or current_track_count < 1
            or isinstance(current_audio_work, bool)
            or not isinstance(current_audio_work, (int, float))
            or not math.isfinite(float(current_audio_work))
            or float(current_audio_work) < 0
            or current_track_count != transcript.stats.track_count
            or not math.isclose(float(current_audio_work), transcript.stats.audio_work_seconds, abs_tol=0.001)
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_METRICS_IDENTITY_INVALID")
        if track_count is None:
            track_count = current_track_count
            audio_work_seconds = float(current_audio_work)
        elif (
            track_count != current_track_count
            or audio_work_seconds is None
            or not math.isclose(audio_work_seconds, float(current_audio_work), abs_tol=0.001)
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_METRICS_IDENTITY_MISMATCH")
        profile_entries.append({"profile_id": profile_id, "artifacts": artifacts})
    if source_id != f"craig-{source_sha256}":
        raise BenchmarkEvidenceError("BENCHMARK_SOURCE_IDENTITY_MISMATCH")
    manifest = {
        "schema_version": BUNDLE_SCHEMA,
        "status": "completed",
        "benchmark_id": benchmark_id,
        "job_id": job_id,
        "attempt": attempt,
        "source_id": source_id,
        "source_sha256": source_sha256,
        "sample_identity_sha256": sample_identity_sha256,
        "sample": {"start_seconds": 0.0, "end_seconds": sample_seconds},
        "sample_seconds": sample_seconds,
        "track_count": track_count,
        "audio_work_seconds": audio_work_seconds,
        "profile_order": list(PROFILES),
        "execution_mode": execution_mode,
        "context": _hash_private_text(context),
        "glossary": _hash_private_text(glossary),
        "profiles": profile_entries,
        "completed_at": utc_now(),
    }
    manifest["manifest_payload_sha256"] = _manifest_payload_sha256(manifest)
    _write_json(root / "benchmark.json", manifest)
    descriptor = _descriptor(root / "benchmark.json")
    total_size += int(descriptor["size_bytes"])
    return {
        "benchmark_id": benchmark_id,
        "bundle_manifest_sha256": descriptor["sha256"],
        "bundle_size_bytes": total_size,
        "profiles": [
            {
                "profile_id": item["profile_id"],
                "transcript_sha256": item["artifacts"]["transcript"]["sha256"],
                "artifact_available": True,
            }
            for item in profile_entries
        ],
    }


def load_bundle(data_root: Path, benchmark_id: str) -> dict[str, Any]:
    root = benchmark_root(data_root, benchmark_id)
    manifest = _read_bundle_manifest(data_root, benchmark_id)
    for item in manifest["profiles"]:
        if not isinstance(item, dict):
            raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
        profile_id = item["profile_id"]
        artifacts = item.get("artifacts")
        if not isinstance(artifacts, dict):
            raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
        artifact_names = frozenset(artifacts)
        if (
            not _REQUIRED_PROFILE_ARTIFACTS.issubset(artifact_names)
            or not artifact_names.issubset(
                _REQUIRED_PROFILE_ARTIFACTS | _OPTIONAL_PROFILE_ARTIFACTS
            )
        ):
            raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
        for artifact, descriptor in artifacts.items():
            if not isinstance(descriptor, dict):
                raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
            path = _verified_descriptor_path(root, profile_id, artifact, descriptor)
            maximum = _MAX_JSONL_BYTES if path.suffix == ".jsonl" else _MAX_JSON_BYTES
            digest, size, _ = _sha256_file(path, maximum)
            if digest != descriptor.get("sha256") or size != descriptor.get("size_bytes"):
                raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_INTEGRITY_FAILED")

        profile_payload = verified_profile_bytes(data_root, benchmark_id, profile_id, "profile")
        try:
            profile_manifest = json.loads(profile_payload)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID") from exc
        if (
            not isinstance(profile_manifest, dict)
            or profile_manifest.get("schema_version") != PROFILE_SCHEMA
            or profile_manifest.get("benchmark_id") != benchmark_id
            or profile_manifest.get("profile_id") != profile_id
            or profile_manifest.get("job_id") != manifest["job_id"]
            or profile_manifest.get("attempt") != manifest["attempt"]
            or profile_manifest.get("source_sha256") != manifest["source_sha256"]
            or profile_manifest.get("sample_identity_sha256") != manifest["sample_identity_sha256"]
            or profile_manifest.get("sample_seconds") != manifest["sample_seconds"]
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")
        for key in ("transcript", "metrics"):
            internal = profile_manifest.get(key)
            external = artifacts.get(key)
            if (
                not isinstance(internal, dict)
                or not isinstance(external, dict)
                or internal.get("artifact") != external.get("artifact")
                or internal.get("sha256") != external.get("sha256")
                or internal.get("size_bytes") != external.get("size_bytes")
            ):
                raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")
        metrics_payload = verified_profile_bytes(data_root, benchmark_id, profile_id, "metrics")
        try:
            metrics = json.loads(metrics_payload)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_METRICS_INVALID") from exc
        if (
            not isinstance(metrics, dict)
            or metrics.get("schema_version") != METRICS_SCHEMA
            or metrics.get("benchmark_id") != benchmark_id
            or metrics.get("job_id") != manifest["job_id"]
            or metrics.get("attempt") != manifest["attempt"]
            or metrics.get("profile_id") != profile_id
            or metrics.get("sample_identity_sha256") != manifest["sample_identity_sha256"]
            or metrics.get("sample_seconds") != manifest["sample_seconds"]
            or metrics.get("track_count") != manifest["track_count"]
            or not isinstance(metrics.get("audio_work_seconds"), (int, float))
            or isinstance(metrics.get("audio_work_seconds"), bool)
            or not math.isclose(
                float(metrics["audio_work_seconds"]),
                float(manifest["audio_work_seconds"]),
                abs_tol=0.001,
            )
        ):
            raise BenchmarkEvidenceError("BENCHMARK_PROFILE_METRICS_INVALID")

        transcript_bytes = verified_profile_bytes(data_root, benchmark_id, profile_id, "transcript")
        try:
            document = TranscriptDocument.from_dict(json.loads(transcript_bytes))
        except (json.JSONDecodeError, UnicodeDecodeError, TranscriptValidationError) as exc:
            raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_INVALID") from exc
        if document.source_sha256.lower() != manifest.get("source_sha256") or document.engine.profile != profile_id:
            raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_IDENTITY_MISMATCH")
    return manifest
def _profile_entry(manifest: Mapping[str, Any], profile_id: str) -> Mapping[str, Any]:
    if profile_id not in PROFILES:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_INVALID")
    for item in manifest.get("profiles", []):
        if isinstance(item, dict) and item.get("profile_id") == profile_id:
            return item
    raise BenchmarkEvidenceError("BENCHMARK_PROFILE_NOT_FOUND")


def verified_profile_bytes(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    artifact: str,
) -> bytes:
    if artifact not in {"profile", "transcript", "metrics", "events", "telemetry"}:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_INVALID")
    manifest = _read_bundle_manifest(data_root, benchmark_id)
    item = _profile_entry(manifest, profile_id)
    artifacts = item.get("artifacts")
    if not isinstance(artifacts, dict) or artifact not in artifacts:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_UNAVAILABLE")
    descriptor = artifacts[artifact]
    if not isinstance(descriptor, dict):
        raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
    root = benchmark_root(data_root, benchmark_id)
    path = _verified_descriptor_path(root, profile_id, artifact, descriptor)
    maximum = _MAX_JSONL_BYTES if path.suffix == ".jsonl" else _MAX_JSON_BYTES
    digest, size, payload = _sha256_file(path, maximum)
    if digest != descriptor.get("sha256") or size != descriptor.get("size_bytes"):
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_INTEGRITY_FAILED")
    return payload


def transcript_to_txt(document: TranscriptDocument) -> str:
    rows: list[tuple[float, str, str]] = []
    if document.turns:
        rows.extend((turn.start, turn.speaker, turn.text) for turn in document.turns)
    else:
        for track in document.tracks:
            rows.extend((segment.start + track.timeline_offset_seconds, track.speaker, segment.text) for segment in track.segments)
    rows.sort(key=lambda item: (item[0], item[1], item[2]))
    def stamp(seconds: float) -> str:
        total_ms = max(0, int(round(seconds * 1000)))
        hours, rest = divmod(total_ms, 3_600_000)
        minutes, rest = divmod(rest, 60_000)
        secs, ms = divmod(rest, 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"
    return "\n\n".join(f"[{stamp(start)}] {speaker}\n{text}" for start, speaker, text in rows) + ("\n" if rows else "")


def transcript_to_vtt(document: TranscriptDocument) -> str:
    rows: list[tuple[float, float, str, str]] = []
    if document.turns:
        rows.extend((turn.start, turn.end, turn.speaker, turn.text) for turn in document.turns)
    else:
        for track in document.tracks:
            rows.extend((
                segment.start + track.timeline_offset_seconds,
                segment.end + track.timeline_offset_seconds,
                track.speaker,
                segment.text,
            ) for segment in track.segments)
    rows.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
    def stamp(seconds: float) -> str:
        total_ms = max(0, int(round(seconds * 1000)))
        hours, rest = divmod(total_ms, 3_600_000)
        minutes, rest = divmod(rest, 60_000)
        secs, ms = divmod(rest, 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"
    output = ["WEBVTT", ""]
    for start, end, speaker, text in rows:
        start = max(0.0, start)
        end = max(start, end)
        output.extend([f"{stamp(start)} --> {stamp(end)}", f"{speaker}: {text}", ""])
    return "\n".join(output)


def transcript_to_srt(document: TranscriptDocument) -> str:
    vtt = transcript_to_vtt(document).splitlines()[2:]
    rows: list[str] = []
    cue = 1
    for index in range(0, len(vtt), 3):
        block = vtt[index:index + 3]
        if len(block) < 2 or "-->" not in block[0]:
            continue
        rows.append(str(cue))
        rows.append(block[0].replace(".", ","))
        rows.append(block[1])
        rows.append("")
        cue += 1
    return "\n".join(rows)


def private_export_zip(data_root: Path, benchmark_id: str) -> bytes:
    manifest = load_bundle(data_root, benchmark_id)
    root = benchmark_root(data_root, benchmark_id)
    stream = io.BytesIO()
    prefix = f"TDA-Benchmark-{benchmark_id}"
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        def add(name: str, payload: bytes) -> None:
            info = zipfile.ZipInfo(f"{prefix}/{name}", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, payload)
        add("benchmark.json", _canonical_json(manifest))
        add("export.json", _canonical_json({
            "schema_version": EXPORT_SCHEMA,
            "benchmark_id": benchmark_id,
            "privacy": "private_transcript_content",
            "audio_included": False,
        }))
        for profile_id in PROFILES:
            base = f"profiles/{profile_id}"
            transcript_payload = verified_profile_bytes(data_root, benchmark_id, profile_id, "transcript")
            document = TranscriptDocument.from_dict(json.loads(transcript_payload))
            for artifact in ("profile", "transcript", "metrics", "events", "telemetry"):
                try:
                    payload = verified_profile_bytes(data_root, benchmark_id, profile_id, artifact)
                except BenchmarkEvidenceError as exc:
                    if artifact == "telemetry" and str(exc) == "BENCHMARK_ARTIFACT_UNAVAILABLE":
                        continue
                    raise
                suffix = "jsonl" if artifact in {"events", "telemetry"} else "json"
                add(f"{base}/{artifact}.{suffix}", payload)
            add(f"{base}/transcript.txt", transcript_to_txt(document).encode("utf-8"))
            add(f"{base}/transcript.vtt", transcript_to_vtt(document).encode("utf-8"))
            add(f"{base}/transcript.srt", transcript_to_srt(document).encode("utf-8"))
        for directory in ("reference", "quality"):
            candidate = root / directory
            if not candidate.is_dir() or candidate.is_symlink() or _is_reparse(candidate):
                continue
            for path in sorted(candidate.rglob("*.json")):
                _check_owned_tree(root, path)
                payload = path.read_bytes()
                if len(payload) > _MAX_JSON_BYTES:
                    raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SIZE_INVALID")
                add(str(path.relative_to(root)).replace(os.sep, "/"), payload)
    payload = stream.getvalue()
    if len(payload) > 96 * 1024 * 1024:
        raise BenchmarkEvidenceError("BENCHMARK_EXPORT_TOO_LARGE")
    return payload
