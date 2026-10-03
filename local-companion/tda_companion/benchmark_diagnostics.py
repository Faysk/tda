from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import time
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any, Callable, Mapping

from .atomic_storage import AtomicStorageError, atomic_write
from .benchmark_bundles import (
    BenchmarkBundleError,
    benchmark_id_for,
    benchmark_profile_root,
)
from .engine_metrics import validate_engine_metrics
from .execution_device import (
    gpu_uuid,
    matching_gpu,
    pci_bus_id,
    sanitize_execution_device,
)
from .telemetry import SystemTelemetry
from .worker_protocol import WorkerMessage

METRICS_SCHEMA_VERSION = "tda_benchmark_metrics_v1"
EVENT_SCHEMA_VERSION = "tda_benchmark_event_v1"
TELEMETRY_SCHEMA_VERSION = "tda_benchmark_telemetry_v1"
WORKER_DIAGNOSTICS_SCHEMA_VERSION = "tda_benchmark_worker_diagnostics_v1"
MEASUREMENT_MODE = "profile_diagnostics_v1"

DEFAULT_TELEMETRY_INTERVAL_MS = 1000
MAX_EVENT_ROWS = 4096
MAX_EVENT_BYTES = 4 * 1024 * 1024
MAX_EVENT_ROW_BYTES = 8 * 1024
MAX_TELEMETRY_SAMPLES = 900
MAX_TELEMETRY_BYTES = 2 * 1024 * 1024

_STABLE_CODE = re.compile(r"^[A-Z0-9_]{1,96}$")
_SAFE_TOKEN = re.compile(r"^[A-Za-z0-9_.:+-]{1,160}$")
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,196}$")
_PACKAGE_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
_SPAM_EVENT_CODES = {
    "MODEL_DOWNLOAD_PROGRESS",
    "QWEN_WINDOW_TRANSCRIBED",
    "WHISPER_SEGMENT_TRANSCRIBED",
}
_WARNING_MARKERS = (
    "WARN",
    "FALLBACK",
    "FAILED",
    "FAILURE",
    "EMPTY",
    "NO_SPEECH",
    "NORMALIZED",
    "PARTIAL",
    "RECOVER",
)
_EVENT_VALUE_KEYS = {
    "stage",
    "kind",
    "profile",
    "profile_id",
    "track",
    "total_tracks",
    "window",
    "segment",
    "count",
    "completed",
    "total",
    "unit",
    "reason",
    "compute_type",
    "device",
    "logical_index",
    "physical_uuid",
    "pci_bus_id",
    "downloaded_bytes",
    "total_bytes",
    "reused_window_count",
    "recoverable",
    "forced",
    "fence",
    "returncode",
    "percent",
}
_PACKAGE_BY_ENGINE = {
    "whisper": ("faster-whisper", "ctranslate2", "av"),
    "qwen3": ("torch", "transformers", "qwen-asr", "accelerate"),
}
_COMMON_RUNTIME_PACKAGES = (
    "nvidia-cuda-runtime-cu12",
    "nvidia-cudnn-cu12",
)


class BenchmarkDiagnosticsError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise BenchmarkDiagnosticsError("BENCHMARK_DIAGNOSTICS_JSON_INVALID") from exc


def _canonical_json_line(value: Any) -> bytes:
    return _canonical_json(value) + b"\n"


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _bounded_config_text(value: object, maximum: int = 256) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if (
        not text
        or len(text) > maximum
        or any(ord(char) < 32 or ord(char) == 127 for char in text)
        or "\\" in text
        or "@" in text
        or text.startswith("/")
        or ".." in text
        or re.match(r"^[A-Za-z]:[/\\]", text)
    ):
        return None
    return text


def _safe_token(value: object, maximum: int = 160) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if len(text) > maximum or not _SAFE_TOKEN.fullmatch(text):
        return None
    return text


def _runtime_artifact(value: object) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    runtime_id = _safe_token(value.get("runtime_id"), 96)
    version = _safe_token(value.get("version"), 128)
    worker_sha256 = value.get("worker_sha256")
    archive_sha256 = value.get("archive_sha256")
    if (
        runtime_id is None
        or version is None
        or not isinstance(worker_sha256, str)
        or not re.fullmatch(r"[0-9a-f]{64}", worker_sha256)
    ):
        return None
    if archive_sha256 is not None and (
        not isinstance(archive_sha256, str)
        or not re.fullmatch(r"[0-9a-f]{64}", archive_sha256)
    ):
        return None
    return {
        "runtime_id": runtime_id,
        "version": version,
        "worker_sha256": worker_sha256,
        "archive_sha256": archive_sha256,
    }


