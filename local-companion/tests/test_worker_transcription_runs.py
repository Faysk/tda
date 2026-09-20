from __future__ import annotations

import hashlib
import io
import json
import threading
import zipfile
from pathlib import Path

import pytest
import tda_companion.asr_qwen_strict as qwen_strict
import tda_companion.asr_worker as worker
from tda_companion.attempt_fence import claim_attempt_outcome, read_attempt_outcome
from tda_companion.craig import ingest_craig_zip
from tda_companion.transcript import (
    TranscriptDocument,
    TranscriptEngine,
    TranscriptSegment,
    TranscriptTrack,
    TranscriptWord,
    stats_for_tracks,
)
from tda_companion.transcript import TranscriptValidationError
from tda_companion.transcription_runs import list_runs
from tda_companion.worker_protocol import WorkerRunCommand


def _document(
    source_sha: str,
    text: str,
    *,
    profile_id: str = "whisper-turbo",
) -> TranscriptDocument:
    segment = TranscriptSegment(
        id="1-0",
        start=0.0,
        end=1.0,
        text=text,
        words=(TranscriptWord(text=text, start=0.0, end=1.0, confidence=0.9),),
    )
    track = TranscriptTrack(
        number=1,
        speaker="Alice",
        source_filename="1-Alice.flac",
        source_sha256="a" * 64,
        duration_seconds=30.0,
        segments=(segment,),
    )
    return TranscriptDocument(
        recording_id=None,
        source_sha256=source_sha,
        language="pt",
        engine=TranscriptEngine(
            engine="qwen3" if profile_id.startswith("qwen-") else "faster-whisper",
            model="qwen-test" if profile_id.startswith("qwen-") else "large-v3-turbo",
            profile=profile_id,
            device="cuda",
            compute_type="bfloat16" if profile_id.startswith("qwen-") else "float16",
            alignment="forced" if profile_id.startswith("qwen-") else "native",
            model_revision="test-revision",
        ),
        tracks=(track,),
        stats=stats_for_tracks((track,), processing_seconds=2.0),
    )


def _stage(data_root: Path) -> tuple[str, str, Path]:
    source = data_root.parent / "session.zip"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", b"fLaC-worker-run")
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    source_id = f"craig-{source_sha}"
    package_root = data_root / "staging" / source_id
    ingest_craig_zip(source, package_root)
    return source_id, source_sha, package_root


def _command(
    job_id: str,
    source_id: str,
    *,
    profile_id: str = "whisper-turbo",
    attempt: int = 1,
) -> WorkerRunCommand:
    return WorkerRunCommand(
        job_id=job_id,
        attempt=attempt,
        kind="transcription.craig",
        payload={
            "source_id": source_id,
            "profile_id": profile_id,
            "glossary": "Valyndra",
            "context": "Neverwinter",
            "cpu": False,
        },
    )


def _run(command: WorkerRunCommand) -> tuple[int, list[dict]]:
    stream = io.StringIO()
    emitter = worker._Emitter(stream, command)
    code = worker._run_craig(command, emitter, threading.Event())
    messages = [json.loads(line) for line in stream.getvalue().splitlines() if line]
    return code, messages


@pytest.mark.parametrize("profile_id", ["whisper-turbo", "qwen-fast"])
def test_cancel_fence_blocks_run_commit_for_whisper_and_qwen(
    tmp_path: Path,
    monkeypatch,
    profile_id: str,
):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    data_root.mkdir()
    models_root.mkdir()
    source_id, source_sha, package_root = _stage(data_root)
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))
    job_id = f"job-cancel-{profile_id}"

    transcribe = lambda *_args, **_kwargs: _document(
        source_sha,
        "resultado que nao deve commitar",
        profile_id=profile_id,
    )
    if profile_id.startswith("qwen-"):
        monkeypatch.setattr(
            qwen_strict,
            "transcribe_craig_package_qwen_strict",
            transcribe,
        )
    else:
        monkeypatch.setattr(worker, "transcribe_craig_package", transcribe)

    assert claim_attempt_outcome(package_root, job_id, 1, "cancel") == "cancel"
    code, messages = _run(_command(job_id, source_id, profile_id=profile_id))

    assert code == 0
    cancelled = next(message for message in messages if message["type"] == "cancelled")
    assert cancelled["payload"] == {"stage": "result_prepare", "fence": "cancel"}
    assert list_runs(package_root, verify_content=True) == []
    assert not (package_root / "runs" / f"run-{job_id}-a1").exists()
    assert read_attempt_outcome(package_root, job_id, 1) == "cancel"


@pytest.mark.parametrize("profile_id", ["whisper-turbo", "qwen-fast"])
def test_commit_fence_produces_immutable_run_for_whisper_and_qwen(
    tmp_path: Path,
    monkeypatch,
    profile_id: str,
):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    data_root.mkdir()
    models_root.mkdir()
    source_id, source_sha, package_root = _stage(data_root)
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))
    job_id = f"job-commit-{profile_id}"

    transcribe = lambda *_args, **_kwargs: _document(
        source_sha,
        "resultado commitado",
        profile_id=profile_id,
    )
    if profile_id.startswith("qwen-"):
        monkeypatch.setattr(
            qwen_strict,
            "transcribe_craig_package_qwen_strict",
            transcribe,
        )
    else:
        monkeypatch.setattr(worker, "transcribe_craig_package", transcribe)

    code, messages = _run(_command(job_id, source_id, profile_id=profile_id))

    assert code == 0
    result = next(message for message in messages if message["type"] == "result")
    run_id = result["payload"]["run_id"]
    assert read_attempt_outcome(package_root, job_id, 1) == "commit"
    assert (package_root / "runs" / run_id / "run.json").is_file()
    assert len(list_runs(package_root, verify_content=True)) == 1
    fence_event = next(
        message
        for message in messages
        if message["type"] == "event"
        and message["payload"].get("code") == "RUN_COMMIT_FENCE_WON"
    )
    assert fence_event["payload"]["attempt"] == 1


