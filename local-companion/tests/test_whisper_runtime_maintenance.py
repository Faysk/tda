from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest

import tda_companion.whisper_runtime_maintenance as maintenance_module
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
    data_sentinel = tmp_path / "Data" / "runs" / "keep.json"
    model_sentinel = tmp_path / "Models" / "keep.bin"
    data_sentinel.parent.mkdir(parents=True)
    model_sentinel.parent.mkdir(parents=True)
    data_sentinel.write_text("run", encoding="utf-8")
    model_sentinel.write_bytes(b"model")

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
    assert data_sentinel.read_text(encoding="utf-8") == "run"
    assert model_sentinel.read_bytes() == b"model"


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


def test_corrupt_preserved_target_fails_closed_without_download_or_switch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    runtime_root = tmp_path / "Runtime"
    _install(tmp_path / "old.zip", runtime_root, "1.1.5", b"old-worker")
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")
    (runtime_root / "whisper" / "1.1.5" / "TDAWhisperWorker.exe").write_bytes(b"tampered")

    def unexpected_download(*_args, **_kwargs):
        raise AssertionError("corrupt preserved target must not trigger implicit repair/download")

    monkeypatch.setattr(
        "tda_companion.whisper_runtime_maintenance.fetch_whisper_runtime_manifest",
        unexpected_download,
    )

    with pytest.raises(
        WhisperRuntimeMaintenanceError,
        match="WHISPER_RUNTIME_ROLLBACK_TARGET_INVALID",
    ):
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


def test_preserved_candidate_metadata_drift_fails_without_rewriting_marker(tmp_path: Path):
    runtime_root = tmp_path / "Runtime"
    _install(tmp_path / "old.zip", runtime_root, "1.1.5", b"old-worker")
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")
    marker_path = runtime_root / "whisper" / "1.1.5" / ".tda-runtime.json"
    worker = runtime_root / "whisper" / "1.1.5" / "TDAWhisperWorker.exe"
    marker_before = marker_path.read_bytes()
    stat_before = worker.stat()
    worker.touch()
    assert worker.stat().st_mtime_ns != stat_before.st_mtime_ns

    assert list_whisper_runtime_rollback_candidates(runtime_root) == []
    assert marker_path.read_bytes() == marker_before

    with pytest.raises(
        WhisperRuntimeMaintenanceError,
        match="WHISPER_RUNTIME_ROLLBACK_TARGET_INVALID",
    ):
        rollback_whisper_runtime(
            runtime_root,
            tmp_path / "Cache",
            target_version="1.1.5",
            prefer_bits=False,
        )

    assert marker_path.read_bytes() == marker_before
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["version"] == "1.1.8"


def test_failed_post_switch_verification_restores_previous_selector(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    runtime_root = tmp_path / "Runtime"
    _install(tmp_path / "old.zip", runtime_root, "1.1.5", b"old-worker")
    _install(tmp_path / "new.zip", runtime_root, "1.1.8", b"new-worker")

    real_inspect = maintenance_module.inspect_whisper_runtime
    calls = 0

    def fail_once_after_switch(root: Path, *, verify_worker: bool = False):
        nonlocal calls
        calls += 1
        state = real_inspect(root, verify_worker=verify_worker)
        if calls == 2 and state.get("version") == "1.1.5":
            return {"status": "corrupt", "version": "1.1.5", "worker": None}
        return state

    monkeypatch.setattr(maintenance_module, "inspect_whisper_runtime", fail_once_after_switch)

    with pytest.raises(
        WhisperRuntimeMaintenanceError,
        match="WHISPER_RUNTIME_ROLLBACK_VERIFY_FAILED",
    ):
        rollback_whisper_runtime(
            runtime_root,
            tmp_path / "Cache",
            target_version="1.1.5",
            prefer_bits=False,
        )

    selector = json.loads(
        (runtime_root / "whisper" / "current.json").read_text(encoding="utf-8")
    )
    assert selector["version"] == "1.1.8"
    assert real_inspect(runtime_root, verify_worker=True)["version"] == "1.1.8"
