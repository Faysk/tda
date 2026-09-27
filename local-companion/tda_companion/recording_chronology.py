from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, time, timezone
from typing import Any, Mapping, Sequence

CHRONOLOGY_SCHEMA = "tda_recording_chronology_v1"
OVERLAP_RESOLUTION_VERSION = "boundary_v1"
SEGMENT_BOUNDARY_POLICY = "segment_start_owner_v1"
OVERLAP_MODES = frozenset({"prefer_earlier_until", "prefer_later_from"})
_MAX_SECONDS = 7 * 24 * 60 * 60
_EPSILON = 1e-9


def _finite_non_negative(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0 or numeric > _MAX_SECONDS:
        return None
    return numeric


def classify_start_time(value: object) -> dict[str, object]:
    if value is None:
        return {"kind": "missing", "instant_utc": None}
    if not isinstance(value, str):
        return {"kind": "opaque", "instant_utc": None}
    text = value.strip()
    if not text:
        return {"kind": "missing", "instant_utc": None}
    if len(text) > 128:
        return {"kind": "opaque", "instant_utc": None}
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            time.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return {"kind": "opaque", "instant_utc": None}
        return {"kind": "ambiguous", "instant_utc": None}
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return {"kind": "ambiguous", "instant_utc": None}
    instant = parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"kind": "trusted_absolute", "instant_utc": instant}


def _trusted_epoch(value: object) -> float | None:
    classified = classify_start_time(value)
    instant = classified["instant_utc"]
    if classified["kind"] != "trusted_absolute" or not isinstance(instant, str):
        return None
    return datetime.fromisoformat(instant.replace("Z", "+00:00")).timestamp()


def segment_owner_at_boundary(
    segment_global_start_seconds: object,
    boundary_seconds: object,
) -> str:
    start = _finite_non_negative(segment_global_start_seconds)
    boundary = _finite_non_negative(boundary_seconds)
    if start is None or boundary is None:
        raise ValueError("RECORDING_CHRONOLOGY_BOUNDARY_INVALID")
    return "earlier" if start < boundary else "later"


