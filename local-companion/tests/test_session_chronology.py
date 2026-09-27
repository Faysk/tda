from __future__ import annotations

from types import SimpleNamespace

import pytest

from tda_companion.session_chronology import (
    SessionChronologyError,
    build_session_chronology,
    canonical_session_part_timing,
    classify_start_time,
    default_session_part_timing,
)


def package(start_time, duration, *, offset=0.0):
    return SimpleNamespace(
        start_time=start_time,
        tracks=(
            SimpleNamespace(
                timeline_offset_seconds=offset,
                duration_seconds=duration,
            ),
        ),
    )


def part(seed, ordinal, timing=None):
    return {
        "part_id": f"{seed:032x}",
        "source_id": f"craig-{seed:064x}",
        "ordinal": ordinal,
        "timing": timing or default_session_part_timing(),
    }


@pytest.mark.parametrize(
    ("value", "confidence"),
    [
        ("2026-09-27T21:00:00Z", "trusted_absolute"),
        ("2026-09-27T22:00:00+01:00", "trusted_absolute"),
        ("2026-09-27T21:00:00", "ambiguous"),
        ("Craig started eventually", "opaque"),
        (None, "missing"),
    ],
)
def test_start_time_confidence_is_fail_closed(value, confidence):
    parsed = classify_start_time(value)
    assert parsed["confidence"] == confidence
    if confidence == "trusted_absolute":
        assert parsed["normalized_utc"] == "2026-09-27T21:00:00.000000Z"
        assert parsed["epoch_seconds"] is not None
    else:
        assert parsed["normalized_utc"] is None
        assert parsed["epoch_seconds"] is None


def test_absolute_clocks_normalize_across_timezone_offsets():
    values = [
        classify_start_time("2026-10-25T01:30:00Z"),
        classify_start_time("2026-10-25T02:30:00+01:00"),
    ]
    assert values[0]["epoch_seconds"] == values[1]["epoch_seconds"]


def test_automatic_chronology_preserves_gap_and_requires_confirmation():
    parts = [part(1, 0), part(2, 1)]
    packages = {
        parts[0]["source_id"]: package("2026-09-27T21:00:00Z", 60.0),
        parts[1]["source_id"]: package("2026-09-27T21:01:00.001Z", 60.0),
    }
    chronology = build_session_chronology(parts, packages)
    second = chronology["parts"][1]
    assert chronology["resolved_part_order"] == [
        parts[0]["part_id"],
        parts[1]["part_id"],
    ]
    assert second["relation_to_previous"]["kind"] == "gap"
    assert second["relation_to_previous"]["seconds"] == pytest.approx(0.001, abs=1e-6)
    assert "gap_unconfirmed" in chronology["blocking_reasons"]
    assert chronology["ready_for_assembly"] is False

    confirmed = default_session_part_timing()
    confirmed["gap_confirmed"] = True
    parts[1]["timing"] = confirmed
    chronology = build_session_chronology(parts, packages)
    assert chronology["parts"][1]["relation_to_previous"]["resolved"] is True
    assert chronology["ready_for_assembly"] is True


def test_overlap_requires_explicit_bounded_resolution_and_defines_boundary_ownership():
    parts = [part(1, 0), part(2, 1)]
    packages = {
        parts[0]["source_id"]: package("2026-09-27T21:00:00Z", 90.0),
        parts[1]["source_id"]: package("2026-09-27T21:01:00Z", 60.0),
    }
    unresolved = build_session_chronology(parts, packages)
    relation = unresolved["parts"][1]["relation_to_previous"]
    assert relation["kind"] == "overlap"
    assert relation["seconds"] == pytest.approx(30.0)
    assert relation["resolved"] is False
    assert "overlap_unresolved" in unresolved["blocking_reasons"]

    resolved_timing = default_session_part_timing()
    resolved_timing["overlap_resolution"] = {
        "schema_version": "tda_session_overlap_resolution_v1",
        "policy": "prefer_later_from",
        "boundary_seconds": 75.0,
    }
    parts[1]["timing"] = resolved_timing
    resolved = build_session_chronology(parts, packages)
    relation = resolved["parts"][1]["relation_to_previous"]
    assert relation["resolved"] is True
    assert relation["boundary_ownership"] == "later_owns_segment_start_at_boundary"
    assert resolved["ready_for_assembly"] is True


