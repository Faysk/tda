"""Build-only launch seals, removed before packaging; installed seals stay intact."""
import hashlib
import json
import os
import subprocess
from pathlib import Path


def launch(
    worker: Path,
    version: str,
    family: str,
    command: str,
    timeout: int,
    environment_overrides: dict[str, str] | None = None,
):
    runtime_id = {"whisper": "whisper-ctranslate2", "qwen": "qwen3-transformers"}[family]
    with worker.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    artifact = {"runtime_id": runtime_id, "version": version, "worker_sha256": digest, "archive_sha256": None}
    marker = worker.parent / ".tda-runtime.json"
    temporary = not marker.exists()
    if temporary:
        with marker.open("x", encoding="utf-8") as handle:
            json.dump({"schema": "tda_asr_runtime_v1", **artifact}, handle)
    else:
        stored = json.loads(marker.read_text(encoding="utf-8"))
        if stored.get("schema") != "tda_asr_runtime_v1" or any(stored.get(key) != artifact[key] for key in ("runtime_id", "version", "worker_sha256")):
            raise RuntimeError("RUNTIME_SMOKE_SEAL_INVALID")
        artifact["archive_sha256"] = stored.get("archive_sha256")
    try:
        environment = {
            **os.environ,
            "TDA_ASR_RUNTIME_FAMILY": family,
            "TDA_ASR_RUNTIME_VERSION": version,
            "TDA_ASR_RUNTIME_ARTIFACT": json.dumps(artifact),
            **(environment_overrides or {}),
        }
        return subprocess.run(
            [str(worker)],
            input=command,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
            env=environment,
        )
    finally:
        if temporary:
            marker.unlink()
