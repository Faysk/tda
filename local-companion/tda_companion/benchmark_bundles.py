from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import stat
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .atomic_storage import AtomicStorageError, atomic_write
from .transcript import TranscriptDocument, TranscriptValidationError

BUNDLE_SCHEMA_VERSION = "tda_benchmark_bundle_v1"
PROFILE_ARTIFACT_SCHEMA_VERSION = "tda_benchmark_profile_artifact_v1"
SAMPLE_SCHEMA_VERSION = "tda_benchmark_sample_v1"
BENCHMARK_PROFILES = (
    "whisper-turbo",
    "whisper-detailed",
    "qwen-fast",
    "qwen-quality",
)
BENCHMARK_SAMPLE_SECONDS = 300.0
BENCHMARK_EXECUTION_MODE = "prepared_artifacts_fresh_worker_per_profile_v1"

_BENCHMARK_ID = re.compile(r"^benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5}$")
_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SOURCE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_MAX_MANIFEST_BYTES = 512 * 1024
_MAX_TRANSCRIPT_BYTES = 512 * 1024 * 1024
_COPY_CHUNK = 1024 * 1024


class BenchmarkBundleError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def benchmark_id_for(job_id: str, attempt: int) -> str:
    if not isinstance(job_id, str) or _JOB_ID.fullmatch(job_id) is None:
        raise BenchmarkBundleError("BENCHMARK_JOB_ID_INVALID")
    if (
        isinstance(attempt, bool)
        or not isinstance(attempt, int)
        or attempt < 1
        or attempt > 1_000_000
    ):
        raise BenchmarkBundleError("BENCHMARK_ATTEMPT_INVALID")
    value = f"benchmark-{job_id}-a{attempt}"
    if _BENCHMARK_ID.fullmatch(value) is None:
        raise BenchmarkBundleError("BENCHMARK_ID_INVALID")
    return value


def _is_reparse_point(path: Path) -> bool:
    if path.is_symlink():
        return True
    try:
        if getattr(path, "is_junction", lambda: False)():
            return True
    except OSError:
        return True
    if os.name == "nt":
        try:
            attributes = getattr(path.lstat(), "st_file_attributes", 0)
        except (FileNotFoundError, OSError):
            return False
        return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    return False


def _benchmarks_root(data_root: Path) -> Path:
    data = data_root.resolve()
    raw = data / "benchmarks"
    if _is_reparse_point(raw):
        raise BenchmarkBundleError("BENCHMARK_ROOT_INVALID")
    root = raw.resolve()
    if root.parent != data:
        raise BenchmarkBundleError("BENCHMARK_ROOT_INVALID")
    return root


def benchmark_root(data_root: Path, benchmark_id: str) -> Path:
    if not isinstance(benchmark_id, str) or _BENCHMARK_ID.fullmatch(benchmark_id) is None:
        raise BenchmarkBundleError("BENCHMARK_ID_INVALID")
    parent = _benchmarks_root(data_root)
    raw = parent / benchmark_id
    if _is_reparse_point(raw):
        raise BenchmarkBundleError("BENCHMARK_PATH_INVALID")
    result = raw.resolve()
    if result.parent != parent:
        raise BenchmarkBundleError("BENCHMARK_PATH_INVALID")
    return result


