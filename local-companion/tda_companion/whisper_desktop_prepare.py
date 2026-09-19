from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from .asr_models import get_profile, verify_and_upgrade_model_install
from .asr_runtime import current_whisper_worker

_MAX_STDOUT_BYTES = 64 * 1024
_PREPARE_TIMEOUT_SECONDS = 2 * 60 * 60


class WhisperDesktopPrepareError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _creationflags() -> int:
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _parse_json_stdout(result: Any) -> dict[str, Any]:
    raw = str(getattr(result, "stdout", "") or "")
    if len(raw.encode("utf-8", errors="replace")) > _MAX_STDOUT_BYTES:
        raise WhisperDesktopPrepareError("WHISPER_PREPARATION_RESPONSE_TOO_LARGE")
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if not lines:
        raise WhisperDesktopPrepareError("WHISPER_PREPARATION_RESPONSE_MISSING")
    try:
        value = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise WhisperDesktopPrepareError("WHISPER_PREPARATION_RESPONSE_INVALID") from exc
    if not isinstance(value, dict) or value.get("schema") != "tda_whisper_model_prepare_v1":
        raise WhisperDesktopPrepareError("WHISPER_PREPARATION_RESPONSE_INVALID")
    return value


def prepare_whisper_profile(
    *,
    models_root: Path,
    runtime_root: Path,
    profile_id: str,
    runner: Callable[..., Any] = subprocess.run,
    is_cancelled: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    if is_cancelled is not None and is_cancelled():
        raise WhisperDesktopPrepareError("TRANSCRIPTION_PREPARATION_CANCELLED")
    profile = get_profile(profile_id)
    if profile.engine != "whisper":
        raise WhisperDesktopPrepareError("WHISPER_PROFILE_REQUIRED")

    existing = verify_and_upgrade_model_install(models_root, profile)
    if existing.get("status") == "ready":
        return {
            "ready": True,
            "profile_id": profile.id,
            "prepared": False,
            "model_content_sha256": existing.get("content_sha256"),
        }

    worker = current_whisper_worker(runtime_root)
    if worker is None:
        raise WhisperDesktopPrepareError("WHISPER_RUNTIME_UNAVAILABLE")

    command = [
        str(worker),
        "--prepare-model",
        "--models-root",
        str(models_root.resolve()),
        "--profile",
        profile.id,
    ]
    if runner is not subprocess.run:
        try:
            result = runner(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=_PREPARE_TIMEOUT_SECONDS,
                check=False,
                creationflags=_creationflags(),
            )
        except subprocess.TimeoutExpired as exc:
            raise WhisperDesktopPrepareError("WHISPER_MODEL_PREPARATION_TIMEOUT") from exc
        except OSError as exc:
            raise WhisperDesktopPrepareError("WHISPER_RUNTIME_EXEC_FAILED") from exc
        if is_cancelled is not None and is_cancelled():
            raise WhisperDesktopPrepareError("TRANSCRIPTION_PREPARATION_CANCELLED")
    else:
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                creationflags=_creationflags(),
            )
        except OSError as exc:
            raise WhisperDesktopPrepareError("WHISPER_RUNTIME_EXEC_FAILED") from exc

        deadline = time.monotonic() + _PREPARE_TIMEOUT_SECONDS
        while True:
            if is_cancelled is not None and is_cancelled():
                process.terminate()
                try:
                    process.communicate(timeout=2.0)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                raise WhisperDesktopPrepareError("TRANSCRIPTION_PREPARATION_CANCELLED")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill()
                process.communicate()
                raise WhisperDesktopPrepareError("WHISPER_MODEL_PREPARATION_TIMEOUT")
            try:
                stdout, _ = process.communicate(timeout=min(0.25, remaining))
                result = subprocess.CompletedProcess(
                    command,
                    process.returncode,
                    stdout=stdout,
                    stderr=None,
                )
                break
            except subprocess.TimeoutExpired:
                continue

    value = _parse_json_stdout(result)
    if int(getattr(result, "returncode", 1)) != 0 or value.get("ready") is not True:
        code = str(value.get("error") or "WHISPER_MODEL_PREPARATION_FAILED")
        raise WhisperDesktopPrepareError(code)

    verified = verify_and_upgrade_model_install(models_root, profile)
    if verified.get("status") != "ready":
        raise WhisperDesktopPrepareError("WHISPER_MODEL_PREPARATION_NOT_VISIBLE")
    digest = verified.get("content_sha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise WhisperDesktopPrepareError("WHISPER_MODEL_PREPARATION_INTEGRITY_MISSING")

    return {
        "ready": True,
        "profile_id": profile.id,
        "prepared": bool(value.get("prepared", True)),
        "model_content_sha256": digest,
    }
