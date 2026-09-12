from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

from .qwen_runtime import QWEN_RUNTIME_ID

BUNDLE_SCHEMA = "tda_qwen_runtime_bundle_v1"
BUNDLE_PLATFORM = "windows-x64"
MAX_PART_COUNT = 16
MAX_PART_BYTES = 2 * 1024**3 - 1
MAX_ARCHIVE_BYTES = 16 * 1024**3
_COPY_CHUNK = 1024 * 1024
_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PART_NAME = re.compile(
    r"^TDAQwenRuntime-(?P<version>[0-9]+\.[0-9]+\.[0-9]+)-windows-x64\.zip\.part(?P<index>[0-9]{3})$"
)


class QwenRuntimeBundleError(RuntimeError):
    pass


@dataclass(frozen=True)
class QwenRuntimePart:
    index: int
    name: str
    size: int
    sha256: str


@dataclass(frozen=True)
class QwenRuntimeBundleManifest:
    version: str
    archive_name: str
    archive_size: int
    archive_sha256: str
    parts: tuple[QwenRuntimePart, ...]
    schema: str = BUNDLE_SCHEMA
    runtime_id: str = QWEN_RUNTIME_ID
    platform: str = BUNDLE_PLATFORM

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "runtime_id": self.runtime_id,
            "platform": self.platform,
            "version": self.version,
            "archive": {
                "name": self.archive_name,
                "size": self.archive_size,
                "sha256": self.archive_sha256,
            },
            "parts": [
                {
                    "index": part.index,
                    "name": part.name,
                    "size": part.size,
                    "sha256": part.sha256,
                }
                for part in self.parts
            ],
        }


