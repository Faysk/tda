from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Any

from .benchmark_bundles import (
    BENCHMARK_PROFILES,
    BenchmarkBundleError,
    benchmark_root,
    load_benchmark_bundle,
    read_benchmark_transcript,
)
from .transcript import TranscriptDocument, TranscriptValidationError

SNAPSHOT_SCHEMA_VERSION = "tda_benchmark_transcript_snapshot_v1"
METRICS_SCHEMA_VERSION = "tda_benchmark_metrics_v1"
EVENT_SCHEMA_VERSION = "tda_benchmark_evidence_event_v1"
PROFILE_IDS = tuple(BENCHMARK_PROFILES)

_BENCHMARK_ID = re.compile(r"^benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5}$")
_PROFILE_ID = re.compile(r"^(?:whisper-(?:turbo|detailed)|qwen-(?:fast|quality))$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAX_TRANSCRIPT_BYTES = 512 * 1024 * 1024
_MAX_PROFILE_MANIFEST_BYTES = 512 * 1024
_MAX_BUNDLE_MANIFEST_BYTES = 1024 * 1024
_MAX_DIAGNOSTIC_ARTIFACT_BYTES = 8 * 1024 * 1024


class BenchmarkEvidenceError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _translate_bundle_error(exc: BenchmarkBundleError) -> BenchmarkEvidenceError:
    return BenchmarkEvidenceError(str(exc))


def _validate_benchmark_id(value: str) -> str:
    if not isinstance(value, str) or _BENCHMARK_ID.fullmatch(value) is None:
        raise BenchmarkEvidenceError("BENCHMARK_ID_INVALID")
    return value


def _validate_profile_id(value: str) -> str:
    if not isinstance(value, str) or _PROFILE_ID.fullmatch(value) is None:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_ID_INVALID")
    return value


def _json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_EXPORT_JSON_INVALID") from exc


def _read_bounded(path: Path, maximum: int, missing_code: str, invalid_code: str) -> bytes:
    if path.is_symlink():
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SYMLINK")
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise BenchmarkEvidenceError(missing_code) from exc
    if size <= 0 or size > maximum or not path.is_file():
        raise BenchmarkEvidenceError(invalid_code)
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_READ_FAILED") from exc
    if len(payload) != size:
        raise BenchmarkEvidenceError("BENCHMARK_ARTIFACT_SIZE_MISMATCH")
    return payload


def _bundle(data_root: Path, benchmark_id: str) -> dict[str, Any]:
    _validate_benchmark_id(benchmark_id)
    try:
        return load_benchmark_bundle(data_root, benchmark_id)
    except BenchmarkBundleError as exc:
        raise _translate_bundle_error(exc) from exc


def _profile_entry(bundle: dict[str, Any], profile_id: str) -> dict[str, Any]:
    profile_id = _validate_profile_id(profile_id)
    profiles = bundle.get("profiles")
    if not isinstance(profiles, list):
        raise BenchmarkEvidenceError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
    entry = next(
        (
            value
            for value in profiles
            if isinstance(value, dict) and value.get("profile_id") == profile_id
        ),
        None,
    )
    if entry is None:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_NOT_FOUND")
    return entry


def _profile_manifest(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    *,
    bundle: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], bytes]:
    bundle = bundle or _bundle(data_root, benchmark_id)
    entry = _profile_entry(bundle, profile_id)
    descriptor = entry.get("profile_manifest")
    if not isinstance(descriptor, dict):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    expected_path = f"profiles/{profile_id}/profile.json"
    digest = descriptor.get("sha256")
    size = descriptor.get("size_bytes")
    if (
        descriptor.get("artifact") != expected_path
        or not isinstance(digest, str)
        or _SHA256.fullmatch(digest) is None
        or isinstance(size, bool)
        or not isinstance(size, int)
        or size <= 0
        or size > _MAX_PROFILE_MANIFEST_BYTES
    ):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID")

    root = benchmark_root(data_root, benchmark_id)
    path = root / expected_path
    payload = _read_bounded(
        path,
        _MAX_PROFILE_MANIFEST_BYTES,
        "BENCHMARK_PROFILE_MANIFEST_MISSING",
        "BENCHMARK_PROFILE_MANIFEST_INVALID",
    )
    if len(payload) != size or hashlib.sha256(payload).hexdigest() != digest:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_MISMATCH")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_INVALID") from exc
    if (
        not isinstance(value, dict)
        or value.get("schema_version") != "tda_benchmark_profile_artifact_v1"
        or value.get("benchmark_id") != benchmark_id
        or value.get("profile_id") != profile_id
        or value.get("source_id") != bundle.get("source_id")
        or value.get("source_sha256") != bundle.get("source_sha256")
        or value.get("sample_identity_sha256") != bundle.get("sample_identity_sha256")
    ):
        raise BenchmarkEvidenceError("BENCHMARK_PROFILE_MANIFEST_MISMATCH")
    return value, payload


