from __future__ import annotations

import pytest

from tda_companion.recording_chronology import (
    CHRONOLOGY_SCHEMA,
    classify_start_time,
    derive_recording_chronology,
)


def part(
    part_id: str,
    source_id: str,
    ordinal: int,
    *,
    offset: float | None = None,
    trim_start: float = 0.0,
    trim_end: float | None = None,
    gap_confirmed: bool = False,
    overlap_resolution: str | None = None,
    overlap_boundary: float | None = None,
):
    return {
        "part_id": part_id,
        "source_id": source_id,
        "ordinal": ordinal,
        "session_offset_seconds": offset,
        "trim_start_seconds": trim_start,
        "trim_end_seconds": trim_end,
        "gap_confirmed": gap_confirmed,
        "overlap_resolution": overlap_resolution,
        "overlap_boundary_seconds": overlap_boundary,
    }


def facts(start_time: str | None, duration: float | None):
    return {"start_time": start_time, "duration_seconds": duration}


@pytest.mark.parametrize(
    ("value", "kind", "instant"),
    [
        ("2026-09-27T20:00:00Z", "trusted_absolute", "2026-09-27T20:00:00Z"),
        (
            "2026-09-27T21:00:00+01:00",
            "trusted_absolute",
            "2026-09-27T20:00:00Z",
        ),
        ("2026-09-27T20:00:00", "ambiguous", None),
        ("domingo depois da sessão", "opaque", None),
        (None, "missing", None),
        ("", "missing", None),
    ],
)
def test_start_time_confidence_requires_an_explicit_timezone(value, kind, instant):
    classified = classify_start_time(value)
    assert classified == {"kind": kind, "instant_utc": instant}


def test_trusted_absolute_timestamps_derive_deterministic_contiguous_offsets():
    parts = [
        part("a" * 32, "craig-" + "1" * 64, 0),
        part("b" * 32, "craig-" + "2" * 64, 1),
    ]
    source_facts = {
        "a" * 32: facts("2026-09-27T20:00:00Z", 60.0),
        "b" * 32: facts("2026-09-27T21:01:00+01:00", 30.0),
    }

    chronology = derive_recording_chronology(parts, source_facts)

    assert chronology["schema_version"] == CHRONOLOGY_SCHEMA
    assert chronology["ready_for_assembly"] is True
    assert chronology["blocking_reasons"] == []
    assert chronology["parts"][0]["session_offset_seconds"] == 0.0
    assert chronology["parts"][1]["session_offset_seconds"] == 60.0
    assert chronology["relations"] == [
        {
            "earlier_part_id": "a" * 32,
            "later_part_id": "b" * 32,
            "kind": "contiguous",
            "seconds": 0.0,
            "confirmed": True,
            "overlap_resolution": None,
        }
    ]
    assert len(chronology["sha256"]) == 64
    assert chronology["sha256"] == derive_recording_chronology(parts, source_facts)["sha256"]


@pytest.mark.parametrize(
    ("start_time", "expected_kind"),
    [
        ("2026-09-27T20:00:00", "ambiguous"),
        ("hora do Craig", "opaque"),
        (None, "missing"),
    ],
)
def test_untrusted_multi_part_start_time_never_becomes_authoritative_offset(
    start_time,
    expected_kind,
):
    parts = [
        part("a" * 32, "craig-" + "1" * 64, 0),
        part("b" * 32, "craig-" + "2" * 64, 1),
    ]
    source_facts = {
        "a" * 32: facts("2026-09-27T20:00:00Z", 60.0),
        "b" * 32: facts(start_time, 30.0),
    }

    chronology = derive_recording_chronology(parts, source_facts)

    second = chronology["parts"][1]
    assert second["start_time_confidence"] == expected_kind
    assert second["placement_authority"] == "unresolved"
    assert second["session_offset_seconds"] is None
    assert f"PART_PLACEMENT_UNRESOLVED:{'b' * 32}" in chronology["blocking_reasons"]
    assert chronology["ready_for_assembly"] is False


def test_single_source_remains_compatible_without_absolute_clock():
    parts = [part("a" * 32, "craig-" + "1" * 64, 0)]
    source_facts = {"a" * 32: facts(None, 90.0)}

    chronology = derive_recording_chronology(parts, source_facts)

    assert chronology["ready_for_assembly"] is True
    assert chronology["parts"][0]["placement_authority"] == "single_source_origin"
    assert chronology["parts"][0]["session_offset_seconds"] == 0.0


