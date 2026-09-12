from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from .asr_models import AsrProfile
from .craig import CraigPackage, CraigTrack
from .transcript import TranscriptSegment, TranscriptTrack, TranscriptValidationError

CHECKPOINT_SCHEMA = "tda_asr_track_checkpoint_v1"
MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class CheckpointSignature:
    package_sha256: str
    profile_id: str
    engine: str
    model_id: str
    model_revision: str | None
    alignment: str
    alignment_revision: str | None
    runtime_fingerprint: str
    recipe_sha256: str
    context_sha256: str
    glossary_sha256: str

    def as_dict(self) -> dict[str, str | None]:
        return asdict(self)

    def digest(self) -> str:
        payload = json.dumps(self.as_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _sha_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_json_hash(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_checkpoint_signature(
    package: CraigPackage,
    profile: AsrProfile,
    *,
    recipe: object,
    context: str,
    glossary: str,
    runtime_fingerprint: str,
) -> CheckpointSignature:
    return CheckpointSignature(
        package_sha256=package.source_sha256.lower(),
        profile_id=profile.id,
        engine=profile.engine,
        model_id=profile.model_id,
        model_revision=profile.revision,
        alignment=profile.alignment,
        alignment_revision=profile.alignment_revision,
        runtime_fingerprint=runtime_fingerprint,
        recipe_sha256=_canonical_json_hash(recipe),
        context_sha256=_sha_text(context),
        glossary_sha256=_sha_text(glossary),
    )


def _checkpoint_path(package_root: Path, signature: CheckpointSignature, track_number: int) -> Path:
    if track_number < 1:
        raise ValueError("CHECKPOINT_TRACK_NUMBER_INVALID")
    root = package_root.resolve() / ".checkpoints" / signature.digest()
    return root / f"track-{track_number:04d}.json"


def _track_from_dict(value: Any) -> TranscriptTrack:
    if not isinstance(value, dict):
        raise TranscriptValidationError("track:OBJECT_REQUIRED")
    segments_value = value.get("segments")
    if not isinstance(segments_value, list):
        raise TranscriptValidationError("track.segments:ARRAY_REQUIRED")
    identity = value.get("identity")
    if identity is not None and not isinstance(identity, dict):
        raise TranscriptValidationError("track.identity:OBJECT_REQUIRED")
    result = TranscriptTrack(
        number=int(value.get("number")),
        speaker=str(value.get("speaker") or ""),
        source_filename=str(value.get("source_filename") or ""),
        source_sha256=None if value.get("source_sha256") is None else str(value.get("source_sha256")),
        duration_seconds=(
            None if value.get("duration_seconds") is None else float(value.get("duration_seconds"))
        ),
        segments=tuple(
            TranscriptSegment.from_dict(segment, fallback_id=f"checkpoint-{index}")
            for index, segment in enumerate(segments_value, start=1)
        ),
        timeline_offset_seconds=float(value.get("timeline_offset_seconds") or 0.0),
        identity=identity,
    )
    result.validate()
    return result


def _matches_source(transcript: TranscriptTrack, track: CraigTrack) -> bool:
    return (
        transcript.number == track.number
        and transcript.speaker == track.speaker
        and transcript.source_filename == track.filename
        and (transcript.source_sha256 or "").lower() == track.sha256.lower()
        and abs(float(transcript.timeline_offset_seconds) - float(track.timeline_offset_seconds)) <= 0.001
    )


def load_track_checkpoint(
    package_root: Path,
    signature: CheckpointSignature,
    track: CraigTrack,
) -> TranscriptTrack | None:
    path = _checkpoint_path(package_root, signature, track.number)
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    except OSError:
        return None
    if stat.st_size <= 0 or stat.st_size > MAX_CHECKPOINT_BYTES:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or value.get("schema") != CHECKPOINT_SCHEMA:
        return None
    if value.get("signature") != signature.as_dict() or value.get("signature_sha256") != signature.digest():
        return None
    if value.get("track_source_sha256") != track.sha256.lower():
        return None
    try:
        transcript = _track_from_dict(value.get("track"))
    except (TypeError, ValueError, TranscriptValidationError):
        return None
    return transcript if _matches_source(transcript, track) else None


def save_track_checkpoint(
    package_root: Path,
    signature: CheckpointSignature,
    source_track: CraigTrack,
    transcript_track: TranscriptTrack,
) -> Path:
    transcript_track.validate()
    if not _matches_source(transcript_track, source_track):
        raise ValueError("CHECKPOINT_TRACK_SOURCE_MISMATCH")
    path = _checkpoint_path(package_root, signature, source_track.number)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{uuid4().hex}.partial")
    payload = {
        "schema": CHECKPOINT_SCHEMA,
        "signature": signature.as_dict(),
        "signature_sha256": signature.digest(),
        "track_source_sha256": source_track.sha256.lower(),
        "track": asdict(transcript_track),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_CHECKPOINT_BYTES:
        raise ValueError("CHECKPOINT_SIZE_LIMIT")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    return path
