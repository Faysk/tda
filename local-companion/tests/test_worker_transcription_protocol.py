from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

import tda_companion.asr_worker as asr_worker
from tda_companion.craig import CraigPackageError
from tda_companion.worker_protocol import WorkerProtocolError, WorkerRunCommand


def test_craig_worker_command_roundtrip_uses_opaque_source_id_only():
    command = WorkerRunCommand(
        job_id="job-asr-1",
        attempt=3,
        kind="transcription.craig",
        payload={
            "source_id": "craig-123",
            "profile_id": "whisper-turbo",
            "glossary": "Yuhara",
            "context": "campanha principal",
            "cpu": False,
        },
    )
    decoded = WorkerRunCommand.decode(command.encode())
    assert decoded == command
    assert "path" not in decoded.payload
    assert "root" not in decoded.payload


def test_craig_worker_command_rejects_paths_and_unknown_fields():
    with pytest.raises(WorkerProtocolError, match="WORKER_SOURCE_ID_INVALID"):
        WorkerRunCommand(
            job_id="job-asr",
            attempt=1,
            kind="transcription.craig",
            payload={"source_id": "../private", "profile_id": "whisper-turbo"},
        ).encode()

    raw = {
        "protocol": "tda_worker_v1",
        "type": "run",
        "job_id": "job-asr",
        "attempt": 1,
        "kind": "transcription.craig",
        "payload": {
            "source_id": "safe-source",
            "profile_id": "whisper-turbo",
            "filesystem_path": "C:/private/audio.flac",
        },
    }
    with pytest.raises(WorkerProtocolError, match="WORKER_PAYLOAD_FIELDS_INVALID"):
        WorkerRunCommand.decode(json.dumps(raw))


def test_craig_worker_command_rejects_unknown_profile_and_unbounded_context():
    with pytest.raises(WorkerProtocolError, match="WORKER_PROFILE_INVALID"):
        WorkerRunCommand(
            job_id="job-asr",
            attempt=1,
            kind="transcription.craig",
            payload={"source_id": "source", "profile_id": "mystery"},
        ).encode()

    with pytest.raises(WorkerProtocolError, match="WORKER_CONTEXT_INVALID"):
        WorkerRunCommand(
            job_id="job-asr",
            attempt=1,
            kind="transcription.craig",
            payload={
                "source_id": "source",
                "profile_id": "whisper-detailed",
                "context": "x" * 2001,
            },
        ).encode()


def test_qwen_profiles_are_reserved_by_protocol_without_claiming_runtime_support():
    command = WorkerRunCommand(
        job_id="job-qwen",
        attempt=1,
        kind="transcription.craig",
        payload={"source_id": "source", "profile_id": "qwen-fast"},
    )
    decoded = WorkerRunCommand.decode(command.encode())
    assert decoded.payload["profile_id"] == "qwen-fast"


def test_worker_source_validation_does_not_rehash_staged_tracks(monkeypatch, tmp_path: Path):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    (data_root / "staging" / "source").mkdir(parents=True)
    models_root.mkdir()
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))

    observed: dict[str, object] = {}
    emitted: list[tuple[str, dict]] = []

    def fake_load(_root, *, verify_tracks=True):  # noqa: ANN001
        observed["verify_tracks"] = verify_tracks
        raise CraigPackageError("TEST_STOP_AFTER_SOURCE_VALIDATION")

    class Emitter:
        def emit(self, kind, payload=None):  # noqa: ANN001
            emitted.append((kind, payload or {}))

    monkeypatch.setattr(asr_worker, "load_craig_package", fake_load)
    command = WorkerRunCommand(
        job_id="source-fast-path",
        attempt=1,
        kind="transcription.craig",
        payload={
            "source_id": "source",
            "profile_id": "qwen-quality",
            "glossary": "",
            "context": "",
            "cpu": False,
        },
    )

    result = asr_worker._run_craig(command, Emitter(), threading.Event())

    assert result == 66
    assert observed["verify_tracks"] is False
    assert emitted[0][0] == "ready"
    assert emitted[1] == (
        "stage",
        {"stage": "source_validation", "profile": "qwen-quality"},
    )
    assert emitted[-1][0] == "error"
    assert emitted[-1][1]["code"] == "TEST_STOP_AFTER_SOURCE_VALIDATION"
