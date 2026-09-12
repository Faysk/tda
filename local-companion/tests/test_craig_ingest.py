from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import Path

import pytest
from starlette.requests import Request

import tda_companion.craig_ingest as ingest_module
from tda_companion.craig_ingest import CraigUploadError, ingest_craig_request
from tda_companion.craig_runtime import load_craig_package


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-alice")
        archive.writestr("2-Bob.flac", b"fLaC-bob")
    return buffer.getvalue()


def _request(payload: bytes) -> Request:
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": payload, "more_body": False}

    return Request({"type": "http", "method": "POST", "path": "/", "headers": []}, receive)


@pytest.mark.anyio
async def test_ingest_is_content_addressed_reusable_and_cleans_raw_zip(tmp_path: Path):
    data_root = tmp_path / "Data"
    payload = _zip_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    source_id = f"craig-{digest}"

    first = await ingest_craig_request(_request(payload), data_root)
    assert first["source_id"] == source_id
    assert first["track_count"] == 2
    assert first["reused"] is False

    package = load_craig_package(data_root / "staging" / source_id, verify_tracks=True)
    assert package.source_sha256 == digest
    assert [track.speaker for track in package.tracks] == ["Alice", "Bob"]
    assert not list((data_root / "uploads").iterdir())

    second = await ingest_craig_request(_request(payload), data_root)
    assert second["source_id"] == source_id
    assert second["reused"] is True
    assert not list((data_root / "uploads").iterdir())


@pytest.mark.anyio
async def test_ingest_rejects_oversize_without_leaving_partial(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    monkeypatch.setattr(ingest_module, "CRAIG_UPLOAD_MAX_BYTES", 4)

    with pytest.raises(CraigUploadError, match="CRAIG_UPLOAD_SIZE_LIMIT"):
        await ingest_craig_request(_request(b"12345"), data_root)

    assert not list((data_root / "uploads").iterdir())