def _diagnostic_artifact(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    kind: str,
    *,
    bundle: dict[str, Any],
) -> bytes | None:
    entry = _profile_entry(bundle, profile_id)
    diagnostics = entry.get("diagnostics")
    if diagnostics is None:
        return None
    if not isinstance(diagnostics, dict):
        raise BenchmarkEvidenceError("BENCHMARK_DIAGNOSTIC_ARTIFACT_INVALID")
    descriptor = diagnostics.get(kind)
    if descriptor is None:
        return None
    if not isinstance(descriptor, dict):
        raise BenchmarkEvidenceError("BENCHMARK_DIAGNOSTIC_ARTIFACT_INVALID")
    filenames = {
        "metrics": "metrics.json",
        "events": "events.jsonl",
        "telemetry": "telemetry.jsonl",
    }
    filename = filenames.get(kind)
    if filename is None:
        raise BenchmarkEvidenceError("BENCHMARK_DIAGNOSTIC_ARTIFACT_INVALID")
    expected_artifact = f"profiles/{profile_id}/{filename}"
    digest = descriptor.get("sha256")
    size = descriptor.get("size_bytes")
    if (
        descriptor.get("artifact") != expected_artifact
        or not isinstance(digest, str)
        or _SHA256.fullmatch(digest) is None
        or isinstance(size, bool)
        or not isinstance(size, int)
        or size <= 0
        or size > _MAX_DIAGNOSTIC_ARTIFACT_BYTES
    ):
        raise BenchmarkEvidenceError("BENCHMARK_DIAGNOSTIC_ARTIFACT_INVALID")
    path = benchmark_root(data_root, benchmark_id) / expected_artifact
    payload = _read_bounded(
        path,
        _MAX_DIAGNOSTIC_ARTIFACT_BYTES,
        "BENCHMARK_DIAGNOSTIC_ARTIFACT_MISSING",
        "BENCHMARK_DIAGNOSTIC_ARTIFACT_INVALID",
    )
    if len(payload) != size or hashlib.sha256(payload).hexdigest() != digest:
        raise BenchmarkEvidenceError("BENCHMARK_DIAGNOSTIC_ARTIFACT_MISMATCH")
    return payload


def load_verified_transcript(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
) -> tuple[dict[str, Any], TranscriptDocument, bytes]:
    bundle = _bundle(data_root, benchmark_id)
    _profile_entry(bundle, profile_id)
    try:
        payload = read_benchmark_transcript(data_root, benchmark_id, profile_id)
    except BenchmarkBundleError as exc:
        raise _translate_bundle_error(exc) from exc
    if len(payload) <= 0 or len(payload) > _MAX_TRANSCRIPT_BYTES:
        raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_SIZE_INVALID")
    try:
        raw = json.loads(payload.decode("utf-8"))
        document = TranscriptDocument.from_dict(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, TranscriptValidationError) as exc:
        raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_INVALID") from exc
    if (
        document.source_sha256.lower() != str(bundle.get("source_sha256", "")).lower()
        or document.engine.profile != profile_id
    ):
        raise BenchmarkEvidenceError("BENCHMARK_TRANSCRIPT_IDENTITY_MISMATCH")
    return bundle, document, payload