def _sanitize_lineage(value: object) -> dict[str, Any] | None:
    if not isinstance(value, Mapping) or value.get("schema_version") != "tda_execution_lineage_v1":
        return None
    execution_device = sanitize_execution_device(value.get("execution_device"))
    raw_gpu = value.get("gpu")
    gpu: dict[str, Any] | None = None
    if isinstance(raw_gpu, Mapping):
        raw_total = raw_gpu.get("vram_total_bytes")
        gpu = {
            "vendor": _safe_token(raw_gpu.get("vendor"), 32),
            "index": raw_gpu.get("index")
            if isinstance(raw_gpu.get("index"), int) and not isinstance(raw_gpu.get("index"), bool)
            else None,
            "logical_index": raw_gpu.get("logical_index")
            if isinstance(raw_gpu.get("logical_index"), int)
            and not isinstance(raw_gpu.get("logical_index"), bool)
            else None,
            "uuid": gpu_uuid(raw_gpu.get("uuid")),
            "pci_bus_id": pci_bus_id(raw_gpu.get("pci_bus_id")),
            "model": _bounded_config_text(raw_gpu.get("model"), 160),
            "vram_total_bytes": raw_total
            if isinstance(raw_total, int) and not isinstance(raw_total, bool) and raw_total >= 0
            else None,
            "compute_capability": _safe_token(raw_gpu.get("compute_capability"), 32),
            "driver_version": _safe_token(raw_gpu.get("driver_version"), 64),
        }
    return {
        "schema_version": "tda_execution_lineage_v1",
        "companion_version": _safe_token(value.get("companion_version"), 64),
        "runtime_family": _safe_token(value.get("runtime_family"), 64),
        "runtime_version": _safe_token(value.get("runtime_version"), 128),
        "runtime_artifact": _runtime_artifact(value.get("runtime_artifact")),
        "device": _safe_token(value.get("device"), 64),
        "execution_device": execution_device,
        "compute_type": _safe_token(value.get("compute_type"), 64),
        "gpu": gpu,
    }


def _warning_code(value: object) -> str:
    if not isinstance(value, str):
        return "TRANSCRIPT_WARNING_UNCLASSIFIED"
    prefix = value.split(":", 1)[0].strip().upper().replace("-", "_")
    prefix = re.sub(r"[^A-Z0-9_]", "_", prefix)
    prefix = re.sub(r"_+", "_", prefix).strip("_")
    if _STABLE_CODE.fullmatch(prefix):
        return prefix
    return "TRANSCRIPT_WARNING_UNCLASSIFIED"


def _runtime_package_versions(engine: str) -> dict[str, str]:
    names = (*_PACKAGE_BY_ENGINE.get(engine, ()), *_COMMON_RUNTIME_PACKAGES)
    result: dict[str, str] = {}
    for name in names:
        if not _PACKAGE_NAME.fullmatch(name):
            continue
        try:
            value = metadata.version(name)
        except metadata.PackageNotFoundError:
            continue
        except Exception:
            continue
        if _SAFE_TOKEN.fullmatch(value) and len(value) <= 128:
            result[name] = value
    return result


def build_worker_benchmark_diagnostics(document: Any) -> dict[str, Any]:
    metrics = document.stats.processing_metrics
    try:
        validate_engine_metrics(metrics)
    except (TypeError, ValueError) as exc:
        raise BenchmarkDiagnosticsError("BENCHMARK_PROCESSING_METRICS_INVALID") from exc
    if metrics is None:
        raise BenchmarkDiagnosticsError("BENCHMARK_PROCESSING_METRICS_REQUIRED")
    warnings = sorted({_warning_code(item) for item in document.warnings})
    return {
        "schema_version": WORKER_DIAGNOSTICS_SCHEMA_VERSION,
        "processing_metrics": metrics,
        "counts": {
            "track_count": document.stats.track_count,
            "word_count": document.stats.word_count,
            "segment_count": document.stats.segment_count,
            "turn_count": document.stats.turn_count,
            "deduplicated_segment_count": document.stats.deduplicated_segment_count,
            "warning_count": len(document.warnings),
        },
        "warning_codes": warnings,
        "package_versions": _runtime_package_versions(document.engine.engine),
    }


