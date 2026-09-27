from __future__ import annotations

from types import SimpleNamespace

import pytest

from tda_companion.session_timeline import (
    automatic_placements,
    classify_start_time,
    enrich_workspace_timeline,
    package_duration_seconds,
    validate_overlap_boundary,
)


def part(
    seed: int,
    ordinal: int,
    *,
    offset: float | None,
    trim_start: float = 0.0,
    trim_end: float | None = None,
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
            part(2, 1, offset=70.0),
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
