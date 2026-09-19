from __future__ import annotations

import hashlib
import io
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from starlette.requests import Request

import tda_companion.craig as craig_module
import tda_companion.craig_ingest as ingest_module
from tda_companion.craig_ingest import CraigUploadError, ingest_craig_file, ingest_craig_request
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
    assert first["source_name"] is None
    assert first["tracks"] == [
        {"number": 1, "speaker": "Alice", "size_bytes": len(b"fLaC-alice")},
        {"number": 2, "speaker": "Bob", "size_bytes": len(b"fLaC-bob")},
    ]

    package_root = data_root / "staging" / source_id
    package = load_craig_package(package_root, verify_tracks=True)
    assert package.source_sha256 == digest
    assert [track.speaker for track in package.tracks] == ["Alice", "Bob"]
    assert [track.filename for track in package.tracks] == ["1-Alice.flac", "2-Bob.flac"]
    assert [track.path for track in package.tracks] == [
        "tracks/track-000001.flac",
        "tracks/track-000002.flac",
    ]
    assert (package_root / "tracks" / "track-000001.flac").is_file()
    assert (package_root / "tracks" / "track-000002.flac").is_file()
    assert not list((data_root / "uploads").iterdir())

    second = await ingest_craig_request(_request(payload), data_root)
    assert second["source_id"] == source_id
    assert second["reused"] is True
    assert not list((data_root / "uploads").iterdir())


@pytest.mark.anyio
async def test_streamed_ingest_reuses_digest_without_rehashing_full_zip(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    payload = _zip_bytes()
    digest = hashlib.sha256(payload).hexdigest()

    monkeypatch.setattr(
        craig_module,
        "_sha256_file",
        lambda _path: (_ for _ in ()).throw(AssertionError("streamed snapshot must not be rehashed")),
    )

    result = await ingest_craig_request(_request(payload), data_root)

    assert result["source_sha256"] == digest
    assert result["source_id"] == f"craig-{digest}"
    package = load_craig_package(data_root / "staging" / result["source_id"], verify_tracks=True)
    assert package.source_sha256 == digest
    assert package.source_zip == f"craig-{digest}.zip"
    assert not list((data_root / "uploads").iterdir())


@pytest.mark.anyio
async def test_ingest_rejects_oversize_without_leaving_partial(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    monkeypatch.setattr(ingest_module, "CRAIG_UPLOAD_MAX_BYTES", 4)

    with pytest.raises(CraigUploadError, match="CRAIG_UPLOAD_SIZE_LIMIT"):
        await ingest_craig_request(_request(b"12345"), data_root)

    assert not list((data_root / "uploads").iterdir())


def test_ingest_local_file_snapshots_reuses_and_returns_safe_session_metadata(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "minha-sessao.zip"
    source.write_bytes(_zip_bytes())

    first = ingest_craig_file(source, data_root)
    assert first["source_name"] == "minha-sessao.zip"
    assert first["track_count"] == 2
    assert [track["speaker"] for track in first["tracks"]] == ["Alice", "Bob"]
    assert first["reused"] is False
    assert "path" not in first
    assert not list((data_root / "uploads").iterdir())

    second = ingest_craig_file(source, data_root)
    assert second["source_id"] == first["source_id"]
    assert second["reused"] is True
    assert second["source_name"] == "minha-sessao.zip"
    assert not list((data_root / "uploads").iterdir())


def test_reupload_repairs_corrupt_staging_preserves_runs_and_discards_checkpoints(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao.zip"
    payload = _zip_bytes()
    source.write_bytes(payload)

    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    track = package_root / "tracks" / "track-000001.flac"
    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)

    evidence = package_root / "runs" / "run-evidence"
    evidence.mkdir(parents=True)
    (evidence / "keep.txt").write_text("preserve-me", encoding="utf-8")
    stale_checkpoint = package_root / ".checkpoints" / "stale"
    stale_checkpoint.mkdir(parents=True)
    (stale_checkpoint / "track.json").write_text("stale", encoding="utf-8")

    repaired = ingest_craig_file(source, data_root)

    assert repaired["source_id"] == first["source_id"]
    assert repaired["reused"] is False
    assert track.read_bytes() == original
    assert (package_root / "runs" / "run-evidence" / "keep.txt").read_text(
        encoding="utf-8"
    ) == "preserve-me"
    assert not (package_root / ".checkpoints").exists()
    package = load_craig_package(package_root, verify_tracks=True)
    assert package.source_sha256 == first["source_sha256"]


def test_concurrent_reupload_converges_on_one_repaired_source(tmp_path: Path):
    data_root = tmp_path / "Data"
    source = tmp_path / "sessao-concorrente.zip"
    source.write_bytes(_zip_bytes())

    first = ingest_craig_file(source, data_root)
    package_root = data_root / "staging" / first["source_id"]
    track = package_root / "tracks" / "track-000001.flac"
    original = track.read_bytes()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == len(original)
    track.write_bytes(replacement)

    evidence = package_root / "runs" / "run-evidence"
    evidence.mkdir(parents=True)
    (evidence / "keep.txt").write_text("preserve-me", encoding="utf-8")

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(ingest_craig_file, source, data_root),
            executor.submit(ingest_craig_file, source, data_root),
        ]
        results = [future.result(timeout=10) for future in futures]

    assert {result["source_id"] for result in results} == {first["source_id"]}
    assert sorted(result["reused"] for result in results) == [False, True]
    assert track.read_bytes() == original
    assert (package_root / "runs" / "run-evidence" / "keep.txt").read_text(
        encoding="utf-8"
    ) == "preserve-me"
    load_craig_package(package_root, verify_tracks=True)


def test_ingest_decouples_windows_unsafe_speaker_name_from_physical_filename(tmp_path: Path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('1-Alice:Boss?.flac', b"fLaC-special")
    source = tmp_path / "special.zip"
    source.write_bytes(buffer.getvalue())
    data_root = tmp_path / "Data"

    result = ingest_craig_file(source, data_root)
    package = load_craig_package(data_root / "staging" / result["source_id"], verify_tracks=True)

    assert package.tracks[0].speaker == "Alice:Boss?"
    assert package.tracks[0].filename == "1-Alice:Boss?.flac"
    assert package.tracks[0].path == "tracks/track-000001.flac"
    assert (data_root / "staging" / result["source_id"] / "tracks" / "track-000001.flac").is_file()


def test_ingest_local_file_requires_zip_extension(tmp_path: Path):
    source = tmp_path / "sessao.flac"
    source.write_bytes(b"fLaC")

    with pytest.raises(CraigUploadError, match="CRAIG_ZIP_REQUIRED"):
        ingest_craig_file(source, tmp_path / "Data")
