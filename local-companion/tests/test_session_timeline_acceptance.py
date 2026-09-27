from __future__ import annotations

from copy import deepcopy

import pytest

from tda_companion.session_timeline import (
    SessionTimelineError,
    build_session_timeline,
    classify_start_time,
    segment_owner_at_boundary,
    timeline_config_sha256,
)


PART_A = "a" * 32
PART_B = "b" * 32
PART_C = "c" * 32
SOURCE_A = f"craig-{'1' * 64}"
SOURCE_B = f"craig-{'2' * 64}"
SOURCE_C = f"craig-{'3' * 64}"


def part(part_id: str, source_id: str, ordinal: int, **overrides):
    value = {
        "part_id": part_id,
        "source_id": source_id,
        "ordinal": ordinal,
        "selected_run_id": None,
        "manual_offset_seconds": None,
        "trim_start_seconds": 0.0,
        "trim_end_seconds": None,
    }
    value.update(overrides)
    return value


def workspace(parts, *, order_authority="unconfirmed", decisions=None):
    return {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": 1,
        "order_authority": order_authority,
        "parts": parts,
        "timeline_decisions": decisions or [],
    }


def facts(*rows):
    return {
        part_id: {
            "source_state": "ready",
            "start_time": start,
            "duration_seconds": duration,
        }
        for part_id, start, duration in rows
    }


def test_start_time_confidence_requires_explicit_timezone():
    assert classify_start_time("2026-09-27T21:00:00Z")["confidence"] == "trusted_absolute"
    assert classify_start_time("2026-09-27T22:00:00+01:00")["instant_utc"] == "2026-09-27T21:00:00Z"
    assert classify_start_time("2026-09-27T21:00:00")["confidence"] == "ambiguous"
    assert classify_start_time("Craig says later")["confidence"] == "opaque"
    assert classify_start_time(None)["confidence"] == "missing"


@pytest.mark.parametrize(
    ("next_start", "expected_kind", "expected_seconds"),
    [
        ("2026-09-27T21:10:00Z", "contiguous", 0.0),
        ("2026-09-27T21:10:00.001000Z", "gap", 0.001),
        ("2026-09-27T21:40:00Z", "gap", 1800.0),
        ("2026-09-27T21:09:59.999000Z", "overlap", 0.001),
        ("2026-09-27T21:09:30Z", "overlap", 30.0),
    ],
)
def test_timeline_reports_contiguous_gap_and_overlap_without_inventing_continuity(
    next_start,
    expected_kind,
    expected_seconds,
):
    value = workspace(
        [part(PART_A, SOURCE_A, 0), part(PART_B, SOURCE_B, 1)]
    )
    timeline = build_session_timeline(
        value,
        facts(
            (PART_A, "2026-09-27T21:00:00Z", 600.0),
            (PART_B, next_start, 600.0),
        ),
    )
    relation = timeline["relations"][0]
    assert relation["kind"] == expected_kind
    assert relation["duration_seconds"] == pytest.approx(expected_seconds)
    assert relation["resolved"] is (expected_kind == "contiguous")
    assert timeline["ready"] is (expected_kind == "contiguous")


def test_gap_requires_explicit_acknowledgement_and_keeps_the_gap():
    value = workspace(
        [part(PART_A, SOURCE_A, 0), part(PART_B, SOURCE_B, 1)],
        decisions=[
            {
                "earlier_part_id": PART_A,
                "later_part_id": PART_B,
                "decision": "gap_acknowledged",
                "boundary_seconds": None,
            }
        ],
    )
    timeline = build_session_timeline(
        value,
        facts(
            (PART_A, "2026-09-27T21:00:00Z", 600.0),
            (PART_B, "2026-09-27T21:20:00Z", 600.0),
        ),
    )
    relation = timeline["relations"][0]
    assert relation == {
        "earlier_part_id": PART_A,
        "later_part_id": PART_B,
        "kind": "gap",
        "duration_seconds": 600.0,
        "decision": "gap_acknowledged",
        "boundary_seconds": None,
        "resolved": True,
    }
    assert timeline["ready"] is True


def test_overlap_uses_real_interval_intersection_when_later_part_is_contained():
    value = workspace(
        [part(PART_A, SOURCE_A, 0), part(PART_B, SOURCE_B, 1)]
    )
    timeline = build_session_timeline(
        value,
        facts(
            (PART_A, "2026-09-27T21:00:00Z", 600.0),
            (PART_B, "2026-09-27T21:01:40Z", 50.0),
        ),
    )
    relation = timeline["relations"][0]
    assert relation["kind"] == "overlap"
    assert relation["overlap_start_seconds"] == 100.0
    assert relation["overlap_end_seconds"] == 150.0
    assert relation["duration_seconds"] == 50.0


def test_overlap_resolution_is_explicit_bounded_and_versioned_by_config_hash():
    unresolved = workspace(
        [part(PART_A, SOURCE_A, 0), part(PART_B, SOURCE_B, 1)]
    )
    source_facts = facts(
        (PART_A, "2026-09-27T21:00:00Z", 600.0),
        (PART_B, "2026-09-27T21:09:30Z", 600.0),
    )
    first = build_session_timeline(unresolved, source_facts)
    assert first["relations"][0]["resolved"] is False
    assert first["ready"] is False

    resolved = deepcopy(unresolved)
    resolved["timeline_decisions"] = [
        {
            "earlier_part_id": PART_A,
            "later_part_id": PART_B,
            "decision": "prefer_earlier_until",
            "boundary_seconds": 585.0,
        }
    ]
    second = build_session_timeline(resolved, source_facts)
    assert second["relations"][0]["resolved"] is True
    assert second["relations"][0]["boundary_seconds"] == 585.0
    assert second["ready"] is True
    assert second["config_sha256"] != first["config_sha256"]


