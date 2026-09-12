from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import Request

from .craig import CraigPackage, CraigPackageError, ingest_craig_zip
from .craig_runtime import load_craig_package

CRAIG_UPLOAD_SCHEMA = "tda_craig_ingest_v1"
CRAIG_UPLOAD_MAX_BYTES = 64 * 1024**3
CRAIG_UPLOAD_MEDIA_TYPES = frozenset({"application/zip", "application/octet-stream"})
_COPY_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class CraigUploadError(RuntimeError):
    code: str
    status: int
    recoverable: bool = False

    def __str__(self) -> str:
        return self.code


def _summary(
    package: CraigPackage,
    *,
    source_id: str,
    source_sha256: str,
    size_bytes: int,
    reused: bool,
    source_name: str | None = None,
) -> dict[str, object]:
    return {
        "schema_version": CRAIG_UPLOAD_SCHEMA,
        "source_id": source_id,
        "source_sha256": source_sha256,
        "source_name": source_name,
        "size_bytes": size_bytes,
        "track_count": len(package.tracks),
        "tracks": [
            {
                "number": track.number,
                "speaker": track.speaker,
                "size_bytes": track.size_bytes,
            }
            for track in package.tracks
        ],
        "recording_id": package.recording_id,
        "guild": package.guild,
        "channel": package.channel,
        "start_time": package.start_time,
        "reused": reused,
    }


def _reuse_existing(
    staging_root: Path,
    *,
    source_id: str,
    source_sha256: str,
    size_bytes: int,
    source_name: str | None = None,
) -> dict[str, object] | None:
    package_root = staging_root / source_id
    if not package_root.exists():
        return None
    try:
        package = load_craig_package(package_root, verify_tracks=True)
    except CraigPackageError as exc:
        raise CraigUploadError("CRAIG_STAGING_EXISTING_INVALID", 409, True) from exc
    if package.source_sha256 != source_sha256:
        raise CraigUploadError("CRAIG_SOURCE_ID_COLLISION", 409, False)
    return _summary(
        package,
        source_id=source_id,
        source_sha256=source_sha256,
        size_bytes=size_bytes,
        reused=True,
        source_name=source_name,
    )


def _finish_snapshot_ingest(
    snapshot: Path,
    *,
    data_root: Path,
    source_sha256: str,
    size_bytes: int,
    source_name: str | None,
) -> dict[str, object]:
    uploads_root = data_root / "uploads"
    staging_root = data_root / "staging"
    source_id = f"craig-{source_sha256}"
    existing = _reuse_existing(
        staging_root,
        source_id=source_id,
        source_sha256=source_sha256,
        size_bytes=size_bytes,
        source_name=source_name,
    )
    if existing is not None:
        return existing

    source_zip = uploads_root / f"{source_id}.zip"
    os.replace(snapshot, source_zip)
    try:
        package = ingest_craig_zip(source_zip, staging_root / source_id)
    except CraigPackageError as exc:
        if str(exc) == "CRAIG_DESTINATION_EXISTS":
            existing = _reuse_existing(
                staging_root,
                source_id=source_id,
                source_sha256=source_sha256,
                size_bytes=size_bytes,
                source_name=source_name,
            )
            if existing is not None:
                return existing
        raise CraigUploadError(str(exc), 422, False) from exc
    finally:
        source_zip.unlink(missing_ok=True)

    return _summary(
        package,
        source_id=source_id,
        source_sha256=source_sha256,
        size_bytes=size_bytes,
        reused=False,
        source_name=source_name,
    )


def ingest_craig_file(source_zip: Path, data_root: Path) -> dict[str, object]:
    """Snapshot a user-selected Craig ZIP locally, then use the canonical safe ingest path."""
    source = source_zip.resolve()
    root = data_root.resolve()
    if source.suffix.casefold() != ".zip":
        raise CraigUploadError("CRAIG_ZIP_REQUIRED", 415, False)
    try:
        size = source.stat().st_size
    except OSError as exc:
        raise CraigUploadError("CRAIG_ARCHIVE_NOT_FOUND", 404, False) from exc
    if not source.is_file() or size <= 0:
        raise CraigUploadError("CRAIG_UPLOAD_EMPTY", 422, False)
    if size > CRAIG_UPLOAD_MAX_BYTES:
        raise CraigUploadError("CRAIG_UPLOAD_SIZE_LIMIT", 413, False)

    uploads_root = root / "uploads"
    staging_root = root / "staging"
    uploads_root.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)
    temporary = uploads_root / f".{uuid4().hex}.zip.partial"
    digest = hashlib.sha256()
    written = 0
    try:
        with source.open("rb") as origin, temporary.open("xb") as destination:
            while True:
                chunk = origin.read(_COPY_CHUNK)
                if not chunk:
                    break
                written += len(chunk)
                if written > CRAIG_UPLOAD_MAX_BYTES:
                    raise CraigUploadError("CRAIG_UPLOAD_SIZE_LIMIT", 413, False)
                digest.update(chunk)
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
        if written != size:
            raise CraigUploadError("CRAIG_SOURCE_CHANGED", 409, True)
        return _finish_snapshot_ingest(
            temporary,
            data_root=root,
            source_sha256=digest.hexdigest(),
            size_bytes=written,
            source_name=source.name,
        )
    except CraigUploadError:
        raise
    except OSError as exc:
        raise CraigUploadError("CRAIG_UPLOAD_STORAGE_FAILED", 503, True) from exc
    finally:
        temporary.unlink(missing_ok=True)


async def ingest_craig_request(request: Request, data_root: Path) -> dict[str, object]:
    """Stream a Craig ZIP from the browser into local staging without trusting a filesystem path."""
    root = data_root.resolve()
    uploads_root = root / "uploads"
    staging_root = root / "staging"
    uploads_root.mkdir(parents=True, exist_ok=True)
    staging_root.mkdir(parents=True, exist_ok=True)

    temporary = uploads_root / f".{uuid4().hex}.zip.partial"
    digest = hashlib.sha256()
    written = 0
    try:
        with temporary.open("xb") as destination:
            async for chunk in request.stream():
                if not chunk:
                    continue
                written += len(chunk)
                if written > CRAIG_UPLOAD_MAX_BYTES:
                    raise CraigUploadError("CRAIG_UPLOAD_SIZE_LIMIT", 413, False)
                digest.update(chunk)
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())

        if written <= 0:
            raise CraigUploadError("CRAIG_UPLOAD_EMPTY", 422, False)

        return _finish_snapshot_ingest(
            temporary,
            data_root=root,
            source_sha256=digest.hexdigest(),
            size_bytes=written,
            source_name=None,
        )
    except CraigUploadError:
        raise
    except OSError as exc:
        raise CraigUploadError("CRAIG_UPLOAD_STORAGE_FAILED", 503, True) from exc
    finally:
        temporary.unlink(missing_ok=True)
