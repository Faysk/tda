from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone

TIMELINE_SCHEMA = "tda_session_timeline_v1"
CONFIG_SCHEMA = "tda_session_timeline_config_v1"
SEGMENT_BOUNDARY_POLICY = "segment_start_v1"
_RESOLUTION_MODES = frozenset({
    "accept_gap",
    "prefer_earlier_until",
    "prefer_later_from",
})


class SessionTimelineError(ValueError):
    pass


def _sha256_json(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def classify_start_time(value: object) -> dict[str, object]:
    if value is None:
        return {
            "raw": None,
            "confidence": "missing",
            "normalized_utc": None,
            "epoch_ms": None,
        }
    if not isinstance(value, str) or not value.strip():
        return {
            "raw": None,
            "confidence": "missing",
            "normalized_utc": None,
            "epoch_ms": None,
        }
    raw = value.strip()
    if len(raw) > 128:
        return {
            "raw": raw[:128],
            "confidence": "opaque",
            "normalized_utc": None,
            "epoch_ms": None,
        }
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return {
            "raw": raw,
            "confidence": "opaque",
            "normalized_utc": None,
            "epoch_ms": None,
        }
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return {
            "raw": raw,
            "confidence": "ambiguous",
            "normalized_utc": None,
            "epoch_ms": None,
        }
    normalized = parsed.astimezone(timezone.utc)
    return {
        "raw": raw,
        "confidence": "trusted_absolute",
        "normalized_utc": normalized.isoformat().replace("+00:00", "Z"),
        "epoch_ms": round(normalized.timestamp() * 1000),
    }


def source_facts_from_package(package) -> dict[str, object]:
    duration_ms: int | None = 0
    maximum = 0.0
    tracks = tuple(getattr(package, "tracks", ()) or ())
    if not tracks:
        duration_ms = None
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
            duration_ms = None
            break
        maximum = max(maximum, float(offset) + float(duration))
    if duration_ms is not None:
        duration_ms = round(maximum * 1000)
    return {
        "start_time": getattr(package, "start_time", None),
        "duration_ms": duration_ms,
    }


def _part_id(value: object) -> str:
    if not isinstance(value, str) or len(value) != 32:
        raise SessionTimelineError("SESSION_TIMELINE_PART_INVALID")
    try:
        int(value, 16)
    except ValueError as exc:
        raise SessionTimelineError("SESSION_TIMELINE_PART_INVALID") from exc
    return value


def _milliseconds(value: object, *, nullable: bool = False) -> int | None:
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise SessionTimelineError("SESSION_TIMELINE_VALUE_INVALID")
    return value


def normalize_timeline_config(
    raw: object,
    part_ids: list[str],
    *,
    require_exact: bool = False,
) -> dict[str, object]:
    current = [_part_id(value) for value in part_ids]
    if len(set(current)) != len(current) or len(current) > 64:
        raise SessionTimelineError("SESSION_TIMELINE_PART_SET_INVALID")

    if raw is None:
        raw = {
            "schema_version": CONFIG_SCHEMA,
            "parts": [],
            "boundaries": [],
        }
    if not isinstance(raw, dict) or raw.get("schema_version") != CONFIG_SCHEMA:
        raise SessionTimelineError("SESSION_TIMELINE_CONFIG_INVALID")

    raw_parts = raw.get("parts")
    raw_boundaries = raw.get("boundaries")
    if not isinstance(raw_parts, list) or len(raw_parts) > 64:
        raise SessionTimelineError("SESSION_TIMELINE_CONFIG_INVALID")
    if not isinstance(raw_boundaries, list) or len(raw_boundaries) > 63:
        raise SessionTimelineError("SESSION_TIMELINE_CONFIG_INVALID")

    by_part: dict[str, dict[str, object]] = {}
    for item in raw_parts:
        if not isinstance(item, dict):
            raise SessionTimelineError("SESSION_TIMELINE_CONFIG_INVALID")
        part_id = _part_id(item.get("part_id"))
        if part_id in by_part:
            raise SessionTimelineError("SESSION_TIMELINE_PART_SET_INVALID")
        if part_id not in current:
            if require_exact:
                raise SessionTimelineError("SESSION_TIMELINE_PART_SET_INVALID")
            continue
        session_offset_ms = _milliseconds(item.get("session_offset_ms"), nullable=True)
        trim_start_ms = _milliseconds(item.get("trim_start_ms", 0))
        trim_end_ms = _milliseconds(item.get("trim_end_ms"), nullable=True)
        assert isinstance(trim_start_ms, int)
        if trim_end_ms is not None and trim_end_ms <= trim_start_ms:
            raise SessionTimelineError("SESSION_TIMELINE_TRIM_INVALID")
        by_part[part_id] = {
            "part_id": part_id,
            "session_offset_ms": session_offset_ms,
            "trim_start_ms": trim_start_ms,
            "trim_end_ms": trim_end_ms,
        }

    if require_exact and set(by_part) != set(current):
        raise SessionTimelineError("SESSION_TIMELINE_PART_SET_INVALID")

    parts = [
        by_part.get(
            part_id,
            {
                "part_id": part_id,
                "session_offset_ms": None,
                "trim_start_ms": 0,
                "trim_end_ms": None,
            },
        )
        for part_id in current
    ]

    adjacency = {
        (current[index], current[index + 1])
        for index in range(max(0, len(current) - 1))
    }
    boundaries: list[dict[str, object]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for item in raw_boundaries:
        if not isinstance(item, dict):
            raise SessionTimelineError("SESSION_TIMELINE_CONFIG_INVALID")
        left = _part_id(item.get("left_part_id"))
        right = _part_id(item.get("right_part_id"))
        pair = (left, right)
        if pair not in adjacency:
            if require_exact:
                raise SessionTimelineError("SESSION_TIMELINE_BOUNDARY_PAIR_INVALID")
            continue
        if pair in seen_pairs:
            raise SessionTimelineError("SESSION_TIMELINE_BOUNDARY_PAIR_INVALID")
        seen_pairs.add(pair)
        mode = item.get("mode")
        if mode not in _RESOLUTION_MODES:
            raise SessionTimelineError("SESSION_TIMELINE_RESOLUTION_INVALID")
        boundary_ms = _milliseconds(item.get("boundary_ms"), nullable=True)
        if mode == "accept_gap":
            if boundary_ms is not None:
                raise SessionTimelineError("SESSION_TIMELINE_RESOLUTION_INVALID")
        elif boundary_ms is None:
            raise SessionTimelineError("SESSION_TIMELINE_RESOLUTION_INVALID")
        boundaries.append(
            {
                "left_part_id": left,
                "right_part_id": right,
                "mode": mode,
                "boundary_ms": boundary_ms,
            }
        )

    return {
        "schema_version": CONFIG_SCHEMA,
        "parts": parts,
        "boundaries": boundaries,
    }


def build_session_timeline(
    workspace: dict[str, object],
    source_facts: dict[str, dict[str, object]],
    config: object = None,
) -> dict[str, object]:
    raw_parts = workspace.get("parts")
    if not isinstance(raw_parts, list) or len(raw_parts) > 64:
        raise SessionTimelineError("SESSION_TIMELINE_WORKSPACE_INVALID")

    part_ids: list[str] = []
    for raw in raw_parts:
        if not isinstance(raw, dict):
            raise SessionTimelineError("SESSION_TIMELINE_WORKSPACE_INVALID")
        part_ids.append(_part_id(raw.get("part_id")))
    normalized = normalize_timeline_config(config, part_ids)
    config_by_part = {
        row["part_id"]: row
        for row in normalized["parts"]
        if isinstance(row, dict)
    }

    evidence_by_part: dict[str, dict[str, object]] = {}
    trusted: list[tuple[int, str]] = []
    for raw in raw_parts:
        assert isinstance(raw, dict)
        part_id = str(raw["part_id"])
        facts = source_facts.get(str(raw.get("source_id")), {})
        evidence = classify_start_time(facts.get("start_time"))
        evidence_by_part[part_id] = evidence
        epoch_ms = evidence.get("epoch_ms")
        if evidence.get("confidence") == "trusted_absolute" and isinstance(epoch_ms, int):
            trusted.append((epoch_ms, part_id))

    baseline_ms = min((value for value, _ in trusted), default=None)
    all_trusted = len(raw_parts) > 0 and len(trusted) == len(raw_parts)
    suggested_order = (
        {
            part_id: index
            for index, (_, part_id) in enumerate(sorted(trusted, key=lambda item: (item[0], item[1])))
        }
        if all_trusted
        else {}
    )

    timeline_parts: list[dict[str, object]] = []
    identity_parts: list[dict[str, object]] = []
    for index, raw in enumerate(raw_parts):
        assert isinstance(raw, dict)
        part_id = str(raw["part_id"])
        source_id = str(raw.get("source_id"))
        facts = source_facts.get(source_id, {})
        duration_ms = facts.get("duration_ms")
        if isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or duration_ms < 0:
            duration_ms = None
        item = config_by_part[part_id]
        manual_offset = item["session_offset_ms"]
        evidence = evidence_by_part[part_id]

        if manual_offset is not None:
            offset_ms = manual_offset
            placement_origin = "manual"
        elif len(raw_parts) == 1:
            offset_ms = 0
            placement_origin = "single_source_zero"
        elif evidence.get("confidence") == "trusted_absolute" and baseline_ms is not None:
            epoch_ms = evidence.get("epoch_ms")
            assert isinstance(epoch_ms, int)
            offset_ms = epoch_ms - baseline_ms
            placement_origin = "trusted_absolute"
        else:
            offset_ms = None
            placement_origin = "unresolved"

        trim_start_ms = item["trim_start_ms"]
        trim_end_ms = item["trim_end_ms"]
        assert isinstance(trim_start_ms, int)
        if duration_ms is not None:
            if trim_start_ms > duration_ms:
                raise SessionTimelineError("SESSION_TIMELINE_TRIM_INVALID")
            local_end_ms = duration_ms if trim_end_ms is None else trim_end_ms
            if local_end_ms > duration_ms or local_end_ms <= trim_start_ms:
                raise SessionTimelineError("SESSION_TIMELINE_TRIM_INVALID")
        else:
            local_end_ms = trim_end_ms

        effective_start_ms = (
            offset_ms + trim_start_ms
            if isinstance(offset_ms, int)
            else None
        )
        effective_end_ms = (
            offset_ms + local_end_ms
            if isinstance(offset_ms, int) and isinstance(local_end_ms, int)
            else None
        )
        suggested_ordinal = suggested_order.get(part_id)
        order_matches = (
            index == suggested_ordinal
            if suggested_ordinal is not None
            else None
        )
        row = {
            "part_id": part_id,
            "source_id": source_id,
            "ordinal": index,
            "start_time": {
                "raw": evidence.get("raw"),
                "confidence": evidence.get("confidence"),
                "normalized_utc": evidence.get("normalized_utc"),
            },
            "source_duration_ms": duration_ms,
            "placement": {
                "session_offset_ms": offset_ms,
                "origin": placement_origin,
                "trim_start_ms": trim_start_ms,
                "trim_end_ms": trim_end_ms,
            },
            "effective_start_ms": effective_start_ms,
            "effective_end_ms": effective_end_ms,
            "suggested_ordinal": suggested_ordinal,
            "order_matches_trusted_suggestion": order_matches,
        }
        timeline_parts.append(row)
        identity_parts.append(
            {
                "part_id": part_id,
                "source_id": source_id,
                "ordinal": index,
                "session_offset_ms": offset_ms,
                "placement_origin": placement_origin,
                "trim_start_ms": trim_start_ms,
                "trim_end_ms": trim_end_ms,
            }
        )

    resolutions = {
        (row["left_part_id"], row["right_part_id"]): row
        for row in normalized["boundaries"]
        if isinstance(row, dict)
    }
    boundaries: list[dict[str, object]] = []
    identity_boundaries: list[dict[str, object]] = []
    boundaries_ready = True
    for index in range(max(0, len(timeline_parts) - 1)):
        left = timeline_parts[index]
        right = timeline_parts[index + 1]
        pair = (str(left["part_id"]), str(right["part_id"]))
        resolution = resolutions.get(pair)
        left_end = left["effective_end_ms"]
        right_start = right["effective_start_ms"]
        kind = "unresolved"
        duration_ms: int | None = None
        resolved = False

        if isinstance(left_end, int) and isinstance(right_start, int):
            delta = right_start - left_end
            if delta == 0:
                kind = "contiguous"
                duration_ms = 0
                resolved = True
                if resolution is not None:
                    raise SessionTimelineError("SESSION_TIMELINE_RESOLUTION_INVALID")
            elif delta > 0:
                kind = "gap"
                duration_ms = delta
                resolved = resolution is not None and resolution.get("mode") == "accept_gap"
                if resolution is not None and not resolved:
                    raise SessionTimelineError("SESSION_TIMELINE_RESOLUTION_INVALID")
            else:
                kind = "overlap"
                duration_ms = -delta
                if resolution is not None:
                    mode = resolution.get("mode")
                    boundary_ms = resolution.get("boundary_ms")
                    if (
                        mode not in {"prefer_earlier_until", "prefer_later_from"}
                        or not isinstance(boundary_ms, int)
                        or boundary_ms < right_start
                        or boundary_ms > left_end
                    ):
                        raise SessionTimelineError("SESSION_TIMELINE_RESOLUTION_INVALID")
                    resolved = True
        elif resolution is not None:
            raise SessionTimelineError("SESSION_TIMELINE_RESOLUTION_INVALID")

        if not resolved:
            boundaries_ready = False
        public_resolution = (
            {
                "mode": resolution["mode"],
                "boundary_ms": resolution["boundary_ms"],
            }
            if resolution is not None
            else None
        )
        boundaries.append(
            {
                "left_part_id": pair[0],
                "right_part_id": pair[1],
                "kind": kind,
                "duration_ms": duration_ms,
                "resolved": resolved,
                "resolution": public_resolution,
            }
        )
        identity_boundaries.append(
            {
                "left_part_id": pair[0],
                "right_part_id": pair[1],
                "kind": kind,
                "resolution": public_resolution,
            }
        )

    parts_ready = all(
        isinstance(row["effective_start_ms"], int)
        and isinstance(row["effective_end_ms"], int)
        for row in timeline_parts
    )
    order_matches_suggestion = (
        all(bool(row["order_matches_trusted_suggestion"]) for row in timeline_parts)
        if all_trusted
        else None
    )
    identity = {
        "schema_version": TIMELINE_SCHEMA,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "parts": identity_parts,
        "boundaries": identity_boundaries,
    }

    return {
        "schema_version": TIMELINE_SCHEMA,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "configuration_sha256": _sha256_json(normalized),
        "timeline_identity_sha256": _sha256_json(identity),
        "approval_ready": parts_ready and boundaries_ready,
        "order_matches_trusted_suggestion": order_matches_suggestion,
        "parts": timeline_parts,
        "boundaries": boundaries,
    }
