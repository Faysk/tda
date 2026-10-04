from __future__ import annotations

from types import SimpleNamespace

import pytest

from tda_companion.session_timeline import (
    project_trusted_absolute_time,
    automatic_placements,
    classify_start_time,
    enrich_workspace_timeline,
    package_duration_seconds,
    segment_owner_at_boundary,
    validate_overlap_boundary,
    user_confirmed_sequence_placements,
)


def part(
    seed: int,
    ordinal: int,
    *,
    offset: float | None,
    trim_start: float = 0.0,
    trim_end: float | None = None,
    gap_confirmed: bool = False,
    resolution: str | None = None,
    boundary: float | None = None,
):
    return {
        "part_id": f"{seed:032x}",
        "source_id": f"craig-{seed:064x}",
        "ordinal": ordinal,
        "selected_run_id": None,
        "timeline_mode": "manual" if offset is not None else "unresolved",
        "session_offset_seconds": offset,
        "trim_start_seconds": trim_start,
        "trim_end_seconds": trim_end,
        "gap_confirmed": gap_confirmed,
        "overlap_resolution": resolution,
        "overlap_boundary_seconds": boundary,
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
    }


def facts(seed: int, *, start: str | None, duration: float):
    classified = classify_start_time(start)
    return (
        f"craig-{seed:064x}",
        {
            "source_state": "ready",
            "start_time": start,
            "start_confidence": classified["confidence"],
            "start_utc": classified["instant_utc"],
            "start_epoch_seconds": classified["epoch_seconds"],
            "duration_seconds": duration,
        },
    )


@pytest.mark.parametrize(
    ("value", "confidence", "utc"),
    [
        ("2026-09-27T21:00:00Z", "trusted_absolute", "2026-09-27T21:00:00Z"),
        (
            "2026-09-27T22:00:00+01:00",
            "trusted_absolute",
            "2026-09-27T21:00:00Z",
        ),
        ("2026-09-27T21:00:00", "ambiguous", None),
        ("21:00:00", "ambiguous", None),
        ("21:00:00+01:00", "ambiguous", None),
        ("Craig sometime after dinner", "opaque", None),
        (None, "missing", None),
    ],
)
def test_start_time_confidence_is_fail_closed(value, confidence, utc):
    classified = classify_start_time(value)
    assert classified["confidence"] == confidence
    assert classified["instant_utc"] == utc


def test_package_duration_uses_session_extent_not_audio_work():
    package = SimpleNamespace(
        tracks=(
            SimpleNamespace(timeline_offset_seconds=0.0, duration_seconds=10.0),
            SimpleNamespace(timeline_offset_seconds=5.0, duration_seconds=10.0),
        )
    )
    assert package_duration_seconds(package) == 15.0


def test_automatic_placement_requires_every_source_to_have_absolute_time():
    parts = [part(1, 0, offset=None), part(2, 1, offset=None)]
    trusted = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=60),
            facts(2, start="2026-09-27T20:01:00+00:00", duration=60),
        ]
    )
    placements = automatic_placements(parts, trusted)
    assert [item["source_id"] for item in placements] == [
        f"craig-{1:064x}",
        f"craig-{2:064x}",
    ]
    assert [item["session_offset_seconds"] for item in placements] == [0.0, 60.0]

    ambiguous = dict(trusted)
    ambiguous[f"craig-{2:064x}"] = dict(
        ambiguous[f"craig-{2:064x}"],
        start_confidence="ambiguous",
        start_epoch_seconds=None,
    )
    with pytest.raises(ValueError, match="SESSION_WORKSPACE_TIMELINE_NOT_TRUSTED"):
        automatic_placements(parts, ambiguous)


def test_equal_absolute_starts_require_manual_order_instead_of_synthetic_tiebreak():
    parts = [
        part(2, 0, offset=None),
        part(1, 1, offset=None),
    ]
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=60.0),
            facts(2, start="2026-09-27T21:00:00+01:00", duration=60.0),
        ]
    )

    with pytest.raises(
        ValueError, match="SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS"
    ):
        automatic_placements(parts, source_facts)

    unresolved = enrich_workspace_timeline(
        {
            "schema_version": "tda_session_workspace_v1",
            "campaign_id": "campaign-a",
            "session_id": "session-a",
            "revision": 2,
            "ordering_mode": "attachment",
            "created_at": "2026-09-27T22:00:00Z",
            "updated_at": "2026-09-27T22:00:00Z",
            "parts": parts,
        },
        source_facts,
    )
    assert unresolved["timeline"]["all_sources_trusted"] is True
    assert unresolved["timeline"]["automatic_order_available"] is False