def chronology_config_fingerprint(
    parts: Sequence[Mapping[str, object]],
    source_facts: Mapping[str, Mapping[str, object]],
) -> str:
    payload = {
        "schema_version": CHRONOLOGY_SCHEMA,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "parts": [
            {
                "part_id": part.get("part_id"),
                "source_id": part.get("source_id"),
                "ordinal": part.get("ordinal"),
                "session_offset_seconds": part.get("session_offset_seconds"),
                "trim_start_seconds": part.get("trim_start_seconds"),
                "trim_end_seconds": part.get("trim_end_seconds"),
                "gap_confirmed": bool(part.get("gap_confirmed", False)),
                "overlap_resolution": part.get("overlap_resolution"),
                "overlap_boundary_seconds": part.get("overlap_boundary_seconds"),
                "source_start_time": source_facts.get(str(part.get("part_id")), {}).get(
                    "start_time"
                ),
                "local_duration_seconds": source_facts.get(
                    str(part.get("part_id")), {}
                ).get("duration_seconds"),
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


def overlap_segment_owner(
    segment_start_seconds: object,
    segment_end_seconds: object,
    boundary_seconds: object,
) -> str:
    start = _finite_non_negative(segment_start_seconds)
    end = _finite_non_negative(segment_end_seconds)
    boundary = _finite_non_negative(boundary_seconds)
    if start is None or end is None or boundary is None or end < start:
        raise ValueError("RECORDING_CHRONOLOGY_SEGMENT_INVALID")
    return "earlier" if start < boundary else "later"


def derive_recording_chronology(
    parts: Sequence[Mapping[str, object]],
    source_facts: Mapping[str, Mapping[str, object]],
) -> dict[str, object]:
    if len(parts) > 64:
        raise ValueError("RECORDING_CHRONOLOGY_PART_LIMIT")

    trusted_epochs = [
        epoch
        for part in parts
        if (
            epoch := _trusted_epoch(
                source_facts.get(str(part.get("part_id")), {}).get("start_time")
            )
        )
        is not None
    ]
    trusted_origin = min(trusted_epochs) if trusted_epochs else None
    single_source = len(parts) == 1

    projected: list[dict[str, object]] = []
    blocking: list[str] = []

    for expected_ordinal, part in enumerate(parts):
        part_id = str(part.get("part_id"))
        source_id = str(part.get("source_id"))
        ordinal = part.get("ordinal")
        if ordinal != expected_ordinal:
            raise ValueError("RECORDING_CHRONOLOGY_ORDER_INVALID")

        facts = source_facts.get(part_id, {})
        source_available = bool(facts.get("available", bool(facts)))
        if not source_available:
            blocking.append(f"SOURCE_INVALID:{part_id}")
        start_time = facts.get("start_time")
        classified = classify_start_time(start_time)
        trusted_epoch = _trusted_epoch(start_time)
        duration = _finite_non_negative(facts.get("duration_seconds"))

        manual_offset_raw = part.get("session_offset_seconds")
        manual_offset = (
            None
            if manual_offset_raw is None
            else _finite_non_negative(manual_offset_raw)
        )
        trim_start = _finite_non_negative(part.get("trim_start_seconds", 0.0))
        trim_end_raw = part.get("trim_end_seconds")
        trim_end = (
            None if trim_end_raw is None else _finite_non_negative(trim_end_raw)
        )

        if manual_offset_raw is not None and manual_offset is None:
            blocking.append(f"PART_OFFSET_INVALID:{part_id}")
        if trim_start is None:
            blocking.append(f"PART_TRIM_INVALID:{part_id}")
            trim_start = 0.0
        if trim_end_raw is not None and trim_end is None:
            blocking.append(f"PART_TRIM_INVALID:{part_id}")
        if trim_end is not None and trim_end <= trim_start + _EPSILON:
            blocking.append(f"PART_TRIM_INVALID:{part_id}")
        if duration is not None and trim_start > duration + _EPSILON:
            blocking.append(f"PART_TRIM_INVALID:{part_id}")
        if duration is not None and trim_end is not None and trim_end > duration + _EPSILON:
            blocking.append(f"PART_TRIM_INVALID:{part_id}")

        if manual_offset is not None:
            offset = manual_offset
            placement_authority = "manual"
        elif trusted_epoch is not None and trusted_origin is not None:
            offset = max(0.0, trusted_epoch - trusted_origin)
            placement_authority = "trusted_absolute"
        elif single_source:
            offset = 0.0
            placement_authority = "single_source_origin"
        else:
            offset = None
            placement_authority = "unresolved"
            blocking.append(f"PART_PLACEMENT_UNRESOLVED:{part_id}")

        retained_end = trim_end if trim_end is not None else duration
        if retained_end is None and not single_source:
            blocking.append(f"PART_DURATION_UNRESOLVED:{part_id}")

        effective_start = None if offset is None else offset + trim_start
        effective_end = (
            None
            if offset is None or retained_end is None
            else offset + retained_end
        )

        projected.append(
            {
                "part_id": part_id,
                "source_id": source_id,
                "ordinal": ordinal,
                "start_time_confidence": classified["kind"],
                "normalized_start_time": classified["instant_utc"],
                "placement_authority": placement_authority,
                "local_duration_seconds": duration,
                "session_offset_seconds": offset,
                "trim_start_seconds": trim_start,
                "trim_end_seconds": trim_end,
                "effective_start_seconds": effective_start,
                "effective_end_seconds": effective_end,
            }
        )

    trusted_by_ordinal = [
        (
            item["ordinal"],
            _trusted_epoch(
                source_facts.get(str(item["part_id"]), {}).get("start_time")
            ),
            next(
                (
                    part.get("session_offset_seconds")
                    for part in parts
                    if part.get("part_id") == item["part_id"]
                ),
                None,
            ),
        )
        for item in projected
    ]
    previous_trusted: float | None = None
    for _ordinal, epoch, manual in trusted_by_ordinal:
        if epoch is None or manual is not None:
            continue
        if previous_trusted is not None and epoch + _EPSILON < previous_trusted:
            blocking.append("ORDER_CONFLICT")
            break
        previous_trusted = epoch

    relations: list[dict[str, object]] = []
    for index in range(1, len(projected)):
        earlier = projected[index - 1]
        later = projected[index]
        later_config = parts[index]
        earlier_end = earlier["effective_end_seconds"]
        later_start = later["effective_start_seconds"]

        relation: dict[str, object] = {
            "earlier_part_id": earlier["part_id"],
            "later_part_id": later["part_id"],
            "kind": "unknown",
            "seconds": None,
            "confirmed": False,
            "overlap_resolution": None,
        }

        if isinstance(earlier_end, (int, float)) and isinstance(later_start, (int, float)):
            delta = float(later_start) - float(earlier_end)
            if abs(delta) <= _EPSILON:
                relation.update({"kind": "contiguous", "seconds": 0.0, "confirmed": True})
            elif delta > 0:
                confirmed = bool(later_config.get("gap_confirmed", False))
                relation.update({"kind": "gap", "seconds": delta, "confirmed": confirmed})
                if not confirmed:
                    blocking.append(f"GAP_UNCONFIRMED:{later['part_id']}")
            else:
                overlap_seconds = -delta
                mode = later_config.get("overlap_resolution")
                boundary = _finite_non_negative(
                    later_config.get("overlap_boundary_seconds")
                )
                resolved = (
                    mode in OVERLAP_MODES
                    and boundary is not None
                    and float(later_start) - _EPSILON
                    <= boundary
                    <= float(earlier_end) + _EPSILON
                )
                relation.update(
                    {
                        "kind": "overlap",
                        "seconds": overlap_seconds,
                        "confirmed": resolved,
                        "overlap_resolution": (
                            {
                                "version": OVERLAP_RESOLUTION_VERSION,
                                "mode": mode,
                                "boundary_seconds": boundary,
                                "segment_policy": SEGMENT_BOUNDARY_POLICY,
                            }
                            if resolved
                            else None
                        ),
                    }
                )
                if not resolved:
                    blocking.append(f"OVERLAP_UNRESOLVED:{later['part_id']}")
        else:
            blocking.append(f"RELATION_UNRESOLVED:{later['part_id']}")

        relations.append(relation)

    unique_blocking = list(dict.fromkeys(blocking))
    return {
        "schema_version": CHRONOLOGY_SCHEMA,
        "segment_boundary_policy": SEGMENT_BOUNDARY_POLICY,
        "sha256": chronology_config_fingerprint(parts, source_facts),
        "ready_for_assembly": not unique_blocking,
        "blocking_reasons": unique_blocking,
        "parts": projected,
        "relations": relations,
    }
