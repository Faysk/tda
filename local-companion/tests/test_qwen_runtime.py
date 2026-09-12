from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from tda_companion.qwen_runtime import (
    QwenRuntimeInstallError,
    current_qwen_worker,
    inspect_qwen_runtime,
    install_qwen_runtime_archive,
)


def _runtime_zip(path: Path, *, member: str = "TDAQwenWorker.exe", payload: bytes = b"worker") -> str:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        archive.writestr(member, payload)
        archive.writestr("_internal/torch.dll", b"dll")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_verified_qwen_runtime_installs_versioned_and_switches_current_atomically(tmp_path: Path):
    archive = tmp_path / "runtime.zip"
    digest = _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"

    marker = install_qwen_runtime_archive(
        archive,
        runtime_root,
        version="1.0.0",
        expected_sha256=digest,
    )

    worker = runtime_root / "qwen" / "1.0.0" / "TDAQwenWorker.exe"
    assert worker.read_bytes() == b"worker"
    assert marker["archive_sha256"] == digest
    state = inspect_qwen_runtime(runtime_root, verify_worker=True)
    assert state["status"] == "ready"
    assert state["version"] == "1.0.0"
    assert current_qwen_worker(runtime_root) == worker.resolve()
    selector = json.loads((runtime_root / "qwen" / "current.json").read_text(encoding="utf-8"))
    assert selector["version"] == "1.0.0"


def test_qwen_runtime_hash_mismatch_does_not_materialize_runtime(tmp_path: Path):
    archive = tmp_path / "runtime.zip"
    _runtime_zip(archive)
    runtime_root = tmp_path / "Runtime"
    with pytest.raises(QwenRuntimeInstallError, match="QWEN_RUNTIME_HASH_MISMATCH"):
        install_qwen_runtime_archive(
            archive,
            runtime_root,
            version="1.0.0",
            expected_sha256="0" * 64,
        )
    assert inspect_qwen_runtime(runtime_root)["status"] == "missing"


def test_qwen_runtime_rejects_path_traversal(tmp_path: Path):
    archive = tmp_path / "bad.zip"
    digest = _runtime_zip(archive, member="../TDAQwenWorker.exe")
    with pytest.raises(QwenRuntimeInstallError, match="QWEN_RUNTIME_ARCHIVE_PATH_INVALID"):
        install_qwen_runtime_archive(
            archive,
            tmp_path / "Runtime",
            version="1.0.0",
            expected_sha256=digest,
        )


def test_qwen_runtime_requires_expected_worker_and_detects_tamper(tmp_path: Path):
    archive = tmp_path / "wrong.zip"
    digest = _runtime_zip(archive, member="something.exe")
    runtime_root = tmp_path / "Runtime"
    with pytest.raises(QwenRuntimeInstallError, match="QWEN_RUNTIME_WORKER_MISSING"):
        install_qwen_runtime_archive(
            archive,
            runtime_root,
            version="1.0.0",
            expected_sha256=digest,
        )

    good = tmp_path / "good.zip"
    good_digest = _runtime_zip(good)
    install_qwen_runtime_archive(
        good,
        runtime_root,
        version="1.0.1",
        expected_sha256=good_digest,
    )
    worker = runtime_root / "qwen" / "1.0.1" / "TDAQwenWorker.exe"
    worker.write_bytes(b"tampered")
    assert inspect_qwen_runtime(runtime_root, verify_worker=True)["status"] == "corrupt"
    assert current_qwen_worker(runtime_root) is None
