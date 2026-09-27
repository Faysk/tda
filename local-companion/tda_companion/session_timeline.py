from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any, Iterable

TIMING_POLICY_VERSION = "tda_session_timeline_v1"
SEGMENT_BOUNDARY_POLICY = "segment_start_owner_v1"
_START_CONFIDENCES = frozenset({"trusted_absolute", "ambiguous", "opaque", "missing"})
_TIMELINE_MODES = frozenset({"unresolved", "automatic", "manual"})
_OVERLAP_RESOLUTIONS = frozenset({"prefer_earlier_until", "prefer_later_from"})
_EPSILON = 1e-9


def classify_start_time(value: object) -> dict[str, object | None]:
    if value is None:
        return {
            "confidence": "missing",
            "instant_utc": None,
            "epoch_seconds": None,
        }
    if not isinstance(value, str):
        return {
            "confidence": "opaque",
            "instant_utc": None,
            "epoch_seconds": None,
        }
    raw = value.strip()
    if not raw:
        return {
            "confidence": "missing",
            "instant_utc": None,
            "epoch_seconds": None,
        }
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return {
            "confidence": "opaque",
            "instant_utc": None,
            "epoch_seconds": None,
        }
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return {
            "confidence": "ambiguous",
            "instant_utc": None,
            "epoch_seconds": None,
        }
    resolved = parsed.astimezone(timezone.utc)
    return {
        "confidence": "trusted_absolute",
        "instant_utc": resolved.isoformat().replace("+00:00", "Z"),
        "epoch_seconds": resolved.timestamp(),
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
            or float(duration) < 0
            or isinstance(offset, bool)
            or not isinstance(offset, (int, float))
            or not math.isfinite(float(offset))
            or float(offset) < 0
        ):
            return None
        extent = max(extent, float(offset) + float(duration))
    return extent


def automatic_placements(
    parts: Iterable[dict[str, Any]],
    source_facts: dict[str, dict[str, Any]],
) -> list[dict[str, object]]:
    rows = list(parts)
    if not rows:
        return []
    sortable: list[tuple[float, str, str]] = []
    for part in rows:
        facts = source_facts.get(str(part["source_id"]), {})
        if facts.get("start_confidence") != "trusted_absolute":
            raise ValueError("SESSION_WORKSPACE_TIMELINE_NOT_TRUSTED")
        epoch = facts.get("start_epoch_seconds")
        if (
            isinstance(epoch, bool)
            or not isinstance(epoch, (int, float))
            or not math.isfinite(float(epoch))
        ):
            raise ValueError("SESSION_WORKSPACE_TIMELINE_NOT_TRUSTED")
        sortable.append((float(epoch), str(part["part_id"]), str(part["source_id"])))
    sortable.sort()
    anchor = sortable[0][0]
    return [
        {
            "part_id": part_id,
            "source_id": source_id,
            "ordinal": ordinal,
            "session_offset_seconds": epoch - anchor,
        }
        for ordinal, (epoch, part_id, source_id) in enumerate(sortable)
    ]


def _number(value: object) -> float | None:
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
    ):
        return None
    return float(value)


