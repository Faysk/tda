from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from tda_companion.asr_runtime import (
    inspect_whisper_runtime,
    install_whisper_runtime_archive,
)
from tda_companion.asr_runtime_updates import WhisperRuntimeManifest
from tda_companion.network import NetworkError
from tda_companion.whisper_runtime_maintenance import (
    WhisperRuntimeMaintenanceError,
    list_whisper_runtime_rollback_candidates,
    rollback_whisper_runtime,
)


def _runtime_zip(path: Path, payload: bytes) -> str:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("TDAWhisperWorker.exe", payload)
        archive.writestr("_internal/runtime.dll", b"dll")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _install(path: Path, runtime_root: Path, version: str, payload: bytes) -> Path:
    digest = _runtime_zip(path, payload)
    install_whisper_runtime_archive(
        path,
        runtime_root,
        version=version,
        expected_sha256=digest,
    )
    return path


def test_explicit_rollback_reactivates_verified_preserved_runtime(tmp_path: Path):
    runtime_root = tmp_path / "Runtime"
    cache_root = tmp_path / "Cache"
    _install(tmp_path / "old.zip", runtime_root, "1.1.5", b"old-worker")
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")

    assert list_whisper_runtime_rollback_candidates(runtime_root) == ["1.1.5"]

    result = rollback_whisper_runtime(
        runtime_root,
        cache_root,
        target_version="1.1.5",
        prefer_bits=False,
    )

    assert result["accepted"] is True
    assert result["version"] == "1.1.5"
    assert result["previous_version"] == "1.1.8"
    assert result["source"] == "preserved"
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["version"] == "1.1.5"
    selector = json.loads(
        (runtime_root / "whisper" / "current.json").read_text(encoding="utf-8")
    )
    assert selector["version"] == "1.1.5"
    assert (runtime_root / "whisper" / "1.1.8" / "TDAWhisperWorker.exe").read_bytes() == b"new-worker"


def test_rollback_never_accepts_same_newer_or_incompatible_target(tmp_path: Path):
    runtime_root = tmp_path / "Runtime"
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")

    with pytest.raises(
        WhisperRuntimeMaintenanceError,
        match="WHISPER_RUNTIME_ROLLBACK_TARGET_NOT_OLDER",
    ):
        rollback_whisper_runtime(
            runtime_root,
            tmp_path / "Cache",
            target_version="1.1.8",
            prefer_bits=False,
        )

    with pytest.raises(
        WhisperRuntimeMaintenanceError,
        match="WHISPER_RUNTIME_ROLLBACK_TARGET_NOT_OLDER",
    ):
        rollback_whisper_runtime(
            runtime_root,
            tmp_path / "Cache",
            target_version="1.1.9",
            prefer_bits=False,
        )

    with pytest.raises(
        WhisperRuntimeMaintenanceError,
        match="WHISPER_RUNTIME_ROLLBACK_TARGET_INCOMPATIBLE",
    ):
        rollback_whisper_runtime(
            runtime_root,
            tmp_path / "Cache",
            target_version="1.1.1",
            prefer_bits=False,
        )
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["version"] == "1.1.8"


def test_corrupt_preserved_target_does_not_replace_current_when_exact_download_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    runtime_root = tmp_path / "Runtime"
    _install(tmp_path / "old.zip", runtime_root, "1.1.5", b"old-worker")
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")
    (runtime_root / "whisper" / "1.1.5" / "TDAWhisperWorker.exe").write_bytes(b"tampered")

    def unavailable(*_args, **_kwargs):
        raise NetworkError("OFFLINE")

    monkeypatch.setattr(
        "tda_companion.whisper_runtime_maintenance.fetch_whisper_runtime_manifest",
        unavailable,
    )

    with pytest.raises(NetworkError, match="OFFLINE"):
        rollback_whisper_runtime(
            runtime_root,
            tmp_path / "Cache",
            target_version="1.1.5",
            prefer_bits=False,
        )

    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["version"] == "1.1.8"


def test_missing_preserved_runtime_can_be_restored_from_exact_verified_stable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    runtime_root = tmp_path / "Runtime"
    cache_root = tmp_path / "Cache"
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")

    archive = tmp_path / "downloaded-old.zip"
    digest = _runtime_zip(archive, b"downloaded-old")
    manifest = WhisperRuntimeManifest(
        version="1.1.5",
        tag="companion-whisper-runtime-v1.1.5",
        url=(
            "https://dnd.faysk.dev/api/downloads/companion/windows/"
            "whisper-runtime?version=1.1.5"
        ),
        sha256=digest,
        size=archive.stat().st_size,
    )
    observed: dict[str, object] = {}

    def fetch_manifest(*, version=None, **_kwargs):
        observed["version"] = version
        return manifest

    def download(value, target_cache, **_kwargs):
        observed["manifest"] = value
        observed["cache"] = target_cache
        return archive

    monkeypatch.setattr(
        "tda_companion.whisper_runtime_maintenance.fetch_whisper_runtime_manifest",
        fetch_manifest,
    )
    monkeypatch.setattr(
        "tda_companion.whisper_runtime_maintenance.download_whisper_runtime",
        download,
    )

    result = rollback_whisper_runtime(
        runtime_root,
        cache_root,
        target_version="1.1.5",
        prefer_bits=False,
    )

    assert observed["version"] == "1.1.5"
    assert observed["manifest"] == manifest
    assert result["source"] == "download"
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["version"] == "1.1.5"
    assert (runtime_root / "whisper" / "1.1.8").is_dir()


def test_candidate_listing_does_not_auto_downgrade_current_runtime(tmp_path: Path):
    runtime_root = tmp_path / "Runtime"
    _install(tmp_path / "old.zip", runtime_root, "1.1.5", b"old-worker")
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")

    candidates = list_whisper_runtime_rollback_candidates(runtime_root)

    assert candidates == ["1.1.5"]
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["version"] == "1.1.8"