def _validate_worker_diagnostics(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "schema_version",
        "processing_metrics",
        "counts",
        "warning_codes",
        "package_versions",
    }:
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    if value.get("schema_version") != WORKER_DIAGNOSTICS_SCHEMA_VERSION:
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    metrics = value.get("processing_metrics")
    try:
        validate_engine_metrics(metrics)
    except (TypeError, ValueError) as exc:
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID") from exc
    if metrics is None:
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    counts = value.get("counts")
    expected_counts = {
        "track_count",
        "word_count",
        "segment_count",
        "turn_count",
        "deduplicated_segment_count",
        "warning_count",
    }
    if not isinstance(counts, dict) or set(counts) != expected_counts:
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    if any(
        isinstance(item, bool) or not isinstance(item, int) or item < 0
        for item in counts.values()
    ):
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    warnings = value.get("warning_codes")
    if (
        not isinstance(warnings, list)
        or len(warnings) > 64
        or any(not isinstance(item, str) or not _STABLE_CODE.fullmatch(item) for item in warnings)
    ):
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    packages = value.get("package_versions")
    if not isinstance(packages, dict) or len(packages) > 16:
        raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    for name, version in packages.items():
        if (
            not isinstance(name, str)
            or not _PACKAGE_NAME.fullmatch(name)
            or not isinstance(version, str)
            or len(version) > 128
            or not _SAFE_TOKEN.fullmatch(version)
        ):
            raise BenchmarkDiagnosticsError("BENCHMARK_WORKER_DIAGNOSTICS_INVALID")
    return value


def _safe_event_data(payload: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, raw in payload.items():
        if key not in _EVENT_VALUE_KEYS:
            continue
        if raw is None or isinstance(raw, bool):
            result[key] = raw
            continue
        if isinstance(raw, int) and not isinstance(raw, bool):
            if -(2**53 - 1) <= raw <= 2**53 - 1:
                result[key] = raw
            continue
        if isinstance(raw, float):
            if math.isfinite(raw) and abs(raw) <= 2**53 - 1:
                result[key] = raw
            continue
        if not isinstance(raw, str):
            continue
        if key == "physical_uuid":
            clean = gpu_uuid(raw)
        elif key == "pci_bus_id":
            clean = pci_bus_id(raw)
        else:
            clean = _safe_token(raw)
        if clean is not None:
            result[key] = clean
    return result


def _event_level(code: str, type_name: str) -> str:
    if type_name == "error":
        return "error"
    if any(marker in code for marker in _WARNING_MARKERS):
        return "warning"
    return "info"


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return round(float(ordered[index]), 6)


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 6)


def _peak(values: list[float]) -> float | None:
    if not values:
        return None
    return round(max(values), 6)