def test_explicit_dst_offsets_preserve_absolute_meaning():
    summer = classify_start_time("2026-10-25T01:30:00+01:00")
    same_instant = classify_start_time("2026-10-25T00:30:00Z")
    winter_offset = classify_start_time("2026-10-25T01:30:00+00:00")

    assert summer["confidence"] == "trusted_absolute"
    assert summer["instant_utc"] == same_instant["instant_utc"]
    assert winter_offset["confidence"] == "trusted_absolute"
    assert winter_offset["instant_utc"] != summer["instant_utc"]


def test_gap_overlap_and_resolution_are_explicit_and_deterministic():
    workspace = {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": 4,
        "ordering_mode": "manual",
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
        "parts": [
            part(1, 0, offset=0.0),
            part(2, 1, offset=70.0, gap_confirmed=True),
            part(
                3,
                2,
                offset=110.0,
                resolution="prefer_earlier_until",
                boundary=115.0,
            ),
        ],
    }
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=60.0),
            facts(2, start="2026-09-27T20:01:10Z", duration=50.0),
            facts(3, start="2026-09-27T20:01:50Z", duration=30.0),
        ]
    )
    first = enrich_workspace_timeline(workspace, source_facts)
    second = enrich_workspace_timeline(workspace, source_facts)

    assert first["parts"][1]["relation_to_previous"] == "gap"
    assert first["parts"][1]["relation_seconds"] == 10.0
    assert first["parts"][2]["relation_to_previous"] == "overlap"
    assert first["parts"][2]["relation_seconds"] == 10.0
    assert first["parts"][2]["overlap_resolution_valid"] is True
    assert first["timeline"]["gap_count"] == 1
    assert first["timeline"]["overlap_count"] == 1
    assert first["timeline"]["unresolved_overlap_count"] == 0
    assert first["timeline"]["unconfirmed_gap_count"] == 0
    assert first["timeline"]["segment_boundary_policy"] == "segment_start_owner_v1"
    assert first["timeline"]["state"] == "ready"
    assert (
        first["timeline"]["fingerprint_sha256"]
        == second["timeline"]["fingerprint_sha256"]
    )
    validate_overlap_boundary(first, first["parts"][2]["part_id"])


def test_unresolved_overlap_blocks_readiness_and_trim_changes_fingerprint():
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=60.0),
            facts(2, start="2026-09-27T20:00:50Z", duration=60.0),
        ]
    )
    base = {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": 2,
        "ordering_mode": "manual",
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
        "parts": [
            part(1, 0, offset=0.0),
            part(2, 1, offset=50.0),
        ],
    }
    unresolved = enrich_workspace_timeline(base, source_facts)
    assert unresolved["timeline"]["state"] == "overlap_unresolved"
    assert unresolved["timeline"]["unresolved_overlap_count"] == 1

    changed = {
        **base,
        "parts": [
            base["parts"][0],
            {
                **base["parts"][1],
                "trim_start_seconds": 10.0,
            },
        ],
    }
    trimmed = enrich_workspace_timeline(changed, source_facts)
    assert (
        unresolved["timeline"]["fingerprint_sha256"]
        != trimmed["timeline"]["fingerprint_sha256"]
    )
    assert trimmed["parts"][1]["effective_start_seconds"] == 60.0
    assert trimmed["parts"][1]["relation_to_previous"] == "contiguous"
    assert trimmed["timeline"]["state"] == "ready"


def test_overlap_boundary_outside_real_overlap_is_rejected():
    workspace = {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": 2,
        "ordering_mode": "manual",
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
        "parts": [
            part(1, 0, offset=0.0),
            part(
                2,
                1,
                offset=50.0,
                resolution="prefer_later_from",
                boundary=80.0,
            ),
        ],
    }
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=60.0),
            facts(2, start="2026-09-27T20:00:50Z", duration=60.0),
        ]
    )
    enriched = enrich_workspace_timeline(workspace, source_facts)
    assert enriched["parts"][1]["overlap_resolution_valid"] is False
    with pytest.raises(
        ValueError, match="SESSION_WORKSPACE_OVERLAP_BOUNDARY_INVALID"
    ):
        validate_overlap_boundary(enriched, workspace["parts"][1]["part_id"])


