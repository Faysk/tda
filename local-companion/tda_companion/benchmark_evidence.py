from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Any, Iterable

from .atomic_storage import atomic_write
from .transcript import TranscriptDocument, TranscriptValidationError, utc_now

BUNDLE_SCHEMA_VERSION = "tda_benchmark_bundle_v1"
PROFILE_SCHEMA_VERSION = "tda_benchmark_profile_artifact_v1"
METRICS_SCHEMA_VERSION = "tda_benchmark_metrics_v1"
SNAPSHOT_SCHEMA_VERSION = "tda_benchmark_transcript_snapshot_v1"
EVENT_SCHEMA_VERSION = "tda_benchmark_event_v1"
PROFILE_IDS = (
    "whisper-turbo",
    "whisper-detailed",
    "qwen-fast",
    "qwen-quality",
)
_PROFILE_ID = re.compile(r"^(?:whisper-(?:turbo|detailed)|qwen-(?:fast|quality))$")
_BENCHMARK_ID = re.compile(r"^benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAX_TRANSCRIPT_BYTES = 512 * 1024 * 1024
_MAX_PROFILE_MANIFEST_BYTES = 512 * 1024
_MAX_BUNDLE_MANIFEST_BYTES = 1024 * 1024
_MAX_METRICS_BYTES = 1024 * 1024
_MAX_EVENTS_BYTES = 16 * 1024 * 1024
_COPY_CHUNK = 1024 * 1024
_PRIVATE_EVENT_KEYS = {
    "token", "authorization", "cookie", "secret", "password", "path",
    "source_path", "filename", "source_filename", "context", "glossary",
    "text", "transcript",
}


class BenchmarkEvidenceError(RuntimeError):
    pass


def benchmark_id_for(job_id: str, attempt: int) -> str:
    if not isinstance(job_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job_id):
        raise BenchmarkEvidenceError("BENCHMARK_JOB_ID_INVALID")
    if isinstance(attempt, bool) or not isinstance(attempt, int) or not 1 <= attempt <= 1_000_000:
        raise BenchmarkEvidenceError("BENCHMARK_ATTEMPT_INVALID")
    value = f"benchmark-{job_id}-a{attempt}"
    if not _BENCHMARK_ID.fullmatch(value):
        raise BenchmarkEvidenceError("BENCHMARK_ID_INVALID")
    return value


def _validate_benchmark_id(value: str) -> str:
    if not isinstance(value, str) or not _BENCHMARK_ID.fullmatch(value):
        raise BenchmarkEvidenceError("BENCHMARK_ID_INVALID")
    return value


def _validate_profile_id(value: str) -> str:
    if not isinstance(value, str) or not _PROFILE_ID.fullmatch(value):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ID_INVALID")
    return value


def _validate_sha256(value: object, code: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise BenchmarkEvidenceError(code)
    return value


def _benchmarks_root(data_root: Path) -> Path:
    root = data_root.resolve()
    result = (root / "benchmarks").resolve()
    if result.parent != root:
        raise BenchmarkEvidenceError("BENCHMARK_ROOT_INVALID")
    if result.exists() and (result.is_symlink() or not result.is_dir()):
        raise BenchmarkEvidenceError("BENCHMARK_ROOT_INVALID")
    return result


def benchmark_root(data_root: Path, benchmark_id: str) -> Path:
    root = _benchmarks_root(data_root)
    result = (root / _validate_benchmark_id(benchmark_id)).resolve()
    if result.parent != root:
        raise BenchmarkEvidenceError("BENCHMARK_PATH_INVALID")
    return result


def profile_root(data_root: Path, benchmark_id: str, profile_id: str) -> Path:
    bundle = benchmark_root(data_root, benchmark_id)
    profiles = (bundle / "profiles").resolve()
    if profiles.parent != bundle:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ROOT_INVALID")
    result = (profiles / _validate_profile_id(profile_id)).resolve()
    if result.parent != profiles:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_PATH_INVALID")
    return result


def _json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _atomic_json(path: Path, value: Any) -> None:
    atomic_write(path, _json_bytes(value))


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _read_bounded(path: Path, maximum: int, missing_code: str, size_code: str) -> bytes:
    if path.is_symlink():
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SYMLINK")
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise BenchmarkEvidenceError(missing_code) from exc
    if size <= 0 or size > maximum:
        raise BenchmarkEvidenceError(size_code)
    try:
        with path.open("rb") as handle:
            payload = handle.read(size + 1)
    except OSError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_READ_FAILED") from exc
    if len(payload) != size:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SIZE_MISMATCH")
    return payload


def _read_json(path: Path, maximum: int, missing_code: str, size_code: str) -> dict[str, Any]:
    payload = _read_bounded(path, maximum, missing_code, size_code)
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_JSON_INVALID") from exc
    if not isinstance(value, dict):
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_JSON_INVALID")
    return value


def _artifact_record(path: Path, *, relative_to: Path) -> dict[str, Any]:
    payload = _read_bounded(
        path,
        max(
            _MAX_TRANSCRIPT_BYTES,
            _MAX_EVENTS_BYTES,
            _MAX_METRICS_BYTES,
            _MAX_PROFILE_MANIFEST_BYTES,
        ),
        "BENCHMARK_ARTIFACT_MISSING",
        "BENCHMARK_ARTIFACT_SIZE_INVALID",
    )
    return {
        "artifact": path.relative_to(relative_to).as_posix(),
        "sha256": _sha256_bytes(payload),
        "size_bytes": len(payload),
    }


def _metrics_for_document(
    document: TranscriptDocument,
    *,
    benchmark_id: str,
    profile_id: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    execution_lineage: dict[str, Any],
) -> dict[str, Any]:
    stats = document.stats
    return {
        "schema_version": METRICS_SCHEMA_VERSION,
        "benchmark_id": benchmark_id,
        "profile_id": profile_id,
        "sample_identity_sha256": sample_identity_sha256,
        "sample_seconds": sample_seconds,
        "engine": document.engine.engine,
        "model": document.engine.model,
        "model_revision": document.engine.model_revision,
        "device": document.engine.device,
        "compute_type": document.engine.compute_type,
        "alignment": document.engine.alignment,
        "audio_work_seconds": stats.audio_work_seconds,
        "session_duration_seconds": stats.session_duration_seconds,
        "processing_seconds": stats.processing_seconds,
        "rtf": stats.rtf,
        "word_count": stats.word_count,
        "segment_count": stats.segment_count,
        "turn_count": stats.turn_count,
        "track_count": stats.track_count,
        "deduplicated_segment_count": stats.deduplicated_segment_count,
        "warning_count": len(document.warnings),
        "duration_semantics": stats.duration_semantics,
        "processing_metrics": stats.processing_metrics,
        "execution_lineage": execution_lineage,
    }


def write_profile_payload(
    data_root: Path,
    document: TranscriptDocument,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    source_id: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    execution_lineage: dict[str, Any],
) -> dict[str, Any]:
    expected_id = benchmark_id_for(job_id, attempt)
    if benchmark_id != expected_id:
        raise BenchmarkEvidenceError("BENCHMARK_ID_MISMATCH")
    profile_id = _validate_profile_id(document.engine.profile)
    sample_hash = _validate_sha256(
        sample_identity_sha256,
        "BENCHMARK_SAMPLE_IDENTITY_INVALID",
    )
    if not isinstance(source_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", source_id):
        raise BenchmarkEvidenceError("BENCHMARK_SOURCE_ID_INVALID")
    if not isinstance(sample_seconds, (int, float)) or isinstance(sample_seconds, bool) or sample_seconds <= 0:
        raise BenchmarkEvidenceError("BENCHMARK_SAMPLE_SECONDS_INVALID")
    document.validate()

    root = profile_root(data_root, benchmark_id, profile_id)
    if root.exists():
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ALREADY_EXISTS")
    root.mkdir(parents=True, exist_ok=False)

    transcript_path = root / "transcript.json"
    document.write_atomic(transcript_path)
    transcript_payload = _read_bounded(
        transcript_path,
        _MAX_TRANSCRIPT_BYTES,
        "BENCHMARK_TRANSCRIPT_MISSING",
        "BENCHMARK_TRANSCRIPT_SIZE_INVALID",
    )
    metrics = _metrics_for_document(
        document,
        benchmark_id=benchmark_id,
        profile_id=profile_id,
        sample_identity_sha256=sample_hash,
        sample_seconds=float(sample_seconds),
        execution_lineage=execution_lineage,
    )
    metrics_path = root / "metrics.json"
    _atomic_json(metrics_path, metrics)
    metrics_payload = _read_bounded(
        metrics_path,
        _MAX_METRICS_BYTES,
        "BENCHMARK_METRICS_MISSING",
        "BENCHMARK_METRICS_SIZE_INVALID",
    )
    return {
        "benchmark_id": benchmark_id,
        "profile_id": profile_id,
        "transcript_sha256": _sha256_bytes(transcript_payload),
        "transcript_size_bytes": len(transcript_payload),
        "metrics_sha256": _sha256_bytes(metrics_payload),
        "metrics_size_bytes": len(metrics_payload),
    }


def _sanitize_event_value(value: Any, *, depth: int = 0) -> Any:
    if depth > 3:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:512]
    if isinstance(value, list):
        return [_sanitize_event_value(item, depth=depth + 1) for item in value[:64]]
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for raw_key, raw_value in list(value.items())[:64]:
            key = str(raw_key)
            if key.casefold() in _PRIVATE_EVENT_KEYS:
                continue
            clean[key] = _sanitize_event_value(raw_value, depth=depth + 1)
        return clean
    return str(value)[:256]


def benchmark_event_row(
    *,
    benchmark_id: str,
    attempt: int,
    profile_id: str,
    seq: int,
    event_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": EVENT_SCHEMA_VERSION,
        "benchmark_id": _validate_benchmark_id(benchmark_id),
        "attempt": attempt,
        "profile_id": _validate_profile_id(profile_id),
        "seq": seq,
        "type": event_type,
        "data": _sanitize_event_value(payload),
    }


def commit_profile_artifact(
    data_root: Path,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    source_id: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    profile_receipt: dict[str, Any],
    event_rows: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    profile_id = _validate_profile_id(str(profile_receipt.get("profile_id") or ""))
    if benchmark_id != benchmark_id_for(job_id, attempt):
        raise BenchmarkEvidenceError("BENCHMARK_ID_MISMATCH")
    root = profile_root(data_root, benchmark_id, profile_id)
    manifest_path = root / "profile.json"
    if manifest_path.exists():
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ALREADY_COMMITTED")

    transcript_record = _artifact_record(root / "transcript.json", relative_to=root)
    metrics_record = _artifact_record(root / "metrics.json", relative_to=root)
    if (
        transcript_record["sha256"] != profile_receipt.get("transcript_sha256")
        or transcript_record["size_bytes"] != profile_receipt.get("transcript_size_bytes")
        or metrics_record["sha256"] != profile_receipt.get("metrics_sha256")
        or metrics_record["size_bytes"] != profile_receipt.get("metrics_size_bytes")
    ):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_PAYLOAD_MISMATCH")

    rows = list(event_rows)
    if len(rows) > 50_000:
        raise BenchmarkEvidenceError("BENCHMARK_EVENTS_LIMIT")
    event_payload = b"".join(_json_bytes(row) + b"\n" for row in rows)
    if len(event_payload) > _MAX_EVENTS_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_EVENTS_SIZE_INVALID")
    if not event_payload:
        event_payload = _json_bytes({
            "schema_version": EVENT_SCHEMA_VERSION,
            "benchmark_id": benchmark_id,
            "attempt": attempt,
            "profile_id": profile_id,
            "seq": 0,
            "type": "empty",
            "data": {},
        }) + b"\n"
    events_path = root / "events.jsonl"
    atomic_write(events_path, event_payload)
    events_record = _artifact_record(events_path, relative_to=root)

    manifest = {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "benchmark_id": benchmark_id,
        "job_id": job_id,
        "attempt": attempt,
        "source_id": source_id,
        "sample_identity_sha256": _validate_sha256(
            sample_identity_sha256,
            "BENCHMARK_SAMPLE_IDENTITY_INVALID",
        ),
        "sample_seconds": float(sample_seconds),
        "profile_id": profile_id,
        "transcript": transcript_record,
        "metrics": metrics_record,
        "events": events_record,
        "execution_lineage": profile_receipt.get("execution_lineage"),
        "completed_at": utc_now(),
    }
    _atomic_json(manifest_path, manifest)
    return manifest


def finalize_bundle(
    data_root: Path,
    *,
    benchmark_id: str,
    job_id: str,
    attempt: int,
    source_id: str,
    source_sha256: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    track_count: int,
    audio_work_seconds: float,
    context: str,
    glossary: str,
    profile_manifests: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    if benchmark_id != benchmark_id_for(job_id, attempt):
        raise BenchmarkEvidenceError("BENCHMARK_ID_MISMATCH")
    root = benchmark_root(data_root, benchmark_id)
    manifest_path = root / "benchmark.json"
    if manifest_path.exists():
        raise BenchmarkEvidenceError("BENCHMARK_ALREADY_COMMITTED")
    values = list(profile_manifests)
    if [value.get("profile_id") for value in values] != list(PROFILE_IDS):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_SET_INVALID")

    profiles: list[dict[str, Any]] = []
    for profile_id, value in zip(PROFILE_IDS, values, strict=True):
        profile_path = profile_root(data_root, benchmark_id, profile_id) / "profile.json"
        profile_record = _artifact_record(profile_path, relative_to=root)
        profiles.append({
            "profile_id": profile_id,
            "profile_manifest": profile_record,
            "transcript": value["transcript"],
            "metrics": value["metrics"],
            "events": value["events"],
        })

    manifest = {
        "schema_version": BUNDLE_SCHEMA_VERSION,
        "benchmark_id": benchmark_id,
        "job_id": job_id,
        "attempt": attempt,
        "status": "completed",
        "source_id": source_id,
        "source_sha256": _validate_sha256(source_sha256, "BENCHMARK_SOURCE_SHA256_INVALID"),
        "sample_identity_sha256": _validate_sha256(
            sample_identity_sha256,
            "BENCHMARK_SAMPLE_IDENTITY_INVALID",
        ),
        "sample_seconds": float(sample_seconds),
        "sample_descriptor": {
            "schema_version": "tda_benchmark_sample_v1",
            "start_seconds": 0,
            "end_seconds": float(sample_seconds),
            "track_count": track_count,
            "audio_work_seconds": audio_work_seconds,
        },
        "profile_order": list(PROFILE_IDS),
        "context_sha256": hashlib.sha256(context.encode("utf-8")).hexdigest(),
        "context_length": len(context),
        "glossary_sha256": hashlib.sha256(glossary.encode("utf-8")).hexdigest(),
        "glossary_length": len(glossary),
        "execution_mode": "prepared_artifacts_fresh_worker_per_profile_v1",
        "profiles": profiles,
        "completed_at": utc_now(),
    }
    _atomic_json(manifest_path, manifest)
    payload = _read_bounded(
        manifest_path,
        _MAX_BUNDLE_MANIFEST_BYTES,
        "BENCHMARK_MANIFEST_MISSING",
        "BENCHMARK_MANIFEST_SIZE_INVALID",
    )
    return {
        **manifest,
        "manifest_sha256": _sha256_bytes(payload),
        "manifest_size_bytes": len(payload),
        "bundle_size_bytes": bundle_size_bytes(data_root, benchmark_id),
    }


def _verify_artifact(root: Path, record: Any, maximum: int) -> bytes:
    if not isinstance(record, dict):
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_RECORD_INVALID")
    name = record.get("artifact")
    digest = _validate_sha256(record.get("sha256"), "BENCHMARK_ARTIFACT_HASH_INVALID")
    size = record.get("size_bytes")
    if (
        not isinstance(name, str)
        or name.startswith("/")
        or ".." in Path(name).parts
        or isinstance(size, bool)
        or not isinstance(size, int)
        or size <= 0
        or size > maximum
    ):
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_RECORD_INVALID")
    path = (root / name).resolve()
    if root.resolve() not in path.parents:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_PATH_INVALID")
    payload = _read_bounded(
        path,
        maximum,
        "BENCHMARK_ARTIFACT_MISSING",
        "BENCHMARK_ARTIFACT_SIZE_INVALID",
    )
    if len(payload) != size or _sha256_bytes(payload) != digest:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_INTEGRITY_FAILED")
    return payload


def load_bundle(data_root: Path, benchmark_id: str, *, verify_content: bool = True) -> dict[str, Any]:
    root = benchmark_root(data_root, benchmark_id)
    manifest = _read_json(
        root / "benchmark.json",
        _MAX_BUNDLE_MANIFEST_BYTES,
        "BENCHMARK_NOT_FOUND",
        "BENCHMARK_MANIFEST_SIZE_INVALID",
    )
    if (
        manifest.get("schema_version") != BUNDLE_SCHEMA_VERSION
        or manifest.get("benchmark_id") != benchmark_id
        or manifest.get("status") != "completed"
        or manifest.get("profile_order") != list(PROFILE_IDS)
        or not isinstance(manifest.get("profiles"), list)
        or len(manifest["profiles"]) != len(PROFILE_IDS)
    ):
        raise BenchmarkEvidenceError("BENCHMARK_MANIFEST_INVALID")
    _validate_sha256(manifest.get("source_sha256"), "BENCHMARK_SOURCE_SHA256_INVALID")
    _validate_sha256(
        manifest.get("sample_identity_sha256"),
        "BENCHMARK_SAMPLE_IDENTITY_INVALID",
    )
    if verify_content:
        for expected_profile, profile_entry in zip(PROFILE_IDS, manifest["profiles"], strict=True):
            if not isinstance(profile_entry, dict) or profile_entry.get("profile_id") != expected_profile:
                raise BenchmarkEvidenceError("BENCHMARK_PROFILE_SET_INVALID")
            profile_manifest_payload = _verify_artifact(
                root,
                profile_entry.get("profile_manifest"),
                _MAX_PROFILE_MANIFEST_BYTES,
            )
            try:
                profile_manifest = json.loads(profile_manifest_payload)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID") from exc
            if (
                not isinstance(profile_manifest, dict)
                or profile_manifest.get("schema_version") != PROFILE_SCHEMA_VERSION
                or profile_manifest.get("benchmark_id") != benchmark_id
                or profile_manifest.get("profile_id") != expected_profile
                or profile_manifest.get("sample_identity_sha256") != manifest.get("sample_identity_sha256")
            ):
                raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")
            profile_root_path = profile_root(data_root, benchmark_id, expected_profile)
            _verify_artifact(profile_root_path, profile_manifest.get("transcript"), _MAX_TRANSCRIPT_BYTES)
            _verify_artifact(profile_root_path, profile_manifest.get("metrics"), _MAX_METRICS_BYTES)
            _verify_artifact(profile_root_path, profile_manifest.get("events"), _MAX_EVENTS_BYTES)
    return manifest


def _profile_manifest(data_root: Path, benchmark_id: str, profile_id: str) -> dict[str, Any]:
    bundle = load_bundle(data_root, benchmark_id, verify_content=False)
    if profile_id not in bundle["profile_order"]:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_NOT_FOUND")
    root = profile_root(data_root, benchmark_id, profile_id)
    value = _read_json(
        root / "profile.json",
        _MAX_PROFILE_MANIFEST_BYTES,
        "BENCHMARK_PROFILE_NOT_FOUND",
        "BENCHMARK_PROFILE_MANIFEST_SIZE_INVALID",
    )
    if (
        value.get("schema_version") != PROFILE_SCHEMA_VERSION
        or value.get("benchmark_id") != benchmark_id
        or value.get("profile_id") != profile_id
        or value.get("sample_identity_sha256") != bundle.get("sample_identity_sha256")
    ):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    return value


def load_verified_transcript(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
) -> tuple[dict[str, Any], TranscriptDocument, bytes]:
    profile_id = _validate_profile_id(profile_id)
    bundle = load_bundle(data_root, benchmark_id, verify_content=False)
    manifest = _profile_manifest(data_root, benchmark_id, profile_id)
    root = profile_root(data_root, benchmark_id, profile_id)
    payload = _verify_artifact(root, manifest.get("transcript"), _MAX_TRANSCRIPT_BYTES)
    try:
        raw = json.loads(payload)
        document = TranscriptDocument.from_dict(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, TranscriptValidationError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_INVALID") from exc
    if document.source_sha256 != bundle.get("source_sha256"):
        raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_SOURCE_MISMATCH")
    if document.engine.profile != profile_id:
        raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_PROFILE_MISMATCH")
    return bundle, document, payload


def transcript_snapshot(data_root: Path, benchmark_id: str, profile_id: str) -> dict[str, Any]:
    bundle, document, _ = load_verified_transcript(data_root, benchmark_id, profile_id)
    lineage = _profile_manifest(data_root, benchmark_id, profile_id).get("execution_lineage")
    segments: list[dict[str, Any]] = []
    for track in document.tracks:
        for segment in track.segments:
            segments.append({
                "track_number": track.number,
                "segment_id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "timeline_start": segment.start + track.timeline_offset_seconds,
                "timeline_end": segment.end + track.timeline_offset_seconds,
                "text": segment.text,
                "speaker": track.speaker,
                "word_count": len(segment.words),
                "timing_precision": "word" if segment.words else "segment",
            })
    segments.sort(
        key=lambda item: (
            float(item["timeline_start"]),
            float(item["timeline_end"]),
            int(item["track_number"]),
            str(item["segment_id"]),
        )
    )
    stats = document.stats
    return {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "benchmark_id": benchmark_id,
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "source_id": bundle["source_id"],
        "source_sha256": bundle["source_sha256"],
        "profile_id": profile_id,
        "engine": document.engine.engine,
        "model": document.engine.model,
        "model_revision": document.engine.model_revision,
        "device": document.engine.device,
        "compute_type": document.engine.compute_type,
        "alignment": document.engine.alignment,
        "execution_lineage": lineage,
        "stats": {
            "audio_work_seconds": stats.audio_work_seconds,
            "processing_seconds": stats.processing_seconds,
            "processing_metrics": stats.processing_metrics,
            "session_duration_seconds": stats.session_duration_seconds,
            "duration_semantics": stats.duration_semantics,
            "rtf": stats.rtf,
            "word_count": stats.word_count,
            "segment_count": stats.segment_count,
            "track_count": stats.track_count,
            "turn_count": stats.turn_count,
            "deduplicated_segment_count": stats.deduplicated_segment_count,
            "warning_count": len(document.warnings),
        },
        "warnings": list(document.warnings),
        "segments": segments,
    }


def _timestamp(seconds: float, *, separator: str = ".") -> str:
    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds < 0:
        raise BenchmarkEvidenceError("BENCHMARK_EXPORT_TIMING_INVALID")
    milliseconds = round(float(seconds) * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def _ordered_segments(document: TranscriptDocument) -> list[tuple[float, float, int, str, str, str]]:
    values: list[tuple[float, float, int, str, str, str]] = []
    for track in document.tracks:
        for segment in track.segments:
            start = float(segment.start) + float(track.timeline_offset_seconds)
            end = float(segment.end) + float(track.timeline_offset_seconds)
            values.append((start, end, track.number, segment.id, track.speaker, segment.text))
    values.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
    return values


def transcript_txt(document: TranscriptDocument, *, timestamps: bool = True) -> bytes:
    lines: list[str] = []
    for start, _end, _track, _segment, speaker, text in _ordered_segments(document):
        prefix = f"[{_timestamp(start)}] " if timestamps else ""
        lines.append(f"{prefix}{speaker}\n{text.strip()}")
    return ("\n\n".join(lines).rstrip() + "\n").encode("utf-8")


def transcript_vtt(document: TranscriptDocument) -> bytes:
    lines = ["WEBVTT", ""]
    previous_start = -1.0
    for start, end, _track, _segment, speaker, text in _ordered_segments(document):
        if end <= start or start < previous_start:
            raise BenchmarkEvidenceError("BENCHMARK_EXPORT_TIMING_INVALID")
        previous_start = start
        lines.extend([
            f"{_timestamp(start)} --> {_timestamp(end)}",
            f"{speaker}: {text.strip()}",
            "",
        ])
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def transcript_srt(document: TranscriptDocument) -> bytes:
    lines: list[str] = []
    previous_start = -1.0
    for index, (start, end, _track, _segment, speaker, text) in enumerate(
        _ordered_segments(document),
        start=1,
    ):
        if end <= start or start < previous_start:
            raise BenchmarkEvidenceError("BENCHMARK_EXPORT_TIMING_INVALID")
        previous_start = start
        lines.extend([
            str(index),
            f"{_timestamp(start, separator=',')} --> {_timestamp(end, separator=',')}",
            f"{speaker}: {text.strip()}",
            "",
        ])
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def derived_artifact(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    format_name: str,
) -> tuple[bytes, str, str]:
    _bundle, document, canonical = load_verified_transcript(data_root, benchmark_id, profile_id)
    if format_name == "json":
        return canonical, "application/json; charset=utf-8", "transcript.json"
    if format_name == "txt":
        return transcript_txt(document), "text/plain; charset=utf-8", "transcript.txt"
    if format_name == "vtt":
        return transcript_vtt(document), "text/vtt; charset=utf-8", "transcript.vtt"
    if format_name == "srt":
        return transcript_srt(document), "application/x-subrip; charset=utf-8", "transcript.srt"
    raise BenchmarkEvidenceError("BENCHMARK_EXPORT_FORMAT_UNSUPPORTED")


def bundle_size_bytes(data_root: Path, benchmark_id: str) -> int:
    root = benchmark_root(data_root, benchmark_id)
    if not root.is_dir():
        return 0
    total = 0
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            total += path.stat().st_size
    return total


def public_bundle_summary(data_root: Path, benchmark_id: str) -> dict[str, Any]:
    manifest = load_bundle(data_root, benchmark_id, verify_content=True)
    return {
        "schema_version": "tda_benchmark_artifacts_v1",
        "benchmark_id": benchmark_id,
        "sample_identity_sha256": manifest["sample_identity_sha256"],
        "source_id": manifest["source_id"],
        "profile_order": manifest["profile_order"],
        "bundle_size_bytes": bundle_size_bytes(data_root, benchmark_id),
        "formats": ["json", "txt", "vtt", "srt"],
        "quality_reference_status": "none",
        "telemetry_available": False,
        "integrity": "verified",
    }


def write_private_evidence_zip(
    data_root: Path,
    benchmark_id: str,
    destination: Path,
) -> None:
    load_bundle(data_root, benchmark_id, verify_content=True)
    root = benchmark_root(data_root, benchmark_id)
    prefix = f"TDA-Benchmark-{benchmark_id}"
    entries: list[tuple[str, bytes]] = [
        (f"{prefix}/benchmark.json", _read_bounded(
            root / "benchmark.json",
            _MAX_BUNDLE_MANIFEST_BYTES,
            "BENCHMARK_MANIFEST_MISSING",
            "BENCHMARK_MANIFEST_SIZE_INVALID",
        )),
    ]
    for profile_id in PROFILE_IDS:
        profile_dir = profile_root(data_root, benchmark_id, profile_id)
        profile_manifest = _profile_manifest(data_root, benchmark_id, profile_id)
        _, document, canonical = load_verified_transcript(data_root, benchmark_id, profile_id)
        entries.extend([
            (f"{prefix}/profiles/{profile_id}/profile.json", _read_bounded(
                profile_dir / "profile.json",
                _MAX_PROFILE_MANIFEST_BYTES,
                "BENCHMARK_PROFILE_NOT_FOUND",
                "BENCHMARK_PROFILE_MANIFEST_SIZE_INVALID",
            )),
            (f"{prefix}/profiles/{profile_id}/transcript.json", canonical),
            (f"{prefix}/profiles/{profile_id}/transcript.txt", transcript_txt(document)),
            (f"{prefix}/profiles/{profile_id}/transcript.vtt", transcript_vtt(document)),
            (f"{prefix}/profiles/{profile_id}/transcript.srt", transcript_srt(document)),
            (f"{prefix}/profiles/{profile_id}/metrics.json", _verify_artifact(
                profile_dir, profile_manifest["metrics"], _MAX_METRICS_BYTES,
            )),
            (f"{prefix}/profiles/{profile_id}/events.jsonl", _verify_artifact(
                profile_dir, profile_manifest["events"], _MAX_EVENTS_BYTES,
            )),
        ])
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, payload in entries:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, payload)
