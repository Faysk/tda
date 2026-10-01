#!/usr/bin/env python3
"""Sanitized structural validator for the #1236 full Qwen recovery run."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_SOURCE_ID = re.compile(r"^craig-([0-9a-f]{64})$")
_MAX_TRANSCRIPT_BYTES = 512 * 1024 * 1024
_MAX_MANIFEST_BYTES = 256 * 1024


class QwenFullRunStructureError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_file(path: Path, *, maximum: int, code: str) -> dict[str, Any]:
    if path.is_symlink():
        raise QwenFullRunStructureError(f"{code}_SYMLINK")
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise QwenFullRunStructureError(f"{code}_MISSING") from exc
    if size <= 0 or size > maximum:
        raise QwenFullRunStructureError(f"{code}_SIZE_INVALID")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise QwenFullRunStructureError(f"{code}_JSON_INVALID") from exc
    if not isinstance(value, dict):
        raise QwenFullRunStructureError(f"{code}_OBJECT_REQUIRED")
    return value


def _load_transcript_type(repo_root: Path):
    package_root = (repo_root / "local-companion").resolve()
    if not package_root.is_dir():
        raise QwenFullRunStructureError("QWEN_1236_REPOSITORY_LAYOUT_INVALID")
    sys.path.insert(0, str(package_root))
    try:
        from tda_companion.transcript import TranscriptDocument, TranscriptValidationError
    except Exception as exc:
        raise QwenFullRunStructureError("QWEN_1236_TRANSCRIPT_VALIDATOR_IMPORT_FAILED") from exc
    return TranscriptDocument, TranscriptValidationError


def validate_full_run(
    *,
    transcript_path: Path,
    run_marker_path: Path,
    source_id: str,
    expected_source_sha256: str,
    job_id: str,
    attempt: int,
    expected_profile_id: str,
    expected_track_count: int,
    repo_root: Path,
) -> dict[str, Any]:
    source_match = _SOURCE_ID.fullmatch(source_id)
    expected_sha = expected_source_sha256.lower()
    if source_match is None or not _SHA256.fullmatch(expected_sha) or source_match.group(1) != expected_sha:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_SOURCE_MISMATCH")
    if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 2:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_RETRY_ATTEMPT_INVALID")
    if expected_profile_id != "qwen-fast":
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_PROFILE_INVALID")
    if expected_track_count != 4:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_TRACK_CONTRACT_INVALID")

    raw_transcript = _json_file(transcript_path, maximum=_MAX_TRANSCRIPT_BYTES, code="QWEN_1236_FULL_RUN_TRANSCRIPT")
    run_marker = _json_file(run_marker_path, maximum=_MAX_MANIFEST_BYTES, code="QWEN_1236_FULL_RUN_MARKER")

    TranscriptDocument, TranscriptValidationError = _load_transcript_type(repo_root)
    try:
        document = TranscriptDocument.from_dict(raw_transcript)
    except TranscriptValidationError as exc:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_TRANSCRIPT_INVALID") from exc

    transcript_sha256 = _sha256_file(transcript_path)
    track_numbers = [int(track.number) for track in document.tracks]
    if track_numbers != list(range(1, expected_track_count + 1)):
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_TRACK_IDENTITY_INVALID")
    if document.source_sha256.lower() != expected_sha:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_SOURCE_MISMATCH")
    if document.engine.profile != expected_profile_id:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_PROFILE_INVALID")
    if document.stats.track_count != expected_track_count:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_TRACK_COUNT_INVALID")
    if (
        document.stats.duration_semantics != "session_extent_v1"
        or document.stats.audio_work_seconds <= 0
        or document.stats.session_duration_seconds <= 0
    ):
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_COVERAGE_INVALID")

    expected_marker = {
        "schema_version": "tda_transcription_run_v1",
        "status": "completed",
        "source_id": source_id,
        "source_sha256": expected_sha,
        "job_id": job_id,
        "attempt": attempt,
        "profile_id": expected_profile_id,
        "transcript_sha256": transcript_sha256,
    }
    for key, expected in expected_marker.items():
        if run_marker.get(key) != expected:
            raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_MARKER_MISMATCH")
    marker_stats = run_marker.get("stats")
    if not isinstance(marker_stats, dict):
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_MARKER_STATS_INVALID")
    for key, expected in (
        ("track_count", document.stats.track_count),
        ("segment_count", document.stats.segment_count),
        ("word_count", document.stats.word_count),
        ("audio_work_seconds", document.stats.audio_work_seconds),
        ("session_duration_seconds", document.stats.session_duration_seconds),
        ("duration_semantics", document.stats.duration_semantics),
    ):
        actual = marker_stats.get(key)
        if isinstance(expected, float):
            try:
                if abs(float(actual) - expected) > 0.001:
                    raise ValueError
            except (TypeError, ValueError):
                raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_MARKER_STATS_MISMATCH")
        elif actual != expected:
            raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_MARKER_STATS_MISMATCH")

    track_hashes_present = sum(1 for track in document.tracks if track.source_sha256 is not None)
    if track_hashes_present != expected_track_count:
        raise QwenFullRunStructureError("QWEN_1236_FULL_RUN_TRACK_HASH_MISSING")

    return {
        "schema": "tda_qwen_1236_full_run_structure_v1",
        "issue": 1236,
        "source_sha256": expected_sha,
        "profile_id": expected_profile_id,
        "attempt": attempt,
        "track_count": document.stats.track_count,
        "track_numbers": track_numbers,
        "track_source_hashes_present": track_hashes_present,
        "audio_work_seconds": document.stats.audio_work_seconds,
        "session_duration_seconds": document.stats.session_duration_seconds,
        "duration_semantics": document.stats.duration_semantics,
        "segment_count": document.stats.segment_count,
        "word_count": document.stats.word_count,
        "turn_count": document.stats.turn_count,
        "warning_count": len(document.warnings),
        "transcript_sha256": transcript_sha256,
        "run_marker_schema": str(run_marker.get("schema_version") or ""),
        "immutable_run_verified": True,
        "contains_audio": False,
        "contains_transcript": False,
        "contains_speaker_names": False,
        "contains_paths": False,
    }


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(payload, encoding="utf-8")
    os.replace(temporary, path)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate #1236 full Qwen recovery run structure.")
    parser.add_argument("--transcript", type=Path, required=True)
    parser.add_argument("--run-marker", type=Path, required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--attempt", type=int, required=True)
    parser.add_argument("--profile-id", required=True)
    parser.add_argument("--expected-track-count", type=int, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        receipt = validate_full_run(
            transcript_path=args.transcript.resolve(),
            run_marker_path=args.run_marker.resolve(),
            source_id=args.source_id,
            expected_source_sha256=args.expected_source_sha256,
            job_id=args.job_id,
            attempt=args.attempt,
            expected_profile_id=args.profile_id,
            expected_track_count=args.expected_track_count,
            repo_root=args.repo_root.resolve(),
        )
        _write_json(args.output.resolve(), receipt)
        print("QWEN_1236_FULL_RUN_STRUCTURE_OK")
        return 0
    except QwenFullRunStructureError as exc:
        print(exc.code, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