def test_gap_requires_explicit_confirmation_before_timeline_is_ready():
    workspace = {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": 2,
        "ordering_mode": "manual",
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
        "parts": [
            part(1, 0, offset=0.0),
            part(2, 1, offset=61.0),
        ],
    }
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=60.0),
            facts(2, start="2026-09-27T20:01:01Z", duration=30.0),
        ]
    )

    unconfirmed = enrich_workspace_timeline(workspace, source_facts)
    assert unconfirmed["parts"][1]["relation_to_previous"] == "gap"
    assert unconfirmed["timeline"]["gap_count"] == 1
    assert unconfirmed["timeline"]["unconfirmed_gap_count"] == 1
    assert unconfirmed["timeline"]["state"] == "gap_unconfirmed"

    confirmed_workspace = {
        **workspace,
        "parts": [
            workspace["parts"][0],
            {**workspace["parts"][1], "gap_confirmed": True},
        ],
    }
    confirmed = enrich_workspace_timeline(confirmed_workspace, source_facts)
    assert confirmed["timeline"]["unconfirmed_gap_count"] == 0
    assert confirmed["timeline"]["state"] == "ready"
    assert (
        confirmed["timeline"]["fingerprint_sha256"]
        != unconfirmed["timeline"]["fingerprint_sha256"]
    )


def test_segment_boundary_ownership_is_versioned_and_start_based():
    assert segment_owner_at_boundary(9.999, 10.0) == "earlier"
    assert segment_owner_at_boundary(10.0, 10.0) == "later"
    assert segment_owner_at_boundary(10.001, 10.0) == "later"

    with pytest.raises(
        ValueError, match="SESSION_WORKSPACE_SEGMENT_BOUNDARY_INVALID"
    ):
        segment_owner_at_boundary(-0.001, 10.0)


def test_contained_overlap_uses_real_interval_intersection_for_duration_and_boundary():
    workspace = {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-contained",
        "session_id": "session-contained",
        "revision": 2,
        "ordering_mode": "manual",
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
        "parts": [
            part(1, 0, offset=0.0),
            part(
                2,
                1,
                offset=100.0,
                trim_end=50.0,
                resolution="prefer_earlier_until",
                boundary=125.0,
            ),
        ],
    }
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=600.0),
            facts(2, start="2026-09-27T20:01:40Z", duration=50.0),
        ]
    )

    enriched = enrich_workspace_timeline(workspace, source_facts)
    current = enriched["parts"][1]

    assert current["relation_to_previous"] == "overlap"
    assert current["relation_seconds"] == 50.0
    assert current["overlap_resolution_valid"] is True
    assert enriched["timeline"]["state"] == "ready"

    outside = {
        **workspace,
        "parts": [
            workspace["parts"][0],
            {**workspace["parts"][1], "overlap_boundary_seconds": 200.0},
        ],
    }
    invalid = enrich_workspace_timeline(outside, source_facts)
    assert invalid["parts"][1]["overlap_resolution_valid"] is False
    assert invalid["timeline"]["state"] == "overlap_unresolved"
    with pytest.raises(ValueError, match="SESSION_WORKSPACE_OVERLAP_BOUNDARY_INVALID"):
        validate_overlap_boundary(invalid, invalid["parts"][1]["part_id"])


def test_reverse_disjoint_manual_parts_are_order_conflict_not_overlap():
    workspace = {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-reverse",
        "session_id": "session-reverse",
        "revision": 2,
        "ordering_mode": "manual",
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
        "parts": [
            part(1, 0, offset=60.0, trim_end=30.0),
            part(
                2,
                1,
                offset=0.0,
                trim_end=30.0,
                resolution="prefer_later_from",
                boundary=15.0,
            ),
        ],
    }
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:01:00Z", duration=30.0),
            facts(2, start="2026-09-27T20:00:00Z", duration=30.0),
        ]
    )

    enriched = enrich_workspace_timeline(workspace, source_facts)
    current = enriched["parts"][1]

    assert current["relation_to_previous"] == "order_conflict"
    assert current["relation_seconds"] is None
    assert current["overlap_resolution_valid"] is False
    assert enriched["timeline"]["state"] == "order_conflict"
    assert enriched["timeline"]["order_conflict_count"] == 1
    assert enriched["timeline"]["overlap_count"] == 0
    assert enriched["timeline"]["unresolved_overlap_count"] == 0
    with pytest.raises(ValueError, match="SESSION_WORKSPACE_OVERLAP_RESOLUTION_INVALID"):
        validate_overlap_boundary(enriched, current["part_id"])


