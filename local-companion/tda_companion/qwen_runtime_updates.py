from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .qwen_runtime_bundle import (
    QwenRuntimeBundleManifest,
    QwenRuntimePart,
    assemble_qwen_runtime_bundle,
    parse_qwen_runtime_bundle_manifest,
)
from .release_download import ReleaseRedirectError, open_verified_release

PRODUCTION_ORIGIN = "https://dnd.faysk.dev"
MANIFEST_URL = f"{PRODUCTION_ORIGIN}/api/downloads/companion/windows/qwen-runtime/manifest"
RUNTIME_ID = "qwen3-transformers"
_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
_TAG = re.compile(r"^companion-qwen-runtime-v(\d+)\.(\d+)\.(\d+)$")
_COPY_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class QwenRuntimeDownloadManifest:
    version: str
    tag: str
    bundle: QwenRuntimeBundleManifest


def _version_tuple(value: str) -> tuple[int, int, int]:
    match = _VERSION.fullmatch(value)
    if not match:
        raise ValueError("INVALID_QWEN_RUNTIME_VERSION")
    return tuple(int(match[index]) for index in range(1, 4))  # type: ignore[return-value]


def parse_qwen_runtime_download_manifest(value: object) -> QwenRuntimeDownloadManifest:
    if not isinstance(value, dict):
        raise ValueError("INVALID_QWEN_RUNTIME_MANIFEST")
    if value.get("channel") != "stable" or value.get("runtime_id") != RUNTIME_ID:
        raise ValueError("INVALID_QWEN_RUNTIME_CHANNEL")
    version = value.get("version")
    tag = value.get("tag")
    if not isinstance(version, str) or not _VERSION.fullmatch(version):
        raise ValueError("INVALID_QWEN_RUNTIME_VERSION")
    if not isinstance(tag, str) or not _TAG.fullmatch(tag):
        raise ValueError("INVALID_QWEN_RUNTIME_TAG")
    if tag != f"companion-qwen-runtime-v{version}":
        raise ValueError("INVALID_QWEN_RUNTIME_TAG")
    try:
        bundle = parse_qwen_runtime_bundle_manifest(value.get("bundle"))
    except Exception as exc:
        raise ValueError("INVALID_QWEN_RUNTIME_BUNDLE") from exc
    if bundle.version != version or bundle.runtime_id != RUNTIME_ID:
        raise ValueError("INVALID_QWEN_RUNTIME_BUNDLE")
    return QwenRuntimeDownloadManifest(version=version, tag=tag, bundle=bundle)


def fetch_qwen_runtime_manifest(timeout: float = 8.0) -> QwenRuntimeDownloadManifest:
    request = urllib.request.Request(
        MANIFEST_URL,
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "User-Agent": "TDACompanion",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed HTTPS endpoint
        if response.status != 200:
            raise RuntimeError("QWEN_RUNTIME_MANIFEST_HTTP_ERROR")
        body = response.read(256 * 1024 + 1)
        if len(body) > 256 * 1024:
            raise RuntimeError("QWEN_RUNTIME_MANIFEST_TOO_LARGE")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("QWEN_RUNTIME_MANIFEST_INVALID") from exc
    return parse_qwen_runtime_download_manifest(value)


def qwen_runtime_update_available(
    current_version: str | None,
    manifest: QwenRuntimeDownloadManifest,
) -> bool:
    if current_version is None:
        return True
    return _version_tuple(manifest.version) > _version_tuple(current_version)


def _part_endpoint(part: QwenRuntimePart) -> str:
    return f"{PRODUCTION_ORIGIN}/api/downloads/companion/windows/qwen-runtime/{part.name}"


def _release_asset_url(manifest: QwenRuntimeDownloadManifest, part: QwenRuntimePart) -> str:
    return f"https://github.com/Faysk/tda/releases/download/{manifest.tag}/{part.name}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_COPY_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _cached_part_valid(path: Path, part: QwenRuntimePart) -> bool:
    try:
        return path.is_file() and path.stat().st_size == part.size and _sha256_file(path) == part.sha256
    except OSError:
        return False


def _download_part(
    manifest: QwenRuntimeDownloadManifest,
    part: QwenRuntimePart,
    target: Path,
    *,
    timeout: float,
) -> Path:
    if _cached_part_valid(target, part):
        return target
    target.unlink(missing_ok=True)
    temporary = target.with_name(target.name + ".partial")
    temporary.unlink(missing_ok=True)
    request = urllib.request.Request(
        _part_endpoint(part),
        headers={
            "Accept": "application/octet-stream",
            "Cache-Control": "no-cache",
            "User-Agent": "TDACompanion",
        },
    )
    digest = hashlib.sha256()
    total = 0
    try:
        try:
            response_context = open_verified_release(
                request,
                expected_github_url=_release_asset_url(manifest, part),
                timeout=timeout,
            )
        except ReleaseRedirectError as exc:
            raise RuntimeError("QWEN_RUNTIME_REDIRECT_REJECTED") from exc
        with response_context as response:
            with temporary.open("xb") as handle:
                while True:
                    chunk = response.read(_COPY_CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > part.size:
                        raise RuntimeError("QWEN_RUNTIME_PART_SIZE_EXCEEDED")
                    digest.update(chunk)
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
        if total != part.size:
            raise RuntimeError("QWEN_RUNTIME_PART_SIZE_MISMATCH")
        if digest.hexdigest() != part.sha256:
            raise RuntimeError("QWEN_RUNTIME_PART_DIGEST_MISMATCH")
        os.replace(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def download_qwen_runtime(
    manifest: QwenRuntimeDownloadManifest,
    cache_root: Path,
    timeout: float = 300.0,
) -> Path:
    root = cache_root.resolve() / "runtime" / "qwen" / manifest.version
    parts_root = root / "parts"
    assembled_root = root / "assembled"
    parts_root.mkdir(parents=True, exist_ok=True)
    for part in manifest.bundle.parts:
        _download_part(
            manifest,
            part,
            parts_root / part.name,
            timeout=timeout,
        )
    return assemble_qwen_runtime_bundle(manifest.bundle, parts_root, assembled_root)
