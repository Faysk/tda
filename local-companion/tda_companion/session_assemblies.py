from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from .atomic_storage import AtomicStorageError, atomic_write
from .session_timeline import SEGMENT_BOUNDARY_POLICY, TIMING_POLICY_VERSION
from .transcription_runs import (
    TranscriptionRunError,
    load_run,
    load_verified_transcript_snapshot,
)

ASSEMBLY_SCHEMA_VERSION = "tda_session_assembly_v1"
ASSEMBLY_TRANSCRIPT_SCHEMA_VERSION = "tda_session_assembly_transcript_v1"
ASSEMBLY_CANONICALIZATION_VERSION = "tda_session_assembly_canonical_v1"
ASSEMBLY_LIST_SCHEMA_VERSION = "tda_session_assemblies_v1"
_MAX_PARTS = 64
_MAX_SEGMENTS = 100_000
_MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024
_MAX_MANIFEST_BYTES = 1024 * 1024
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SOURCE = re.compile(r"^craig-[0-9a-f]{64}$")
_RUN = re.compile(r"^[A-Za-z0-9_-]{1,196}$")
_ASSEMBLY = re.compile(r"^[0-9a-f]{64}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class SessionAssemblyError(RuntimeError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _identity(value: object, code: str) -> str:
    if not isinstance(value, str) or _ID.fullmatch(value) is None:
        raise SessionAssemblyError(code)
    return value


def _number(value: object, code: str, *, allow_none: bool = False) -> float | None:
    if value is None and allow_none:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        or float(value) < 0
    ):
        raise SessionAssemblyError(code)
    return float(value)


def _assemblies_root(data_root: Path, campaign_id: str, session_id: str) -> Path:
    campaign_id = _identity(campaign_id, "SESSION_ASSEMBLY_CAMPAIGN_INVALID")
    session_id = _identity(session_id, "SESSION_ASSEMBLY_SESSION_INVALID")
    base = (data_root.resolve() / "session-assemblies").resolve()
    root = (base / campaign_id / session_id).resolve()
    if root.parent.parent != base:
        raise SessionAssemblyError("SESSION_ASSEMBLY_PATH_INVALID")
    return root


def assembly_root(
    data_root: Path,
    campaign_id: str,
    session_id: str,
    assembly_id: str,
) -> Path:
    if not isinstance(assembly_id, str) or _ASSEMBLY.fullmatch(assembly_id) is None:
        raise SessionAssemblyError("SESSION_ASSEMBLY_ID_INVALID")
    parent = _assemblies_root(data_root, campaign_id, session_id)
    value = (parent / f"assembly-{assembly_id}").resolve()
    if value.parent != parent:
        raise SessionAssemblyError("SESSION_ASSEMBLY_PATH_INVALID")
    return value


def _bounded_bytes(path: Path, maximum: int, missing_code: str, invalid_code: str) -> bytes:
    if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
        raise SessionAssemblyError(invalid_code)
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise SessionAssemblyError(missing_code) from exc
    if size <= 0 or size > maximum:
        raise SessionAssemblyError(invalid_code)
    try:
        with path.open("rb") as handle:
            payload = handle.read(maximum + 1)
    except OSError as exc:
        raise SessionAssemblyError(invalid_code) from exc
    if len(payload) != size or len(payload) > maximum:
        raise SessionAssemblyError(invalid_code)
    return payload


def _bounded_json(path: Path, maximum: int, missing_code: str, invalid_code: str) -> tuple[dict[str, Any], bytes]:
    payload = _bounded_bytes(path, maximum, missing_code, invalid_code)
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SessionAssemblyError(invalid_code) from exc
    if not isinstance(value, dict):
        raise SessionAssemblyError(invalid_code)
    return value, payload


def _source_local_segment(track: Mapping[str, Any], segment: Mapping[str, Any]) -> tuple[float, float]:
    offset = _number(track.get("timeline_offset_seconds", 0.0), "SESSION_ASSEMBLY_TRACK_OFFSET_INVALID")
    start = _number(segment.get("start"), "SESSION_ASSEMBLY_SEGMENT_TIMING_INVALID")
    end = _number(segment.get("end"), "SESSION_ASSEMBLY_SEGMENT_TIMING_INVALID")
    assert offset is not None and start is not None and end is not None
    if end < start:
        raise SessionAssemblyError("SESSION_ASSEMBLY_SEGMENT_TIMING_INVALID")
    return offset + start, offset + end


