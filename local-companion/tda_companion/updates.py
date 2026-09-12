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
MANIFEST_URL = f"{PRODUCTION_ORIGIN}/api/downloads/companion/windows/manifest"
_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
_TAG = re.compile(r"^companion-v(\d+)\.(\d+)\.(\d+)$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")


@dataclass(frozen=True)
class UpdateManifest:
    version: str
    tag: str
    minimum_api: str
    url: str
    sha256: str
    size: int


def version_tuple(value: str) -> tuple[int, int, int]:
    match = _VERSION.fullmatch(value)
    if not match:
        raise ValueError("INVALID_VERSION")
    return tuple(int(match[index]) for index in range(1, 4))  # type: ignore[return-value]


def parse_manifest(value: object) -> UpdateManifest:
    if not isinstance(value, dict):
        raise ValueError("INVALID_UPDATE_MANIFEST")
    if value.get("channel") != "stable":
        raise ValueError("INVALID_UPDATE_CHANNEL")
    version = value.get("version")
    tag = value.get("tag")
    minimum_api = value.get("minimum_api")
    asset = value.get("asset")
    if not isinstance(version, str) or not _VERSION.fullmatch(version):
        raise ValueError("INVALID_UPDATE_VERSION")
    if not isinstance(tag, str) or not _TAG.fullmatch(tag) or tag != f"companion-v{version}":
        raise ValueError("INVALID_UPDATE_TAG")
    if minimum_api != "1" or not isinstance(asset, dict):
        raise ValueError("INCOMPATIBLE_UPDATE_MANIFEST")
    raw_url = asset.get("url")
    digest = asset.get("sha256")
    size = asset.get("size")
    if not isinstance(raw_url, str):
        raise ValueError("INVALID_UPDATE_URL")
    url = urljoin(PRODUCTION_ORIGIN + "/", raw_url)
    if url != f"{PRODUCTION_ORIGIN}/api/downloads/companion/windows":
        raise ValueError("INVALID_UPDATE_URL")
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        raise ValueError("INVALID_UPDATE_DIGEST")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0 or size > 512 * 1024 * 1024:
        raise ValueError("INVALID_UPDATE_SIZE")
    return UpdateManifest(version, tag, minimum_api, url, digest, size)


def fetch_manifest(timeout: float = 8.0) -> UpdateManifest:
    request = urllib.request.Request(
        MANIFEST_URL,
        headers={"Accept": "application/json", "Cache-Control": "no-cache", "User-Agent": "TDACompanion"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed HTTPS endpoint
        if response.status != 200:
            raise RuntimeError("UPDATE_MANIFEST_HTTP_ERROR")
        body = response.read(64 * 1024 + 1)
        if len(body) > 64 * 1024:
            raise RuntimeError("UPDATE_MANIFEST_TOO_LARGE")
    return parse_manifest(json.loads(body.decode("utf-8")))


def update_available(current_version: str, manifest: UpdateManifest) -> bool:
    return version_tuple(manifest.version) > version_tuple(current_version)


def download_update(manifest: UpdateManifest, cache_root: Path, timeout: float = 60.0) -> Path:
    target_dir = cache_root / "updates" / manifest.version
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "TDACompanion-x64.msi"
    temporary = target.with_suffix(".partial")
    temporary.unlink(missing_ok=True)

    digest = hashlib.sha256()
    total = 0
    request = urllib.request.Request(
        manifest.url,
        headers={"Accept": "application/x-msi,application/octet-stream", "Cache-Control": "no-cache", "User-Agent": "TDACompanion"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - validated fixed TDA endpoint
            expected_final = (
                f"https://github.com/Faysk/tda/releases/download/{manifest.tag}/TDACompanion-x64.msi"
            )
            if response.geturl() != expected_final:
                raise RuntimeError("UPDATE_REDIRECT_REJECTED")
            with temporary.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > manifest.size or total > 512 * 1024 * 1024:
                        raise RuntimeError("UPDATE_SIZE_EXCEEDED")
                    digest.update(chunk)
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
        if total != manifest.size:
            raise RuntimeError("UPDATE_SIZE_MISMATCH")
        if digest.hexdigest() != manifest.sha256:
            raise RuntimeError("UPDATE_DIGEST_MISMATCH")
        os.replace(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)
