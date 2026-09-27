from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, time, timezone
from typing import Any

TIMELINE_SCHEMA_VERSION = "tda_session_timeline_v1"
TIMING_POLICY_VERSION = "tda_session_timing_v1"
_ALLOWED_DECISIONS = frozenset(
    {
        "gap_acknowledged",
        "prefer_earlier_until",
        "prefer_later_from",
    }
)
_EPSILON_SECONDS = 1e-6


class SessionTimelineError(ValueError):
    pass


def _finite_non_negative(value: object, code: str, *, allow_none: bool = False) -> float | None:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SessionTimelineError(code)
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise SessionTimelineError(code)
    normalized = round(number, 6)
    return 0.0 if normalized == 0 else normalized


def classify_start_time(value: object) -> dict[str, object]:
    if value is None:
        return {
            "confidence": "missing",
            "raw": None,
            "instant_utc": None,
        }
    if not isinstance(value, str):
        return {
            "confidence": "opaque",
            "raw": None,
            "instant_utc": None,
        }
    raw = value.strip()
    if not raw:
        return {
            "confidence": "missing",
            "raw": None,
            "instant_utc": None,
        }
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            time.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return {
                "confidence": "opaque",
                "raw": raw,
                "instant_utc": None,
            }
        return {
            "confidence": "ambiguous",
            "raw": raw,
            "instant_utc": None,
        }
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return {
            "confidence": "ambiguous",
            "raw": raw,
            "instant_utc": None,
        }
    normalized = parsed.astimezone(timezone.utc)
    return {
        "confidence": "trusted_absolute",
        "raw": raw,
        "instant_utc": normalized.isoformat().replace("+00:00", "Z"),
    }


def _trusted_epoch_seconds(classification: dict[str, object]) -> float | None:
    if classification.get("confidence") != "trusted_absolute":
        return None
    value = classification.get("instant_utc")
    if not isinstance(value, str):
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (parsed - epoch).total_seconds()


def package_duration_seconds(package: Any) -> float | None:
    tracks = getattr(package, "tracks", None)
    if not isinstance(tracks, (list, tuple)) or not tracks:
        return None
    ends: list[float] = []
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
        ends.append(float(offset) + float(duration))
    return max(ends, default=None)


def normalize_part_timing(
    *,
    manual_offset_seconds: object,
    trim_start_seconds: object,
    trim_end_seconds: object,
) -> dict[str, float | None]:
    manual = _finite_non_negative(
        manual_offset_seconds,
        "SESSION_TIMELINE_OFFSET_INVALID",
        allow_none=True,
    )
    trim_start = _finite_non_negative(
        trim_start_seconds,
        "SESSION_TIMELINE_TRIM_INVALID",
    )
    trim_end = _finite_non_negative(
        trim_end_seconds,
        "SESSION_TIMELINE_TRIM_INVALID",
        allow_none=True,
    )
    assert trim_start is not None
    if trim_end is not None and trim_end < trim_start:
        raise SessionTimelineError("SESSION_TIMELINE_TRIM_INVALID")
    return {
        "manual_offset_seconds": manual,
        "trim_start_seconds": trim_start,
        "trim_end_seconds": trim_end,
    }


def normalize_decision(
    decision: object,
    boundary_seconds: object,
) -> tuple[str | None, float | None]:
    if decision is None:
        if boundary_seconds is not None:
            raise SessionTimelineError("SESSION_TIMELINE_DECISION_INVALID")
        return None, None
    if not isinstance(decision, str) or decision not in _ALLOWED_DECISIONS:
        raise SessionTimelineError("SESSION_TIMELINE_DECISION_INVALID")
    if decision == "gap_acknowledged":
        if boundary_seconds is not None:
            raise SessionTimelineError("SESSION_TIMELINE_DECISION_INVALID")
        return decision, None
    boundary = _finite_non_negative(
        boundary_seconds,
        "SESSION_TIMELINE_BOUNDARY_INVALID",
    )
    assert boundary is not None
    return decision, boundary


