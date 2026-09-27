from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Mapping

TIMELINE_SCHEMA_VERSION = "tda_session_timeline_v1"
SEGMENT_BOUNDARY_POLICY = "segment_start_v1"
OVERLAP_POLICY = "split_boundary_v1"
_EPSILON_SECONDS = 1e-6


def classify_start_time(value: object) -> dict[str, object]:
    if value is None:
        return {"classification": "missing", "raw": None, "epoch_seconds": None}
    if not isinstance(value, str) or not value.strip():
        return {"classification": "opaque", "raw": None, "epoch_seconds": None}
    raw = value.strip()
    if len(raw) > 128:
        return {"classification": "opaque", "raw": raw[:128], "epoch_seconds": None}
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return {"classification": "opaque", "raw": raw, "epoch_seconds": None}
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return {"classification": "ambiguous", "raw": raw, "epoch_seconds": None}
    epoch = parsed.astimezone(timezone.utc).timestamp()
    if not math.isfinite(epoch):
        return {"classification": "opaque", "raw": raw, "epoch_seconds": None}
    return {
        "classification": "trusted_absolute",
        "raw": raw,
        "epoch_seconds": epoch,
    }


def package_duration_seconds(package: object) -> float | None:
    tracks = getattr(package, "tracks", None)
    if not isinstance(tracks, (list, tuple)) or not tracks:
        return None
    extent = 0.0
    for track in tracks:
        duration = getattr(track, "duration_seconds", None)
        offset = getattr(track, "timeline_offset_seconds", 0.0)
        if (
            isinstance(duration, bool)
            or not isinstance(duration, (int, float))
            or not math.isfinite(float(duration))
            or duration < 0
            or isinstance(offset, bool)
            or not isinstance(offset, (int, float))
            or not math.isfinite(float(offset))
            or offset < 0
        ):
            return None
        extent = max(extent, float(offset) + float(duration))
    return extent


def segment_owner_for_boundary(
    segment_start: float,
    segment_end: float,
    boundary_seconds: float,
) -> str:
    values = (segment_start, segment_end, boundary_seconds)
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        for value in values
    ):
        raise ValueError("SESSION_TIMELINE_SEGMENT_INVALID")
    if segment_start < 0 or segment_end < segment_start or boundary_seconds < 0:
        raise ValueError("SESSION_TIMELINE_SEGMENT_INVALID")
    # Versioned ownership rule: a crossing segment remains whole and belongs to
    # the side containing its start. A segment starting exactly at the boundary
    # belongs to the later part. Raw run timestamps are never rewritten.
    return "earlier" if segment_start < boundary_seconds else "later"


def _nullable_non_negative(value: object) -> float | None:
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        or value < 0
    ):
        raise ValueError("SESSION_TIMELINE_CONFIGURATION_INVALID")
    return float(value)


def _part_projection(
    part: Mapping[str, object],
    package: object | None,
) -> dict[str, object]:
    evidence = classify_start_time(getattr(package, "start_time", None) if package else None)
    duration = package_duration_seconds(package) if package is not None else None
    manual_offset = _nullable_non_negative(part.get("manual_offset_seconds"))
    trim_start = _nullable_non_negative(part.get("trim_start_seconds"))
    trim_end = _nullable_non_negative(part.get("trim_end_seconds"))
    boundary = _nullable_non_negative(part.get("overlap_boundary_seconds"))
    gap_confirmed = part.get("gap_confirmed", False)
    if not isinstance(gap_confirmed, bool):
        raise ValueError("SESSION_TIMELINE_CONFIGURATION_INVALID")

    trim_start_value = trim_start or 0.0
    configuration_valid = True
    if duration is not None:
        effective_local_end = duration if trim_end is None else trim_end
        if trim_start_value > effective_local_end or effective_local_end > duration + _EPSILON_SECONDS:
            configuration_valid = False
    else:
        effective_local_end = trim_end
        if trim_end is not None and trim_start_value > trim_end:
            configuration_valid = False

    return {
        "part_id": part["part_id"],
        "source_id": part["source_id"],
        "workspace_ordinal": part["ordinal"],
        "source_state": part.get("source_state", "ready" if package is not None else "invalid"),
        "start_time": evidence,
        "duration_seconds": duration,
        "manual_offset_seconds": manual_offset,
        "trim_start_seconds": trim_start,
        "trim_end_seconds": trim_end,
        "gap_confirmed": gap_confirmed,
        "overlap_boundary_seconds": boundary,
        "configuration_valid": configuration_valid,
        "_local_start": trim_start_value,
        "_local_end": effective_local_end,
    }