def _profile_root(data_root: Path, benchmark_id: str, profile_id: str) -> Path:
    if profile_id not in BENCHMARK_PROFILES:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_INVALID")
    root = benchmark_root(data_root, benchmark_id)
    profiles = root / "profiles"
    if _is_reparse_point(profiles):
        raise BenchmarkBundleError("BENCHMARK_PROFILE_ROOT_INVALID")
    profiles = profiles.resolve()
    if profiles.parent != root:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_ROOT_INVALID")
    raw = profiles / profile_id
    if _is_reparse_point(raw):
        raise BenchmarkBundleError("BENCHMARK_PROFILE_PATH_INVALID")
    result = raw.resolve()
    if result.parent != profiles:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_PATH_INVALID")
    return result


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(_COPY_CHUNK), b""):
                digest.update(chunk)
    except OSError as exc:
        raise BenchmarkBundleError("BENCHMARK_ARTIFACT_READ_FAILED") from exc
    return digest.hexdigest()


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _document_payload(document: TranscriptDocument) -> bytes:
    document.validate()
    return json.dumps(
        document.as_dict(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _validate_transcript_paths(document: TranscriptDocument) -> None:
    for track in document.tracks:
        source_filename = track.source_filename
        if (
            Path(source_filename).is_absolute()
            or "/" in source_filename
            or "\\" in source_filename
            or "\x00" in source_filename
        ):
            raise BenchmarkBundleError("BENCHMARK_TRANSCRIPT_PATH_INVALID")


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    atomic_write(path, payload)


def _bounded_bytes(
    path: Path,
    *,
    maximum: int,
    missing_code: str,
    invalid_code: str,
) -> bytes:
    if _is_reparse_point(path):
        raise BenchmarkBundleError(invalid_code)
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise BenchmarkBundleError(missing_code) from exc
    if size <= 0 or size > maximum or not path.is_file():
        raise BenchmarkBundleError(invalid_code)
    try:
        with path.open("rb") as handle:
            payload = handle.read(size + 1)
    except OSError as exc:
        raise BenchmarkBundleError(invalid_code) from exc
    if len(payload) != size or len(payload) > maximum:
        raise BenchmarkBundleError(invalid_code)
    return payload


def _bounded_json(path: Path, *, missing_code: str, invalid_code: str) -> tuple[dict[str, Any], bytes]:
    payload = _bounded_bytes(
        path,
        maximum=_MAX_MANIFEST_BYTES,
        missing_code=missing_code,
        invalid_code=invalid_code,
    )
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkBundleError(invalid_code) from exc
    if not isinstance(value, dict):
        raise BenchmarkBundleError(invalid_code)
    return value, payload


def _sha256_value(value: object, code: str) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise BenchmarkBundleError(code)
    return value


def _non_negative_number(value: object, code: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BenchmarkBundleError(code)
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise BenchmarkBundleError(code)
    return result


def _positive_size(value: object, code: str, *, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > maximum:
        raise BenchmarkBundleError(code)
    return value


def benchmark_sample_descriptor(package: Any, sample_seconds: float = BENCHMARK_SAMPLE_SECONDS) -> dict[str, Any]:
    if (
        isinstance(sample_seconds, bool)
        or not isinstance(sample_seconds, (int, float))
        or not math.isfinite(float(sample_seconds))
        or float(sample_seconds) != BENCHMARK_SAMPLE_SECONDS
    ):
        raise BenchmarkBundleError("BENCHMARK_SAMPLE_SECONDS_INVALID")
    source_sha256 = _sha256_value(
        getattr(package, "source_sha256", None),
        "BENCHMARK_SOURCE_SHA256_INVALID",
    )
    tracks = []
    seen: set[int] = set()
    for track in tuple(getattr(package, "tracks", ())):
        number = getattr(track, "number", None)
        digest = getattr(track, "sha256", None)
        if (
            isinstance(number, bool)
            or not isinstance(number, int)
            or number < 1
            or number in seen
        ):
            raise BenchmarkBundleError("BENCHMARK_SAMPLE_TRACK_INVALID")
        seen.add(number)
        tracks.append(
            {
                "number": number,
                "sha256": _sha256_value(digest, "BENCHMARK_SAMPLE_TRACK_SHA256_INVALID"),
            }
        )
    if not tracks:
        raise BenchmarkBundleError("BENCHMARK_SAMPLE_TRACKS_EMPTY")
    return {
        "schema": SAMPLE_SCHEMA_VERSION,
        "source_sha256": source_sha256,
        "start_seconds": 0.0,
        "end_seconds": BENCHMARK_SAMPLE_SECONDS,
        "tracks": tracks,
    }


def _validate_sample_descriptor(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BenchmarkBundleError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
    if value.get("schema") != SAMPLE_SCHEMA_VERSION:
        raise BenchmarkBundleError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
    source_sha256 = _sha256_value(
        value.get("source_sha256"),
        "BENCHMARK_SAMPLE_DESCRIPTOR_INVALID",
    )
    if value.get("start_seconds") != 0.0 or value.get("end_seconds") != BENCHMARK_SAMPLE_SECONDS:
        raise BenchmarkBundleError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
    raw_tracks = value.get("tracks")
    if not isinstance(raw_tracks, list) or not raw_tracks:
        raise BenchmarkBundleError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
    tracks: list[dict[str, Any]] = []
    seen: set[int] = set()
    for raw in raw_tracks:
        if not isinstance(raw, dict):
            raise BenchmarkBundleError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
        number = raw.get("number")
        if (
            isinstance(number, bool)
            or not isinstance(number, int)
            or number < 1
            or number in seen
        ):
            raise BenchmarkBundleError("BENCHMARK_SAMPLE_DESCRIPTOR_INVALID")
        seen.add(number)
        tracks.append(
            {
                "number": number,
                "sha256": _sha256_value(
                    raw.get("sha256"),
                    "BENCHMARK_SAMPLE_DESCRIPTOR_INVALID",
                ),
            }
        )
    return {
        "schema": SAMPLE_SCHEMA_VERSION,
        "source_sha256": source_sha256,
        "start_seconds": 0.0,
        "end_seconds": BENCHMARK_SAMPLE_SECONDS,
        "tracks": tracks,
    }


def benchmark_sample_identity(package: Any, sample_seconds: float = BENCHMARK_SAMPLE_SECONDS) -> str:
    return benchmark_sample_identity_from_descriptor(
        benchmark_sample_descriptor(package, sample_seconds)
    )


def benchmark_sample_identity_from_descriptor(descriptor: object) -> str:
    normalized = _validate_sample_descriptor(descriptor)
    payload = json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _safe_remove_incomplete(path: Path, expected_parent: Path) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if _is_reparse_point(path) or path.resolve().parent != expected_parent.resolve():
        raise BenchmarkBundleError("BENCHMARK_PROFILE_PATH_INVALID")
    if not path.is_dir():
        raise BenchmarkBundleError("BENCHMARK_PROFILE_PATH_INVALID")
    shutil.rmtree(path)


def _profile_manifest_metadata(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
) -> dict[str, Any]:
    root = _profile_root(data_root, benchmark_id, profile_id)
    manifest_path = root / "profile.json"
    manifest, payload = _bounded_json(
        manifest_path,
        missing_code="BENCHMARK_PROFILE_MANIFEST_MISSING",
        invalid_code="BENCHMARK_PROFILE_MANIFEST_INVALID",
    )
    if (
        manifest.get("schema_version") != PROFILE_ARTIFACT_SCHEMA_VERSION
        or manifest.get("benchmark_id") != benchmark_id
        or manifest.get("profile_id") != profile_id
        or manifest.get("sample_seconds") != BENCHMARK_SAMPLE_SECONDS
    ):
        raise BenchmarkBundleError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    source_id = manifest.get("source_id")
    if not isinstance(source_id, str) or _SOURCE_ID.fullmatch(source_id) is None:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    _sha256_value(manifest.get("source_sha256"), "BENCHMARK_PROFILE_MANIFEST_INVALID")
    _sha256_value(
        manifest.get("sample_identity_sha256"),
        "BENCHMARK_PROFILE_MANIFEST_INVALID",
    )
    lineage = manifest.get("execution_lineage")
    if not isinstance(lineage, dict) or lineage.get("schema_version") != "tda_execution_lineage_v1":
        raise BenchmarkBundleError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    metrics = manifest.get("processing_metrics")
    if not isinstance(metrics, dict):
        raise BenchmarkBundleError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    completed_at = manifest.get("completed_at")
    if not isinstance(completed_at, str) or not completed_at:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    transcript = manifest.get("transcript")
    if not isinstance(transcript, dict) or transcript.get("artifact") != "transcript.json":
        raise BenchmarkBundleError("BENCHMARK_PROFILE_MANIFEST_INVALID")
    transcript_sha256 = _sha256_value(
        transcript.get("sha256"),
        "BENCHMARK_PROFILE_MANIFEST_INVALID",
    )
    transcript_size_bytes = _positive_size(
        transcript.get("size_bytes"),
        "BENCHMARK_PROFILE_MANIFEST_INVALID",
        maximum=_MAX_TRANSCRIPT_BYTES,
    )
    return {
        "manifest": manifest,
        "manifest_sha256": hashlib.sha256(payload).hexdigest(),
        "manifest_size_bytes": len(payload),
        "transcript_sha256": transcript_sha256,
        "transcript_size_bytes": transcript_size_bytes,
    }


def write_benchmark_profile(
    data_root: Path,
    document: TranscriptDocument,
    *,
    job_id: str,
    attempt: int,
    source_id: str,
    sample_identity_sha256: str,
    sample_seconds: float,
    execution_lineage: dict[str, Any],
) -> dict[str, Any]:
    document.validate()
    _validate_transcript_paths(document)
    document_payload = _document_payload(document)
    benchmark_id = benchmark_id_for(job_id, attempt)
    profile_id = document.engine.profile
    if profile_id not in BENCHMARK_PROFILES:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_INVALID")
    if not isinstance(source_id, str) or _SOURCE_ID.fullmatch(source_id) is None:
        raise BenchmarkBundleError("BENCHMARK_SOURCE_ID_INVALID")
    _sha256_value(document.source_sha256.lower(), "BENCHMARK_SOURCE_SHA256_INVALID")
    _sha256_value(sample_identity_sha256, "BENCHMARK_SAMPLE_IDENTITY_INVALID")
    if float(sample_seconds) != BENCHMARK_SAMPLE_SECONDS:
        raise BenchmarkBundleError("BENCHMARK_SAMPLE_SECONDS_INVALID")
    if (
        not isinstance(execution_lineage, dict)
        or execution_lineage.get("schema_version") != "tda_execution_lineage_v1"
    ):
        raise BenchmarkBundleError("BENCHMARK_EXECUTION_LINEAGE_INVALID")
    if not isinstance(document.stats.processing_metrics, dict):
        raise BenchmarkBundleError("BENCHMARK_PROCESSING_METRICS_REQUIRED")

    destination = _profile_root(data_root, benchmark_id, profile_id)
    manifest_path = destination / "profile.json"
    if manifest_path.exists():
        current = _profile_manifest_metadata(data_root, benchmark_id, profile_id)
        manifest = current["manifest"]
        if (
            manifest.get("source_id") != source_id
            or manifest.get("source_sha256") != document.source_sha256.lower()
            or manifest.get("sample_identity_sha256") != sample_identity_sha256
        ):
            raise BenchmarkBundleError("BENCHMARK_PROFILE_ALREADY_EXISTS")
        transcript_path = destination / "transcript.json"
        transcript_payload = _bounded_bytes(
            transcript_path,
            maximum=_MAX_TRANSCRIPT_BYTES,
            missing_code="BENCHMARK_PROFILE_TRANSCRIPT_MISSING",
            invalid_code="BENCHMARK_PROFILE_TRANSCRIPT_INVALID",
        )
        if (
            len(transcript_payload) != current["transcript_size_bytes"]
            or hashlib.sha256(transcript_payload).hexdigest() != current["transcript_sha256"]
            or hashlib.sha256(document_payload).hexdigest() != current["transcript_sha256"]
        ):
            raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_MISMATCH")
        try:
            persisted = TranscriptDocument.from_dict(json.loads(transcript_payload.decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError, TranscriptValidationError) as exc:
            raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_INVALID") from exc
        if (
            persisted.source_sha256.lower() != document.source_sha256.lower()
            or persisted.engine.profile != profile_id
        ):
            raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_MISMATCH")
        return {
            "benchmark_id": benchmark_id,
            "transcript_sha256": current["transcript_sha256"],
            "transcript_size_bytes": current["transcript_size_bytes"],
            "artifact_available": True,
        }

    parent = destination.parent
    parent.parent.mkdir(parents=True, exist_ok=True)
    parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        _safe_remove_incomplete(destination, parent)
    destination.mkdir(parents=False, exist_ok=False)
    try:
        transcript_path = destination / "transcript.json"
        atomic_write(transcript_path, document_payload)
        transcript_sha256 = hashlib.sha256(document_payload).hexdigest()
        transcript_size_bytes = len(document_payload)
        manifest = {
            "schema_version": PROFILE_ARTIFACT_SCHEMA_VERSION,
            "benchmark_id": benchmark_id,
            "profile_id": profile_id,
            "source_id": source_id,
            "source_sha256": document.source_sha256.lower(),
            "sample_identity_sha256": sample_identity_sha256,
            "sample_seconds": BENCHMARK_SAMPLE_SECONDS,
            "transcript": {
                "artifact": "transcript.json",
                "sha256": transcript_sha256,
                "size_bytes": transcript_size_bytes,
            },
            "execution_lineage": execution_lineage,
            "processing_metrics": document.stats.processing_metrics,
            "completed_at": utc_now(),
        }
        _atomic_json(manifest_path, manifest)
        return {
            "benchmark_id": benchmark_id,
            "transcript_sha256": transcript_sha256,
            "transcript_size_bytes": transcript_size_bytes,
            "artifact_available": True,
        }
    except BaseException as exc:
        if (
            not (isinstance(exc, AtomicStorageError) and exc.ambiguous)
            and not manifest_path.is_file()
        ):
            shutil.rmtree(destination, ignore_errors=True)
        raise


def _artifact_descriptor(
    *,
    benchmark_id: str,
    profile_id: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    return {
        "profile_id": profile_id,
        "profile_manifest": {
            "artifact": f"profiles/{profile_id}/profile.json",
            "sha256": metadata["manifest_sha256"],
            "size_bytes": metadata["manifest_size_bytes"],
        },
        "transcript": {
            "artifact": f"profiles/{profile_id}/transcript.json",
            "sha256": metadata["transcript_sha256"],
            "size_bytes": metadata["transcript_size_bytes"],
        },
    }


def _validate_text_fingerprint(value: object, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BenchmarkBundleError(code)
    digest = _sha256_value(value.get("sha256"), code)
    length = value.get("length")
    if isinstance(length, bool) or not isinstance(length, int) or length < 0 or length > 1_200:
        raise BenchmarkBundleError(code)
    return {"sha256": digest, "length": length}


def _bundle_size_bytes(
    manifest_payload_size: int,
    profiles: Iterable[dict[str, Any]],
) -> int:
    total = manifest_payload_size
    for item in profiles:
        profile_manifest = item["profile_manifest"]
        transcript = item["transcript"]
        total += int(profile_manifest["size_bytes"]) + int(transcript["size_bytes"])
    return total


def load_benchmark_bundle(data_root: Path, benchmark_id: str) -> dict[str, Any]:
    root = benchmark_root(data_root, benchmark_id)
    manifest, payload = _bounded_json(
        root / "benchmark.json",
        missing_code="BENCHMARK_BUNDLE_NOT_FOUND",
        invalid_code="BENCHMARK_BUNDLE_MANIFEST_INVALID",
    )
    if (
        manifest.get("schema_version") != BUNDLE_SCHEMA_VERSION
        or manifest.get("benchmark_id") != benchmark_id
        or manifest.get("status") != "completed"
        or manifest.get("execution_mode") != BENCHMARK_EXECUTION_MODE
        or manifest.get("sample_seconds") != BENCHMARK_SAMPLE_SECONDS
    ):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
    job_id = manifest.get("job_id")
    attempt = manifest.get("attempt")
    if benchmark_id_for(job_id, attempt) != benchmark_id:
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
    source_id = manifest.get("source_id")
    if not isinstance(source_id, str) or _SOURCE_ID.fullmatch(source_id) is None:
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
    source_sha256 = _sha256_value(
        manifest.get("source_sha256"),
        "BENCHMARK_BUNDLE_MANIFEST_INVALID",
    )
    sample_identity = _sha256_value(
        manifest.get("sample_identity_sha256"),
        "BENCHMARK_BUNDLE_MANIFEST_INVALID",
    )
    descriptor = _validate_sample_descriptor(manifest.get("sample"))
    if (
        descriptor["source_sha256"] != source_sha256
        or benchmark_sample_identity_from_descriptor(descriptor) != sample_identity
    ):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_SAMPLE_MISMATCH")
    profile_order = manifest.get("profile_order")
    if profile_order != list(BENCHMARK_PROFILES):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_PROFILE_ORDER_INVALID")
    track_count = manifest.get("track_count")
    if (
        isinstance(track_count, bool)
        or not isinstance(track_count, int)
        or track_count != len(descriptor["tracks"])
    ):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
    audio_work_seconds = _non_negative_number(
        manifest.get("audio_work_seconds"),
        "BENCHMARK_BUNDLE_MANIFEST_INVALID",
    )
    if not math.isclose(
        audio_work_seconds,
        BENCHMARK_SAMPLE_SECONDS * track_count,
        abs_tol=0.001,
    ):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
    _validate_text_fingerprint(manifest.get("context"), "BENCHMARK_BUNDLE_MANIFEST_INVALID")
    _validate_text_fingerprint(manifest.get("glossary"), "BENCHMARK_BUNDLE_MANIFEST_INVALID")
    completed_at = manifest.get("completed_at")
    if not isinstance(completed_at, str) or not completed_at:
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")

    profile_entries = manifest.get("profiles")
    if not isinstance(profile_entries, list) or len(profile_entries) != len(BENCHMARK_PROFILES):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
    verified_entries: list[dict[str, Any]] = []
    for expected, entry in zip(BENCHMARK_PROFILES, profile_entries, strict=True):
        if not isinstance(entry, dict) or entry.get("profile_id") != expected:
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
        profile_artifact = entry.get("profile_manifest")
        transcript_artifact = entry.get("transcript")
        if not isinstance(profile_artifact, dict) or not isinstance(transcript_artifact, dict):
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_MANIFEST_INVALID")
        if (
            profile_artifact.get("artifact") != f"profiles/{expected}/profile.json"
            or transcript_artifact.get("artifact") != f"profiles/{expected}/transcript.json"
        ):
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_ARTIFACT_PATH_INVALID")
        expected_profile_sha = _sha256_value(
            profile_artifact.get("sha256"),
            "BENCHMARK_BUNDLE_MANIFEST_INVALID",
        )
        expected_profile_size = _positive_size(
            profile_artifact.get("size_bytes"),
            "BENCHMARK_BUNDLE_MANIFEST_INVALID",
            maximum=_MAX_MANIFEST_BYTES,
        )
        expected_transcript_sha = _sha256_value(
            transcript_artifact.get("sha256"),
            "BENCHMARK_BUNDLE_MANIFEST_INVALID",
        )
        expected_transcript_size = _positive_size(
            transcript_artifact.get("size_bytes"),
            "BENCHMARK_BUNDLE_MANIFEST_INVALID",
            maximum=_MAX_TRANSCRIPT_BYTES,
        )
        metadata = _profile_manifest_metadata(data_root, benchmark_id, expected)
        profile_manifest = metadata["manifest"]
        if (
            metadata["manifest_sha256"] != expected_profile_sha
            or metadata["manifest_size_bytes"] != expected_profile_size
            or metadata["transcript_sha256"] != expected_transcript_sha
            or metadata["transcript_size_bytes"] != expected_transcript_size
            or profile_manifest.get("source_id") != source_id
            or profile_manifest.get("source_sha256") != source_sha256
            or profile_manifest.get("sample_identity_sha256") != sample_identity
        ):
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_ARTIFACT_MISMATCH")
        transcript_path = _profile_root(data_root, benchmark_id, expected) / "transcript.json"
        if _is_reparse_point(transcript_path):
            raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_INVALID")
        try:
            actual_size = transcript_path.stat().st_size
        except OSError as exc:
            raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_MISSING") from exc
        if actual_size != expected_transcript_size or not transcript_path.is_file():
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_ARTIFACT_MISMATCH")
        verified_entries.append(entry)

    return {
        **manifest,
        "bundle_manifest_sha256": hashlib.sha256(payload).hexdigest(),
        "bundle_manifest_size_bytes": len(payload),
        "bundle_size_bytes": _bundle_size_bytes(len(payload), verified_entries),
    }


def read_benchmark_transcript(
    data_root: Path,
    benchmark_id: str,
    profile_id: str,
) -> bytes:
    if profile_id not in BENCHMARK_PROFILES:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_INVALID")
    bundle = load_benchmark_bundle(data_root, benchmark_id)
    entries = bundle["profiles"]
    entry = next((item for item in entries if item["profile_id"] == profile_id), None)
    if entry is None:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_NOT_FOUND")
    expected = entry["transcript"]
    path = _profile_root(data_root, benchmark_id, profile_id) / "transcript.json"
    payload = _bounded_bytes(
        path,
        maximum=_MAX_TRANSCRIPT_BYTES,
        missing_code="BENCHMARK_PROFILE_TRANSCRIPT_MISSING",
        invalid_code="BENCHMARK_PROFILE_TRANSCRIPT_INVALID",
    )
    if (
        len(payload) != expected["size_bytes"]
        or hashlib.sha256(payload).hexdigest() != expected["sha256"]
    ):
        raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_MISMATCH")
    try:
        value = json.loads(payload.decode("utf-8"))
        document = TranscriptDocument.from_dict(value)
    except (UnicodeDecodeError, json.JSONDecodeError, TranscriptValidationError) as exc:
        raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_INVALID") from exc
    if (
        document.source_sha256.lower() != bundle["source_sha256"]
        or document.engine.profile != profile_id
    ):
        raise BenchmarkBundleError("BENCHMARK_PROFILE_TRANSCRIPT_MISMATCH")
    return payload


def finalize_benchmark_bundle(
    data_root: Path,
    *,
    job_id: str,
    attempt: int,
    source_id: str,
    source_sha256: str,
    sample: dict[str, Any],
    sample_identity_sha256: str,
    sample_seconds: float,
    track_count: int,
    audio_work_seconds: float,
    context: str,
    glossary: str,
    profile_receipts: list[dict[str, Any]],
) -> dict[str, Any]:
    benchmark_id = benchmark_id_for(job_id, attempt)
    if not isinstance(source_id, str) or _SOURCE_ID.fullmatch(source_id) is None:
        raise BenchmarkBundleError("BENCHMARK_SOURCE_ID_INVALID")
    source_sha256 = _sha256_value(source_sha256, "BENCHMARK_SOURCE_SHA256_INVALID")
    descriptor = _validate_sample_descriptor(sample)
    expected_identity = benchmark_sample_identity_from_descriptor(descriptor)
    if (
        descriptor["source_sha256"] != source_sha256
        or sample_identity_sha256 != expected_identity
        or float(sample_seconds) != BENCHMARK_SAMPLE_SECONDS
    ):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_SAMPLE_MISMATCH")
    if (
        isinstance(track_count, bool)
        or not isinstance(track_count, int)
        or track_count != len(descriptor["tracks"])
    ):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_TRACK_COUNT_INVALID")
    expected_audio_work = BENCHMARK_SAMPLE_SECONDS * track_count
    if not math.isclose(
        _non_negative_number(audio_work_seconds, "BENCHMARK_BUNDLE_AUDIO_WORK_INVALID"),
        expected_audio_work,
        abs_tol=0.001,
    ):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_AUDIO_WORK_INVALID")
    if not isinstance(context, str) or not isinstance(glossary, str):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_TEXT_INVALID")
    if len(context) > 1_200 or len(glossary) > 1_200:
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_TEXT_INVALID")
    if len(profile_receipts) != len(BENCHMARK_PROFILES):
        raise BenchmarkBundleError("BENCHMARK_BUNDLE_PROFILE_COUNT_INVALID")

    root = benchmark_root(data_root, benchmark_id)
    root.parent.mkdir(parents=True, exist_ok=True)
    root.mkdir(parents=True, exist_ok=True)
    manifest_path = root / "benchmark.json"
    if manifest_path.exists():
        current = load_benchmark_bundle(data_root, benchmark_id)
        if (
            current.get("job_id") != job_id
            or current.get("attempt") != attempt
            or current.get("source_id") != source_id
            or current.get("sample_identity_sha256") != sample_identity_sha256
        ):
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_ALREADY_EXISTS")
        return current

    artifacts: list[dict[str, Any]] = []
    for expected_profile, receipt in zip(BENCHMARK_PROFILES, profile_receipts, strict=True):
        if not isinstance(receipt, dict) or receipt.get("profile_id") != expected_profile:
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_PROFILE_ORDER_INVALID")
        if (
            receipt.get("benchmark_id") != benchmark_id
            or receipt.get("sample_identity_sha256") != sample_identity_sha256
            or receipt.get("artifact_available") is not True
        ):
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_PROFILE_RECEIPT_INVALID")
        metadata = _profile_manifest_metadata(data_root, benchmark_id, expected_profile)
        profile_manifest = metadata["manifest"]
        if (
            profile_manifest.get("source_id") != source_id
            or profile_manifest.get("source_sha256") != source_sha256
            or profile_manifest.get("sample_identity_sha256") != sample_identity_sha256
            or metadata["transcript_sha256"] != receipt.get("transcript_sha256")
            or metadata["transcript_size_bytes"] != receipt.get("transcript_size_bytes")
        ):
            raise BenchmarkBundleError("BENCHMARK_BUNDLE_PROFILE_RECEIPT_MISMATCH")
        artifacts.append(
            _artifact_descriptor(
                benchmark_id=benchmark_id,
                profile_id=expected_profile,
                metadata=metadata,
            )
        )

    manifest = {
        "schema_version": BUNDLE_SCHEMA_VERSION,
        "benchmark_id": benchmark_id,
        "status": "completed",
        "job_id": job_id,
        "attempt": attempt,
        "source_id": source_id,
        "source_sha256": source_sha256,
        "sample_identity_sha256": sample_identity_sha256,
        "sample_seconds": BENCHMARK_SAMPLE_SECONDS,
        "sample": descriptor,
        "track_count": track_count,
        "audio_work_seconds": round(expected_audio_work, 3),
        "profile_order": list(BENCHMARK_PROFILES),
        "context": {
            "sha256": _sha256_text(context),
            "length": len(context),
        },
        "glossary": {
            "sha256": _sha256_text(glossary),
            "length": len(glossary),
        },
        "execution_mode": BENCHMARK_EXECUTION_MODE,
        "profiles": artifacts,
        "completed_at": utc_now(),
    }
    _atomic_json(manifest_path, manifest)
    return load_benchmark_bundle(data_root, benchmark_id)