def test_worker_cleans_only_uncommitted_crash_runs_before_asr(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    data_root.mkdir()
    models_root.mkdir()
    source_id, source_sha, package_root = _stage(data_root)
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))
    monkeypatch.setattr(
        worker,
        "transcribe_craig_package",
        lambda *_args, **_kwargs: _document(source_sha, "recuperado"),
    )

    orphan = package_root / "runs" / "run-crashed-a1"
    orphan.mkdir(parents=True)
    (orphan / "transcript.json.partial").write_text("partial", encoding="utf-8")

    committed = package_root / "runs" / "run-preserve-a1"
    committed.mkdir(parents=True)
    (committed / "run.json").write_text("keep-even-if-invalid", encoding="utf-8")

    code, messages = _run(_command("job-clean-orphan", source_id))

    assert code == 0
    assert not orphan.exists()
    assert committed.is_dir()
    event = next(
        message
        for message in messages
        if message["type"] == "event"
        and message["payload"].get("code") == "INCOMPLETE_RUNS_CLEANED"
    )
    assert event["payload"]["count"] == 1


def test_worker_marks_invalid_transcript_output_non_retryable(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    data_root.mkdir()
    models_root.mkdir()
    source_id, source_sha, _package_root = _stage(data_root)
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))
    monkeypatch.setattr(
        worker,
        "transcribe_craig_package",
        lambda *_args, **_kwargs: _document(source_sha, "resultado inválido"),
    )
    monkeypatch.setattr(
        worker,
        "write_completed_run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            TranscriptValidationError("segment:INVALID")
        ),
    )

    code, messages = _run(_command("job-invalid-transcript", source_id))

    assert code == 66
    error = next(message for message in messages if message["type"] == "error")
    assert error["payload"] == {
        "code": "TRANSCRIPT_VALIDATION_FAILED",
        "recoverable": False,
    }


def test_worker_rejects_transcript_bound_to_a_different_source(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    data_root.mkdir()
    models_root.mkdir()
    source_id, _source_sha, package_root = _stage(data_root)
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))

    monkeypatch.setattr(
        worker,
        "transcribe_craig_package",
        lambda *_args, **_kwargs: _document("f" * 64, "fonte errada"),
    )

    code, messages = _run(_command("job-wrong-source", source_id))

    assert code == 66
    error = next(message for message in messages if message["type"] == "error")
    assert error["payload"]["code"] == "TRANSCRIPTION_SOURCE_HASH_MISMATCH"
    assert list_runs(package_root, verify_content=True) == []


def test_worker_succeeds_when_legacy_mirror_write_fails(tmp_path: Path, monkeypatch):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    data_root.mkdir()
    models_root.mkdir()
    source_id, source_sha, package_root = _stage(data_root)
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))
    monkeypatch.setattr(
        worker,
        "transcribe_craig_package",
        lambda *_args, **_kwargs: _document(source_sha, "resultado autoritativo"),
    )
    monkeypatch.setattr(
        worker,
        "write_compatibility_mirror",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("locked")),
    )

    code, messages = _run(_command("job-mirror-locked", source_id))

    assert code == 0
    result = next(message for message in messages if message["type"] == "result")
    run_id = result["payload"]["run_id"]
    assert (package_root / "runs" / run_id / "run.json").is_file()
    warning = next(
        message
        for message in messages
        if message["type"] == "event"
        and message["payload"].get("code") == "COMPATIBILITY_MIRROR_WRITE_FAILED"
    )
    assert warning["payload"]["reason"] == "write_failed"
    assert len(list_runs(package_root, verify_content=True)) == 1


def test_worker_keeps_previous_run_and_uses_root_only_as_latest_compatibility_mirror(
    tmp_path: Path,
    monkeypatch,
):
    data_root = tmp_path / "Data"
    models_root = tmp_path / "Models"
    data_root.mkdir()
    models_root.mkdir()
    source_id, source_sha, package_root = _stage(data_root)
    monkeypatch.setenv("TDA_WORKER_DATA_ROOT", str(data_root))
    monkeypatch.setenv("TDA_WORKER_MODELS_ROOT", str(models_root))

    current = {"text": "primeira versao"}

    def transcribe(*_args, **_kwargs):
        return _document(source_sha, current["text"])

    monkeypatch.setattr(worker, "transcribe_craig_package", transcribe)

    first_code, first_messages = _run(_command("job-one", source_id))
    assert first_code == 0
    first_result = next(message for message in first_messages if message["type"] == "result")
    first_run_id = first_result["payload"]["run_id"]
    first_path = package_root / "runs" / first_run_id / "transcript.json"
    first_bytes = first_path.read_bytes()
    assert (package_root / "transcript.json").read_bytes() == first_bytes

    current["text"] = "segunda versao"
    second_code, second_messages = _run(_command("job-two", source_id))
    assert second_code == 0
    second_result = next(message for message in second_messages if message["type"] == "result")
    second_run_id = second_result["payload"]["run_id"]

    assert second_run_id != first_run_id
    assert first_path.read_bytes() == first_bytes
    assert (package_root / "transcript.json").read_bytes() != first_bytes
    runs = list_runs(package_root, verify_content=True)
    assert {value["run_id"] for value in runs} == {first_run_id, second_run_id}
    # The root compatibility mirror of run 1 must not be duplicated as a fake legacy run.
    assert all(value["origin"] == "asr" for value in runs)
