from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest

from tda_companion.session_timeline import (
    SessionTimelineError,
    build_session_timeline,
    classify_start_time,
    package_duration_seconds,
    timeline_config_sha256,
    validate_relation_decision,
)


def _part(seed: str, ordinal: int, *, offset=None, trim_start=0.0, trim_end=None):
    return {
        "part_id": seed * 32,
        "source_id": f"craig-{seed * 64}",
        "ordinal": ordinal,
        "selected_run_id": None,
        "manual_offset_seconds": offset,
        "trim_start_seconds": trim_start,
        "trim_end_seconds": trim_end,
    }


def _workspace(parts, *, authority="unconfirmed", decisions=None):
    return {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": 1,
        "order_authority": authority,
        "parts": parts,
        "timeline_decisions": decisions or [],
    }


def _facts(part, *, start_time, duration=60.0):
    return {
        part["part_id"]: {
            "source_state": "ready",
            "start_time": start_time,
            "duration_seconds": duration,
        }
    }


@pytest.mark.parametrize(
    ("value", "confidence"),
    [
        (None, "missing"),
        ("", "missing"),
        ("domingo depois da capoeira", "opaque"),
        ("2026-09-27T20:00:00", "ambiguous"),
        ("20:00:00", "ambiguous"),
        ("2026-09-27T20:00:00Z", "trusted_absolute"),
        ("2026-09-27T21:00:00+01:00", "trusted_absolute"),
    ],
)
def test_start_time_confidence_is_explicit(value, confidence):
    assert classify_start_time(value)["confidence"] == confidence


def test_equivalent_timezone_offsets_normalize_to_same_absolute_instant():
    utc = classify_start_time("2026-09-27T20:00:00Z")
    lisbon = classify_start_time("2026-09-27T21:00:00+01:00")
    assert utc["instant_utc"] == lisbon["instant_utc"] == "2026-09-27T20:00:00Z"


def test_explicit_dst_offsets_preserve_their_absolute_meaning():
    summer = classify_start_time("2026-10-25T01:30:00+01:00")
    same_instant = classify_start_time("2026-10-25T00:30:00Z")
    winter_offset = classify_start_time("2026-10-25T01:30:00+00:00")

    assert summer["confidence"] == "trusted_absolute"
    assert summer["instant_utc"] == same_instant["instant_utc"]
    assert winter_offset["confidence"] == "trusted_absolute"
    assert winter_offset["instant_utc"] != summer["instant_utc"]


def test_package_duration_is_derived_without_mutating_tracks():
    package = SimpleNamespace(
        tracks=[
            SimpleNamespace(timeline_offset_seconds=0.0, duration_seconds=60.0),
            SimpleNamespace(timeline_offset_seconds=2.0, duration_seconds=63.0),
        ]
    )
    assert package_duration_seconds(package) == 65.0
    assert package.tracks[1].duration_seconds == 63.0


def test_trusted_absolute_times_can_place_contiguous_parts_automatically():
    first = _part("1", 0)
    second = _part("2", 1)
    workspace = _workspace([first, second])
    facts = {
        **_facts(first, start_time="2026-09-27T20:00:00Z", duration=60.0),
        **_facts(second, start_time="2026-09-27T20:01:00Z", duration=45.0),
    }

    timeline = build_session_timeline(workspace, facts)

    assert timeline["ready"] is True
    assert timeline["order"] == {
        "state": "trusted_absolute",
        "workspace_authority": "unconfirmed",
        "suggested_part_ids": [first["part_id"], second["part_id"]],
        "matches_suggestion": True,
    }
    assert timeline["parts"][0]["session_offset_seconds"] == 0.0
    assert timeline["parts"][1]["session_offset_seconds"] == 60.0
    assert timeline["relations"][0]["kind"] == "contiguous"
    assert timeline["relations"][0]["resolved"] is True


def test_gap_remains_visible_and_requires_explicit_acknowledgement():
    first = _part("1", 0)
    second = _part("2", 1)
    workspace = _workspace([first, second])
    facts = {
        **_facts(first, start_time="2026-09-27T20:00:00Z", duration=60.0),
        **_facts(second, start_time="2026-09-27T20:01:00.001000Z", duration=45.0),
    }

    unresolved = build_session_timeline(workspace, facts)
    assert unresolved["ready"] is False
    assert unresolved["relations"][0]["kind"] == "gap"
    assert unresolved["relations"][0]["duration_seconds"] == pytest.approx(0.001)
    assert unresolved["relations"][0]["resolved"] is False

    decided = deepcopy(workspace)
    decided["timeline_decisions"] = [
        {
            "earlier_part_id": first["part_id"],
            "later_part_id": second["part_id"],
            "decision": "gap_acknowledged",
            "boundary_seconds": None,
        }
    ]
    resolved = build_session_timeline(decided, facts)
    assert resolved["ready"] is True
    assert resolved["relations"][0]["decision"] == "gap_acknowledged"


