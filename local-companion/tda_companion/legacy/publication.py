from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .artifacts import atomic_write_json, sha256_file, sha256_json, utc_now


PUBLICATION_SCHEMA = "publication_bundle_v1"


def build_publication_bundle(
    session: dict[str, Any],
    manifest: dict[str, Any],
    *,
    manifest_path: Path | None = None,
) -> dict[str, Any]:
    transcript = session.get("transcript") or []
    duration_seconds = max((float(item.get("end", 0)) for item in transcript), default=0)
    recap = session.get("recap") or {}

    payload = {
        "schema_version": PUBLICATION_SCHEMA,
        "session": {
            "source_id": session["recording_id"],
            "played_at": (session.get("start_time") or "")[:10] or None,
            "start_time": session.get("start_time"),
            "title": session.get("title"),
            "speakers": session.get("speakers") or [],
        },
        "recap": {
            "short": recap.get("short"),
            "full": recap.get("full"),
        },
        "approved_entries": session.get("approved_entries") or [],
        "open_threads": session.get("open_threads") or [],
        "source_manifest": {
            "local_only": True,
            "recording_format": session.get("format"),
            "transcript_segments": len(transcript),
            "duration_seconds": round(duration_seconds, 3),
            "transcript_sha256": manifest.get("transcript", {}).get("sha256"),
            "manifest_sha256": (
                sha256_file(manifest_path)
                if manifest_path and manifest_path.is_file()
                else sha256_json(manifest)
            ),
        },
    }
    publication_id = sha256_json(payload)
    return {
        **payload,
        "publication_id": publication_id,
        "generated_at": utc_now(),
    }


def write_publication_bundle(
    session: dict[str, Any],
    manifest: dict[str, Any],
    session_dir: Path,
) -> tuple[Path, dict[str, Any]]:
    manifest_path = session_dir / "manifest.json"
    bundle = build_publication_bundle(
        session,
        manifest,
        manifest_path=manifest_path,
    )
    output = session_dir / "publications" / f"{PUBLICATION_SCHEMA}.json"
    atomic_write_json(output, bundle)
    return output, bundle


def serialized_size(value: Any) -> int:
    return len(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