def transcript_snapshot(data_root: Path, benchmark_id: str, profile_id: str) -> dict[str, Any]:
    bundle, document, _ = load_verified_transcript(data_root, benchmark_id, profile_id)
    profile_manifest, _ = _profile_manifest(
        data_root,
        benchmark_id,
        profile_id,
        bundle=bundle,
    )
    segments: list[dict[str, Any]] = []
    for track in document.tracks:
        for segment in track.segments:
            segments.append(
                {
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
                }
            )
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
        "engine": "whisper" if profile_id.startswith("whisper-") else "qwen3",
        "model": document.engine.model,
        "model_revision": document.engine.model_revision,
        "device": document.engine.device,
        "compute_type": document.engine.compute_type,
        "alignment": document.engine.alignment,
        "execution_lineage": profile_manifest.get("execution_lineage"),
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
    if (
        not isinstance(seconds, (int, float))
        or isinstance(seconds, bool)
        or seconds < 0
    ):
        raise BenchmarkEvidenceError("BENCHMARK_EXPORT_TIMING_INVALID")
    milliseconds = round(float(seconds) * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def _ordered_segments(
    document: TranscriptDocument,
) -> list[tuple[float, float, int, str, str, str]]:
    values: list[tuple[float, float, int, str, str, str]] = []
    for track in document.tracks:
        for segment in track.segments:
            start = float(segment.start) + float(track.timeline_offset_seconds)
            end = float(segment.end) + float(track.timeline_offset_seconds)
            values.append(
                (start, end, track.number, segment.id, track.speaker, segment.text)
            )
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
        lines.extend(
            [
                f"{_timestamp(start)} --> {_timestamp(end)}",
                f"{speaker}: {text.strip()}",
                "",
            ]
        )
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
        lines.extend(
            [
                str(index),
                f"{_timestamp(start, separator=',')} --> {_timestamp(end, separator=',')}",
                f"{speaker}: {text.strip()}",
                "",
            ]
        )
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def derived_artifact(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
    format_name: str,
) -> tuple[bytes, str, str]:
    _bundle_value, document, canonical = load_verified_transcript(
        data_root,
        benchmark_id,
        profile_id,
    )
    if format_name == "json":
        return canonical, "application/json; charset=utf-8", "transcript.json"
    if format_name == "txt":
        return transcript_txt(document), "text/plain; charset=utf-8", "transcript.txt"
    if format_name == "txt-plain":
        return (
            transcript_txt(document, timestamps=False),
            "text/plain; charset=utf-8",
            "transcript-plain.txt",
        )
    if format_name == "vtt":
        return transcript_vtt(document), "text/vtt; charset=utf-8", "transcript.vtt"
    if format_name == "srt":
        return transcript_srt(document), "application/x-subrip; charset=utf-8", "transcript.srt"
    raise BenchmarkEvidenceError("BENCHMARK_EXPORT_FORMAT_UNSUPPORTED")


def _derived_metrics(
    *,
    bundle: dict[str, Any],
    document: TranscriptDocument,
    profile_manifest: dict[str, Any],
) -> bytes:
    stats = document.stats
    value = {
        "schema_version": METRICS_SCHEMA_VERSION,
        "measurement_mode": "canonical_bundle_derived_v1",
        "benchmark_id": bundle["benchmark_id"],
        "profile_id": document.engine.profile,
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "sample_seconds": bundle["sample_seconds"],
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
        "processing_metrics": profile_manifest.get("processing_metrics"),
        "execution_lineage": profile_manifest.get("execution_lineage"),
        "completed_at": profile_manifest.get("completed_at"),
    }
    return _json_bytes(value)


def _warning_code(value: object) -> str:
    if not isinstance(value, str):
        return "TRANSCRIPT_WARNING"
    prefix = value.split(":", 1)[0].strip().upper().replace("-", "_")
    prefix = re.sub(r"[^A-Z0-9_]", "_", prefix)
    prefix = re.sub(r"_+", "_", prefix).strip("_")
    return prefix[:96] if prefix else "TRANSCRIPT_WARNING"


def _derived_events(
    *,
    bundle: dict[str, Any],
    document: TranscriptDocument,
    profile_manifest: dict[str, Any],
) -> bytes:
    profile_id = document.engine.profile
    entry = _profile_entry(bundle, profile_id)
    transcript = entry.get("transcript")
    rows: list[dict[str, Any]] = [
        {
            "schema_version": EVENT_SCHEMA_VERSION,
            "seq": 0,
            "at": profile_manifest.get("completed_at"),
            "benchmark_id": bundle["benchmark_id"],
            "profile_id": profile_id,
            "type": "evidence",
            "code": "PROFILE_EVIDENCE_COMMITTED",
            "data": {
                "transcript_sha256": transcript.get("sha256")
                if isinstance(transcript, dict)
                else None,
                "transcript_size_bytes": transcript.get("size_bytes")
                if isinstance(transcript, dict)
                else None,
                "processing_timing_version": (
                    profile_manifest.get("processing_metrics") or {}
                ).get("version")
                if isinstance(profile_manifest.get("processing_metrics"), dict)
                else None,
            },
        }
    ]
    for warning in sorted({_warning_code(value) for value in document.warnings}):
        rows.append(
            {
                "schema_version": EVENT_SCHEMA_VERSION,
                "seq": len(rows),
                "at": profile_manifest.get("completed_at"),
                "benchmark_id": bundle["benchmark_id"],
                "profile_id": profile_id,
                "type": "warning",
                "code": warning,
                "data": {},
            }
        )
    return b"".join(_json_bytes(row) + b"\n" for row in rows)


def public_bundle_summary(data_root: Path, benchmark_id: str) -> dict[str, Any]:
    bundle = _bundle(data_root, benchmark_id)
    telemetry_available = any(
        isinstance(entry, dict)
        and isinstance(entry.get("diagnostics"), dict)
        and isinstance(entry["diagnostics"].get("telemetry"), dict)
        for entry in bundle.get("profiles", [])
    )
    return {
        "schema_version": "tda_benchmark_artifacts_v1",
        "benchmark_id": benchmark_id,
        "sample_identity_sha256": bundle["sample_identity_sha256"],
        "source_id": bundle["source_id"],
        "profile_order": bundle["profile_order"],
        "bundle_size_bytes": bundle["bundle_size_bytes"],
        "formats": ["json", "txt", "txt-plain", "vtt", "srt"],
        "quality_reference_status": "none",
        "telemetry_available": telemetry_available,
        "integrity": "manifest_verified",
    }


def _verified_bundle_manifest_bytes(
    data_root: Path,
    benchmark_id: str,
    bundle: dict[str, Any],
) -> bytes:
    root = benchmark_root(data_root, benchmark_id)
    payload = _read_bounded(
        root / "benchmark.json",
        _MAX_BUNDLE_MANIFEST_BYTES,
        "BENCHMARK_BUNDLE_NOT_FOUND",
        "BENCHMARK_BUNDLE_MANIFEST_INVALID",
    )
    if (
        len(payload) != bundle.get("bundle_manifest_size_bytes")
        or hashlib.sha256(payload).hexdigest() != bundle.get("bundle_manifest_sha256")
    ):
        raise BenchmarkEvidenceError("BENCHMARK_BUNDLE_MANIFEST_MISMATCH")
    return payload


def _write_zip_entry(archive: zipfile.ZipFile, name: str, payload: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o600 << 16
    archive.writestr(info, payload)


def write_private_evidence_zip(
    data_root: Path,
    benchmark_id: str,
    destination: Path,
) -> None:
    bundle = _bundle(data_root, benchmark_id)
    prefix = f"TDA-Benchmark-{benchmark_id}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        destination,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        _write_zip_entry(
            archive,
            f"{prefix}/benchmark.json",
            _verified_bundle_manifest_bytes(data_root, benchmark_id, bundle),
        )
        for profile_id in PROFILE_IDS:
            profile_manifest, profile_manifest_bytes = _profile_manifest(
                data_root,
                benchmark_id,
                profile_id,
                bundle=bundle,
            )
            _bundle_value, document, canonical = load_verified_transcript(
                data_root,
                benchmark_id,
                profile_id,
            )
            base = f"{prefix}/profiles/{profile_id}"
            _write_zip_entry(archive, f"{base}/profile.json", profile_manifest_bytes)
            _write_zip_entry(archive, f"{base}/transcript.json", canonical)
            _write_zip_entry(archive, f"{base}/transcript.txt", transcript_txt(document))
            _write_zip_entry(archive, f"{base}/transcript.vtt", transcript_vtt(document))
            _write_zip_entry(archive, f"{base}/transcript.srt", transcript_srt(document))
            metrics_payload = _diagnostic_artifact(
                data_root,
                benchmark_id,
                profile_id,
                "metrics",
                bundle=bundle,
            ) or _derived_metrics(
                bundle=bundle,
                document=document,
                profile_manifest=profile_manifest,
            )
            events_payload = _diagnostic_artifact(
                data_root,
                benchmark_id,
                profile_id,
                "events",
                bundle=bundle,
            ) or _derived_events(
                bundle=bundle,
                document=document,
                profile_manifest=profile_manifest,
            )
            telemetry_payload = _diagnostic_artifact(
                data_root,
                benchmark_id,
                profile_id,
                "telemetry",
                bundle=bundle,
            )
            _write_zip_entry(archive, f"{base}/metrics.json", metrics_payload)
            _write_zip_entry(archive, f"{base}/events.jsonl", events_payload)
            if telemetry_payload is not None:
                _write_zip_entry(
                    archive,
                    f"{base}/telemetry.jsonl",
                    telemetry_payload,
                )