@pytest.mark.parametrize("overlap_seconds", [0.001, 30.0, 180.0])
def test_overlap_is_fail_closed_until_boundary_is_explicit(overlap_seconds):
    first = _part("1", 0)
    second = _part("2", 1)
    second_start = 60.0 - overlap_seconds
    workspace = _workspace([first, second], authority="manual")
    facts = {
        **_facts(first, start_time=None, duration=60.0),
        **_facts(second, start_time=None, duration=60.0),
    }
    workspace["parts"][0]["manual_offset_seconds"] = 0.0
    workspace["parts"][1]["manual_offset_seconds"] = second_start

    unresolved = build_session_timeline(workspace, facts)
    relation = unresolved["relations"][0]
    assert unresolved["ready"] is False
    assert relation["kind"] == "overlap"
    assert relation["duration_seconds"] == pytest.approx(overlap_seconds)

    boundary = second_start + min(overlap_seconds, 1.0) / 2
    decided = deepcopy(workspace)
    decided["timeline_decisions"] = [
        {
            "earlier_part_id": first["part_id"],
            "later_part_id": second["part_id"],
            "decision": "prefer_earlier_until",
            "boundary_seconds": boundary,
        }
    ]
    resolved = build_session_timeline(decided, facts)
    assert resolved["ready"] is True
    assert resolved["relations"][0]["boundary_seconds"] == pytest.approx(boundary)


def test_ambiguous_opaque_and_missing_clocks_never_place_without_manual_offset():
    parts = [_part("1", 0), _part("2", 1), _part("3", 2)]
    workspace = _workspace(parts, authority="manual")
    facts = {
        **_facts(parts[0], start_time="2026-09-27T20:00:00", duration=10.0),
        **_facts(parts[1], start_time="alguma hora", duration=10.0),
        **_facts(parts[2], start_time=None, duration=10.0),
    }

    unresolved = build_session_timeline(workspace, facts)
    assert unresolved["ready"] is False
    assert [part["placement_authority"] for part in unresolved["parts"]] == [
        "unresolved",
        "unresolved",
        "unresolved",
    ]

    for index, part in enumerate(workspace["parts"]):
        part["manual_offset_seconds"] = float(index * 10)
    resolved = build_session_timeline(workspace, facts)
    assert resolved["ready"] is True
    assert [part["placement_authority"] for part in resolved["parts"]] == [
        "manual",
        "manual",
        "manual",
    ]


def test_manual_order_can_override_a_trusted_suggestion_without_mutating_source_clock():
    first = _part("1", 0, offset=60.0)
    second = _part("2", 1, offset=0.0)
    workspace = _workspace([first, second], authority="manual")
    facts = {
        **_facts(first, start_time="2026-09-27T20:00:00Z", duration=30.0),
        **_facts(second, start_time="2026-09-27T20:01:00Z", duration=30.0),
    }
    before = deepcopy(facts)

    timeline = build_session_timeline(workspace, facts)

    assert timeline["order"]["state"] == "manual"
    assert timeline["order"]["suggested_part_ids"] == [first["part_id"], second["part_id"]]
    assert timeline["parts"][0]["placement_authority"] == "manual"
    assert facts == before


def test_trim_and_offset_change_config_hash_but_identical_config_is_stable():
    first = _part("1", 0, offset=0.0)
    workspace = _workspace([first], authority="manual")
    baseline = timeline_config_sha256(workspace)
    assert baseline == timeline_config_sha256(deepcopy(workspace))

    changed_offset = deepcopy(workspace)
    changed_offset["parts"][0]["manual_offset_seconds"] = 1.0
    assert timeline_config_sha256(changed_offset) != baseline

    changed_trim = deepcopy(workspace)
    changed_trim["parts"][0]["trim_start_seconds"] = 1.0
    assert timeline_config_sha256(changed_trim) != baseline


def test_relation_decision_rejects_wrong_kind_and_out_of_overlap_boundary():
    first = _part("1", 0, offset=0.0)
    second = _part("2", 1, offset=50.0)
    workspace = _workspace([first, second], authority="manual")
    facts = {
        **_facts(first, start_time=None, duration=60.0),
        **_facts(second, start_time=None, duration=60.0),
    }
    timeline = build_session_timeline(workspace, facts)

    with pytest.raises(SessionTimelineError, match="SESSION_TIMELINE_DECISION_MISMATCH"):
        validate_relation_decision(
            timeline,
            earlier_part_id=first["part_id"],
            later_part_id=second["part_id"],
            decision="gap_acknowledged",
            boundary_seconds=None,
        )
    with pytest.raises(SessionTimelineError, match="SESSION_TIMELINE_BOUNDARY_INVALID"):
        validate_relation_decision(
            timeline,
            earlier_part_id=first["part_id"],
            later_part_id=second["part_id"],
            decision="prefer_later_from",
            boundary_seconds=1.0,
        )


def test_empty_workspace_is_not_ready_for_assembly():
    timeline = build_session_timeline(_workspace([]), {})
    assert timeline["ready"] is False
    assert timeline["parts"] == []
    assert timeline["relations"] == []