class BenchmarkProfileDiagnostics:
    """Profile-scoped benchmark evidence captured outside the heavy worker.

    Worker protocol messages arrive here only after WorkerMessage.decode() and
    sequence validation in WorkerSupervisor. Transcript/audio content and arbitrary
    strings are never accepted into this artifact contract.
    """

    def __init__(
        self,
        *,
        data_root: Path,
        job_id: str,
        attempt: int,
        source_id: str,
        profile_id: str,
        sample_identity_sha256: str,
        sample_seconds: float,
        context: str,
        glossary: str,
        telemetry_interval_ms: int = DEFAULT_TELEMETRY_INTERVAL_MS,
        telemetry_factory: Callable[[], Any] = SystemTelemetry,
        enable_telemetry: bool = True,
        clock: Callable[[], float] = time.monotonic,
    ):
        if not _SAFE_ID.fullmatch(profile_id):
            raise BenchmarkDiagnosticsError("BENCHMARK_DIAGNOSTICS_PROFILE_INVALID")
        if (
            isinstance(sample_seconds, bool)
            or not isinstance(sample_seconds, (int, float))
            or not math.isfinite(float(sample_seconds))
            or float(sample_seconds) <= 0
        ):
            raise BenchmarkDiagnosticsError("BENCHMARK_DIAGNOSTICS_SAMPLE_INVALID")
        if (
            isinstance(telemetry_interval_ms, bool)
            or not isinstance(telemetry_interval_ms, int)
            or not 250 <= telemetry_interval_ms <= 10_000
        ):
            raise BenchmarkDiagnosticsError("BENCHMARK_TELEMETRY_INTERVAL_INVALID")

        self.data_root = data_root.resolve()
        self.job_id = job_id
        self.attempt = attempt
        self.source_id = source_id
        self.profile_id = profile_id
        self.sample_identity_sha256 = sample_identity_sha256
        self.sample_seconds = float(sample_seconds)
        self.context_fingerprint = {
            "sha256": _sha256_text(context),
            "characters": len(context),
            "utf8_bytes": len(context.encode("utf-8")),
        }
        self.glossary_fingerprint = {
            "sha256": _sha256_text(glossary),
            "characters": len(glossary),
            "utf8_bytes": len(glossary.encode("utf-8")),
        }
        try:
            self.benchmark_id = benchmark_id_for(job_id, attempt)
            self.profile_root = benchmark_profile_root(
                self.data_root,
                self.benchmark_id,
                profile_id,
            )
        except BenchmarkBundleError as exc:
            raise BenchmarkDiagnosticsError(str(exc)) from exc
        self.telemetry_interval_ms = telemetry_interval_ms
        self.telemetry_factory = telemetry_factory
        self.enable_telemetry = enable_telemetry
        self.clock = clock
        self.started_monotonic = clock()
        self.started_at = _utc_now()
        self.worker_ready_relative_ms: int | None = None
        self.terminal_relative_ms: int | None = None
        self.runtime_artifact: dict[str, Any] | None = None
        self.execution_device: dict[str, Any] | None = None
        self._events: list[dict[str, Any]] = []
        self._event_bytes = 0
        self._pending_aggregate: dict[str, Any] | None = None
        self._terminal_seen = False
        self._event_capture_seconds = 0.0
        self._telemetry_samples: list[tuple[int, dict[str, Any]]] = []
        self._telemetry_sampling_seconds = 0.0
        self._telemetry_errors = 0
        self._telemetry_truncated = False
        self._telemetry_missing_reason: str | None = None
        self._telemetry: Any | None = None
        self._telemetry_stop = threading.Event()
        self._telemetry_thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def _relative_ms(self) -> int:
        return max(0, int(round((self.clock() - self.started_monotonic) * 1000)))

    def start(self) -> None:
        if not self.enable_telemetry:
            self._telemetry_missing_reason = "disabled"
            return
        try:
            self._telemetry = self.telemetry_factory()
        except Exception:
            self._telemetry_missing_reason = "sampler_unavailable"
            return

        def sample_loop() -> None:
            while not self._telemetry_stop.is_set():
                started = self.clock()
                try:
                    snapshot = self._telemetry.snapshot()
                except Exception:
                    snapshot = None
                    self._telemetry_errors += 1
                elapsed = max(0.0, self.clock() - started)
                self._telemetry_sampling_seconds += elapsed
                if isinstance(snapshot, dict):
                    self.record_telemetry_snapshot(snapshot)
                wait_seconds = self.telemetry_interval_ms / 1000
                if self._telemetry_stop.wait(wait_seconds):
                    return

        self._telemetry_thread = threading.Thread(
            target=sample_loop,
            name=f"tda-benchmark-telemetry-{self.profile_id}",
            daemon=True,
        )
        self._telemetry_thread.start()

    def stop(self) -> None:
        self._telemetry_stop.set()
        if self._telemetry_thread is not None:
            self._telemetry_thread.join(timeout=max(1.0, self.telemetry_interval_ms / 1000 + 0.5))

    def record_telemetry_snapshot(
        self,
        snapshot: Mapping[str, Any],
        *,
        relative_ms: int | None = None,
    ) -> None:
        with self._lock:
            if len(self._telemetry_samples) >= MAX_TELEMETRY_SAMPLES:
                self._telemetry_truncated = True
                return
            value = dict(snapshot)
            self._telemetry_samples.append(
                (self._relative_ms() if relative_ms is None else max(0, int(relative_ms)), value)
            )

    def bind_runtime_artifact(self, artifact: Mapping[str, Any] | None) -> None:
        clean = _runtime_artifact(artifact)
        if clean is not None:
            self.runtime_artifact = clean

    def bind_execution_lineage(self, lineage: Mapping[str, Any] | None) -> dict[str, Any] | None:
        clean = _sanitize_lineage(lineage)
        if clean is None:
            return None
        artifact = clean.get("runtime_artifact")
        if artifact is not None:
            self.runtime_artifact = artifact
        device = clean.get("execution_device")
        if device is not None:
            self.execution_device = device
        return clean

    def _base_event(self, *, type_name: str, code: str, stage: str | None, relative_ms: int) -> dict[str, Any]:
        return {
            "schema_version": EVENT_SCHEMA_VERSION,
            "seq": len(self._events),
            "at": _utc_now(),
            "relative_ms": relative_ms,
            "benchmark_id": self.benchmark_id,
            "job_id": self.job_id,
            "attempt": self.attempt,
            "profile_id": self.profile_id,
            "sample_identity_sha256": self.sample_identity_sha256,
            "runtime_artifact": self.runtime_artifact,
            "type": type_name,
            "level": _event_level(code, type_name),
            "stage": stage,
            "code": code,
            "data": {},
        }

    def _append_event(self, row: dict[str, Any], *, terminal: bool = False) -> None:
        row["seq"] = len(self._events)
        encoded = _canonical_json_line(row)
        if len(encoded) > MAX_EVENT_ROW_BYTES:
            raise BenchmarkDiagnosticsError("BENCHMARK_EVENT_ROW_TOO_LARGE")
        limit_rows = MAX_EVENT_ROWS + (1 if terminal else 0)
        limit_bytes = MAX_EVENT_BYTES + (MAX_EVENT_ROW_BYTES if terminal else 0)
        if len(self._events) >= limit_rows or self._event_bytes + len(encoded) > limit_bytes:
            raise BenchmarkDiagnosticsError("BENCHMARK_EVENTS_LIMIT_EXCEEDED")
        self._events.append(row)
        self._event_bytes += len(encoded)
        if terminal:
            self._terminal_seen = True
            self.terminal_relative_ms = int(row["relative_ms"])

    def _flush_aggregate(self) -> None:
        aggregate = self._pending_aggregate
        if aggregate is None:
            return
        self._pending_aggregate = None
        row = self._base_event(
            type_name="event",
            code="BENCHMARK_EVENT_AGGREGATE",
            stage=aggregate["stage"],
            relative_ms=aggregate["first_relative_ms"],
        )
        row["data"] = {
            key: value
            for key, value in aggregate.items()
            if key not in {"_key", "stage"} and value is not None
        }
        self._append_event(row)

    def _observe_spam(
        self,
        *,
        message: WorkerMessage,
        code: str,
        stage: str | None,
        data: dict[str, Any],
        relative_ms: int,
    ) -> None:
        key = (
            message.type,
            code,
            stage,
            data.get("track"),
            data.get("total"),
            data.get("total_tracks"),
        )
        current = self._pending_aggregate
        if current is not None and current.get("_key") == key:
            current["count"] += 1
            current["last_worker_seq"] = message.seq
            current["last_relative_ms"] = relative_ms
            if "completed" in data:
                current["last_completed"] = data["completed"]
            return
        self._flush_aggregate()
        self._pending_aggregate = {
            "_key": key,
            "original_type": message.type,
            "original_code": code,
            "stage": stage,
            "track": data.get("track"),
            "count": 1,
            "first_worker_seq": message.seq,
            "last_worker_seq": message.seq,
            "first_relative_ms": relative_ms,
            "last_relative_ms": relative_ms,
            "first_completed": data.get("completed"),
            "last_completed": data.get("completed"),
            "total": data.get("total"),
            "total_tracks": data.get("total_tracks"),
            "unit": data.get("unit"),
        }

    def observe_message(self, message: WorkerMessage) -> None:
        started = self.clock()
        try:
            relative_ms = self._relative_ms()
            payload = message.payload if isinstance(message.payload, dict) else {}
            code = "WORKER_EVENT"
            if message.type == "ready":
                code = "WORKER_READY"
                if self.worker_ready_relative_ms is None:
                    self.worker_ready_relative_ms = relative_ms
            elif message.type == "stage":
                code = "STAGE_CHANGED"
            elif message.type == "progress":
                code = "PROGRESS"
            elif message.type == "heartbeat":
                code = "HEARTBEAT"
            elif message.type == "event":
                raw_code = payload.get("code")
                code = raw_code if isinstance(raw_code, str) and _STABLE_CODE.fullmatch(raw_code) else "WORKER_EVENT"
            elif message.type == "error":
                raw_code = payload.get("code")
                code = raw_code if isinstance(raw_code, str) and _STABLE_CODE.fullmatch(raw_code) else "WORKER_EXECUTION_FAILED"
            elif message.type == "cancelled":
                code = "PROFILE_CANCELLED"
            elif message.type == "result":
                code = "PROFILE_COMPLETED"

            data = _safe_event_data(payload)
            data["worker_seq"] = message.seq
            stage = _safe_token(payload.get("stage"), 96)

            if code == "ASR_EXECUTION_DEVICE":
                self.execution_device = sanitize_execution_device(payload)

            spam = (
                message.type in {"progress", "heartbeat"}
                or (message.type == "event" and code in _SPAM_EVENT_CODES)
            )
            if spam:
                self._observe_spam(
                    message=message,
                    code=code,
                    stage=stage,
                    data=data,
                    relative_ms=relative_ms,
                )
                return

            self._flush_aggregate()
            type_name = message.type
            if message.type == "event" and any(marker in code for marker in _WARNING_MARKERS):
                type_name = "warning"
            row = self._base_event(
                type_name=type_name,
                code=code,
                stage=stage,
                relative_ms=relative_ms,
            )
            row["data"] = data
            self._append_event(
                row,
                terminal=message.type in {"result", "cancelled", "error"},
            )
        finally:
            self._event_capture_seconds += max(0.0, self.clock() - started)

    def record_supervisor_terminal(
        self,
        *,
        status: str,
        code: str,
        recoverable: bool | None = None,
    ) -> None:
        self._flush_aggregate()
        stable = code if _STABLE_CODE.fullmatch(code) else "BENCHMARK_PROFILE_SUPERVISOR_FAILED"
        type_name = "cancelled" if status == "cancelled" else "error" if status == "failed" else "event"
        row = self._base_event(
            type_name=type_name,
            code=stable,
            stage="benchmark",
            relative_ms=self._relative_ms(),
        )
        if recoverable is not None:
            row["data"] = {"recoverable": bool(recoverable)}
        self._append_event(row, terminal=True)

    def _project_telemetry(
        self,
        lineage: dict[str, Any] | None,
        *,
        elapsed_ms: int,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        identity = (
            sanitize_execution_device(lineage.get("execution_device"))
            if isinstance(lineage, dict)
            else None
        ) or self.execution_device
        artifact = (
            _runtime_artifact(lineage.get("runtime_artifact"))
            if isinstance(lineage, dict)
            else None
        ) or self.runtime_artifact

        rows: list[dict[str, Any]] = []
        cpu_values: list[float] = []
        ram_used_values: list[float] = []
        ram_percent_values: list[float] = []
        gpu_util_values: list[float] = []
        vram_used_values: list[float] = []
        gpu_samples = 0

        for relative_ms, snapshot in sorted(self._telemetry_samples, key=lambda item: item[0]):
            cpu = snapshot.get("cpu")
            memory = snapshot.get("memory")
            gpus = snapshot.get("gpus")
            cpu_percent = cpu.get("utilization_percent") if isinstance(cpu, dict) else None
            memory_used = memory.get("used_bytes") if isinstance(memory, dict) else None
            memory_percent = memory.get("percent") if isinstance(memory, dict) else None
            selected = matching_gpu(gpus, identity)
            gpu_value: dict[str, Any] | None = None
            if selected is not None:
                gpu_samples += 1
                util = selected.get("utilization_percent")
                used = selected.get("memory_used_bytes")
                total = selected.get("memory_total_bytes")
                gpu_value = {
                    "uuid": gpu_uuid(selected.get("uuid")),
                    "pci_bus_id": pci_bus_id(selected.get("pci_bus_id")),
                    "model": _bounded_config_text(selected.get("name"), 160),
                    "utilization_percent": util
                    if isinstance(util, (int, float)) and not isinstance(util, bool) and math.isfinite(float(util))
                    else None,
                    "vram_used_bytes": used
                    if isinstance(used, int) and not isinstance(used, bool) and used >= 0
                    else None,
                    "vram_total_bytes": total
                    if isinstance(total, int) and not isinstance(total, bool) and total >= 0
                    else None,
                }
                if gpu_value["utilization_percent"] is not None:
                    gpu_util_values.append(float(gpu_value["utilization_percent"]))
                if gpu_value["vram_used_bytes"] is not None:
                    vram_used_values.append(float(gpu_value["vram_used_bytes"]))

            if isinstance(cpu_percent, (int, float)) and not isinstance(cpu_percent, bool) and math.isfinite(float(cpu_percent)):
                cpu_values.append(float(cpu_percent))
                cpu_percent = float(cpu_percent)
            else:
                cpu_percent = None
            if isinstance(memory_used, int) and not isinstance(memory_used, bool) and memory_used >= 0:
                ram_used_values.append(float(memory_used))
            else:
                memory_used = None
            if isinstance(memory_percent, (int, float)) and not isinstance(memory_percent, bool) and math.isfinite(float(memory_percent)):
                ram_percent_values.append(float(memory_percent))
                memory_percent = float(memory_percent)
            else:
                memory_percent = None

            rows.append(
                {
                    "schema_version": TELEMETRY_SCHEMA_VERSION,
                    "relative_ms": relative_ms,
                    "benchmark_id": self.benchmark_id,
                    "job_id": self.job_id,
                    "attempt": self.attempt,
                    "profile_id": self.profile_id,
                    "sample_identity_sha256": self.sample_identity_sha256,
                    "runtime_artifact": artifact,
                    "execution_device": identity,
                    "cpu_utilization_percent": cpu_percent,
                    "ram_used_bytes": memory_used,
                    "ram_percent": memory_percent,
                    "gpu": gpu_value,
                }
            )

        expected = max(1, math.floor(max(0, elapsed_ms) / self.telemetry_interval_ms) + 1)
        captured = len(rows)
        coverage = min(1.0, captured / expected) if expected else 0.0
        missing_reason = self._telemetry_missing_reason
        if self._telemetry_truncated:
            missing_reason = "sample_limit_reached"
        elif self._telemetry_errors:
            missing_reason = "partial_sampler_failures"
        elif missing_reason is None and captured == 0:
            missing_reason = "no_samples"
        elif missing_reason is None and captured < expected:
            missing_reason = "coverage_gap"

        summary = {
            "schema_version": TELEMETRY_SCHEMA_VERSION,
            "sampler": "system_telemetry_v1",
            "interval_ms": self.telemetry_interval_ms,
            "window": "profile_supervisor_v1",
            "expected_samples": expected,
            "captured_samples": captured,
            "coverage": round(coverage, 6),
            "gpu_captured_samples": gpu_samples,
            "missing_reason": missing_reason,
            "sampling_overhead_seconds": round(self._telemetry_sampling_seconds, 6),
            "truncated": self._telemetry_truncated,
            "aggregates": {
                "vram_peak_bytes": int(max(vram_used_values)) if vram_used_values else None,
                "vram_average_bytes": _average(vram_used_values),
                "vram_p95_bytes": _percentile(vram_used_values, 0.95),
                "gpu_utilization_average_percent": _average(gpu_util_values),
                "gpu_utilization_p95_percent": _percentile(gpu_util_values, 0.95),
                "gpu_utilization_peak_percent": _peak(gpu_util_values),
                "cpu_average_percent": _average(cpu_values),
                "cpu_p95_percent": _percentile(cpu_values, 0.95),
                "ram_peak_bytes": int(max(ram_used_values)) if ram_used_values else None,
                "ram_percent_peak": _peak(ram_percent_values),
                "temperature_max_c": None,
                "power_average_w": None,
                "power_peak_w": None,
            },
        }
        return rows, summary

    def _metrics(
        self,
        *,
        status: str,
        receipt: Mapping[str, Any] | None,
        worker_diagnostics: object,
        lineage: dict[str, Any] | None,
        telemetry_summary: dict[str, Any],
        elapsed_ms: int,
        error_code: str | None,
    ) -> dict[str, Any]:
        base: dict[str, Any] = {
            "schema_version": METRICS_SCHEMA_VERSION,
            "measurement_mode": MEASUREMENT_MODE,
            "status": status,
            "benchmark_id": self.benchmark_id,
            "job_id": self.job_id,
            "attempt": self.attempt,
            "source_id": self.source_id,
            "profile_id": self.profile_id,
            "sample_identity_sha256": self.sample_identity_sha256,
            "sample_seconds": self.sample_seconds,
            "context": self.context_fingerprint,
            "glossary": self.glossary_fingerprint,
            "execution_lineage": lineage,
            "supervisor_timing": {
                "started_at": self.started_at,
                "worker_ready_relative_ms": self.worker_ready_relative_ms,
                "terminal_relative_ms": self.terminal_relative_ms,
                "profile_elapsed_seconds": round(elapsed_ms / 1000, 6),
            },
            "telemetry": telemetry_summary,
            "instrumentation": {
                "event_capture_seconds": round(self._event_capture_seconds, 6),
                "telemetry_sampling_seconds": round(self._telemetry_sampling_seconds, 6),
                "timing_semantics": "engine_processing_v1_child_process_with_parent_diagnostics_v1",
            },
            "error_code": error_code,
        }
        if status != "completed":
            base.update(
                {
                    "processing_timing_version": None,
                    "stage_seconds": None,
                    "total_processing_seconds": None,
                    "rtf": None,
                    "realtime_factor": {"value": None, "derived": True, "source": "rtf"},
                    "audio_work_seconds": None,
                    "session_duration_seconds": None,
                    "counts": None,
                    "warning_codes": [],
                    "work_provenance": None,
                    "external_preparation_included": None,
                    "execution_config": None,
                }
            )
            return base

        if not isinstance(receipt, Mapping):
            raise BenchmarkDiagnosticsError("BENCHMARK_PROFILE_DIAGNOSTICS_INVALID")
        diagnostics = _validate_worker_diagnostics(worker_diagnostics)
        processing = diagnostics["processing_metrics"]
        counts = diagnostics["counts"]
        if (
            receipt.get("profile_id") != self.profile_id
            or receipt.get("sample_seconds") != self.sample_seconds
            or counts["track_count"] != receipt.get("track_count")
            or counts["word_count"] != receipt.get("word_count")
            or counts["segment_count"] != receipt.get("segment_count")
            or counts["warning_count"] != receipt.get("warning_count")
        ):
            raise BenchmarkDiagnosticsError("BENCHMARK_PROFILE_DIAGNOSTICS_MISMATCH")
        rtf = receipt.get("rtf")
        realtime = (
            round(1 / float(rtf), 6)
            if isinstance(rtf, (int, float))
            and not isinstance(rtf, bool)
            and math.isfinite(float(rtf))
            and float(rtf) > 0
            else None
        )
        base.update(
            {
                "processing_timing_version": processing["version"],
                "stage_seconds": processing["stage_seconds"],
                "total_processing_seconds": processing["total_processing_seconds"],
                "rtf": rtf,
                "realtime_factor": {
                    "value": realtime,
                    "derived": True,
                    "source": "rtf",
                },
                "audio_work_seconds": receipt.get("audio_work_seconds"),
                "session_duration_seconds": receipt.get("session_duration_seconds"),
                "counts": counts,
                "warning_codes": diagnostics["warning_codes"],
                "work_provenance": {
                    "total_tracks": processing["total_tracks"],
                    "fresh_asr_tracks": processing["fresh_asr_tracks"],
                    "text_checkpoint_reused_tracks": processing["text_checkpoint_reused_tracks"],
                    "completed_checkpoint_reused_tracks": processing["completed_checkpoint_reused_tracks"],
                    "fresh_audio_work_seconds": processing["fresh_audio_work_seconds"],
                    "reused_audio_work_seconds": processing["reused_audio_work_seconds"],
                    "fresh_calibration_eligible": processing["fresh_calibration_eligible"],
                },
                "external_preparation_included": processing["external_preparation_included"],
                "execution_config": {
                    "engine": _safe_token(receipt.get("engine"), 64),
                    "model": _bounded_config_text(receipt.get("model"), 256),
                    "model_revision": _bounded_config_text(receipt.get("model_revision"), 256),
                    "device": _safe_token(receipt.get("device"), 64),
                    "compute_type": _safe_token(receipt.get("compute_type"), 64),
                    "alignment": _bounded_config_text(receipt.get("alignment"), 128),
                    "package_versions": diagnostics["package_versions"],
                },
            }
        )
        return base

    def finalize(
        self,
        *,
        status: str,
        receipt: Mapping[str, Any] | None = None,
        worker_diagnostics: object = None,
        error_code: str | None = None,
    ) -> dict[str, Any]:
        if status not in {"completed", "failed", "cancelled"}:
            raise BenchmarkDiagnosticsError("BENCHMARK_DIAGNOSTICS_STATUS_INVALID")
        self.stop()
        if not self._terminal_seen:
            self.record_supervisor_terminal(
                status=status,
                code=(
                    "PROFILE_COMPLETED"
                    if status == "completed"
                    else "PROFILE_CANCELLED"
                    if status == "cancelled"
                    else error_code or "BENCHMARK_PROFILE_SUPERVISOR_FAILED"
                ),
            )
        self._flush_aggregate()

        lineage = self.bind_execution_lineage(
            receipt.get("execution_lineage")
            if isinstance(receipt, Mapping)
            else None
        )
        for row in self._events:
            if row.get("runtime_artifact") is None and self.runtime_artifact is not None:
                row["runtime_artifact"] = self.runtime_artifact

        elapsed_ms = self._relative_ms()
        telemetry_rows, telemetry_summary = self._project_telemetry(lineage, elapsed_ms=elapsed_ms)

        self.profile_root.mkdir(parents=True, exist_ok=True)
        metrics_path = self.profile_root / "metrics.json"
        if metrics_path.exists():
            raise BenchmarkDiagnosticsError("BENCHMARK_DIAGNOSTICS_ALREADY_COMMITTED")

        telemetry_receipt: dict[str, Any] | None = None
        if telemetry_rows:
            telemetry_payload = b"".join(_canonical_json_line(row) for row in telemetry_rows)
            if len(telemetry_payload) > MAX_TELEMETRY_BYTES:
                telemetry_summary["missing_reason"] = "serialized_size_limit"
                telemetry_summary["truncated"] = True
            else:
                try:
                    atomic_write(self.profile_root / "telemetry.jsonl", telemetry_payload)
                    telemetry_receipt = {
                        "artifact": "telemetry.jsonl",
                        "sha256": _sha256_bytes(telemetry_payload),
                        "size_bytes": len(telemetry_payload),
                    }
                except AtomicStorageError:
                    telemetry_summary["missing_reason"] = "telemetry_write_failed"

        events_payload = b"".join(_canonical_json_line(row) for row in self._events)
        if len(events_payload) > MAX_EVENT_BYTES + MAX_EVENT_ROW_BYTES:
            raise BenchmarkDiagnosticsError("BENCHMARK_EVENTS_LIMIT_EXCEEDED")
        try:
            atomic_write(self.profile_root / "events.jsonl", events_payload)
        except AtomicStorageError as exc:
            raise BenchmarkDiagnosticsError("BENCHMARK_EVENTS_WRITE_FAILED") from exc

        metrics = self._metrics(
            status=status,
            receipt=receipt,
            worker_diagnostics=worker_diagnostics,
            lineage=lineage,
            telemetry_summary=telemetry_summary,
            elapsed_ms=elapsed_ms,
            error_code=error_code,
        )
        metrics["artifacts"] = {
            "events": {
                "artifact": "events.jsonl",
                "sha256": _sha256_bytes(events_payload),
                "size_bytes": len(events_payload),
                "rows": len(self._events),
            },
            "telemetry": telemetry_receipt,
        }
        metrics_payload = _canonical_json(metrics)
        try:
            atomic_write(metrics_path, metrics_payload)
        except AtomicStorageError as exc:
            raise BenchmarkDiagnosticsError("BENCHMARK_METRICS_WRITE_FAILED") from exc

        return {
            "benchmark_id": self.benchmark_id,
            "profile_id": self.profile_id,
            "status": status,
            "metrics_sha256": _sha256_bytes(metrics_payload),
            "metrics_size_bytes": len(metrics_payload),
            "events_sha256": _sha256_bytes(events_payload),
            "events_size_bytes": len(events_payload),
            "telemetry": telemetry_receipt,
        }