def test_exact_touch_and_one_millisecond_gap_overlap_remain_distinct():
    source_facts = dict(
        [
            facts(1, start="2026-09-27T20:00:00Z", duration=60.0),
            facts(2, start="2026-09-27T20:01:00Z", duration=30.0),
        ]
    )
    base = {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-boundary",
        "session_id": "session-boundary",
        "revision": 2,
        "ordering_mode": "manual",
        "created_at": "2026-09-27T22:00:00Z",
        "updated_at": "2026-09-27T22:00:00Z",
    }

    touching = enrich_workspace_timeline(
        {
            **base,
            "parts": [
                part(1, 0, offset=0.0),
                part(2, 1, offset=60.0),
            ],
        },
        source_facts,
    )
    assert touching["parts"][1]["relation_to_previous"] == "contiguous"
    assert touching["parts"][1]["relation_seconds"] == 0.0
    assert touching["timeline"]["state"] == "ready"

    gap = enrich_workspace_timeline(
        {
            **base,
            "parts": [
                part(1, 0, offset=0.0),
                part(2, 1, offset=60.001, gap_confirmed=True),
            ],
        },
        source_facts,
    )
    assert gap["parts"][1]["relation_to_previous"] == "gap"
    assert gap["parts"][1]["relation_seconds"] == pytest.approx(0.001)
    assert gap["timeline"]["state"] == "ready"

    overlap = enrich_workspace_timeline(
        {
            **base,
            "parts": [
                part(1, 0, offset=0.0),
                part(
                    2,
                    1,
                    offset=59.999,
                    resolution="prefer_later_from",
                    boundary=59.9995,
                ),
            ],
        },
        source_facts,
    )
    assert overlap["parts"][1]["relation_to_previous"] == "overlap"
    assert overlap["parts"][1]["relation_seconds"] == pytest.approx(0.001)
    assert overlap["parts"][1]["overlap_resolution_valid"] is True
    assert overlap["timeline"]["state"] == "ready"


def test_project_trusted_absolute_time_preserves_explicit_offset_and_rolls_midnight():
    assert project_trusted_absolute_time(
        "2026-09-12T23:59:59+01:00",
        "trusted_absolute",
        3.25,
    ) == "2026-09-13T00:00:02.250+01:00"
    assert project_trusted_absolute_time(
        "2026-09-12T22:34:23Z",
        "trusted_absolute",
        0,
    ) == "2026-09-12T22:34:23.000Z"


@pytest.mark.parametrize("confidence", ["ambiguous", "opaque", "missing"])
def test_project_trusted_absolute_time_never_invents_untrusted_wall_clock(confidence):
    assert project_trusted_absolute_time(
        "2026-09-12T22:34:23+01:00",
        confidence,
        44,
    ) is None


def test_project_trusted_absolute_time_rechecks_claimed_trust():
    assert project_trusted_absolute_time(
        "22:34:23",
        "trusted_absolute",
        44,
    ) is None



def _sequence_workspace(count: int, source_facts: dict[str, dict[str, object]]):
    raw_parts = [part(seed, seed - 1, offset=None) for seed in range(1, count + 1)]
    placements = user_confirmed_sequence_placements(raw_parts, source_facts)
    by_part = {row["part_id"]: row for row in placements}
    resolved_parts = [
        {
            **row,
            "timeline_mode": "sequence",
            "session_offset_seconds": by_part[row["part_id"]]["session_offset_seconds"],
        }
        for row in raw_parts
    ]
    return enrich_workspace_timeline(
        {
            "schema_version": "tda_session_workspace_v1",
            "campaign_id": "campaign-sequence",
            "session_id": "session-sequence",
            "revision": count,
            "ordering_mode": "manual",
            "created_at": "2026-10-04T00:00:00Z",
            "updated_at": "2026-10-04T00:00:00Z",
            "parts": resolved_parts,
        },
        source_facts,
    )