def _participant_index(mapping: Mapping[str, Any]) -> dict[tuple[str, int], tuple[str, str]]:
    observations = mapping.get("observations")
    participants = mapping.get("participants")
    if not isinstance(observations, list) or not isinstance(participants, list):
        raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID")
    by_observation: dict[str, tuple[str, int]] = {}
    for row in observations:
        if not isinstance(row, Mapping):
            raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID")
        observation_id = row.get("observation_id")
        source_id = row.get("source_id")
        track_number = row.get("track_number")
        if (
            not isinstance(observation_id, str)
            or not isinstance(source_id, str)
            or _SOURCE.fullmatch(source_id) is None
            or isinstance(track_number, bool)
            or not isinstance(track_number, int)
            or track_number < 1
        ):
            raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID")
        by_observation[observation_id] = (source_id, track_number)

    index: dict[tuple[str, int], tuple[str, str]] = {}
    for participant in participants:
        if not isinstance(participant, Mapping):
            raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID")
        participant_id = participant.get("participant_id")
        display = participant.get("display_speaker")
        observation_ids = participant.get("observation_ids")
        if (
            not isinstance(participant_id, str)
            or re.fullmatch(r"[0-9a-f]{32}", participant_id) is None
            or not isinstance(display, str)
            or not display
            or not isinstance(observation_ids, list)
        ):
            raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID")
        for observation_id in observation_ids:
            key = by_observation.get(str(observation_id))
            if key is None or key in index:
                raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID")
            index[key] = (participant_id, display)
    if set(index) != set(by_observation.values()):
        raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INCOMPLETE")
    return index


def _part_bounds(parts: list[Mapping[str, Any]]) -> dict[str, tuple[float | None, float | None]]:
    bounds: dict[str, tuple[float | None, float | None]] = {}
    for index, part in enumerate(parts):
        part_id = str(part.get("part_id") or "")
        lower: float | None = None
        upper: float | None = None
        if index > 0 and part.get("relation_to_previous") == "overlap":
            boundary = _number(
                part.get("overlap_boundary_seconds"),
                "SESSION_ASSEMBLY_OVERLAP_UNRESOLVED",
            )
            assert boundary is not None
            lower = boundary
            previous_id = str(parts[index - 1].get("part_id") or "")
            previous_lower, _ = bounds.get(previous_id, (None, None))
            bounds[previous_id] = (previous_lower, boundary)
        bounds[part_id] = (lower, upper)
    return bounds


