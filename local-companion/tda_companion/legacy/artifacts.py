from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .fs import atomic_write_json


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_json(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _file_record(path: Path, *, known_sha256: str | None = None) -> dict[str, Any]:
    if not path.is_file():
        return {
            "filename": path.name,
            "available": False,
        }
    return {
        "filename": path.name,
        "available": True,
        "bytes": path.stat().st_size,
        "sha256": known_sha256 or sha256_file(path),
    }


def build_session_manifest(
    session: dict[str, Any],
    session_dir: Path,
    *,
    inbox: Path,
) -> dict[str, Any]:
    source = Path(session.get("source", ""))
    source_record = _file_record(source, known_sha256=session.get("source_sha256"))
    try:
        source_record["inbox_path"] = source.resolve().relative_to(inbox.resolve()).as_posix()
    except (OSError, ValueError):
        source_record["inbox_path"] = None

    tracks = []
    for track in session.get("tracks", []):
        path = Path(track.get("path", ""))
        record = _file_record(path, known_sha256=track.get("sha256"))
        record["speaker"] = track.get("speaker")
        tracks.append(record)

    transcript_files = [
        _file_record(path)
        for path in sorted(session_dir.glob("transcript-*.json"))
    ]
    transcript = session.get("transcript") or []
    transcript_digest = sha256_json(transcript) if transcript else None

    return {
        "schema_version": 1,
        "generated_at": utc_now(),
        "recording_id": session["recording_id"],
        "start_time": session.get("start_time"),
        "format": session.get("format"),
        "status": session.get("status"),
        "mode": session.get("mode"),
        "processing": session.get("processing"),
        "source": source_record,
        "tracks": tracks,
        "transcript": {
            "available": bool(transcript),
            "segments": len(transcript),
            "sha256": transcript_digest,
            "files": transcript_files,
        },
    }


def write_session_manifest(
    session: dict[str, Any],
    session_dir: Path,
    *,
    inbox: Path,
) -> dict[str, Any]:
    manifest = build_session_manifest(session, session_dir, inbox=inbox)
    atomic_write_json(session_dir / "manifest.json", manifest)
    return manifest