def test_gap_is_preserved_and_requires_explicit_confirmation():
    a = "a" * 32
    b = "b" * 32
    source_facts = {
        a: facts(None, 60.0),
        b: facts(None, 30.0),
    }
    unresolved = [
        part(a, "craig-" + "1" * 64, 0, offset=0.0),
        part(b, "craig-" + "2" * 64, 1, offset=60.001),
    ]

    first = derive_recording_chronology(unresolved, source_facts)
    assert first["relations"][0]["kind"] == "gap"
    assert first["relations"][0]["seconds"] == pytest.approx(0.001)
    assert first["relations"][0]["confirmed"] is False
    assert f"GAP_UNCONFIRMED:{b}" in first["blocking_reasons"]

    confirmed = [unresolved[0], {**unresolved[1], "gap_confirmed": True}]
    second = derive_recording_chronology(confirmed, source_facts)
    assert second["relations"][0]["confirmed"] is True
    assert second["ready_for_assembly"] is True
    assert second["sha256"] != first["sha256"]


@pytest.mark.parametrize("overlap", [0.001, 30.0, 180.0])
def test_overlap_blocks_until_boundary_resolution_is_explicit(overlap):
    a = "a" * 32
    b = "b" * 32
    source_facts = {
        a: facts(None, 300.0),
        b: facts(None, 120.0),
    }
    unresolved = [
        part(a, "craig-" + "1" * 64, 0, offset=0.0),
        part(b, "craig-" + "2" * 64, 1, offset=300.0 - overlap),
    ]

    first = derive_recording_chronology(unresolved, source_facts)
    relation = first["relations"][0]
    assert relation["kind"] == "overlap"
    assert relation["seconds"] == pytest.approx(overlap)
    assert relation["confirmed"] is False
    assert f"OVERLAP_UNRESOLVED:{b}" in first["blocking_reasons"]

    boundary = 300.0 - overlap / 2
    resolved = [
        unresolved[0],
        {
            **unresolved[1],
            "overlap_resolution": "prefer_later_from",
            "overlap_boundary_seconds": boundary,
        },
    ]
    second = derive_recording_chronology(resolved, source_facts)
    assert second["relations"][0]["confirmed"] is True
    assert second["relations"][0]["overlap_resolution"] == {
        "version": "boundary_v1",
        "mode": "prefer_later_from",
        "boundary_seconds": boundary,
    }
    assert second["ready_for_assembly"] is True


def test_manual_offset_overrides_ambiguous_clock_and_changes_fingerprint_without_mutating_source():
    a = "a" * 32
    b = "b" * 32
    source_facts = {
        a: facts("2026-09-27T20:00:00", 60.0),
        b: facts("2026-09-27T21:00:00", 30.0),
    }
    first_config = [
        part(a, "craig-" + "1" * 64, 0, offset=0.0),
        part(b, "craig-" + "2" * 64, 1, offset=60.0),
    ]
    first = derive_recording_chronology(first_config, source_facts)
    assert first["ready_for_assembly"] is True
    assert [row["placement_authority"] for row in first["parts"]] == ["manual", "manual"]

    second_config = [
        first_config[0],
        {**first_config[1], "session_offset_seconds": 75.0, "gap_confirmed": True},
    ]
    second = derive_recording_chronology(second_config, source_facts)
    assert second["relations"][0]["kind"] == "gap"
    assert second["sha256"] != first["sha256"]
    assert source_facts[b]["start_time"] == "2026-09-27T21:00:00"


def test_manual_order_contrary_to_trusted_clock_is_fail_closed_until_manual_offsets_are_explicit():
    a = "a" * 32
    b = "b" * 32
    parts = [
        part(b, "craig-" + "2" * 64, 0),
        part(a, "craig-" + "1" * 64, 1),
    ]
    source_facts = {
        a: facts("2026-09-27T20:00:00Z", 60.0),
        b: facts("2026-09-27T20:02:00Z", 60.0),
    }

    automatic = derive_recording_chronology(parts, source_facts)
    assert "ORDER_CONFLICT" in automatic["blocking_reasons"]
    assert automatic["ready_for_assembly"] is False

    manual = derive_recording_chronology(
        [
            {**parts[0], "session_offset_seconds": 0.0},
            {**parts[1], "session_offset_seconds": 60.0},
        ],
        source_facts,
    )
    assert "ORDER_CONFLICT" not in manual["blocking_reasons"]
    assert manual["ready_for_assembly"] is True


def test_trim_changes_effective_interval_and_fingerprint_without_rewriting_duration():
    a = "a" * 32
    source_facts = {a: facts(None, 120.0)}
    original = [part(a, "craig-" + "1" * 64, 0, offset=0.0)]
    trimmed = [
        part(
            a,
            "craig-" + "1" * 64,
            0,
            offset=0.0,
            trim_start=10.0,
            trim_end=90.0,
        )
    ]

    before = derive_recording_chronology(original, source_facts)
    after = derive_recording_chronology(trimmed, source_facts)

    assert after["parts"][0]["effective_start_seconds"] == 10.0
    assert after["parts"][0]["effective_end_seconds"] == 90.0
    assert after["sha256"] != before["sha256"]
    assert source_facts[a]["duration_seconds"] == 120.0