def _positive_int(value: Any, code: str, *, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise QwenRuntimeBundleError(code)
    if maximum is not None and value > maximum:
        raise QwenRuntimeBundleError(code)
    return value


def _digest(value: Any, code: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise QwenRuntimeBundleError(code)
    return value


def _archive_name(version: str) -> str:
    return f"TDAQwenRuntime-{version}-windows-x64.zip"


def parse_qwen_runtime_bundle_manifest(value: object) -> QwenRuntimeBundleManifest:
    if not isinstance(value, dict):
        raise QwenRuntimeBundleError("QWEN_BUNDLE_MANIFEST_OBJECT_REQUIRED")
    if value.get("schema") != BUNDLE_SCHEMA:
        raise QwenRuntimeBundleError("QWEN_BUNDLE_SCHEMA_INVALID")
    if value.get("runtime_id") != QWEN_RUNTIME_ID:
        raise QwenRuntimeBundleError("QWEN_BUNDLE_RUNTIME_ID_INVALID")
    if value.get("platform") != BUNDLE_PLATFORM:
        raise QwenRuntimeBundleError("QWEN_BUNDLE_PLATFORM_INVALID")

    version = value.get("version")
    if not isinstance(version, str) or not _VERSION.fullmatch(version):
        raise QwenRuntimeBundleError("QWEN_BUNDLE_VERSION_INVALID")

    archive = value.get("archive")
    if not isinstance(archive, dict):
        raise QwenRuntimeBundleError("QWEN_BUNDLE_ARCHIVE_OBJECT_REQUIRED")
    archive_name = archive.get("name")
    if archive_name != _archive_name(version):
        raise QwenRuntimeBundleError("QWEN_BUNDLE_ARCHIVE_NAME_INVALID")
    archive_size = _positive_int(
        archive.get("size"),
        "QWEN_BUNDLE_ARCHIVE_SIZE_INVALID",
        maximum=MAX_ARCHIVE_BYTES,
    )
    archive_sha256 = _digest(archive.get("sha256"), "QWEN_BUNDLE_ARCHIVE_HASH_INVALID")

    parts_value = value.get("parts")
    if not isinstance(parts_value, list) or not parts_value or len(parts_value) > MAX_PART_COUNT:
        raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_COUNT_INVALID")

    expected_total = 0
    parts: list[QwenRuntimePart] = []
    names: set[str] = set()
    for expected_index, raw in enumerate(parts_value, start=1):
        if not isinstance(raw, dict):
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_OBJECT_REQUIRED")
        index = _positive_int(raw.get("index"), "QWEN_BUNDLE_PART_INDEX_INVALID")
        if index != expected_index:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_SEQUENCE_INVALID")
        name = raw.get("name")
        if not isinstance(name, str):
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_NAME_INVALID")
        match = _PART_NAME.fullmatch(name)
        if (
            match is None
            or match.group("version") != version
            or int(match.group("index")) != index
        ):
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_NAME_INVALID")
        if name.casefold() in names:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_DUPLICATE")
        names.add(name.casefold())
        size = _positive_int(
            raw.get("size"),
            "QWEN_BUNDLE_PART_SIZE_INVALID",
            maximum=MAX_PART_BYTES,
        )
        digest = _digest(raw.get("sha256"), "QWEN_BUNDLE_PART_HASH_INVALID")
        expected_total += size
        if expected_total > MAX_ARCHIVE_BYTES:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_ARCHIVE_SIZE_INVALID")
        parts.append(QwenRuntimePart(index=index, name=name, size=size, sha256=digest))

    if expected_total != archive_size:
        raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_SIZE_TOTAL_MISMATCH")

    return QwenRuntimeBundleManifest(
        version=version,
        archive_name=archive_name,
        archive_size=archive_size,
        archive_sha256=archive_sha256,
        parts=tuple(parts),
    )


def read_qwen_runtime_bundle_manifest(path: Path) -> QwenRuntimeBundleManifest:
    try:
        stat = path.stat()
        if stat.st_size <= 0 or stat.st_size > 256 * 1024:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_MANIFEST_SIZE_INVALID")
        value = json.loads(path.read_text(encoding="utf-8"))
    except QwenRuntimeBundleError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise QwenRuntimeBundleError("QWEN_BUNDLE_MANIFEST_INVALID") from exc
    return parse_qwen_runtime_bundle_manifest(value)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_COPY_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _part_path(parts_root: Path, part: QwenRuntimePart) -> Path:
    root = parts_root.resolve()
    candidate = (root / part.name).resolve()
    if candidate.parent != root:
        raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_PATH_INVALID")
    return candidate


def verify_qwen_runtime_parts(
    manifest: QwenRuntimeBundleManifest,
    parts_root: Path,
) -> tuple[Path, ...]:
    values: list[Path] = []
    for part in manifest.parts:
        path = _part_path(parts_root, part)
        try:
            stat = path.stat()
        except OSError as exc:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_MISSING") from exc
        if not path.is_file() or stat.st_size != part.size:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_SIZE_MISMATCH")
        if _sha256_file(path) != part.sha256:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_PART_HASH_MISMATCH")
        values.append(path)
    return tuple(values)


def assemble_qwen_runtime_bundle(
    manifest: QwenRuntimeBundleManifest,
    parts_root: Path,
    destination_root: Path,
) -> Path:
    parts = verify_qwen_runtime_parts(manifest, parts_root)
    destination = destination_root.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / manifest.archive_name
    temporary = destination / f".{manifest.archive_name}.{uuid4().hex}.partial"
    digest = hashlib.sha256()
    written = 0
    try:
        with temporary.open("xb") as output:
            for path in parts:
                with path.open("rb") as source:
                    for chunk in iter(lambda: source.read(_COPY_CHUNK), b""):
                        written += len(chunk)
                        if written > manifest.archive_size:
                            raise QwenRuntimeBundleError("QWEN_BUNDLE_ARCHIVE_SIZE_MISMATCH")
                        digest.update(chunk)
                        output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if written != manifest.archive_size:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_ARCHIVE_SIZE_MISMATCH")
        if digest.hexdigest() != manifest.archive_sha256:
            raise QwenRuntimeBundleError("QWEN_BUNDLE_ARCHIVE_HASH_MISMATCH")
        os.replace(temporary, target)
        return target
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def build_qwen_runtime_bundle_manifest(
    *,
    version: str,
    archive_sha256: str,
    parts: Iterable[QwenRuntimePart],
) -> QwenRuntimeBundleManifest:
    values = tuple(parts)
    return parse_qwen_runtime_bundle_manifest(
        {
            "schema": BUNDLE_SCHEMA,
            "runtime_id": QWEN_RUNTIME_ID,
            "platform": BUNDLE_PLATFORM,
            "version": version,
            "archive": {
                "name": _archive_name(version),
                "size": sum(part.size for part in values),
                "sha256": archive_sha256,
            },
            "parts": [
                {
                    "index": part.index,
                    "name": part.name,
                    "size": part.size,
                    "sha256": part.sha256,
                }
                for part in values
            ],
        }
    )