def _segment_id(
    part_id: str,
    source_id: str,
    run_id: str,
    track_number: int,
    source_segment_id: str,
) -> str:
    payload = f"{part_id}\0{source_id}\0{run_id}\0{track_number}\0{source_segment_id}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _build_transcript(
    *,
    campaign_id: str,
    session_id: str,
    parts: list[Mapping[str, Any]],
    snapshots: Mapping[str, tuple[dict[str, Any], dict[str, Any]]],
    participant_mapping: Mapping[str, Any],
) -> dict[str, Any]:
    participant_index = _participant_index(participant_mapping)
    bounds = _part_bounds(parts)
    segments: list[dict[str, Any]] = []
    warnings: list[str] = []

    for part in parts:
        part_id = str(part["part_id"])
        source_id = str(part["source_id"])
        run_id = str(part["selected_run_id"])
        ordinal = int(part["ordinal"])
        offset = _number(part.get("session_offset_seconds"), "SESSION_ASSEMBLY_TIMELINE_NOT_READY")
        trim_start = _number(part.get("trim_start_seconds", 0.0), "SESSION_ASSEMBLY_TRIM_INVALID")
        trim_end = _number(part.get("trim_end_seconds"), "SESSION_ASSEMBLY_TRIM_INVALID", allow_none=True)
        assert offset is not None and trim_start is not None
        manifest, transcript = snapshots[part_id]
        tracks = transcript.get("tracks")
        if not isinstance(tracks, list):
            raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
        lower_boundary, upper_boundary = bounds[part_id]

        for track in tracks:
            if not isinstance(track, Mapping):
                raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
            track_number = track.get("number")
            raw_speaker = track.get("speaker")
            raw_segments = track.get("segments")
            if (
                isinstance(track_number, bool)
                or not isinstance(track_number, int)
                or track_number < 1
                or not isinstance(raw_speaker, str)
                or not isinstance(raw_segments, list)
            ):
                raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
            participant = participant_index.get((source_id, track_number))
            if participant is None:
                raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INCOMPLETE")
            participant_id, display_speaker = participant
            for segment in raw_segments:
                if not isinstance(segment, Mapping):
                    raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
                source_segment_id = segment.get("id")
                text = segment.get("text")
                words = segment.get("words", [])
                if (
                    not isinstance(source_segment_id, str)
                    or not source_segment_id
                    or len(source_segment_id) > 256
                    or not isinstance(text, str)
                    or not text.strip()
                    or not isinstance(words, list)
                ):
                    raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
                local_start, local_end = _source_local_segment(track, segment)
                if local_start + 1e-9 < trim_start:
                    continue
                if trim_end is not None and local_start >= trim_end - 1e-9:
                    continue
                global_start = offset + local_start
                global_end = offset + local_end
                if lower_boundary is not None and global_start < lower_boundary - 1e-9:
                    continue
                if upper_boundary is not None and global_start >= upper_boundary - 1e-9:
                    continue

                projected_words = []
                track_offset = _number(
                    track.get("timeline_offset_seconds", 0.0),
                    "SESSION_ASSEMBLY_TRACK_OFFSET_INVALID",
                )
                assert track_offset is not None
                for word in words:
                    if not isinstance(word, Mapping):
                        raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
                    word_start = _number(word.get("start"), "SESSION_ASSEMBLY_WORD_TIMING_INVALID")
                    word_end = _number(word.get("end"), "SESSION_ASSEMBLY_WORD_TIMING_INVALID")
                    word_text = word.get("text")
                    if (
                        word_start is None
                        or word_end is None
                        or word_end < word_start
                        or not isinstance(word_text, str)
                        or not word_text.strip()
                    ):
                        raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
                    projected = {
                        "text": word_text,
                        "start": offset + track_offset + word_start,
                        "end": offset + track_offset + word_end,
                    }
                    confidence = word.get("confidence")
                    if confidence is not None:
                        projected["confidence"] = confidence
                    projected_words.append(projected)

                segments.append(
                    {
                        "assembly_segment_id": _segment_id(
                            part_id,
                            source_id,
                            run_id,
                            track_number,
                            source_segment_id,
                        ),
                        "part_id": part_id,
                        "part_ordinal": ordinal,
                        "source_id": source_id,
                        "source_sha256": manifest["source_sha256"],
                        "run_id": run_id,
                        "transcript_sha256": manifest["transcript_sha256"],
                        "source_segment_id": source_segment_id,
                        "track_number": track_number,
                        "participant_id": participant_id,
                        "speaker": display_speaker,
                        "raw_speaker": raw_speaker,
                        "start": global_start,
                        "end": global_end,
                        "text": text,
                        "words": projected_words,
                    }
                )
                if len(segments) > _MAX_SEGMENTS:
                    raise SessionAssemblyError("SESSION_ASSEMBLY_SEGMENT_LIMIT")
        raw_warnings = transcript.get("warnings", [])
        if isinstance(raw_warnings, list):
            for warning in raw_warnings:
                if isinstance(warning, str) and warning and len(warning) <= 1024:
                    warnings.append(f"{part_id}:{warning}")

    segments.sort(
        key=lambda item: (
            float(item["start"]),
            float(item["end"]),
            int(item["part_ordinal"]),
            int(item["track_number"]),
            str(item["source_segment_id"]),
            str(item["assembly_segment_id"]),
        )
    )
    if len({row["assembly_segment_id"] for row in segments}) != len(segments):
        raise SessionAssemblyError("SESSION_ASSEMBLY_SEGMENT_ID_COLLISION")

    return {
        "schema_version": ASSEMBLY_TRANSCRIPT_SCHEMA_VERSION,
        "canonicalization_version": ASSEMBLY_CANONICALIZATION_VERSION,
        "campaign_id": campaign_id,
        "session_id": session_id,
        "segments": segments,
        "warnings": warnings,
    }