def test_equal_absolute_instants_do_not_manufacture_authoritative_order():
    value = workspace(
        [part(PART_A, SOURCE_A, 0), part(PART_B, SOURCE_B, 1)]
    )
    timeline = build_session_timeline(
        value,
        facts(
            (PART_A, "2026-09-27T21:00:00Z", 60.0),
            (PART_B, "2026-09-27T22:00:00+01:00", 60.0),
        ),
    )
    assert timeline["order"]["suggested_part_ids"] is None
    assert timeline["order"]["state"] == "manual_required"
    assert timeline["ready"] is False


@pytest.mark.parametrize(
    "start_time",
    ["2026-09-27T21:00:00", "opaque-clock", None],
)
def test_non_authoritative_start_time_never_auto_places_part(start_time):
    value = workspace([part(PART_A, SOURCE_A, 0)])
    timeline = build_session_timeline(
        value,
        facts((PART_A, start_time, 60.0)),
    )
    assert timeline["parts"][0]["session_offset_seconds"] is None
    assert timeline["parts"][0]["state"] == "unresolved"
    assert timeline["ready"] is False


def test_manual_offset_can_place_ambiguous_source_and_survives_as_authority():
    value = workspace(
        [part(PART_A, SOURCE_A, 0, manual_offset_seconds=12.5)],
        order_authority="manual",
    )
    timeline = build_session_timeline(
        value,
        facts((PART_A, "2026-09-27T21:00:00", 60.0)),
    )
    row = timeline["parts"][0]
    assert row["source_start"]["confidence"] == "ambiguous"
    assert row["placement_authority"] == "manual"
    assert row["session_offset_seconds"] == 12.5
    assert row["effective_start_seconds"] == 12.5
    assert timeline["ready"] is True


def test_reverse_non_overlapping_absolute_order_is_not_misreported_as_overlap():
    value = workspace(
        [part(PART_A, SOURCE_A, 0), part(PART_B, SOURCE_B, 1)],
        order_authority="manual",
    )
    timeline = build_session_timeline(
        value,
        facts(
            (PART_A, "2026-09-27T22:00:00Z", 60.0),
            (PART_B, "2026-09-27T21:00:00Z", 60.0),
        ),
    )
    assert timeline["relations"][0]["kind"] == "order_conflict"
    assert timeline["relations"][0]["resolved"] is False
    assert timeline["ready"] is False


def test_trim_changes_config_identity_without_mutating_source_timing():
    base = workspace([part(PART_A, SOURCE_A, 0)])
    trimmed = deepcopy(base)
    trimmed["parts"][0]["trim_start_seconds"] = 5.0
    trimmed["parts"][0]["trim_end_seconds"] = 55.0
    assert timeline_config_sha256(base) == timeline_config_sha256(deepcopy(base))
    assert timeline_config_sha256(base) != timeline_config_sha256(trimmed)

    timeline = build_session_timeline(
        trimmed,
        facts((PART_A, "2026-09-27T21:00:00Z", 60.0)),
    )
    row = timeline["parts"][0]
    assert row["duration_seconds"] == 60.0
    assert row["effective_start_seconds"] == 5.0
    assert row["effective_end_seconds"] == 55.0


def test_boundary_ownership_is_deterministic_for_exact_and_crossing_segments():
    assert segment_owner_at_boundary(9.999, 10.0) == "earlier"
    assert segment_owner_at_boundary(10.0, 10.0) == "later"
    # A segment crossing the boundary is owned by where it starts; no split/fuzzy merge.
    assert segment_owner_at_boundary(9.5, 10.0) == "earlier"


def test_three_parts_can_expose_gap_and_overlap_at_the_same_time():
    value = workspace(
        [
            part(PART_A, SOURCE_A, 0),
            part(PART_B, SOURCE_B, 1),
            part(PART_C, SOURCE_C, 2),
        ]
    )
    timeline = build_session_timeline(
        value,
        facts(
            (PART_A, "2026-09-27T21:00:00Z", 300.0),
            (PART_B, "2026-09-27T21:10:00Z", 300.0),
            (PART_C, "2026-09-27T21:14:30Z", 300.0),
        ),
    )
    assert [relation["kind"] for relation in timeline["relations"]] == ["gap", "overlap"]
    assert timeline["relations"][0]["duration_seconds"] == 300.0
    assert timeline["relations"][1]["duration_seconds"] == 30.0
    assert timeline["ready"] is False


def test_invalid_trim_fails_closed():
    value = workspace(
        [part(PART_A, SOURCE_A, 0, trim_start_seconds=61.0)]
    )
    timeline = build_session_timeline(
        value,
        facts((PART_A, "2026-09-27T21:00:00Z", 60.0)),
    )
    assert timeline["parts"][0]["state"] == "invalid"
    assert timeline["ready"] is False

    with pytest.raises(SessionTimelineError, match="SESSION_TIMELINE_TRIM_INVALID"):
        timeline_config_sha256(
            workspace(
                [
                    part(
                        PART_A,
                        SOURCE_A,
                        0,
                        trim_start_seconds=20.0,
                        trim_end_seconds=10.0,
                    )
                ]
            )
        )