@pytest.mark.parametrize("count", [2, 3, 20])
def test_user_confirmed_sequence_builds_continuous_editorial_timeline_without_wall_clock(count):
    source_facts = dict(
        facts(seed, start=None, duration=float(10 + seed))
        for seed in range(1, count + 1)
    )

    first = _sequence_workspace(count, source_facts)
    second = _sequence_workspace(count, source_facts)

    expected_offsets = []
    cursor = 0.0
    for seed in range(1, count + 1):
        expected_offsets.append(cursor)
        cursor += float(10 + seed)

    assert [row["session_offset_seconds"] for row in first["parts"]] == expected_offsets
    assert first["timeline"]["policy_version"] == "tda_session_timeline_v2"
    assert first["timeline"]["strategy"] == "user_confirmed_sequence"
    assert first["timeline"]["wall_clock"] == "unavailable"
    assert first["timeline"]["unknown_interval_count"] == count - 1
    assert first["timeline"]["state"] == "ready"
    assert all(
        row["relation_to_previous"] == "contiguous"
        for row in first["parts"][1:]
    )
    assert all(
        row["physical_interval_state"] == "unknown"
        for row in first["parts"][1:]
    )
    assert first["timeline"]["fingerprint_sha256"] == second["timeline"]["fingerprint_sha256"]


def test_sequence_preserves_trusted_gap_and_does_not_require_manual_gap_confirmation():
    raw_parts = [part(1, 0, offset=None), part(2, 1, offset=None)]
    source_facts = dict(
        [
            facts(1, start="2026-10-04T20:00:00Z", duration=60.0),
            facts(2, start="2026-10-04T20:11:00Z", duration=30.0),
        ]
    )
    placements = user_confirmed_sequence_placements(raw_parts, source_facts)
    assert [row["session_offset_seconds"] for row in placements] == [0.0, 660.0]
    workspace = _sequence_workspace(2, source_facts)

    assert workspace["parts"][1]["relation_to_previous"] == "gap"
    assert workspace["parts"][1]["relation_seconds"] == 600.0
    assert workspace["parts"][1]["physical_interval_state"] == "trusted_absolute"
    assert workspace["parts"][1]["gap_confirmed"] is False
    assert workspace["timeline"]["unconfirmed_gap_count"] == 0
    assert workspace["timeline"]["unknown_interval_count"] == 0
    assert workspace["timeline"]["wall_clock"] == "trusted"
    assert workspace["timeline"]["state"] == "ready"


def test_sequence_partial_wall_clock_keeps_unknown_interval_explicit_not_zero():
    source_facts = dict(
        [
            facts(1, start="2026-10-04T23:59:30+01:00", duration=30.0),
            facts(2, start="2026-10-05T00:00:00+01:00", duration=45.0),
            facts(3, start=None, duration=20.0),
        ]
    )
    workspace = _sequence_workspace(3, source_facts)

    assert [row["session_offset_seconds"] for row in workspace["parts"]] == [
        0.0,
        30.0,
        75.0,
    ]
    assert workspace["timeline"]["wall_clock"] == "partial"
    assert workspace["timeline"]["unknown_interval_count"] == 1
    assert workspace["parts"][1]["physical_interval_state"] == "trusted_absolute"
    assert workspace["parts"][2]["physical_interval_state"] == "unknown"
    assert workspace["parts"][2]["relation_to_previous"] == "contiguous"
    assert workspace["parts"][2]["relation_seconds"] == 0.0
    assert workspace["parts"][2]["source_start_utc"] is None


def test_sequence_proven_overlap_remains_fail_closed_until_explicit_boundary():
    source_facts = dict(
        [
            facts(1, start="2026-10-04T20:00:00Z", duration=60.0),
            facts(2, start="2026-10-04T20:00:50Z", duration=60.0),
        ]
    )
    workspace = _sequence_workspace(2, source_facts)

    assert workspace["parts"][1]["relation_to_previous"] == "overlap"
    assert workspace["parts"][1]["relation_seconds"] == 10.0
    assert workspace["parts"][1]["physical_interval_state"] == "trusted_absolute"
    assert workspace["timeline"]["state"] == "overlap_unresolved"
    assert workspace["timeline"]["unresolved_overlap_count"] == 1


def test_sequence_rejects_trusted_reverse_order_instead_of_hiding_conflict():
    raw_parts = [part(2, 0, offset=None), part(1, 1, offset=None)]
    source_facts = dict(
        [
            facts(1, start="2026-10-04T20:00:00Z", duration=30.0),
            facts(2, start="2026-10-04T20:01:00Z", duration=30.0),
        ]
    )

    with pytest.raises(
        ValueError, match="SESSION_WORKSPACE_TIMELINE_ORDER_CONFLICT"
    ):
        user_confirmed_sequence_placements(raw_parts, source_facts)
