from __future__ import annotations

import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path

import pytest

import tda_companion.asr_runtime as runtime_module
from tda_companion.asr_runtime import (
    AsrRuntimeError,
    current_whisper_worker,
    inspect_whisper_runtime,
    install_whisper_runtime_archive,
    recover_interrupted_whisper_runtime_install,
)
from tda_companion.runtime_compat import MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION


def _runtime_zip(path: Path, *, member: str = "TDAWhisperWorker.exe", payload: bytes = b"worker") -> str:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(member, payload)
        archive.writestr("_internal/runtime.dll", b"dll")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_verified_runtime_installs_versioned_and_switches_current_atomically(tmp_path: Path):
    archive = tmp_path / "runtime.zip"
    digest = _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION

    marker = install_whisper_runtime_archive(
        archive,
        runtime_root,
        version=version,
        expected_sha256=digest,
    )

    worker = runtime_root / "whisper" / version / "TDAWhisperWorker.exe"
    assert worker.read_bytes() == b"worker"
    assert marker["archive_sha256"] == digest
    state = inspect_whisper_runtime(runtime_root, verify_worker=True)
    assert state["status"] == "ready"
    assert state["version"] == version
    assert current_whisper_worker(runtime_root) == worker.resolve()
    selector = json.loads((runtime_root / "whisper" / "current.json").read_text(encoding="utf-8"))
    assert selector["version"] == version


def test_startup_recovery_restores_interrupted_whisper_runtime_swap(tmp_path: Path):
    archive = tmp_path / "runtime.zip"
    digest = _runtime_zip(archive, payload=b"stable")
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    install_whisper_runtime_archive(
        archive,
        runtime_root,
        version=version,
        expected_sha256=digest,
    )

    parent = runtime_root / "whisper"
    target = parent / version
    backup = parent / f".{version}-{'a' * 32}.backup"
    partial = parent / f".{version}-{'b' * 32}.partial"
    target.rename(backup)
    partial.mkdir()
    (partial / "junk").write_text("partial", encoding="utf-8")

    recovered = recover_interrupted_whisper_runtime_install(runtime_root)

    assert recovered == [version]
    assert target.is_dir()
    assert not backup.exists()
    assert not partial.exists()
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "ready"


def test_startup_recovery_prefers_verified_whisper_partial_over_corrupt_backup(
    tmp_path: Path,
):
    archive = tmp_path / "runtime.zip"
    digest = _runtime_zip(archive, payload=b"fresh-worker")
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    install_whisper_runtime_archive(
        archive,
        runtime_root,
        version=version,
        expected_sha256=digest,
    )

    parent = runtime_root / "whisper"
    target = parent / version
    partial = parent / f".{version}-{'b' * 32}.partial"
    backup = parent / f".{version}-{'a' * 32}.backup"
    shutil.copytree(target, partial)
    target.rename(backup)
    (backup / "TDAWhisperWorker.exe").write_bytes(b"corrupt-backup")

    recovered = recover_interrupted_whisper_runtime_install(runtime_root)

    assert recovered == [version]
    assert not backup.exists()
    assert not partial.exists()
    assert (target / "TDAWhisperWorker.exe").read_bytes() == b"fresh-worker"
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "ready"


def test_corrupt_current_version_can_be_repaired_transactionally(tmp_path: Path):
    original = tmp_path / "runtime-original.zip"
    original_digest = _runtime_zip(original, payload=b"original")
    replacement = tmp_path / "runtime-replacement.zip"
    replacement_digest = _runtime_zip(replacement, payload=b"replacement")
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION

    install_whisper_runtime_archive(
        original,
        runtime_root,
        version=version,
        expected_sha256=original_digest,
    )
    worker = runtime_root / "whisper" / version / "TDAWhisperWorker.exe"
    worker.write_bytes(b"tampered")
    assert inspect_whisper_runtime(runtime_root, verify_worker=False)["status"] == "corrupt"
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "corrupt"

    marker = install_whisper_runtime_archive(
        replacement,
        runtime_root,
        version=version,
        expected_sha256=replacement_digest,
        replace_corrupt=True,
    )

    assert marker["archive_sha256"] == replacement_digest
    assert worker.read_bytes() == b"replacement"
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "ready"
    assert not list((runtime_root / "whisper").glob(".*.backup"))


def test_orphaned_target_without_selector_can_be_repaired(tmp_path: Path):
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    orphan = runtime_root / "whisper" / version
    orphan.mkdir(parents=True)
    (orphan / "TDAWhisperWorker.exe").write_bytes(b"partial-old")
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "missing"

    replacement = tmp_path / "runtime-replacement.zip"
    digest = _runtime_zip(replacement, payload=b"recovered")
    install_whisper_runtime_archive(
        replacement,
        runtime_root,
        version=version,
        expected_sha256=digest,
        replace_corrupt=True,
    )

    assert (orphan / "TDAWhisperWorker.exe").read_bytes() == b"recovered"
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "ready"


