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
) -> dict[str, object]:
    return {
        "schema_version": CRAIG_UPLOAD_SCHEMA,
        "source_id": source_id,
        "source_sha256": source_sha256,
        "size_bytes": size_bytes,
        "track_count": len(package.tracks),
        "reused": reused,
    }


def _reuse_existing(
    staging_root: Path,
    *,
    source_id: str,
    source_sha256: str,
    size_bytes: int,
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
    )


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

        source_sha256 = digest.hexdigest()
        source_id = f"craig-{source_sha256}"
        existing = _reuse_existing(
            staging_root,
            source_id=source_id,
            source_sha256=source_sha256,
            size_bytes=written,
        )
        if existing is not None:
            return existing

        source_zip = uploads_root / f"{source_id}.zip"
        os.replace(temporary, source_zip)
        temporary = source_zip
        try:
            package = ingest_craig_zip(source_zip, staging_root / source_id)
        except CraigPackageError as exc:
            if str(exc) == "CRAIG_DESTINATION_EXISTS":
                existing = _reuse_existing(
                    staging_root,
                    source_id=source_id,
                    source_sha256=source_sha256,
                    size_bytes=written,
                )
                if existing is not None:
                    return existing
            raise CraigUploadError(str(exc), 422, False) from exc

        return _summary(
            package,
            source_id=source_id,
            source_sha256=source_sha256,
            size_bytes=written,
            reused=False,
        )
    except CraigUploadError:
        raise
    except OSError as exc:
        raise CraigUploadError("CRAIG_UPLOAD_STORAGE_FAILED", 503, True) from exc
    finally:
        temporary.unlink(missing_ok=True)
