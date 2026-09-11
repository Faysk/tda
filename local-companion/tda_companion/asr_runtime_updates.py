from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

PRODUCTION_ORIGIN = "https://dnd.faysk.dev"
MANIFEST_URL = f"{PRODUCTION_ORIGIN}/api/downloads/companion/windows/whisper-runtime/manifest"
RUNTIME_ID = "whisper-ctranslate2"
MAX_RUNTIME_DOWNLOAD_BYTES = 3 * 1024**3
_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
_TAG = re.compile(r"^companion-whisper-runtime-v(\d+)\.(\d+)\.(\d+)$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")


@dataclass(frozen=True)
class WhisperRuntimeManifest:
    version: str
    tag: str
    url: str
    sha256: str
    size: int


def _version_tuple(value: str) -> tuple[int, int, int]:
    match = _VERSION.fullmatch(value)
    if not match:
        raise ValueError("INVALID_RUNTIME_VERSION")
    return tuple(int(match[index]) for index in range(1, 4))  # type: ignore[return-value]


def parse_whisper_runtime_manifest(value: object) -> WhisperRuntimeManifest:
    if not isinstance(value, dict):
        raise ValueError("INVALID_RUNTIME_MANIFEST")
    if value.get("channel") != "stable" or value.get("runtime_id") != RUNTIME_ID:
        raise ValueError("INVALID_RUNTIME_CHANNEL")
    version = value.get("version")
    tag = value.get("tag")
    asset = value.get("asset")
    if not isinstance(version, str) or not _VERSION.fullmatch(version):
        raise ValueError("INVALID_RUNTIME_VERSION")
    if not isinstance(tag, str) or not _TAG.fullmatch(tag):
        raise ValueError("INVALID_RUNTIME_TAG")
    if tag != f"companion-whisper-runtime-v{version}" or not isinstance(asset, dict):
        raise ValueError("INVALID_RUNTIME_TAG")
    raw_url = asset.get("url")
    digest = asset.get("sha256")
    size = asset.get("size")
    if not isinstance(raw_url, str):
        raise ValueError("INVALID_RUNTIME_URL")
    url = urljoin(PRODUCTION_ORIGIN + "/", raw_url)
    expected = f"{PRODUCTION_ORIGIN}/api/downloads/companion/windows/whisper-runtime"
    if url != expected:
        raise ValueError("INVALID_RUNTIME_URL")
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        raise ValueError("INVALID_RUNTIME_DIGEST")
    if (
        not isinstance(size, int)
        or isinstance(size, bool)
        or size <= 0
        or size > MAX_RUNTIME_DOWNLOAD_BYTES
    ):
        raise ValueError("INVALID_RUNTIME_SIZE")
    return WhisperRuntimeManifest(version, tag, url, digest, size)


def fetch_whisper_runtime_manifest(timeout: float = 8.0) -> WhisperRuntimeManifest:
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
            raise RuntimeError("RUNTIME_MANIFEST_HTTP_ERROR")
        body = response.read(64 * 1024 + 1)
        if len(body) > 64 * 1024:
            raise RuntimeError("RUNTIME_MANIFEST_TOO_LARGE")
    return parse_whisper_runtime_manifest(json.loads(body.decode("utf-8")))


def whisper_runtime_update_available(
    current_version: str | None,
    manifest: WhisperRuntimeManifest,
) -> bool:
    if current_version is None:
        return True
    return _version_tuple(manifest.version) > _version_tuple(current_version)


def download_whisper_runtime(
    manifest: WhisperRuntimeManifest,
    cache_root: Path,
    timeout: float = 300.0,
) -> Path:
    target_dir = cache_root.resolve() / "runtime" / "whisper" / manifest.version
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"TDAWhisperRuntime-{manifest.version}-windows-x64.zip"
    temporary = target.with_suffix(".partial")
    temporary.unlink(missing_ok=True)

    digest = hashlib.sha256()
    total = 0
    request = urllib.request.Request(
        manifest.url,
        headers={
            "Accept": "application/zip,application/octet-stream",
            "Cache-Control": "no-cache",
            "User-Agent": "TDACompanion",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - validated fixed TDA endpoint
            expected_final = (
                f"https://github.com/Faysk/tda/releases/download/{manifest.tag}/"
                f"TDAWhisperRuntime-{manifest.version}-windows-x64.zip"
            )
            if response.geturl() != expected_final:
                raise RuntimeError("RUNTIME_REDIRECT_REJECTED")
            with temporary.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > manifest.size or total > MAX_RUNTIME_DOWNLOAD_BYTES:
                        raise RuntimeError("RUNTIME_SIZE_EXCEEDED")
                    digest.update(chunk)
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
        if total != manifest.size:
            raise RuntimeError("RUNTIME_SIZE_MISMATCH")
        if digest.hexdigest() != manifest.sha256:
            raise RuntimeError("RUNTIME_DIGEST_MISMATCH")
        os.replace(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)