def _canonical_inputs(
    workspace: Mapping[str, Any],
    participant_mapping: Mapping[str, Any],
    run_manifests: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    timeline = workspace.get("timeline")
    if not isinstance(timeline, Mapping):
        raise SessionAssemblyError("SESSION_ASSEMBLY_TIMELINE_NOT_READY")
    mapping_sha = participant_mapping.get("mapping_sha256")
    if not isinstance(mapping_sha, str) or _SHA256.fullmatch(mapping_sha) is None:
        raise SessionAssemblyError("SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID")
    return {
        "canonicalization_version": ASSEMBLY_CANONICALIZATION_VERSION,
        "timing_policy_version": timeline.get("policy_version"),
        "segment_boundary_policy": timeline.get("segment_boundary_policy"),
        "timeline_fingerprint_sha256": timeline.get("fingerprint_sha256"),
        "participant_mapping_schema_version": participant_mapping.get("schema_version"),
        "participant_mapping_policy": participant_mapping.get("policy"),
        "participant_mapping_sha256": mapping_sha,
        "campaign_id": workspace.get("campaign_id"),
        "session_id": workspace.get("session_id"),
        "parts": [
            {
                "part_id": part.get("part_id"),
                "source_id": part.get("source_id"),
                "source_sha256": run_manifests[str(part.get("part_id"))]["source_sha256"],
                "run_id": part.get("selected_run_id"),
                "transcript_sha256": run_manifests[str(part.get("part_id"))]["transcript_sha256"],
                "ordinal": part.get("ordinal"),
                "session_offset_seconds": part.get("session_offset_seconds"),
                "trim_start_seconds": part.get("trim_start_seconds", 0.0),
                "trim_end_seconds": part.get("trim_end_seconds"),
                "overlap_resolution": part.get("overlap_resolution"),
                "overlap_boundary_seconds": part.get("overlap_boundary_seconds"),
            }
            for part in workspace.get("parts", [])
        ],
    }


def build_session_assembly(
    data_root: Path,
    workspace: Mapping[str, Any],
    participant_mapping: Mapping[str, Any],
    package_roots: Mapping[str, Path],
    *,
    run_visible: Callable[[Path, dict[str, Any]], bool] | None = None,
    before_commit: Callable[[], None] | None = None,
) -> dict[str, Any]:
    campaign_id = _identity(workspace.get("campaign_id"), "SESSION_ASSEMBLY_CAMPAIGN_INVALID")
    session_id = _identity(workspace.get("session_id"), "SESSION_ASSEMBLY_SESSION_INVALID")
    parts_value = workspace.get("parts")
    timeline = workspace.get("timeline")
    if (
        not isinstance(parts_value, list)
        or not 1 <= len(parts_value) <= _MAX_PARTS
        or not isinstance(timeline, Mapping)
        or timeline.get("state") != "ready"
        or timeline.get("policy_version") != TIMING_POLICY_VERSION
        or timeline.get("segment_boundary_policy") != SEGMENT_BOUNDARY_POLICY
        or not isinstance(timeline.get("fingerprint_sha256"), str)
        or _SHA256.fullmatch(str(timeline.get("fingerprint_sha256"))) is None
    ):
        raise SessionAssemblyError("SESSION_ASSEMBLY_TIMELINE_NOT_READY")
    parts: list[Mapping[str, Any]] = []
    snapshots: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    manifests: dict[str, dict[str, Any]] = {}
    seen_parts: set[str] = set()
    for expected_ordinal, raw_part in enumerate(parts_value):
        if not isinstance(raw_part, Mapping):
            raise SessionAssemblyError("SESSION_ASSEMBLY_PART_INVALID")
        part_id = raw_part.get("part_id")
        source_id = raw_part.get("source_id")
        run_id = raw_part.get("selected_run_id")
        ordinal = raw_part.get("ordinal")
        if (
            not isinstance(part_id, str)
            or re.fullmatch(r"[0-9a-f]{32}", part_id) is None
            or part_id in seen_parts
            or not isinstance(source_id, str)
            or _SOURCE.fullmatch(source_id) is None
            or not isinstance(run_id, str)
            or _RUN.fullmatch(run_id) is None
            or isinstance(ordinal, bool)
            or ordinal != expected_ordinal
        ):
            raise SessionAssemblyError("SESSION_ASSEMBLY_PART_INVALID")
        seen_parts.add(part_id)
        package_root = package_roots.get(source_id)
        if not isinstance(package_root, Path) or package_root.resolve().name != source_id:
            raise SessionAssemblyError("SESSION_ASSEMBLY_SOURCE_UNAVAILABLE")
        try:
            manifest, transcript = load_verified_transcript_snapshot(package_root, run_id)
        except TranscriptionRunError as exc:
            raise SessionAssemblyError("SESSION_ASSEMBLY_RUN_INVALID") from exc
        if (
            manifest.get("source_id") != source_id
            or manifest.get("source_sha256") != source_id.removeprefix("craig-")
        ):
            raise SessionAssemblyError("SESSION_ASSEMBLY_SOURCE_HASH_MISMATCH")
        if run_visible is not None and not run_visible(package_root, manifest):
            raise SessionAssemblyError("SESSION_ASSEMBLY_RUN_NOT_VISIBLE")
        manifests[part_id] = manifest
        snapshots[part_id] = (manifest, transcript)
        parts.append(raw_part)

    inputs = _canonical_inputs(workspace, participant_mapping, manifests)
    input_payload = _canonical_bytes(inputs)
    inputs_sha256 = _sha256(input_payload)
    assembly_id = inputs_sha256
    destination = assembly_root(data_root, campaign_id, session_id, assembly_id)

    if (destination / "assembly.json").is_file():
        existing = load_session_assembly(
            data_root,
            campaign_id,
            session_id,
            assembly_id,
            verify_transcript=True,
        )
        if existing.get("inputs_sha256") != inputs_sha256:
            raise SessionAssemblyError("SESSION_ASSEMBLY_ID_COLLISION")
        return existing

    transcript = _build_transcript(
        campaign_id=campaign_id,
        session_id=session_id,
        parts=parts,
        snapshots=snapshots,
        participant_mapping=participant_mapping,
    )
    transcript_payload = _canonical_bytes(transcript)
    if not 0 < len(transcript_payload) <= _MAX_TRANSCRIPT_BYTES:
        raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_SIZE_INVALID")
    transcript_sha256 = _sha256(transcript_payload)
    mapping_sha = str(participant_mapping["mapping_sha256"])
    participant_approval_blocked = participant_mapping.get("approval_blocked") is True

    manifest = {
        "schema_version": ASSEMBLY_SCHEMA_VERSION,
        "assembly_id": assembly_id,
        "status": "completed",
        "campaign_id": campaign_id,
        "session_id": session_id,
        "canonicalization_version": ASSEMBLY_CANONICALIZATION_VERSION,
        "inputs_sha256": inputs_sha256,
        "timing_policy_version": inputs["timing_policy_version"],
        "segment_boundary_policy": inputs["segment_boundary_policy"],
        "timeline_fingerprint_sha256": inputs["timeline_fingerprint_sha256"],
        "participant_mapping_schema_version": inputs["participant_mapping_schema_version"],
        "participant_mapping_policy": inputs["participant_mapping_policy"],
        "participant_mapping_sha256": mapping_sha,
        "participant_approval_blocked": participant_approval_blocked,
        "transcript_artifact": "transcript.json",
        "transcript_sha256": transcript_sha256,
        "transcript_size_bytes": len(transcript_payload),
        "segment_count": len(transcript["segments"]),
        "created_at": _utc_now(),
        "parts": inputs["parts"],
    }
    manifest_payload = _canonical_bytes(manifest)
    if len(manifest_payload) > _MAX_MANIFEST_BYTES:
        raise SessionAssemblyError("SESSION_ASSEMBLY_MANIFEST_SIZE_INVALID")

    if destination.exists():
        try:
            shutil.rmtree(destination)
        except OSError as exc:
            raise SessionAssemblyError("SESSION_ASSEMBLY_PARTIAL_CLEANUP_FAILED") from exc
    destination.mkdir(parents=True, exist_ok=False)
    try:
        atomic_write(destination / "transcript.json", transcript_payload, storage_class="authoritative")
        if before_commit is not None:
            before_commit()
        atomic_write(destination / "assembly.json", manifest_payload, storage_class="authoritative")
    except BaseException as exc:
        if not (isinstance(exc, AtomicStorageError) and exc.ambiguous) and not (destination / "assembly.json").is_file():
            shutil.rmtree(destination, ignore_errors=True)
        raise
    return manifest


def load_session_assembly(
    data_root: Path,
    campaign_id: str,
    session_id: str,
    assembly_id: str,
    *,
    verify_transcript: bool = True,
) -> dict[str, Any]:
    root = assembly_root(data_root, campaign_id, session_id, assembly_id)
    manifest, _ = _bounded_json(
        root / "assembly.json",
        _MAX_MANIFEST_BYTES,
        "SESSION_ASSEMBLY_NOT_FOUND",
        "SESSION_ASSEMBLY_MANIFEST_INVALID",
    )
    if (
        manifest.get("schema_version") != ASSEMBLY_SCHEMA_VERSION
        or manifest.get("status") != "completed"
        or manifest.get("assembly_id") != assembly_id
        or manifest.get("campaign_id") != campaign_id
        or manifest.get("session_id") != session_id
        or manifest.get("canonicalization_version") != ASSEMBLY_CANONICALIZATION_VERSION
        or manifest.get("inputs_sha256") != assembly_id
        or manifest.get("timing_policy_version") != TIMING_POLICY_VERSION
        or manifest.get("segment_boundary_policy") != SEGMENT_BOUNDARY_POLICY
        or not isinstance(manifest.get("timeline_fingerprint_sha256"), str)
        or _SHA256.fullmatch(manifest["timeline_fingerprint_sha256"]) is None
        or manifest.get("participant_mapping_schema_version") != "tda_session_participant_mapping_v1"
        or manifest.get("participant_mapping_policy") != "strong_discord_or_manual_v1"
        or not isinstance(manifest.get("participant_mapping_sha256"), str)
        or _SHA256.fullmatch(manifest["participant_mapping_sha256"]) is None
        or not isinstance(manifest.get("transcript_sha256"), str)
        or _SHA256.fullmatch(manifest["transcript_sha256"]) is None
        or isinstance(manifest.get("transcript_size_bytes"), bool)
        or not isinstance(manifest.get("transcript_size_bytes"), int)
        or manifest["transcript_size_bytes"] <= 0
        or manifest["transcript_size_bytes"] > _MAX_TRANSCRIPT_BYTES
        or not isinstance(manifest.get("parts"), list)
        or not 1 <= len(manifest["parts"]) <= _MAX_PARTS
    ):
        raise SessionAssemblyError("SESSION_ASSEMBLY_MANIFEST_INVALID")
    if verify_transcript:
        payload = _bounded_bytes(
            root / "transcript.json",
            _MAX_TRANSCRIPT_BYTES,
            "SESSION_ASSEMBLY_TRANSCRIPT_MISSING",
            "SESSION_ASSEMBLY_TRANSCRIPT_INVALID",
        )
        if len(payload) != manifest["transcript_size_bytes"]:
            raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_SIZE_MISMATCH")
        if _sha256(payload) != manifest["transcript_sha256"]:
            raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_HASH_MISMATCH")
        try:
            transcript = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID") from exc
        if (
            not isinstance(transcript, dict)
            or transcript.get("schema_version") != ASSEMBLY_TRANSCRIPT_SCHEMA_VERSION
            or transcript.get("campaign_id") != campaign_id
            or transcript.get("session_id") != session_id
            or not isinstance(transcript.get("segments"), list)
            or len(transcript["segments"]) != manifest.get("segment_count")
        ):
            raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
    return manifest


def load_session_assembly_transcript(
    data_root: Path,
    campaign_id: str,
    session_id: str,
    assembly_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = load_session_assembly(
        data_root,
        campaign_id,
        session_id,
        assembly_id,
        verify_transcript=False,
    )
    root = assembly_root(data_root, campaign_id, session_id, assembly_id)
    payload = _bounded_bytes(
        root / "transcript.json",
        _MAX_TRANSCRIPT_BYTES,
        "SESSION_ASSEMBLY_TRANSCRIPT_MISSING",
        "SESSION_ASSEMBLY_TRANSCRIPT_INVALID",
    )
    if len(payload) != manifest["transcript_size_bytes"] or _sha256(payload) != manifest["transcript_sha256"]:
        raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_HASH_MISMATCH")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID") from exc
    if (
        not isinstance(value, dict)
        or value.get("schema_version") != ASSEMBLY_TRANSCRIPT_SCHEMA_VERSION
        or value.get("campaign_id") != campaign_id
        or value.get("session_id") != session_id
        or not isinstance(value.get("segments"), list)
    ):
        raise SessionAssemblyError("SESSION_ASSEMBLY_TRANSCRIPT_INVALID")
    return manifest, value


def list_session_assemblies(data_root: Path, campaign_id: str, session_id: str) -> dict[str, Any]:
    root = _assemblies_root(data_root, campaign_id, session_id)
    values: list[dict[str, Any]] = []
    if root.is_dir():
        for candidate in sorted(root.iterdir(), key=lambda item: item.name):
            match = re.fullmatch(r"assembly-([0-9a-f]{64})", candidate.name)
            if (
                match is None
                or not candidate.is_dir()
                or candidate.is_symlink()
                or getattr(candidate, "is_junction", lambda: False)()
                or not (candidate / "assembly.json").is_file()
            ):
                continue
            try:
                manifest = load_session_assembly(
                    data_root,
                    campaign_id,
                    session_id,
                    match.group(1),
                    verify_transcript=True,
                )
            except SessionAssemblyError:
                continue
            values.append(
                {
                    "assembly_id": manifest["assembly_id"],
                    "transcript_sha256": manifest["transcript_sha256"],
                    "inputs_sha256": manifest["inputs_sha256"],
                    "segment_count": manifest["segment_count"],
                    "part_count": len(manifest["parts"]),
                    "participant_approval_blocked": manifest["participant_approval_blocked"],
                    "created_at": manifest["created_at"],
                }
            )
    values.sort(key=lambda item: (str(item["created_at"]), str(item["assembly_id"])), reverse=True)
    return {
        "schema_version": ASSEMBLY_LIST_SCHEMA_VERSION,
        "campaign_id": campaign_id,
        "session_id": session_id,
        "assemblies": values,
    }


def assembly_dependency_for_run(data_root: Path, source_id: str, run_id: str) -> dict[str, str] | None:
    if not isinstance(source_id, str) or _SOURCE.fullmatch(source_id) is None:
        raise SessionAssemblyError("SESSION_ASSEMBLY_SOURCE_INVALID")
    if not isinstance(run_id, str) or _RUN.fullmatch(run_id) is None:
        raise SessionAssemblyError("SESSION_ASSEMBLY_RUN_ID_INVALID")
    root = (data_root.resolve() / "session-assemblies").resolve()
    if not root.is_dir():
        return None
    for campaign_dir in root.iterdir():
        if not campaign_dir.is_dir() or campaign_dir.is_symlink() or _ID.fullmatch(campaign_dir.name) is None:
            continue
        for session_dir in campaign_dir.iterdir():
            if not session_dir.is_dir() or session_dir.is_symlink() or _ID.fullmatch(session_dir.name) is None:
                continue
            for candidate in session_dir.iterdir():
                match = re.fullmatch(r"assembly-([0-9a-f]{64})", candidate.name)
                if match is None or not candidate.is_dir() or candidate.is_symlink():
                    continue
                marker = candidate / "assembly.json"
                if not marker.is_file():
                    continue
                try:
                    manifest = load_session_assembly(
                        data_root,
                        campaign_dir.name,
                        session_dir.name,
                        match.group(1),
                        verify_transcript=False,
                    )
                except SessionAssemblyError as exc:
                    raise SessionAssemblyError("SESSION_ASSEMBLY_DEPENDENCY_STATE_INVALID") from exc
                for part in manifest["parts"]:
                    if (
                        isinstance(part, Mapping)
                        and part.get("source_id") == source_id
                        and part.get("run_id") == run_id
                    ):
                        return {
                            "campaign_id": campaign_dir.name,
                            "session_id": session_dir.name,
                            "assembly_id": manifest["assembly_id"],
                        }
    return None
