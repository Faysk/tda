from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Mapping


CHRONOLOGY_SCHEMA = "tda_session_chronology_v1"
TIMING_SCHEMA = "tda_session_part_timing_v1"
OVERLAP_SCHEMA = "tda_session_overlap_resolution_v1"
CANONICALIZATION_VERSION = "session_timing_v1"
_EPSILON_SECONDS = 1e-9


class SessionChronologyError(ValueError):
    pass


def _seconds(value, code: str, *, nullable: bool = False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SessionChronologyError(code)
    parsed = float(value)
    if not math.isfinite(parsed) or parsed < 0:
        raise SessionChronologyError(code)
    return parsed


def default_session_part_timing() -> dict[str, object]:
    return {
        "schema_version": TIMING_SCHEMA,
        "mode": "automatic",
        "session_offset_seconds": None,
        "trim_start_seconds": 0.0,
        "trim_end_seconds": None,
        "gap_confirmed": False,
        "overlap_resolution": None,
    }


def canonical_session_part_timing(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
    allowed = {
        "schema_version",
        "mode",
        "session_offset_seconds",
        "trim_start_seconds",
        "trim_end_seconds",
        "gap_confirmed",
        "overlap_resolution",
    }
    if set(value) - allowed:
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
    if value.get("schema_version") != TIMING_SCHEMA:
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
    mode = value.get("mode")
    if mode not in {"automatic", "manual"}:
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
    offset = _seconds(
        value.get("session_offset_seconds"),
        "SESSION_WORKSPACE_TIMING_INVALID",
        nullable=True,
    )
    if mode == "automatic" and offset is not None:
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
    if mode == "manual" and offset is None:
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
    trim_start = _seconds(
        value.get("trim_start_seconds", 0.0),
        "SESSION_WORKSPACE_TIMING_INVALID",
    )
    trim_end = _seconds(
        value.get("trim_end_seconds"),
        "SESSION_WORKSPACE_TIMING_INVALID",
        nullable=True,
    )
    if trim_end is not None and trim_end <= trim_start:
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
    gap_confirmed = value.get("gap_confirmed", False)
    if not isinstance(gap_confirmed, bool):
        raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")

    raw_resolution = value.get("overlap_resolution")
    resolution = None
    if raw_resolution is not None:
        if not isinstance(raw_resolution, dict):
            raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
        allowed_resolution = {"schema_version", "policy", "boundary_seconds"}
        if set(raw_resolution) - allowed_resolution:
            raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
        if raw_resolution.get("schema_version") != OVERLAP_SCHEMA:
            raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
        policy = raw_resolution.get("policy")
        if policy not in {"prefer_earlier_until", "prefer_later_from"}:
            raise SessionChronologyError("SESSION_WORKSPACE_TIMING_INVALID")
        resolution = {
            "schema_version": OVERLAP_SCHEMA,
            "policy": policy,
            "boundary_seconds": _seconds(
                raw_resolution.get("boundary_seconds"),
                "SESSION_WORKSPACE_TIMING_INVALID",
            ),
        }

    return {
        "schema_version": TIMING_SCHEMA,
        "mode": mode,
        "session_offset_seconds": offset,
        "trim_start_seconds": trim_start,
        "trim_end_seconds": trim_end,
        "gap_confirmed": gap_confirmed,
        "overlap_resolution": resolution,
    }


def classify_start_time(value: object) -> dict[str, object]:
    if not isinstance(value, str) or not value.strip():
        return {
            "confidence": "missing",
            "normalized_utc": None,
            "epoch_seconds": None,
        }
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return {
            "confidence": "opaque",
            "normalized_utc": None,
            "epoch_seconds": None,
        }
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return {
            "confidence": "ambiguous",
            "normalized_utc": None,
            "epoch_seconds": None,
        }
    utc = parsed.astimezone(timezone.utc)
    return {
        "confidence": "trusted_absolute",
        "normalized_utc": utc.isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "epoch_seconds": utc.timestamp(),
    }


def package_duration_seconds(package: object) -> float | None:
    tracks = getattr(package, "tracks", None)
    if not isinstance(tracks, (list, tuple)) or not tracks:
        return None
    ends: list[float] = []
    for track in tracks:
        offset = getattr(track, "timeline_offset_seconds", 0.0)
        duration = getattr(track, "duration_seconds", None)
        if (
            isinstance(offset, bool)
            or not isinstance(offset, (int, float))
            or not math.isfinite(float(offset))
            or float(offset) < 0
            or isinstance(duration, bool)
            or not isinstance(duration, (int, float))
            or not math.isfinite(float(duration))
            or float(duration) < 0
        ):
            return None
        ends.append(float(offset) + float(duration))
    return max(ends) if ends else None


def _config_hash(parts: list[dict[str, object]], order_provenance: str) -> str:
    payload = {
        "schema_version": CHRONOLOGY_SCHEMA,
        "canonicalization_version": CANONICALIZATION_VERSION,
        "order_provenance": order_provenance,
        "parts": [
            {
                "part_id": part["part_id"],
                "source_id": part["source_id"],
                "ordinal": part["ordinal"],
                "timing": part["timing"],
            }
            for part in parts
        ],
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _part_id(value: object) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 32
        or any(char not in "0123456789abcdef" for char in value)
    ):
        raise SessionChronologyError("SESSION_WORKSPACE_PART_INVALID")
    return value


def build_session_chronology(
    parts: list[dict[str, object]],
    packages: Mapping[str, object | None],
    *,
    order_provenance: str = "attached",
) -> dict[str, object]:
    if order_provenance not in {"attached", "manual"}:
        raise SessionChronologyError("SESSION_WORKSPACE_ORDER_PROVENANCE_INVALID")
    if len(parts) > 64:
        raise SessionChronologyError("SESSION_WORKSPACE_ORDER_INVALID")

    normalized: list[dict[str, object]] = []
    seen_parts: set[str] = set()
    seen_sources: set[str] = set()
    for expected_ordinal, raw_part in enumerate(parts):
        part_id = _part_id(raw_part.get("part_id"))
        source_id = raw_part.get("source_id")
        ordinal = raw_part.get("ordinal")
        if (
            part_id in seen_parts
            or not isinstance(source_id, str)
            or source_id in seen_sources
            or isinstance(ordinal, bool)
            or not isinstance(ordinal, int)
            or ordinal != expected_ordinal
        ):
            raise SessionChronologyError("SESSION_WORKSPACE_ORDER_INVALID")
        seen_parts.add(part_id)
        seen_sources.add(source_id)
        timing = canonical_session_part_timing(
            raw_part.get("timing", default_session_part_timing())
        )
        package = packages.get(source_id)
        evidence = classify_start_time(
            getattr(package, "start_time", None) if package is not None else None
        )
        duration = package_duration_seconds(package) if package is not None else None
        normalized.append(
            {
                "part_id": part_id,
                "source_id": source_id,
                "ordinal": ordinal,
                "timing": timing,
                "source_ready": package is not None,
                "start_time_confidence": evidence["confidence"],
                "start_time_utc": evidence["normalized_utc"],
                "_start_epoch": evidence["epoch_seconds"],
                "local_duration_seconds": duration,
            }
        )

    automatic_epochs = [
        float(part["_start_epoch"])
        for part in normalized
        if part["timing"]["mode"] == "automatic"
        and part["_start_epoch"] is not None
    ]
    automatic_origin = min(automatic_epochs) if automatic_epochs else None
    single_part = len(normalized) == 1

    blocking: set[str] = set()
    computed: list[dict[str, object]] = []
    for part in normalized:
        timing = part["timing"]
        assert isinstance(timing, dict)
        offset = timing["session_offset_seconds"]
        if timing["mode"] == "automatic":
            if single_part:
                offset = 0.0
            elif part["_start_epoch"] is not None and automatic_origin is not None:
                offset = float(part["_start_epoch"]) - automatic_origin
            else:
                offset = None
        duration = part["local_duration_seconds"]
        trim_start = float(timing["trim_start_seconds"])
        trim_end = timing["trim_end_seconds"]
        effective_start = None
        effective_end = None
        if not part["source_ready"]:
            blocking.add("source_invalid")
        if duration is None:
            blocking.add("duration_unknown")
        elif (
            trim_start > float(duration) + _EPSILON_SECONDS
            or (trim_end is not None and float(trim_end) > float(duration) + _EPSILON_SECONDS)
        ):
            blocking.add("timing_out_of_bounds")
        elif offset is None:
            blocking.add("offset_unknown")
        else:
            local_end = float(duration) if trim_end is None else float(trim_end)
            effective_start = float(offset) + trim_start
            effective_end = float(offset) + local_end

        computed.append(
            {
                "part_id": part["part_id"],
                "source_id": part["source_id"],
                "ordinal": part["ordinal"],
                "start_time_confidence": part["start_time_confidence"],
                "start_time_utc": part["start_time_utc"],
                "local_duration_seconds": duration,
                "session_offset_seconds": offset,
                "trim_start_seconds": timing["trim_start_seconds"],
                "trim_end_seconds": timing["trim_end_seconds"],
                "effective_start_seconds": effective_start,
                "effective_end_seconds": effective_end,
                "timeline_ordinal": None,
                "relation_to_previous": None,
                "_timing": timing,
            }
        )

    suggested_order = None
    if normalized and all(part["_start_epoch"] is not None for part in normalized):
        suggested_order = [
            part["part_id"]
            for part in sorted(
                normalized,
                key=lambda part: (
                    float(part["_start_epoch"]),
                    int(part["ordinal"]),
                    str(part["part_id"]),
                ),
            )
        ]

    all_positioned = bool(computed) and all(
        part["effective_start_seconds"] is not None
        and part["effective_end_seconds"] is not None
        for part in computed
    )
    resolved_order = None
    ordered: list[dict[str, object]] = []
    if all_positioned:
        if order_provenance == "manual":
            ordered = list(computed)
            starts = [float(part["effective_start_seconds"]) for part in ordered]
            if any(
                starts[index] + _EPSILON_SECONDS < starts[index - 1]
                for index in range(1, len(starts))
            ):
                blocking.add("manual_order_conflicts_with_offsets")
        else:
            ordered = sorted(
                computed,
                key=lambda part: (
                    float(part["effective_start_seconds"]),
                    int(part["ordinal"]),
                    str(part["part_id"]),
                ),
            )
        resolved_order = [str(part["part_id"]) for part in ordered]
        for index, part in enumerate(ordered):
            part["timeline_ordinal"] = index

        prior: list[dict[str, object]] = []
        for index, current in enumerate(ordered):
            if index == 0:
                prior.append(current)
                continue
            current_start = float(current["effective_start_seconds"])
            overlapping = [
                item
                for item in prior
                if float(item["effective_end_seconds"]) > current_start + _EPSILON_SECONDS
            ]
            anchor = max(
                prior,
                key=lambda item: (
                    float(item["effective_end_seconds"]),
                    -int(item["timeline_ordinal"]),
                ),
            )
            anchor_end = float(anchor["effective_end_seconds"])
            delta = current_start - anchor_end
            relation: dict[str, object]
            if abs(delta) <= _EPSILON_SECONDS:
                relation = {
                    "kind": "contiguous",
                    "seconds": 0.0,
                    "previous_part_ids": [str(anchor["part_id"])],
                    "resolved": True,
                    "resolution": None,
                    "boundary_ownership": None,
                }
            elif delta > 0:
                confirmed = bool(current["_timing"]["gap_confirmed"])
                relation = {
                    "kind": "gap",
                    "seconds": delta,
                    "previous_part_ids": [str(anchor["part_id"])],
                    "resolved": confirmed,
                    "resolution": None,
                    "boundary_ownership": None,
                }
                if not confirmed:
                    blocking.add("gap_unconfirmed")
            else:
                previous_ids = [
                    str(item["part_id"])
                    for item in sorted(
                        overlapping,
                        key=lambda item: (
                            int(item["timeline_ordinal"]),
                            str(item["part_id"]),
                        ),
                    )
                ]
                resolution = current["_timing"]["overlap_resolution"]
                valid_resolution = False
                boundary_ownership = None
                if isinstance(resolution, dict):
                    boundary = float(resolution["boundary_seconds"])
                    latest_end = max(
                        float(item["effective_end_seconds"]) for item in overlapping
                    )
                    if (
                        boundary + _EPSILON_SECONDS >= current_start
                        and boundary <= latest_end + _EPSILON_SECONDS
                    ):
                        valid_resolution = True
                        boundary_ownership = (
                            "earlier_owns_segment_start_at_boundary"
                            if resolution["policy"] == "prefer_earlier_until"
                            else "later_owns_segment_start_at_boundary"
                        )
                relation = {
                    "kind": "overlap",
                    "seconds": max(
                        float(item["effective_end_seconds"]) for item in overlapping
                    )
                    - current_start,
                    "previous_part_ids": previous_ids,
                    "resolved": valid_resolution,
                    "resolution": resolution if valid_resolution else None,
                    "boundary_ownership": boundary_ownership,
                }
                if not valid_resolution:
                    blocking.add("overlap_unresolved")
            current["relation_to_previous"] = relation
            prior.append(current)
    elif not computed:
        blocking.add("no_parts")

    for part in computed:
        part.pop("_timing", None)

    return {
        "schema_version": CHRONOLOGY_SCHEMA,
        "canonicalization_version": CANONICALIZATION_VERSION,
        "order_provenance": order_provenance,
        "config_sha256": _config_hash(normalized, order_provenance),
        "ready_for_assembly": len(blocking) == 0,
        "blocking_reasons": sorted(blocking),
        "suggested_part_order": suggested_order,
        "resolved_part_order": resolved_order,
        "parts": computed,
    }