def test_ambiguous_and_opaque_times_never_become_authoritative_order():
    parts = [part(1, 0), part(2, 1)]
    packages = {
        parts[0]["source_id"]: package("2026-09-27T21:00:00", 30.0),
        parts[1]["source_id"]: package("not-a-time", 30.0),
    }
    chronology = build_session_chronology(parts, packages)
    assert chronology["suggested_part_order"] is None
    assert chronology["resolved_part_order"] is None
    assert chronology["blocking_reasons"] == ["offset_unknown"]


def test_manual_offsets_survive_as_authority_and_change_the_config_hash():
    first_timing = {
        **default_session_part_timing(),
        "mode": "manual",
        "session_offset_seconds": 0.0,
    }
    second_timing = {
        **default_session_part_timing(),
        "mode": "manual",
        "session_offset_seconds": 30.0,
    }
    parts = [part(1, 0, first_timing), part(2, 1, second_timing)]
    packages = {
        parts[0]["source_id"]: package(None, 30.0),
        parts[1]["source_id"]: package(None, 30.0),
    }
    original = build_session_chronology(parts, packages, order_provenance="manual")
    repeated = build_session_chronology(parts, packages, order_provenance="manual")
    assert original["config_sha256"] == repeated["config_sha256"]
    assert original["ready_for_assembly"] is True

    changed = {
        **second_timing,
        "session_offset_seconds": 31.0,
        "gap_confirmed": True,
    }
    parts[1]["timing"] = changed
    updated = build_session_chronology(parts, packages, order_provenance="manual")
    assert updated["config_sha256"] != original["config_sha256"]


def test_manual_order_conflicting_with_offsets_fails_closed():
    parts = [
        part(
            1,
            0,
            {
                **default_session_part_timing(),
                "mode": "manual",
                "session_offset_seconds": 60.0,
            },
        ),
        part(
            2,
            1,
            {
                **default_session_part_timing(),
                "mode": "manual",
                "session_offset_seconds": 0.0,
            },
        ),
    ]
    packages = {
        parts[0]["source_id"]: package(None, 30.0),
        parts[1]["source_id"]: package(None, 30.0),
    }
    chronology = build_session_chronology(parts, packages, order_provenance="manual")
    assert "manual_order_conflicts_with_offsets" in chronology["blocking_reasons"]
    assert chronology["ready_for_assembly"] is False


def test_trims_are_composition_only_and_can_resolve_source_overlap():
    first = part(1, 0)
    second_timing = {
        **default_session_part_timing(),
        "mode": "manual",
        "session_offset_seconds": 50.0,
        "trim_start_seconds": 10.0,
    }
    second = part(2, 1, second_timing)
    packages = {
        first["source_id"]: package("2026-09-27T21:00:00Z", 60.0),
        second["source_id"]: package(None, 60.0),
    }
    chronology = build_session_chronology([first, second], packages)
    assert chronology["parts"][1]["effective_start_seconds"] == 60.0
    assert chronology["parts"][1]["relation_to_previous"]["kind"] == "contiguous"
    assert chronology["ready_for_assembly"] is True


def test_invalid_timing_payloads_are_rejected():
    with pytest.raises(SessionChronologyError, match="SESSION_WORKSPACE_TIMING_INVALID"):
        canonical_session_part_timing(
            {
                **default_session_part_timing(),
                "mode": "automatic",
                "session_offset_seconds": 1.0,
            }
        )
    with pytest.raises(SessionChronologyError, match="SESSION_WORKSPACE_TIMING_INVALID"):
        canonical_session_part_timing(
            {
                **default_session_part_timing(),
                "trim_start_seconds": 10.0,
                "trim_end_seconds": 5.0,
            }
        )