def enrich_workspace_timeline(
    workspace: dict[str, Any],
    source_facts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    enriched_parts: list[dict[str, Any]] = []
    gap_count = 0
    overlap_count = 0
    unresolved_overlap_count = 0
    unconfirmed_gap_count = 0
    source_invalid = False
    needs_timing = not bool(workspace.get("parts"))
    all_sources_trusted = bool(workspace.get("parts"))

    previous: dict[str, Any] | None = None
    for part in workspace.get("parts", []):
        source_id = str(part["source_id"])
        facts = source_facts.get(source_id, {})
        source_state = facts.get("source_state", "invalid")
        start_confidence = facts.get("start_confidence", "missing")
        if start_confidence not in _START_CONFIDENCES:
            start_confidence = "opaque"
        all_sources_trusted = (
            all_sources_trusted and start_confidence == "trusted_absolute"
        )
        if source_state != "ready":
            source_invalid = True

        mode = part.get("timeline_mode", "unresolved")
        if mode not in _TIMELINE_MODES:
            mode = "unresolved"
        offset = _number(part.get("session_offset_seconds"))
        trim_start = _number(part.get("trim_start_seconds"))
        if trim_start is None or trim_start < 0:
            trim_start = 0.0
        trim_end = _number(part.get("trim_end_seconds"))
        duration = _number(facts.get("duration_seconds"))
        if offset is None or duration is None:
            needs_timing = True

        effective_start = (
            offset + trim_start if offset is not None else None
        )
        local_end = trim_end if trim_end is not None else duration
        effective_end = (
            offset + local_end
            if offset is not None and local_end is not None
            else None
        )

        relation = "first" if previous is None else "unknown"
        relation_seconds: float | None = 0.0 if previous is None else None
        overlap_resolution_valid = False
        if previous is not None:
            previous_end = previous.get("effective_end_seconds")
            if effective_start is not None and previous_end is not None:
                delta = effective_start - float(previous_end)
                if delta > _EPSILON:
                    relation = "gap"
                    relation_seconds = delta
                    gap_count += 1
                    if part.get("gap_confirmed") is not True:
                        unconfirmed_gap_count += 1
                elif delta < -_EPSILON:
                    relation = "overlap"
                    relation_seconds = -delta
                    overlap_count += 1
                    policy = part.get("overlap_resolution")
                    boundary = _number(part.get("overlap_boundary_seconds"))
                    overlap_start = effective_start
                    overlap_end = float(previous_end)
                    overlap_resolution_valid = (
                        policy in _OVERLAP_RESOLUTIONS
                        and boundary is not None
                        and overlap_start - _EPSILON <= boundary <= overlap_end + _EPSILON
                    )
                    if not overlap_resolution_valid:
                        unresolved_overlap_count += 1
                else:
                    relation = "contiguous"
                    relation_seconds = 0.0

        enriched = {
            **part,
            "source_state": source_state,
            "source_start_time": facts.get("start_time"),
            "source_start_confidence": start_confidence,
            "source_start_utc": facts.get("start_utc"),
            "source_duration_seconds": duration,
            "effective_start_seconds": effective_start,
            "effective_end_seconds": effective_end,
            "relation_to_previous": relation,
            "relation_seconds": relation_seconds,
            "gap_confirmed": bool(part.get("gap_confirmed", False)),
            "overlap_resolution_valid": overlap_resolution_valid,
        }
        enriched_parts.append(enriched)
        previous = enriched

    fingerprint_payload = {
        "schema_version": TIMING_POLICY_VERSION,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "campaign_id": workspace.get("campaign_id"),
        "session_id": workspace.get("session_id"),
        "ordering_mode": workspace.get("ordering_mode", "attachment"),
        "parts": [
            {
                "part_id": part.get("part_id"),
                "source_id": part.get("source_id"),
                "ordinal": part.get("ordinal"),
                "timeline_mode": part.get("timeline_mode", "unresolved"),
                "session_offset_seconds": part.get("session_offset_seconds"),
                "trim_start_seconds": part.get("trim_start_seconds", 0.0),
                "trim_end_seconds": part.get("trim_end_seconds"),
                "gap_confirmed": bool(part.get("gap_confirmed", False)),
                "overlap_resolution": part.get("overlap_resolution"),
                "overlap_boundary_seconds": part.get("overlap_boundary_seconds"),
            }
            for part in workspace.get("parts", [])
        ],
    }
    fingerprint = hashlib.sha256(
        json.dumps(
            fingerprint_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    if source_invalid:
        state = "source_invalid"
    elif needs_timing:
        state = "needs_timing"
    elif unresolved_overlap_count:
        state = "overlap_unresolved"
    elif unconfirmed_gap_count:
        state = "gap_unconfirmed"
    else:
        state = "ready"

    return {
        **workspace,
        "parts": enriched_parts,
        "timeline": {
            "policy_version": TIMING_POLICY_VERSION,
            "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
            "fingerprint_sha256": fingerprint,
            "state": state,
            "all_sources_trusted": all_sources_trusted,
            "automatic_order_available": all_sources_trusted,
            "gap_count": gap_count,
            "overlap_count": overlap_count,
            "unresolved_overlap_count": unresolved_overlap_count,
            "unconfirmed_gap_count": unconfirmed_gap_count,
        },
    }


def validate_overlap_boundary(
    enriched_workspace: dict[str, Any],
    part_id: str,
) -> None:
    for part in enriched_workspace.get("parts", []):
        if part.get("part_id") != part_id:
            continue
        if part.get("overlap_resolution") is None:
            return
        if part.get("relation_to_previous") != "overlap":
            raise ValueError("SESSION_WORKSPACE_OVERLAP_RESOLUTION_INVALID")
        if part.get("overlap_resolution_valid") is not True:
            raise ValueError("SESSION_WORKSPACE_OVERLAP_BOUNDARY_INVALID")
        return
    raise ValueError("SESSION_WORKSPACE_PART_NOT_FOUND")


def segment_owner_at_boundary(
    segment_global_start_seconds: object,
    boundary_seconds: object,
) -> str:
    start = _number(segment_global_start_seconds)
    boundary = _number(boundary_seconds)
    if (
        start is None
        or boundary is None
        or start < 0
        or boundary < 0
    ):
        raise ValueError("SESSION_WORKSPACE_SEGMENT_BOUNDARY_INVALID")
    return "earlier" if start < boundary else "later"