def canonical_timeline_config(workspace: dict[str, object]) -> dict[str, object]:
    parts_value = workspace.get("parts")
    if not isinstance(parts_value, list):
        raise SessionTimelineError("SESSION_TIMELINE_WORKSPACE_INVALID")
    parts: list[dict[str, object]] = []
    for part in parts_value:
        if not isinstance(part, dict):
            raise SessionTimelineError("SESSION_TIMELINE_WORKSPACE_INVALID")
        timing = normalize_part_timing(
            manual_offset_seconds=part.get("manual_offset_seconds"),
            trim_start_seconds=part.get("trim_start_seconds", 0.0),
            trim_end_seconds=part.get("trim_end_seconds"),
        )
        parts.append(
            {
                "part_id": part.get("part_id"),
                "source_id": part.get("source_id"),
                "ordinal": part.get("ordinal"),
                **timing,
            }
        )

    decisions_value = workspace.get("timeline_decisions", [])
    if not isinstance(decisions_value, list):
        raise SessionTimelineError("SESSION_TIMELINE_WORKSPACE_INVALID")
    decisions: list[dict[str, object]] = []
    for item in decisions_value:
        if not isinstance(item, dict):
            raise SessionTimelineError("SESSION_TIMELINE_WORKSPACE_INVALID")
        decision, boundary = normalize_decision(
            item.get("decision"),
            item.get("boundary_seconds"),
        )
        if decision is None:
            continue
        decisions.append(
            {
                "earlier_part_id": item.get("earlier_part_id"),
                "later_part_id": item.get("later_part_id"),
                "decision": decision,
                "boundary_seconds": boundary,
            }
        )
    decisions.sort(
        key=lambda item: (
            str(item["earlier_part_id"]),
            str(item["later_part_id"]),
            str(item["decision"]),
        )
    )
    order_authority = workspace.get("order_authority", "unconfirmed")
    if order_authority not in {"unconfirmed", "manual"}:
        raise SessionTimelineError("SESSION_TIMELINE_ORDER_AUTHORITY_INVALID")
    return {
        "schema_version": TIMING_POLICY_VERSION,
        "order_authority": order_authority,
        "parts": parts,
        "decisions": decisions,
    }


