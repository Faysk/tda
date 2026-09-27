from __future__ import annotations

from types import SimpleNamespace

import pytest

from tda_companion.session_timeline import (
    SEGMENT_BOUNDARY_POLICY,
    build_session_timeline,
    classify_start_time,
    segment_owner_for_boundary,
)


def source(seed: str) -> str:
    return "craig-" + seed * 64


def package(start_time: str | None, duration: float):
    return SimpleNamespace(
        start_time=start_time,
        tracks=(
            SimpleNamespace(
                timeline_offset_seconds=0.0,
                duration_seconds=duration,
            ),
        ),
    )


def part(
    part_id: str,
    source_id: str,
    ordinal: int,
    *,
    manual_offset_seconds=None,
    trim_start_seconds=None,
    trim_end_seconds=None,
    gap_confirmed=False,
    overlap_boundary_seconds=None,
    source_state="ready",
):
    return {
        "part_id": part_id,
        "source_id": source_id,
        "ordinal": ordinal,
        "selected_run_id": None,
        "source_state": source_state,
        "manual_offset_seconds": manual_offset_seconds,
        "trim_start_seconds": trim_start_seconds,
        "trim_end_seconds": trim_end_seconds,
        "gap_confirmed": gap_confirmed,
        "overlap_boundary_seconds": overlap_boundary_seconds,
        "created_at": "2026-09-27T20:00:00Z",
        "updated_at": "2026-09-27T20:00:00Z",
    }


def workspace(parts, *, mode="automatic", revision=1):
    return {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "yuhara-main",
        "session_id": "session-42",
        "revision": revision,
        "chronology_mode": mode,
        "created_at": "2026-09-27T20:00:00Z",
        "updated_at": "2026-09-27T20:00:00Z",
        "parts": parts,
    }


def test_start_time_confidence_never_promotes_ambiguous_or_opaque_values():
    trusted = classify_start_time("2026-09-27T20:00:00Z")
    equivalent = classify_start_time("2026-09-27T21:00:00+01:00")
    assert trusted["classification"] == "trusted_absolute"
    assert equivalent["classification"] == "trusted_absolute"
    assert trusted["epoch_seconds"] == equivalent["epoch_seconds"]

    assert classify_start_time("2026-09-27T20:00:00")["classification"] == "ambiguous"
    assert classify_start_time("domingo depois da sessão")["classification"] == "opaque"
    assert classify_start_time(None)["classification"] == "missing"


def test_automatic_timeline_orders_only_trusted_absolute_evidence_and_preserves_gaps():
    a = source("a")
    b = source("b")
    c = source("c")
    value = workspace(
        [
            part("1" * 32, c, 0),
            part("2" * 32, b, 1),
            part("3" * 32, a, 2),
        ]
    )
    timeline = build_session_timeline(
        value,
        {
            a: package("2026-09-27T20:00:00Z", 60.0),
            b: package("2026-09-27T20:01:00Z", 30.0),
            c: package("2026-09-27T20:02:00Z", 20.0),
        },
    )

    assert [item["source_id"] for item in timeline["parts"]] == [a, b, c]
    assert [item["session_offset_seconds"] for item in timeline["parts"]] == [
        0.0,
        60.0,
        120.0,
    ]
    assert timeline["relations"][0]["kind"] == "contiguous"
    assert timeline["relations"][1] == {
        "earlier_part_id": "2" * 32,
        "later_part_id": "1" * 32,
        "kind": "gap",
        "seconds": 30.0,
        "resolved": False,
        "resolution": None,
    }
    assert timeline["approval_blocked"] is True


@pytest.mark.parametrize(
    ("start_time", "classification"),
    [
        ("2026-09-27T20:00:00", "ambiguous"),
        ("not-a-clock", "opaque"),
        (None, "missing"),
    ],
)
def test_untrusted_start_time_never_becomes_silent_authoritative_placement(
    start_time,
    classification,
):
    a = source("a")
    timeline = build_session_timeline(
        workspace([part("1" * 32, a, 0)]),
        {a: package(start_time, 30.0)},
    )
    row = timeline["parts"][0]
    assert row["start_time"]["classification"] == classification
    assert row["placement_authority"] == "unresolved"
    assert row["session_offset_seconds"] is None
    assert timeline["approval_blocked"] is True


def test_manual_order_offset_gap_confirmation_and_restart_projection_are_deterministic():
    a = source("a")
    b = source("b")
    parts = [
        part("2" * 32, b, 0, manual_offset_seconds=0.0),
        part(
            "1" * 32,
            a,
            1,
            manual_offset_seconds=75.0,
            trim_start_seconds=5.0,
            trim_end_seconds=35.0,
            gap_confirmed=True,
        ),
    ]
    value = workspace(parts, mode="manual", revision=7)
    packages = {
        a: package("2026-09-27T20:00:00Z", 40.0),
        b: package("2026-09-27T20:05:00Z", 60.0),
    }

    first = build_session_timeline(value, packages)
    recovered = build_session_timeline(value, packages)
    assert [row["source_id"] for row in first["parts"]] == [b, a]
    assert first["parts"][0]["placement_authority"] == "manual"
    assert first["parts"][1]["effective_start_seconds"] == 80.0
    assert first["relations"][0]["kind"] == "gap"
    assert first["relations"][0]["resolved"] is True
    assert first["approval_blocked"] is False
    assert first["configuration_sha256"] == recovered["configuration_sha256"]

    changed = workspace(
        [
            parts[0],
            {
                **parts[1],
                "manual_offset_seconds": 76.0,
            },
        ],
        mode="manual",
        revision=8,
    )
    changed_timeline = build_session_timeline(changed, packages)
    assert changed_timeline["configuration_sha256"] != first["configuration_sha256"]


def test_overlap_requires_explicit_boundary_and_boundary_resolves_without_rewriting_sources():
    a = source("a")
    b = source("b")
    packages = {
        a: package("2026-09-27T20:00:00Z", 120.0),
        b: package("2026-09-27T20:01:30Z", 120.0),
    }
    unresolved = build_session_timeline(
        workspace(
            [
                part("1" * 32, a, 0, manual_offset_seconds=0.0),
                part("2" * 32, b, 1, manual_offset_seconds=90.0),
            ],
            mode="manual",
        ),
        packages,
    )
    relation = unresolved["relations"][0]
    assert relation["kind"] == "overlap"
    assert relation["seconds"] == 30.0
    assert relation["resolved"] is False
    assert unresolved["approval_blocked"] is True

    resolved = build_session_timeline(
        workspace(
            [
                part("1" * 32, a, 0, manual_offset_seconds=0.0),
                part(
                    "2" * 32,
                    b,
                    1,
                    manual_offset_seconds=90.0,
                    overlap_boundary_seconds=105.0,
                ),
            ],
            mode="manual",
            revision=2,
        ),
        packages,
    )
    relation = resolved["relations"][0]
    assert relation["kind"] == "overlap"
    assert relation["resolved"] is True
    assert relation["resolution"] == "split_boundary_v1"
    assert relation["boundary_seconds"] == 105.0
    assert resolved["approval_blocked"] is False


def test_segment_boundary_policy_owns_crossing_segment_by_its_start():
    assert SEGMENT_BOUNDARY_POLICY == "segment_start_v1"
    assert segment_owner_for_boundary(9.0, 11.0, 10.0) == "earlier"
    assert segment_owner_for_boundary(10.0, 11.0, 10.0) == "later"
    with pytest.raises(ValueError, match="SESSION_TIMELINE_SEGMENT_INVALID"):
        segment_owner_for_boundary(11.0, 10.0, 10.0)
