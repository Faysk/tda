from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, time, timedelta, timezone
from typing import Any, Iterable

TIMING_POLICY_VERSION = "tda_session_timeline_v2"
SEGMENT_BOUNDARY_POLICY = "segment_start_owner_v1"
_START_CONFIDENCES = frozenset({"trusted_absolute", "ambiguous", "opaque", "missing"})
_TIMELINE_MODES = frozenset({"unresolved", "automatic", "manual", "sequence"})
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
        try:
            time.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return {
                "confidence": "opaque",
                "instant_utc": None,
                "epoch_seconds": None,
            }
        return {
            "confidence": "ambiguous",
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


def project_trusted_absolute_time(
    source_start_time: object,
    confidence: object,
    offset_seconds: object,
) -> str | None:
    """Project a source-local offset onto an explicitly zoned Craig start time.

    The original UTC offset is preserved in the rendered ISO value. Any missing,
    opaque or ambiguous source timestamp stays unavailable instead of borrowing
    the browser/server timezone.
    """
    if confidence != "trusted_absolute":
        return None
    if isinstance(offset_seconds, bool) or not isinstance(offset_seconds, (int, float)):
        return None
    seconds = float(offset_seconds)
    if not math.isfinite(seconds) or seconds < 0:
        return None
    if not isinstance(source_start_time, str):
        return None
    raw = source_start_time.strip()
    classified = classify_start_time(raw)
    if classified["confidence"] != "trusted_absolute":
        return None
    try:
        start = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    projected = start + timedelta(seconds=seconds)
    rendered = projected.isoformat(timespec="milliseconds")
    if raw.endswith("Z") and rendered.endswith("+00:00"):
        rendered = rendered[:-6] + "Z"
    return rendered


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
    if len({epoch for epoch, _, _ in sortable}) != len(sortable):
        raise ValueError("SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS")
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


def user_confirmed_sequence_placements(
    parts: Iterable[dict[str, Any]],
    source_facts: dict[str, dict[str, Any]],
) -> list[dict[str, object]]:
    """Place parts in the user-confirmed order without inventing physical gaps.

    Adjacent trusted Craig timestamps retain their factual relative geometry.
    Every other adjacency is editorially continuous: its physical interval stays
    unknown even though the session timeline itself remains continuous.
    """
    rows = list(parts)
    placements: list[dict[str, object]] = []
    previous_facts: dict[str, Any] | None = None
    previous_offset = 0.0
    previous_duration: float | None = None

    for ordinal, part in enumerate(rows):
        source_id = str(part["source_id"])
        facts = source_facts.get(source_id, {})
        duration = _number(facts.get("duration_seconds"))
        if facts.get("source_state", "invalid") != "ready" or duration is None:
            raise ValueError("SESSION_WORKSPACE_SOURCE_UNAVAILABLE")

        if ordinal == 0:
            offset = 0.0
        else:
            assert previous_facts is not None and previous_duration is not None
            previous_confidence = previous_facts.get("start_confidence")
            current_confidence = facts.get("start_confidence")
            if (
                previous_confidence == "trusted_absolute"
                and current_confidence == "trusted_absolute"
            ):
                previous_epoch = _number(previous_facts.get("start_epoch_seconds"))
                current_epoch = _number(facts.get("start_epoch_seconds"))
                if previous_epoch is None or current_epoch is None:
                    raise ValueError("SESSION_WORKSPACE_TIMELINE_NOT_TRUSTED")
                delta_from_previous_start = current_epoch - previous_epoch
                if delta_from_previous_start < -_EPSILON:
                    raise ValueError("SESSION_WORKSPACE_TIMELINE_ORDER_CONFLICT")
                offset = previous_offset + max(0.0, delta_from_previous_start)
            else:
                offset = previous_offset + previous_duration

        placements.append(
            {
                "part_id": str(part["part_id"]),
                "source_id": source_id,
                "ordinal": ordinal,
                "session_offset_seconds": offset,
            }
        )
        previous_facts = facts
        previous_offset = offset
        previous_duration = duration

    return placements


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


def _timeline_strategy(parts: list[dict[str, Any]]) -> str:
    if not parts:
        return "unresolved"
    modes = [str(part.get("timeline_mode", "unresolved")) for part in parts]
    if all(mode == "automatic" for mode in modes):
        return "trusted_absolute"
    if all(mode == "sequence" for mode in modes):
        return "user_confirmed_sequence"
    if all(mode in {"automatic", "sequence", "manual"} for mode in modes) and any(
        mode == "manual" for mode in modes
    ):
        return "manual_offsets"
    return "unresolved"


def enrich_workspace_timeline(
    workspace: dict[str, Any],
    source_facts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    raw_parts = list(workspace.get("parts", []))
    strategy = _timeline_strategy(raw_parts)
    enriched_parts: list[dict[str, Any]] = []
    gap_count = 0
    overlap_count = 0
    unresolved_overlap_count = 0
    unconfirmed_gap_count = 0
    order_conflict_count = 0
    unknown_interval_count = 0
    source_invalid = False
    needs_timing = not bool(raw_parts)
    all_sources_trusted = bool(raw_parts)
    trusted_epochs: list[float] = []
    trusted_source_count = 0

    previous: dict[str, Any] | None = None
    for part in raw_parts:
        source_id = str(part["source_id"])
        facts = source_facts.get(source_id, {})
        source_state = facts.get("source_state", "invalid")
        start_confidence = facts.get("start_confidence", "missing")
        if start_confidence not in _START_CONFIDENCES:
            start_confidence = "opaque"
        all_sources_trusted = (
            all_sources_trusted and start_confidence == "trusted_absolute"
        )
        start_epoch = _number(facts.get("start_epoch_seconds"))
        if start_confidence == "trusted_absolute" and start_epoch is not None:
            trusted_epochs.append(start_epoch)
            trusted_source_count += 1
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
        if offset is None or duration is None or mode == "unresolved":
            needs_timing = True

        effective_start = offset + trim_start if offset is not None else None
        local_end = trim_end if trim_end is not None else duration
        effective_end = (
            offset + local_end
            if offset is not None and local_end is not None
            else None
        )

        relation = "first" if previous is None else "unknown"
        relation_seconds: float | None = 0.0 if previous is None else None
        overlap_resolution_valid = False
        physical_interval_state = "first"
        if previous is not None:
            previous_mode = previous.get("timeline_mode", "unresolved")
            if mode == "manual" or previous_mode == "manual":
                physical_interval_state = "manual"
            elif (
                start_confidence == "trusted_absolute"
                and previous.get("source_start_confidence") == "trusted_absolute"
            ):
                physical_interval_state = "trusted_absolute"
            else:
                physical_interval_state = "unknown"
                unknown_interval_count += 1

            previous_start = previous.get("effective_start_seconds")
            previous_end = previous.get("effective_end_seconds")
            if (
                effective_start is not None
                and effective_end is not None
                and previous_start is not None
                and previous_end is not None
            ):
                previous_start_value = float(previous_start)
                previous_end_value = float(previous_end)
                delta = effective_start - previous_end_value
                if delta > _EPSILON:
                    relation = "gap"
                    relation_seconds = delta
                    gap_count += 1
                    factual_gap = physical_interval_state == "trusted_absolute"
                    if not factual_gap and part.get("gap_confirmed") is not True:
                        unconfirmed_gap_count += 1
                elif abs(delta) <= _EPSILON:
                    relation = "contiguous"
                    relation_seconds = (
                        None if physical_interval_state == "unknown" else 0.0
                    )
                else:
                    overlap_start = max(previous_start_value, effective_start)
                    overlap_end = min(previous_end_value, effective_end)
                    if overlap_end <= overlap_start + _EPSILON:
                        relation = "order_conflict"
                        relation_seconds = None
                        order_conflict_count += 1
                    else:
                        relation = "overlap"
                        relation_seconds = overlap_end - overlap_start
                        overlap_count += 1
                        policy = part.get("overlap_resolution")
                        boundary = _number(part.get("overlap_boundary_seconds"))
                        overlap_resolution_valid = (
                            policy in _OVERLAP_RESOLUTIONS
                            and boundary is not None
                            and overlap_start - _EPSILON <= boundary <= overlap_end + _EPSILON
                        )
                        if not overlap_resolution_valid:
                            unresolved_overlap_count += 1

        enriched = {
            **part,
            "timeline_mode": mode,
            "source_state": source_state,
            "source_start_time": facts.get("start_time"),
            "source_start_confidence": start_confidence,
            "source_start_utc": facts.get("start_utc"),
            "source_duration_seconds": duration,
            "effective_start_seconds": effective_start,
            "effective_end_seconds": effective_end,
            "relation_to_previous": relation,
            "relation_seconds": relation_seconds,
            "physical_interval_state": physical_interval_state,
            "gap_confirmed": bool(part.get("gap_confirmed", False)),
            "overlap_resolution_valid": overlap_resolution_valid,
        }
        enriched_parts.append(enriched)
        previous = enriched

    if trusted_source_count == 0:
        wall_clock = "unavailable"
    elif trusted_source_count == len(raw_parts):
        wall_clock = "trusted"
    else:
        wall_clock = "partial"

    fingerprint_payload = {
        "schema_version": TIMING_POLICY_VERSION,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "campaign_id": workspace.get("campaign_id"),
        "session_id": workspace.get("session_id"),
        "ordering_mode": workspace.get("ordering_mode", "attachment"),
        "timeline_strategy": strategy,
        "wall_clock": wall_clock,
        "unknown_intervals": unknown_interval_count,
        "parts": [
            {
                "part_id": part.get("part_id"),
                "source_id": part.get("source_id"),
                "ordinal": part.get("ordinal"),
                "timeline_mode": part.get("timeline_mode", "unresolved"),
                "session_offset_seconds": part.get("session_offset_seconds"),
                "trim_start_seconds": part.get("trim_start_seconds", 0.0),
                "trim_end_seconds": part.get("trim_end_seconds"),
                "physical_interval_state": part.get("physical_interval_state"),
                "gap_confirmed": bool(part.get("gap_confirmed", False)),
                "overlap_resolution": part.get("overlap_resolution"),
                "overlap_boundary_seconds": part.get("overlap_boundary_seconds"),
            }
            for part in enriched_parts
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

    automatic_order_available = (
        all_sources_trusted
        and len(trusted_epochs) == len(raw_parts)
        and len(set(trusted_epochs)) == len(trusted_epochs)
    )

    if strategy == "unresolved" and len(raw_parts) > 1:
        needs_timing = True

    if source_invalid:
        state = "source_invalid"
    elif needs_timing:
        state = "needs_timing"
    elif order_conflict_count:
        state = "order_conflict"
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
            "strategy": strategy,
            "wall_clock": wall_clock,
            "unknown_interval_count": unknown_interval_count,
            "all_sources_trusted": all_sources_trusted,
            "automatic_order_available": automatic_order_available,
            "gap_count": gap_count,
            "overlap_count": overlap_count,
            "order_conflict_count": order_conflict_count,
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
