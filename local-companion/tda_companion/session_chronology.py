from __future__ import annotations

from datetime import UTC, datetime, time
import math
from typing import Any

from .legacy.artifacts import sha256_json


CHRONOLOGY_SCHEMA = "tda_session_chronology_v1"
SEGMENT_BOUNDARY_POLICY = "segment_start_v1"
OVERLAP_STRATEGIES = frozenset({"prefer_earlier_until", "prefer_later_from"})


def _finite_non_negative(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or number < 0:
        return None
    return number


def classify_source_start_time(value: object) -> dict[str, object]:
    if value is None:
        return {
            "classification": "missing",
            "raw": None,
            "normalized_utc": None,
        }
    if not isinstance(value, str) or not value.strip():
        return {
            "classification": "missing",
            "raw": None,
            "normalized_utc": None,
        }

    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            time.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return {
                "classification": "opaque",
                "raw": raw,
                "normalized_utc": None,
            }
        return {
            "classification": "ambiguous",
            "raw": raw,
            "normalized_utc": None,
        }

    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return {
            "classification": "ambiguous",
            "raw": raw,
            "normalized_utc": None,
        }

    normalized = (
        parsed.astimezone(UTC)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )
    return {
        "classification": "trusted_absolute",
        "raw": raw,
        "normalized_utc": normalized,
    }


def _trusted_instant(evidence: dict[str, object]) -> datetime | None:
    if evidence.get("classification") != "trusted_absolute":
        return None
    normalized = evidence.get("normalized_utc")
    if not isinstance(normalized, str):
        return None
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None


def _round_seconds(value: float) -> float:
    return round(value, 6)


def build_session_chronology(
    workspace: dict[str, object],
    source_facts: dict[str, dict[str, object]],
) -> dict[str, object]:
    raw_parts = workspace.get("parts")
    if not isinstance(raw_parts, list):
        raise ValueError("SESSION_CHRONOLOGY_PARTS_INVALID")

    order_confirmed = workspace.get("order_confirmed") is True
    part_states: list[dict[str, object]] = []
    trusted: list[tuple[str, datetime]] = []

    for raw in raw_parts:
        if not isinstance(raw, dict):
            raise ValueError("SESSION_CHRONOLOGY_PART_INVALID")
        part_id = raw.get("part_id")
        source_id = raw.get("source_id")
        ordinal = raw.get("ordinal")
        if not isinstance(part_id, str) or not isinstance(source_id, str) or not isinstance(ordinal, int):
            raise ValueError("SESSION_CHRONOLOGY_PART_INVALID")

        facts = source_facts.get(source_id, {})
        evidence = classify_source_start_time(facts.get("start_time"))
        instant = _trusted_instant(evidence)
        if instant is not None:
            trusted.append((part_id, instant))

        duration = _finite_non_negative(facts.get("duration_seconds"))
        manual_offset = _finite_non_negative(raw.get("session_offset_seconds"))
        trim_start = _finite_non_negative(raw.get("trim_start_seconds"))
        if trim_start is None:
            trim_start = 0.0
        trim_end = _finite_non_negative(raw.get("trim_end_seconds"))

        part_states.append(
            {
                "part_id": part_id,
                "source_id": source_id,
                "ordinal": ordinal,
                "evidence": evidence,
                "trusted_instant": instant,
                "duration_seconds": duration,
                "manual_offset_seconds": manual_offset,
                "trim_start_seconds": trim_start,
                "trim_end_seconds": trim_end,
                "gap_confirmed": raw.get("gap_confirmed") is True,
                "overlap_strategy": raw.get("overlap_strategy"),
                "overlap_boundary_seconds": _finite_non_negative(
                    raw.get("overlap_boundary_seconds")
                ),
            }
        )

    trusted_anchor = min((instant for _, instant in trusted), default=None)
    suggested_order = [
        part_id for part_id, _ in sorted(trusted, key=lambda item: (item[1], item[0]))
    ]
    all_trusted = len(trusted) == len(part_states)
    current_order = [str(part["part_id"]) for part in part_states]
    if len(part_states) <= 1:
        order_provenance = "single_part"
    elif order_confirmed:
        order_provenance = "manual"
    elif all_trusted and current_order == suggested_order:
        order_provenance = "trusted_absolute"
    else:
        order_provenance = "unconfirmed"

    blockers: list[dict[str, object]] = []
    if order_provenance == "unconfirmed":
        blockers.append(
            {
                "code": "order_confirmation_required",
                "part_id": None,
            }
        )

    manifest_parts: list[dict[str, object]] = []
    resolved_parts: list[dict[str, object]] = []

    for part in part_states:
        evidence = part["evidence"]
        assert isinstance(evidence, dict)
        instant = part["trusted_instant"]
        manual_offset = part["manual_offset_seconds"]
        if manual_offset is not None:
            offset = float(manual_offset)
            placement_provenance = "manual"
        elif isinstance(instant, datetime) and trusted_anchor is not None:
            offset = max(0.0, (instant - trusted_anchor).total_seconds())
            placement_provenance = "trusted_absolute"
        else:
            offset = None
            placement_provenance = "unplaced"

        duration = part["duration_seconds"]
        trim_start = float(part["trim_start_seconds"])
        trim_end = part["trim_end_seconds"]

        if duration is not None and trim_start > float(duration):
            blockers.append(
                {
                    "code": "trim_out_of_range",
                    "part_id": part["part_id"],
                }
            )
        if trim_end is not None:
            if trim_end < trim_start or (duration is not None and trim_end > float(duration)):
                blockers.append(
                    {
                        "code": "trim_out_of_range",
                        "part_id": part["part_id"],
                    }
                )

        local_included_end = (
            float(trim_end)
            if trim_end is not None
            else (float(duration) if duration is not None else None)
        )
        if offset is None:
            blockers.append(
                {
                    "code": "timeline_position_required",
                    "part_id": part["part_id"],
                }
            )
        if local_included_end is None:
            blockers.append(
                {
                    "code": "duration_required",
                    "part_id": part["part_id"],
                }
            )

        effective_start = _round_seconds(offset) if offset is not None else None
        effective_end = (
            _round_seconds(offset + float(duration))
            if offset is not None and duration is not None
            else None
        )
        included_start = (
            _round_seconds(offset + trim_start) if offset is not None else None
        )
        included_end = (
            _round_seconds(offset + local_included_end)
            if offset is not None and local_included_end is not None
            else None
        )

        public_part = {
            "part_id": part["part_id"],
            "source_id": part["source_id"],
            "ordinal": part["ordinal"],
            "timing_evidence": evidence,
            "placement_provenance": placement_provenance,
            "session_offset_seconds": effective_start,
            "local_duration_seconds": duration,
            "trim_start_seconds": trim_start,
            "trim_end_seconds": trim_end,
            "effective_start_seconds": effective_start,
            "effective_end_seconds": effective_end,
            "included_start_seconds": included_start,
            "included_end_seconds": included_end,
        }
        resolved_parts.append(public_part)
        manifest_parts.append(
            {
                **public_part,
                "gap_confirmed": part["gap_confirmed"],
                "overlap_strategy": part["overlap_strategy"],
                "overlap_boundary_seconds": part["overlap_boundary_seconds"],
            }
        )

    boundaries: list[dict[str, object]] = []
    for index in range(1, len(resolved_parts)):
        earlier = resolved_parts[index - 1]
        later = resolved_parts[index]
        earlier_end = earlier["included_end_seconds"]
        later_start = later["included_start_seconds"]
        later_state = part_states[index]

        if not isinstance(earlier_end, (int, float)) or not isinstance(
            later_start, (int, float)
        ):
            boundaries.append(
                {
                    "before_part_id": later["part_id"],
                    "kind": "unknown",
                    "seconds": None,
                    "resolved": False,
                }
            )
            continue

        delta = _round_seconds(float(later_start) - float(earlier_end))
        if delta > 0:
            resolved = bool(later_state["gap_confirmed"])
            boundaries.append(
                {
                    "before_part_id": later["part_id"],
                    "kind": "gap",
                    "seconds": delta,
                    "resolved": resolved,
                }
            )
            if not resolved:
                blockers.append(
                    {
                        "code": "gap_confirmation_required",
                        "part_id": later["part_id"],
                    }
                )
            continue

        if delta == 0:
            boundaries.append(
                {
                    "before_part_id": later["part_id"],
                    "kind": "contiguous",
                    "seconds": 0.0,
                    "resolved": True,
                }
            )
            continue

        overlap_seconds = _round_seconds(-delta)
        strategy = later_state["overlap_strategy"]
        boundary = later_state["overlap_boundary_seconds"]
        valid_resolution = (
            strategy in OVERLAP_STRATEGIES
            and isinstance(boundary, (int, float))
            and float(later_start) <= float(boundary) <= float(earlier_end)
        )
        boundaries.append(
            {
                "before_part_id": later["part_id"],
                "kind": "overlap",
                "seconds": overlap_seconds,
                "resolved": valid_resolution,
                "strategy": strategy if strategy in OVERLAP_STRATEGIES else None,
                "boundary_seconds": (
                    _round_seconds(float(boundary))
                    if isinstance(boundary, (int, float))
                    else None
                ),
            }
        )
        if not valid_resolution:
            blockers.append(
                {
                    "code": "overlap_resolution_required",
                    "part_id": later["part_id"],
                }
            )

    manifest = {
        "schema_version": CHRONOLOGY_SCHEMA,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "order_provenance": order_provenance,
        "order_confirmed": order_confirmed,
        "parts": manifest_parts,
        "boundaries": boundaries,
    }
    chronology_sha256 = sha256_json(manifest)
    return {
        **manifest,
        "chronology_sha256": chronology_sha256,
        "suggested_order": suggested_order if all_trusted else None,
        "approval_blockers": blockers,
        "approval_ready": not blockers,
        "parts": resolved_parts,
    }