def build_session_timeline(
    workspace: Mapping[str, object],
    packages_by_source: Mapping[str, object | None],
) -> dict[str, object]:
    if workspace.get("schema_version") != "tda_session_workspace_v1":
        raise ValueError("SESSION_TIMELINE_WORKSPACE_INVALID")
    parts_value = workspace.get("parts")
    if not isinstance(parts_value, list) or len(parts_value) > 64:
        raise ValueError("SESSION_TIMELINE_WORKSPACE_INVALID")
    chronology_mode = workspace.get("chronology_mode", "automatic")
    if chronology_mode not in {"automatic", "manual"}:
        raise ValueError("SESSION_TIMELINE_WORKSPACE_INVALID")

    projected = [
        _part_projection(part, packages_by_source.get(str(part["source_id"])))
        for part in parts_value
        if isinstance(part, Mapping)
    ]
    if len(projected) != len(parts_value):
        raise ValueError("SESSION_TIMELINE_WORKSPACE_INVALID")

    trusted_epochs = [
        float(part["start_time"]["epoch_seconds"])
        for part in projected
        if part["start_time"]["classification"] == "trusted_absolute"
        and part["start_time"]["epoch_seconds"] is not None
    ]
    automatic_anchor = min(trusted_epochs) if trusted_epochs else None

    for part in projected:
        placement_authority = "unresolved"
        base_offset: float | None = None
        if chronology_mode == "manual":
            manual_offset = part["manual_offset_seconds"]
            if isinstance(manual_offset, float):
                base_offset = manual_offset
                placement_authority = "manual"
        elif (
            part["start_time"]["classification"] == "trusted_absolute"
            and automatic_anchor is not None
        ):
            base_offset = float(part["start_time"]["epoch_seconds"]) - automatic_anchor
            placement_authority = "trusted_absolute"

        local_start = float(part["_local_start"])
        local_end = part["_local_end"]
        if (
            base_offset is None
            or local_end is None
            or not bool(part["configuration_valid"])
            or part["source_state"] != "ready"
        ):
            effective_start = None
            effective_end = None
        else:
            effective_start = base_offset + local_start
            effective_end = base_offset + float(local_end)

        part["placement_authority"] = placement_authority
        part["session_offset_seconds"] = base_offset
        part["effective_start_seconds"] = effective_start
        part["effective_end_seconds"] = effective_end

    if chronology_mode == "automatic":
        ordered = sorted(
            projected,
            key=lambda part: (
                part["effective_start_seconds"] is None,
                float(part["effective_start_seconds"])
                if part["effective_start_seconds"] is not None
                else math.inf,
                int(part["workspace_ordinal"]),
                str(part["part_id"]),
            ),
        )
    else:
        ordered = sorted(
            projected,
            key=lambda part: (int(part["workspace_ordinal"]), str(part["part_id"])),
        )

    for index, part in enumerate(ordered):
        part["timeline_ordinal"] = index

    relations: list[dict[str, object]] = []
    approval_blocked = any(
        part["effective_start_seconds"] is None
        or part["effective_end_seconds"] is None
        or not bool(part["configuration_valid"])
        for part in ordered
    )

    for earlier, later in zip(ordered, ordered[1:]):
        earlier_end = earlier["effective_end_seconds"]
        later_start = later["effective_start_seconds"]
        relation: dict[str, object] = {
            "earlier_part_id": earlier["part_id"],
            "later_part_id": later["part_id"],
            "kind": "unresolved",
            "seconds": None,
            "resolved": False,
            "resolution": None,
        }
        if earlier_end is None or later_start is None:
            approval_blocked = True
            relations.append(relation)
            continue

        delta = float(later_start) - float(earlier_end)
        if abs(delta) <= _EPSILON_SECONDS:
            relation.update({"kind": "contiguous", "seconds": 0.0, "resolved": True})
        elif delta > 0:
            confirmed = bool(later["gap_confirmed"])
            relation.update(
                {
                    "kind": "gap",
                    "seconds": delta,
                    "resolved": confirmed,
                    "resolution": "confirmed_gap_v1" if confirmed else None,
                }
            )
            if not confirmed:
                approval_blocked = True
        else:
            overlap_seconds = -delta
            overlap_start = max(
                float(earlier["effective_start_seconds"]),
                float(later["effective_start_seconds"]),
            )
            overlap_end = min(
                float(earlier["effective_end_seconds"]),
                float(later["effective_end_seconds"]),
            )
            boundary = later["overlap_boundary_seconds"]
            boundary_valid = (
                isinstance(boundary, float)
                and overlap_start - _EPSILON_SECONDS
                <= boundary
                <= overlap_end + _EPSILON_SECONDS
            )
            relation.update(
                {
                    "kind": "overlap",
                    "seconds": overlap_seconds,
                    "resolved": boundary_valid,
                    "resolution": OVERLAP_POLICY if boundary_valid else None,
                    "boundary_seconds": boundary if boundary_valid else None,
                }
            )
            if not boundary_valid:
                approval_blocked = True
        relations.append(relation)

    public_parts = []
    for part in ordered:
        public_parts.append(
            {
                key: value
                for key, value in part.items()
                if not key.startswith("_")
            }
        )

    canonical_configuration = {
        "schema_version": TIMELINE_SCHEMA_VERSION,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "overlap_policy": OVERLAP_POLICY,
        "chronology_mode": chronology_mode,
        "parts": [
            {
                "part_id": part["part_id"],
                "source_id": part["source_id"],
                "workspace_ordinal": part["workspace_ordinal"],
                "timeline_ordinal": part["timeline_ordinal"],
                "start_time_classification": part["start_time"]["classification"],
                "start_time_raw": part["start_time"]["raw"],
                "duration_seconds": part["duration_seconds"],
                "manual_offset_seconds": part["manual_offset_seconds"],
                "trim_start_seconds": part["trim_start_seconds"],
                "trim_end_seconds": part["trim_end_seconds"],
                "gap_confirmed": part["gap_confirmed"],
                "overlap_boundary_seconds": part["overlap_boundary_seconds"],
            }
            for part in public_parts
        ],
    }
    encoded = json.dumps(
        canonical_configuration,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")

    return {
        "schema_version": TIMELINE_SCHEMA_VERSION,
        "campaign_id": workspace["campaign_id"],
        "session_id": workspace["session_id"],
        "workspace_revision": workspace["revision"],
        "chronology_mode": chronology_mode,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "overlap_policy": OVERLAP_POLICY,
        "configuration_sha256": hashlib.sha256(encoded).hexdigest(),
        "approval_blocked": approval_blocked,
        "parts": public_parts,
        "relations": relations,
    }