def timeline_config_sha256(workspace: dict[str, object]) -> str:
    payload = json.dumps(
        canonical_timeline_config(workspace),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def build_session_timeline(
    workspace: dict[str, object],
    source_facts: dict[str, dict[str, object]],
) -> dict[str, object]:
    config_hash = timeline_config_sha256(workspace)
    parts_value = workspace.get("parts")
    assert isinstance(parts_value, list)

    classifications: dict[str, dict[str, object]] = {}
    trusted_instants: dict[str, float] = {}
    for part in parts_value:
        assert isinstance(part, dict)
        part_id = str(part.get("part_id"))
        facts = source_facts.get(part_id, {})
        classification = classify_start_time(facts.get("start_time"))
        classifications[part_id] = classification
        trusted = _trusted_epoch_seconds(classification)
        if trusted is not None:
            trusted_instants[part_id] = trusted

    all_trusted = bool(parts_value) and len(trusted_instants) == len(parts_value)
    trusted_values = list(trusted_instants.values())
    unique_trusted_instants = len(set(trusted_values)) == len(trusted_values)
    trusted_anchor = min(trusted_values) if trusted_values else None
    suggested_order = (
        [
            str(part["part_id"])
            for part in sorted(
                parts_value,
                key=lambda part: (
                    trusted_instants[str(part["part_id"])],
                    str(part["part_id"]),
                ),
            )
        ]
        if all_trusted and unique_trusted_instants
        else None
    )
    current_order = [str(part["part_id"]) for part in parts_value]
    order_authority = workspace.get("order_authority", "unconfirmed")
    if len(parts_value) <= 1:
        order_state = "trivial"
        order_ready = True
    elif all_trusted and suggested_order == current_order:
        order_state = "trusted_absolute"
        order_ready = True
    elif order_authority == "manual":
        order_state = "manual"
        order_ready = True
    else:
        order_state = "manual_required"
        order_ready = False

    part_states: list[dict[str, object]] = []
    by_part_id: dict[str, dict[str, object]] = {}
    for part in parts_value:
        assert isinstance(part, dict)
        part_id = str(part["part_id"])
        facts = source_facts.get(part_id, {})
        source_state = facts.get("source_state", "invalid")
        duration = facts.get("duration_seconds")
        duration_value = (
            float(duration)
            if (
                not isinstance(duration, bool)
                and isinstance(duration, (int, float))
                and math.isfinite(float(duration))
                and float(duration) >= 0
            )
            else None
        )
        timing = normalize_part_timing(
            manual_offset_seconds=part.get("manual_offset_seconds"),
            trim_start_seconds=part.get("trim_start_seconds", 0.0),
            trim_end_seconds=part.get("trim_end_seconds"),
        )
        classification = classifications[part_id]

        manual_offset = timing["manual_offset_seconds"]
        if manual_offset is not None:
            session_offset = manual_offset
            placement_authority = "manual"
        elif part_id in trusted_instants and trusted_anchor is not None:
            session_offset = trusted_instants[part_id] - trusted_anchor
            placement_authority = "trusted_absolute"
        else:
            session_offset = None
            placement_authority = "unresolved"

        trim_start = timing["trim_start_seconds"]
        trim_end = timing["trim_end_seconds"]
        invalid_trim = (
            duration_value is not None
            and (
                trim_start is None
                or trim_start > duration_value + _EPSILON_SECONDS
                or (
                    trim_end is not None
                    and trim_end > duration_value + _EPSILON_SECONDS
                )
            )
        )
        applied_end = duration_value if trim_end is None else trim_end
        if source_state != "ready" or duration_value is None or invalid_trim:
            state = "invalid"
            effective_start = None
            effective_end = None
        elif session_offset is None or trim_start is None or applied_end is None:
            state = "unresolved"
            effective_start = None
            effective_end = None
        else:
            state = "ready"
            effective_start = session_offset + trim_start
            effective_end = session_offset + applied_end

        part_state = {
            "part_id": part_id,
            "source_id": part.get("source_id"),
            "ordinal": part.get("ordinal"),
            "source_start": classification,
            "duration_seconds": duration_value,
            "manual_offset_seconds": manual_offset,
            "session_offset_seconds": session_offset,
            "placement_authority": placement_authority,
            "trim_start_seconds": trim_start,
            "trim_end_seconds": trim_end,
            "effective_start_seconds": effective_start,
            "effective_end_seconds": effective_end,
            "state": state,
        }
        part_states.append(part_state)
        by_part_id[part_id] = part_state

    raw_decisions = workspace.get("timeline_decisions", [])
    decision_map: dict[tuple[str, str], dict[str, object]] = {}
    if isinstance(raw_decisions, list):
        for item in raw_decisions:
            if not isinstance(item, dict):
                continue
            earlier = item.get("earlier_part_id")
            later = item.get("later_part_id")
            if isinstance(earlier, str) and isinstance(later, str):
                decision_map[(earlier, later)] = item

    relations: list[dict[str, object]] = []
    relations_ready = True
    for index in range(max(0, len(part_states) - 1)):
        earlier = part_states[index]
        later = part_states[index + 1]
        earlier_id = str(earlier["part_id"])
        later_id = str(later["part_id"])
        relation: dict[str, object] = {
            "earlier_part_id": earlier_id,
            "later_part_id": later_id,
            "kind": "unknown",
            "duration_seconds": None,
            "decision": None,
            "boundary_seconds": None,
            "resolved": False,
        }
        earlier_end = earlier.get("effective_end_seconds")
        later_start = later.get("effective_start_seconds")
        if not isinstance(earlier_end, (int, float)) or not isinstance(
            later_start, (int, float)
        ):
            relations_ready = False
            relations.append(relation)
            continue

        a_start = float(earlier.get("effective_start_seconds", 0.0))
        a_end = float(earlier_end)
        b_start = float(later_start)
        b_end_raw = later.get("effective_end_seconds")
        if not isinstance(b_end_raw, (int, float)):
            relations_ready = False
            relations.append(relation)
            continue
        b_end = float(b_end_raw)
        delta = b_start - a_end
        decision_row = decision_map.get((earlier_id, later_id))
        decision = decision_row.get("decision") if decision_row else None
        boundary = decision_row.get("boundary_seconds") if decision_row else None
        if abs(delta) <= _EPSILON_SECONDS:
            relation.update(
                {
                    "kind": "contiguous",
                    "duration_seconds": 0.0,
                    "resolved": True,
                }
            )
        elif delta > 0:
            resolved = decision == "gap_acknowledged"
            relation.update(
                {
                    "kind": "gap",
                    "duration_seconds": round(delta, 6),
                    "decision": decision if resolved else None,
                    "resolved": resolved,
                }
            )
            if not resolved:
                relations_ready = False
        else:
            overlap_start = max(a_start, b_start)
            overlap_end = min(a_end, b_end)
            if overlap_end <= overlap_start + _EPSILON_SECONDS:
                relation.update(
                    {
                        "kind": "order_conflict",
                        "duration_seconds": None,
                        "resolved": False,
                    }
                )
                relations_ready = False
                relations.append(relation)
                continue
            overlap_seconds = round(overlap_end - overlap_start, 6)
            valid_policy = decision in {
                "prefer_earlier_until",
                "prefer_later_from",
            }
            valid_boundary = (
                valid_policy
                and isinstance(boundary, (int, float))
                and not isinstance(boundary, bool)
                and math.isfinite(float(boundary))
                and float(boundary) >= overlap_start - _EPSILON_SECONDS
                and float(boundary) <= overlap_end + _EPSILON_SECONDS
            )
            relation.update(
                {
                    "kind": "overlap",
                    "duration_seconds": overlap_seconds,
                    "overlap_start_seconds": round(overlap_start, 6),
                    "overlap_end_seconds": round(overlap_end, 6),
                    "decision": decision if valid_boundary else None,
                    "boundary_seconds": round(float(boundary), 6) if valid_boundary else None,
                    "resolved": bool(valid_boundary),
                }
            )
            if not valid_boundary:
                relations_ready = False
        relations.append(relation)

    parts_ready = bool(part_states) and all(
        part["state"] == "ready" for part in part_states
    )
    return {
        "schema_version": TIMELINE_SCHEMA_VERSION,
        "config_sha256": config_hash,
        "ready": bool(order_ready and parts_ready and relations_ready),
        "order": {
            "state": order_state,
            "workspace_authority": order_authority,
            "suggested_part_ids": suggested_order,
            "matches_suggestion": (
                suggested_order == current_order if suggested_order is not None else None
            ),
        },
        "parts": part_states,
        "relations": relations,
    }


def segment_owner_at_boundary(
    segment_start_seconds: object,
    boundary_seconds: object,
) -> str:
    """Deterministic overlap ownership: start < boundary is earlier, else later."""
    start = _finite_non_negative(
        segment_start_seconds,
        "SESSION_TIMELINE_SEGMENT_START_INVALID",
    )
    boundary = _finite_non_negative(
        boundary_seconds,
        "SESSION_TIMELINE_BOUNDARY_INVALID",
    )
    assert start is not None and boundary is not None
    return "earlier" if start < boundary else "later"


def validate_relation_decision(
    timeline: dict[str, object],
    *,
    earlier_part_id: str,
    later_part_id: str,
    decision: str | None,
    boundary_seconds: float | None,
) -> None:
    normalized_decision, normalized_boundary = normalize_decision(
        decision,
        boundary_seconds,
    )
    relations = timeline.get("relations")
    if not isinstance(relations, list):
        raise SessionTimelineError("SESSION_TIMELINE_RELATION_NOT_FOUND")
    relation = next(
        (
            item
            for item in relations
            if isinstance(item, dict)
            and item.get("earlier_part_id") == earlier_part_id
            and item.get("later_part_id") == later_part_id
        ),
        None,
    )
    if relation is None:
        raise SessionTimelineError("SESSION_TIMELINE_RELATION_NOT_FOUND")
    if normalized_decision is None:
        return
    if normalized_decision == "gap_acknowledged":
        if relation.get("kind") != "gap":
            raise SessionTimelineError("SESSION_TIMELINE_DECISION_MISMATCH")
        return
    if relation.get("kind") != "overlap":
        raise SessionTimelineError("SESSION_TIMELINE_DECISION_MISMATCH")
    overlap_start = relation.get("overlap_start_seconds")
    overlap_end = relation.get("overlap_end_seconds")
    if (
        not isinstance(overlap_start, (int, float))
        or not isinstance(overlap_end, (int, float))
        or normalized_boundary is None
        or normalized_boundary < float(overlap_start) - _EPSILON_SECONDS
        or normalized_boundary > float(overlap_end) + _EPSILON_SECONDS
    ):
        raise SessionTimelineError("SESSION_TIMELINE_BOUNDARY_INVALID")