def test_repair_never_replaces_a_healthy_runtime(tmp_path: Path):
    archive = tmp_path / "runtime.zip"
    digest = _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    install_whisper_runtime_archive(
        archive,
        runtime_root,
        version=version,
        expected_sha256=digest,
    )

    with pytest.raises(AsrRuntimeError, match="ASR_RUNTIME_REPAIR_NOT_ALLOWED"):
        install_whisper_runtime_archive(
            archive,
            runtime_root,
            version=version,
            expected_sha256=digest,
            replace_corrupt=True,
        )


def test_pre_runs_whisper_runtime_is_valid_but_incompatible(tmp_path: Path):
    archive = tmp_path / "runtime-old.zip"
    digest = _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"
    install_whisper_runtime_archive(
        archive,
        runtime_root,
        version="1.1.1",
        expected_sha256=digest,
    )

    state = inspect_whisper_runtime(runtime_root, verify_worker=True)
    assert state == {"status": "incompatible", "version": "1.1.1", "worker": None}
    assert current_whisper_worker(runtime_root) is None


def test_runtime_archive_hash_mismatch_does_not_materialize_runtime(tmp_path: Path):
    archive = tmp_path / "runtime.zip"
    _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"
    with pytest.raises(AsrRuntimeError, match="ASR_RUNTIME_HASH_MISMATCH"):
        install_whisper_runtime_archive(
            archive,
            runtime_root,
            version="1.0.0",
            expected_sha256="0" * 64,
        )
    assert inspect_whisper_runtime(runtime_root)["status"] == "missing"


def test_runtime_archive_rejects_path_traversal_and_symlink_like_entries(tmp_path: Path):
    archive = tmp_path / "bad.zip"
    digest = _runtime_zip(archive, member="../TDAWhisperWorker.exe")
    with pytest.raises(AsrRuntimeError, match="ASR_RUNTIME_ARCHIVE_PATH_INVALID"):
        install_whisper_runtime_archive(
            archive,
            tmp_path / "Runtime",
            version="1.0.0",
            expected_sha256=digest,
        )


def test_whisper_runtime_metadata_drift_is_verified_once_and_resealed(
    monkeypatch,
    tmp_path: Path,
):
    archive = tmp_path / "runtime.zip"
    digest = _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    install_whisper_runtime_archive(
        archive,
        runtime_root,
        version=version,
        expected_sha256=digest,
    )
    worker = runtime_root / "whisper" / version / "TDAWhisperWorker.exe"
    marker_path = runtime_root / "whisper" / version / ".tda-runtime.json"
    before_marker = json.loads(marker_path.read_text(encoding="utf-8"))
    before = worker.stat()
    os.utime(
        worker,
        ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000_000),
    )

    original = runtime_module._sha256_file
    calls = 0

    def counted(path: Path) -> str:
        nonlocal calls
        calls += 1
        return original(path)

    monkeypatch.setattr(runtime_module, "_sha256_file", counted)
    state = inspect_whisper_runtime(runtime_root, verify_worker=False)

    assert state["status"] == "ready"
    assert calls == 1
    resealed = json.loads(marker_path.read_text(encoding="utf-8"))
    assert resealed["worker_sha256"] == before_marker["worker_sha256"]
    assert (
        resealed["worker_metadata_sha256"]
        != before_marker["worker_metadata_sha256"]
    )

    monkeypatch.setattr(
        runtime_module,
        "_sha256_file",
        lambda _path: (_ for _ in ()).throw(
            AssertionError("resealed Whisper runtime must return to metadata fast path")
        ),
    )
    assert inspect_whisper_runtime(runtime_root, verify_worker=False)["status"] == "ready"


def test_legacy_whisper_runtime_marker_without_metadata_seal_remains_compatible(tmp_path: Path):
    archive = tmp_path / "legacy.zip"
    digest = _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    install_whisper_runtime_archive(
        archive,
        runtime_root,
        version=version,
        expected_sha256=digest,
    )

    marker_path = runtime_root / "whisper" / version / ".tda-runtime.json"
    value = json.loads(marker_path.read_text(encoding="utf-8"))
    value.pop("worker_metadata_sha256")
    marker_path.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )

    assert inspect_whisper_runtime(runtime_root, verify_worker=False)["status"] == "ready"
    assert "worker_metadata_sha256" not in json.loads(
        marker_path.read_text(encoding="utf-8")
    )
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "ready"
    upgraded = json.loads(marker_path.read_text(encoding="utf-8"))
    assert len(upgraded["worker_metadata_sha256"]) == 64


def test_runtime_requires_expected_worker_and_detects_worker_tamper(tmp_path: Path):
    archive = tmp_path / "wrong.zip"
    digest = _runtime_zip(archive, member="something.exe")
    runtime_root = tmp_path / "Runtime"
    with pytest.raises(AsrRuntimeError, match="ASR_RUNTIME_WORKER_MISSING"):
        install_whisper_runtime_archive(
            archive,
            runtime_root,
            version="1.0.0",
            expected_sha256=digest,
        )

    good = tmp_path / "good.zip"
    good_digest = _runtime_zip(good)
    version = MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
    install_whisper_runtime_archive(
        good,
        runtime_root,
        version=version,
        expected_sha256=good_digest,
    )
    worker = runtime_root / "whisper" / version / "TDAWhisperWorker.exe"
    worker.write_bytes(b"tampered")
    assert inspect_whisper_runtime(runtime_root, verify_worker=True)["status"] == "corrupt"
