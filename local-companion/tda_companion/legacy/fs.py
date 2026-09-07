from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any


_RETRY_DELAYS = (0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0)
_RETRYABLE_WINERRORS = {5, 32, 33}


def _is_retryable_replace_error(error: OSError) -> bool:
    if isinstance(error, PermissionError):
        return True
    return getattr(error, "winerror", None) in _RETRYABLE_WINERRORS


def replace_with_retry(source: str | Path, destination: str | Path) -> None:
    source_path = os.fspath(source)
    destination_path = os.fspath(destination)
    for attempt, delay in enumerate((*_RETRY_DELAYS, None)):
        try:
            os.replace(source_path, destination_path)
            return
        except OSError as error:
            if not _is_retryable_replace_error(error) or delay is None:
                raise
            time.sleep(delay)


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        replace_with_retry(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def atomic_replace_probe(directory: Path) -> dict[str, Any]:
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / ".dnd-scribe-health.json"
    descriptor, temporary = tempfile.mkstemp(
        dir=directory,
        prefix=".dnd-scribe-health-",
        suffix=".tmp",
    )
    try:
        destination.write_text('{"generation":0}\n', encoding="utf-8")
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write('{"generation":1}\n')
            handle.flush()
            os.fsync(handle.fileno())
        replace_with_retry(temporary, destination)
        payload = json.loads(destination.read_text(encoding="utf-8"))
        if payload.get("generation") != 1:
            raise OSError("A substituição atômica não preservou o conteúdo esperado.")
        return {"ok": True, "error": None}
    except OSError as error:
        return {"ok": False, "error": f"{type(error).__name__}: {error}"}
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        try:
            destination.unlink()
        except FileNotFoundError:
            pass
