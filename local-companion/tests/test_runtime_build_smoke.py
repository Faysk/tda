import importlib.util
import json
from pathlib import Path

import pytest

from tda_companion.runtime_artifact import verify_frozen_runtime_artifact

spec = importlib.util.spec_from_file_location("runtime_bootstrap_smoke", Path(__file__).parents[1] / "packaging" / "runtime_bootstrap_smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


@pytest.mark.parametrize("family", ["whisper", "qwen"])
@pytest.mark.parametrize("fails", [False, True])
def test_build_smoke_uses_child_contract_and_removes_build_seal(tmp_path, monkeypatch, family, fails):
    worker = tmp_path / "worker.exe"
    worker.write_bytes(b"synthetic worker")
    def run(*args, **kwargs):
        identity = verify_frozen_runtime_artifact(kwargs["env"], executable=worker, frozen=True)
        assert identity["version"] == "1.2.3"
        if fails:
            raise OSError("simulated launch failure")
        return "ok"
    monkeypatch.setattr(smoke.subprocess, "run", run)
    if fails:
        with pytest.raises(OSError):
            smoke.launch(worker, "1.2.3", family, "fixture", 20)
    else:
        assert smoke.launch(worker, "1.2.3", family, "fixture", 20) == "ok"
    assert not (tmp_path / ".tda-runtime.json").exists()


def test_installed_smoke_preserves_archive_seal(tmp_path, monkeypatch):
    worker = tmp_path / "worker.exe"
    worker.write_bytes(b"synthetic worker")
    import hashlib
    marker = tmp_path / ".tda-runtime.json"
    original = json.dumps({"schema": "tda_asr_runtime_v1", "runtime_id": "whisper-ctranslate2",
                           "version": "1.2.3", "worker_sha256": hashlib.sha256(worker.read_bytes()).hexdigest(),
                           "archive_sha256": "a" * 64}).encode()
    marker.write_bytes(original)
    def run(*args, **kwargs):
        assert verify_frozen_runtime_artifact(kwargs["env"], executable=worker, frozen=True)["archive_sha256"] == "a" * 64
    monkeypatch.setattr(smoke.subprocess, "run", run)
    smoke.launch(worker, "1.2.3", "whisper", "fixture", 20)
    assert marker.read_bytes() == original


def test_build_smoke_allows_root_overrides_but_not_runtime_identity_override(
    tmp_path,
    monkeypatch,
):
    worker = tmp_path / "worker.exe"
    worker.write_bytes(b"synthetic worker")
    observed = {}

    def run(*args, **kwargs):
        del args
        observed.update(kwargs["env"])
        identity = verify_frozen_runtime_artifact(
            kwargs["env"],
            executable=worker,
            frozen=True,
        )
        assert identity["version"] == "1.2.3"
        return "ok"

    monkeypatch.setattr(smoke.subprocess, "run", run)
    result = smoke.launch(
        worker,
        "1.2.3",
        "whisper",
        "fixture",
        20,
        {
            "TDA_WORKER_DATA_ROOT": str(tmp_path / "Data"),
            "TDA_ASR_RUNTIME_VERSION": "9.9.9",
            "TDA_ASR_RUNTIME_FAMILY": "qwen",
        },
    )

    assert result == "ok"
    assert observed["TDA_WORKER_DATA_ROOT"] == str(tmp_path / "Data")
    assert observed["TDA_ASR_RUNTIME_VERSION"] == "1.2.3"
    assert observed["TDA_ASR_RUNTIME_FAMILY"] == "whisper"
