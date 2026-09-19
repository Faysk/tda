from __future__ import annotations

import json
import os
import zipfile
from pathlib import Path

import pytest

import tda_companion.craig_runtime as runtime_module
from tda_companion.craig import CraigPackageError, ingest_craig_zip
from tda_companion.craig_runtime import load_craig_package


def _stage_package(tmp_path: Path) -> Path:
    source = tmp_path / "craig.zip"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-alice")
        archive.writestr("2-Bob.flac", b"fLaC-bob")
        archive.writestr(
            "info.txt",
            (
                "Recording 123\n"
                "Guild: TDA\n"
                "Channel: mesa\n"
                "Requester: Alice#0 (1)\n"
                "Tracks:\n"
                "Alice#0 (1)\n"
                "Bob#0 (2)\n"
            ).encode("utf-8"),
        )
    destination = tmp_path / "Data" / "staging" / "source-123"
    ingest_craig_zip(source, destination)
    return destination


def test_load_staged_package_revalidates_tracks_and_hashes(tmp_path: Path):
    root = _stage_package(tmp_path)
    package = load_craig_package(root)
    assert package.recording_id == "123"
    assert [track.number for track in package.tracks] == [1, 2]
    assert [track.speaker for track in package.tracks] == ["Alice", "Bob"]
    assert package.tracks[0].path == "tracks/track-000001.flac"
    assert package.tracks[0].identity is not None
    assert package.tracks[0].identity.discord_id == "1"


def test_load_staged_package_rejects_manifest_path_override(tmp_path: Path):
    root = _stage_package(tmp_path)
    manifest_path = root / "manifest.json"
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    value["tracks"][0]["path"] = "../outside.flac"
    manifest_path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(CraigPackageError, match="CRAIG_MANIFEST_TRACK_PATH_INVALID"):
        load_craig_package(root)


def test_load_staged_package_rejects_track_tampering(tmp_path: Path):
    root = _stage_package(tmp_path)
    (root / "tracks" / "track-000001.flac").write_bytes(b"changed!!!")
    with pytest.raises(CraigPackageError, match="CRAIG_MANIFEST_TRACK_(SIZE|HASH)_MISMATCH"):
        load_craig_package(root)


def test_cheap_load_hashes_only_after_metadata_drift_and_detects_same_size_tamper(
    tmp_path: Path,
):
    root = _stage_package(tmp_path)
    track = root / "tracks" / "track-000001.flac"
    before = track.stat()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == before.st_size
    track.write_bytes(replacement)
    os.utime(
        track,
        ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000),
    )

    with pytest.raises(CraigPackageError, match="CRAIG_MANIFEST_TRACK_HASH_MISMATCH"):
        load_craig_package(root, verify_tracks=False)


def test_metadata_only_drift_self_heals_after_one_verified_hash(monkeypatch, tmp_path: Path):
    root = _stage_package(tmp_path)
    track = root / "tracks" / "track-000001.flac"
    manifest_path = root / "manifest.json"
    before = track.stat()
    os.utime(
        track,
        ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000),
    )

    original = runtime_module._sha256_file
    calls = 0

    def counted(path: Path) -> str:
        nonlocal calls
        calls += 1
        return original(path)

    monkeypatch.setattr(runtime_module, "_sha256_file", counted)
    package = load_craig_package(root, verify_tracks=False)

    assert calls == 1
    assert package.tracks[0].staged_mtime_ns == track.stat().st_mtime_ns
    refreshed = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert refreshed["tracks"][0]["staged_mtime_ns"] == track.stat().st_mtime_ns

    monkeypatch.setattr(
        runtime_module,
        "_sha256_file",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("healed metadata seal must keep later cheap loads hash-free")
        ),
    )
    second = load_craig_package(root, verify_tracks=False)
    assert second.tracks[0].staged_mtime_ns == track.stat().st_mtime_ns


def test_legacy_manifest_without_metadata_seal_hashes_once_and_seals(
    monkeypatch,
    tmp_path: Path,
):
    root = _stage_package(tmp_path)
    manifest_path = root / "manifest.json"
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    for track in value["tracks"]:
        track.pop("staged_mtime_ns", None)
    manifest_path.write_text(json.dumps(value), encoding="utf-8")

    original = runtime_module._sha256_file
    calls = 0

    def counted(path: Path) -> str:
        nonlocal calls
        calls += 1
        return original(path)

    monkeypatch.setattr(runtime_module, "_sha256_file", counted)
    package = load_craig_package(root, verify_tracks=False)

    assert calls == len(package.tracks)
    refreshed = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert all(
        isinstance(item.get("staged_mtime_ns"), int)
        for item in refreshed["tracks"]
    )

    monkeypatch.setattr(
        runtime_module,
        "_sha256_file",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("sealed legacy package must keep later cheap loads hash-free")
        ),
    )
    second = load_craig_package(root, verify_tracks=False)
    assert all(track.staged_mtime_ns is not None for track in second.tracks)


def test_legacy_manifest_without_metadata_seal_rejects_same_size_tamper(tmp_path: Path):
    root = _stage_package(tmp_path)
    manifest_path = root / "manifest.json"
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    for track in value["tracks"]:
        track.pop("staged_mtime_ns", None)
    manifest_path.write_text(json.dumps(value), encoding="utf-8")

    track = root / "tracks" / "track-000001.flac"
    before = track.stat()
    replacement = b"fLaC-ALICE"
    assert len(replacement) == before.st_size
    track.write_bytes(replacement)
    os.utime(
        track,
        ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000),
    )

    with pytest.raises(CraigPackageError, match="CRAIG_MANIFEST_TRACK_HASH_MISMATCH"):
        load_craig_package(root, verify_tracks=False)


def test_load_staged_package_rejects_manifest_source_path(tmp_path: Path):
    root = _stage_package(tmp_path)
    manifest_path = root / "manifest.json"
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    value["source_zip"] = "../private.zip"
    manifest_path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(CraigPackageError, match="CRAIG_MANIFEST_SOURCE_INVALID"):
        load_craig_package(root)
