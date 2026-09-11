from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from tda_companion.asr_runtime_updates import (
    MAX_RUNTIME_DOWNLOAD_BYTES,
    WhisperRuntimeManifest,
    download_whisper_runtime,
    parse_whisper_runtime_manifest,
    whisper_runtime_update_available,
)


def manifest_value(*, url: str | None = None, digest: str | None = None, size: int = 123) -> dict:
    return {
        "channel": "stable",
        "runtime_id": "whisper-ctranslate2",
        "version": "1.2.3",
        "tag": "companion-whisper-runtime-v1.2.3",
        "asset": {
            "url": url or "/api/downloads/companion/windows/whisper-runtime",
            "sha256": digest or "a" * 64,
            "size": size,
        },
    }


def test_runtime_manifest_accepts_only_fixed_tda_endpoint():
    value = parse_whisper_runtime_manifest(manifest_value())
    assert value.version == "1.2.3"
    assert value.url == "https://dnd.faysk.dev/api/downloads/companion/windows/whisper-runtime"

    with pytest.raises(ValueError, match="INVALID_RUNTIME_URL"):
        parse_whisper_runtime_manifest(manifest_value(url="https://example.com/runtime.zip"))


def test_runtime_manifest_rejects_wrong_identity_digest_and_size():
    wrong = manifest_value()
    wrong["runtime_id"] = "other"
    with pytest.raises(ValueError, match="INVALID_RUNTIME_CHANNEL"):
        parse_whisper_runtime_manifest(wrong)
    with pytest.raises(ValueError, match="INVALID_RUNTIME_DIGEST"):
        parse_whisper_runtime_manifest(manifest_value(digest="sha256:bad"))
    with pytest.raises(ValueError, match="INVALID_RUNTIME_SIZE"):
        parse_whisper_runtime_manifest(manifest_value(size=MAX_RUNTIME_DOWNLOAD_BYTES + 1))


def test_runtime_update_comparison_handles_missing_and_semver():
    value = parse_whisper_runtime_manifest(manifest_value())
    assert whisper_runtime_update_available(None, value) is True
    assert whisper_runtime_update_available("1.2.2", value) is True
    assert whisper_runtime_update_available("1.2.3", value) is False
    assert whisper_runtime_update_available("2.0.0", value) is False


class FakeResponse:
    def __init__(self, payload: bytes, final_url: str):
        self.payload = payload
        self.final_url = final_url
        self.offset = 0
        self.status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def geturl(self) -> str:
        return self.final_url

    def read(self, size: int = -1) -> bytes:
        if self.offset >= len(self.payload):
            return b""
        if size < 0:
            size = len(self.payload) - self.offset
        chunk = self.payload[self.offset : self.offset + size]
        self.offset += len(chunk)
        return chunk


def test_runtime_download_requires_exact_release_redirect_and_hash(tmp_path: Path, monkeypatch):
    payload = b"verified-runtime"
    digest = hashlib.sha256(payload).hexdigest()
    manifest = WhisperRuntimeManifest(
        version="1.2.3",
        tag="companion-whisper-runtime-v1.2.3",
        url="https://dnd.faysk.dev/api/downloads/companion/windows/whisper-runtime",
        sha256=digest,
        size=len(payload),
    )
    expected = (
        "https://github.com/Faysk/tda/releases/download/companion-whisper-runtime-v1.2.3/"
        "TDAWhisperRuntime-1.2.3-windows-x64.zip"
    )
    monkeypatch.setattr(
        "tda_companion.asr_runtime_updates.urllib.request.urlopen",
        lambda *_args, **_kwargs: FakeResponse(payload, expected),
    )
    target = download_whisper_runtime(manifest, tmp_path / "Cache")
    assert target.read_bytes() == payload
    assert not target.with_suffix(".partial").exists()

    monkeypatch.setattr(
        "tda_companion.asr_runtime_updates.urllib.request.urlopen",
        lambda *_args, **_kwargs: FakeResponse(payload, "https://example.com/runtime.zip"),
    )
    with pytest.raises(RuntimeError, match="RUNTIME_REDIRECT_REJECTED"):
        download_whisper_runtime(manifest, tmp_path / "Cache2")
    assert not any((tmp_path / "Cache2").rglob("*.partial"))
