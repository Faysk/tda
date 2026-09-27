from __future__ import annotations

from tda_companion.session_timeline import (
    CONFIG_SCHEMA,
    SessionTimelineError,
    build_session_timeline,
    classify_start_time,
)


def _part(seed: int, ordinal: int) -> dict[str, object]:
    return {
        "part_id": f"{seed:032x}",
        "source_id": f"craig-{seed:064x}",
        "ordinal": ordinal,
        "selected_run_id": None,
    }


def _workspace(count: int = 2) -> dict[str, object]:
    return {
        "schema_version": "tda_session_workspace_v1",
        "campaign_id": "campaign-a",
        "session_id": "session-a",
        "revision": 0,
        "parts": [_part(index + 1, index) for index in range(count)],
    }


def _facts(*rows: tuple[str | None, int | None]) -> dict[str, dict[str, object]]:
    return {
        f"craig-{index + 1:064x}": {
            "start_time": start,
            "duration_ms": duration,
        }
        for index, (start, duration) in enumerate(rows)
    }


def _config(workspace, parts=None, boundaries=None):
    return {
        "schema_version": CONFIG_SCHEMA,
        "parts": parts
        if parts is not None
        else [
            {
                "part_id": part["part_id"],
                "session_offset_ms": None,
                "trim_start_ms": 0,
                "trim_end_ms": None,
            }
            for part in workspace["parts"]
        ],
        "boundaries": boundaries or [],
    }


def test_start_time_confidence_is_fail_closed():
    trusted = classify_start_time("2026-09-27T21:00:00+01:00")
    equivalent = classify_start_time("2026-09-27T20:00:00Z")
    assert trusted["confidence"] == "trusted_absolute"
    assert trusted["epoch_ms"] == equivalent["epoch_ms"]
    assert classify_start_time("2026-09-27T21:00:00")["confidence"] == "ambiguous"
    assert classify_start_time("Craig started sometime after dinner")["confidence"] == "opaque"
    assert classify_start_time(None)["confidence"] == "missing"


def test_trusted_absolute_times_derive_offsets_and_contiguous_boundary():
    workspace = _workspace()
    facts = _facts(
        ("2026-09-27T20:00:00Z", 60_000),
        ("2026-09-27T20:01:00+00:00", 60_000),
    )
    timeline = build_session_timeline(workspace, facts, _config(workspace))

    assert [part["placement"]["session_offset_ms"] for part in timeline["parts"]] == [
        0,
        60_000,
    ]
    assert [part["placement"]["origin"] for part in timeline["parts"]] == [
        "trusted_absolute",
        "trusted_absolute",
    ]
    assert timeline["boundaries"] == [
        {
            "left_part_id": workspace["parts"][0]["part_id"],
            "right_part_id": workspace["parts"][1]["part_id"],
            "kind": "contiguous",
            "duration_ms": 0,
            "resolved": True,
            "resolution": None,
        }
    ]
    assert timeline["approval_ready"] is True


def test_ambiguous_opaque_and_missing_times_never_gain_silent_offsets():
    workspace = _workspace(3)
    facts = _facts(
        ("2026-09-27T20:00:00", 30_000),
        ("not-a-clock", 30_000),
        (None, 30_000),
    )
    timeline = build_session_timeline(workspace, facts, _config(workspace))

    assert [part["start_time"]["confidence"] for part in timeline["parts"]] == [
        "ambiguous",
        "opaque",
        "missing",
    ]
    assert [part["placement"]["session_offset_ms"] for part in timeline["parts"]] == [
        None,
        None,
        None,
    ]
    assert timeline["approval_ready"] is False


def test_gap_requires_explicit_acceptance_and_preserves_exact_duration():
    workspace = _workspace()
    facts = _facts(
        ("2026-09-27T20:00:00Z", 60_000),
        ("2026-09-27T20:01:00.001Z", 60_000),
    )
    unresolved = build_session_timeline(workspace, facts, _config(workspace))
    assert unresolved["boundaries"][0]["kind"] == "gap"
    assert unresolved["boundaries"][0]["duration_ms"] == 1
    assert unresolved["boundaries"][0]["resolved"] is False
    assert unresolved["approval_ready"] is False

    accepted = _config(
        workspace,
        boundaries=[
            {
                "left_part_id": workspace["parts"][0]["part_id"],
                "right_part_id": workspace["parts"][1]["part_id"],
                "mode": "accept_gap",
                "boundary_ms": None,
            }
        ],
    )
    resolved = build_session_timeline(workspace, facts, accepted)
    assert resolved["boundaries"][0]["resolved"] is True
    assert resolved["approval_ready"] is True


def test_overlap_requires_explicit_boundary_inside_overlap():
    workspace = _workspace()
    facts = _facts(
        ("2026-09-27T20:00:00Z", 60_000),
        ("2026-09-27T20:00:30Z", 60_000),
    )
    unresolved = build_session_timeline(workspace, facts, _config(workspace))
    assert unresolved["boundaries"][0]["kind"] == "overlap"
    assert unresolved["boundaries"][0]["duration_ms"] == 30_000
    assert unresolved["approval_ready"] is False

    resolved_config = _config(
        workspace,
        boundaries=[
            {
                "left_part_id": workspace["parts"][0]["part_id"],
                "right_part_id": workspace["parts"][1]["part_id"],
                "mode": "prefer_earlier_until",
                "boundary_ms": 45_000,
            }
        ],
    )
    resolved = build_session_timeline(workspace, facts, resolved_config)
    assert resolved["boundaries"][0]["resolved"] is True
    assert resolved["approval_ready"] is True

    invalid = _config(
        workspace,
        boundaries=[
            {
                "left_part_id": workspace["parts"][0]["part_id"],
                "right_part_id": workspace["parts"][1]["part_id"],
                "mode": "prefer_later_from",
                "boundary_ms": 75_000,
            }
        ],
    )
    try:
        build_session_timeline(workspace, facts, invalid)
    except SessionTimelineError as exc:
        assert str(exc) == "SESSION_TIMELINE_RESOLUTION_INVALID"
    else:
        raise AssertionError("outside-overlap boundary must fail closed")


def test_manual_offsets_and_trims_override_clock_without_mutating_source_identity():
    workspace = _workspace()
    facts = _facts(
        ("2026-09-27T20:10:00Z", 120_000),
        ("2026-09-27T20:00:00Z", 120_000),
    )
    config = _config(
        workspace,
        parts=[
            {
                "part_id": workspace["parts"][0]["part_id"],
                "session_offset_ms": 0,
                "trim_start_ms": 10_000,
                "trim_end_ms": 100_000,
            },
            {
                "part_id": workspace["parts"][1]["part_id"],
                "session_offset_ms": 100_000,
                "trim_start_ms": 0,
                "trim_end_ms": 120_000,
            },
        ],
    )
    timeline = build_session_timeline(workspace, facts, config)

    assert timeline["order_matches_trusted_suggestion"] is False
    assert timeline["parts"][0]["placement"]["origin"] == "manual"
    assert timeline["parts"][0]["effective_start_ms"] == 10_000
    assert timeline["parts"][0]["effective_end_ms"] == 100_000
    assert timeline["parts"][0]["source_id"] == workspace["parts"][0]["source_id"]


def test_timeline_identity_is_reproducible_and_changes_with_order_offset_or_trim():
    workspace = _workspace()
    facts = _facts(
        ("2026-09-27T20:00:00Z", 60_000),
        ("2026-09-27T20:01:00Z", 60_000),
    )
    base_config = _config(workspace)
    first = build_session_timeline(workspace, facts, base_config)
    replay = build_session_timeline(workspace, facts, base_config)
    assert first["timeline_identity_sha256"] == replay["timeline_identity_sha256"]

    manual = _config(
        workspace,
        parts=[
            {
                "part_id": workspace["parts"][0]["part_id"],
                "session_offset_ms": 1,
                "trim_start_ms": 0,
                "trim_end_ms": None,
            },
            {
                "part_id": workspace["parts"][1]["part_id"],
                "session_offset_ms": 60_001,
                "trim_start_ms": 0,
                "trim_end_ms": None,
            },
        ],
    )
    changed = build_session_timeline(workspace, facts, manual)
    assert changed["timeline_identity_sha256"] != first["timeline_identity_sha256"]

    reversed_workspace = {
        **workspace,
        "parts": [
            {**workspace["parts"][1], "ordinal": 0},
            {**workspace["parts"][0], "ordinal": 1},
        ],
    }
    reversed_config = _config(reversed_workspace)
    reversed_timeline = build_session_timeline(reversed_workspace, facts, reversed_config)
    assert reversed_timeline["timeline_identity_sha256"] != first["timeline_identity_sha256"]


def test_single_source_without_clock_uses_zero_origin_and_stays_compatible():
    workspace = _workspace(1)
    timeline = build_session_timeline(
        workspace,
        _facts((None, 60_000)),
        _config(workspace),
    )
    assert timeline["parts"][0]["placement"] == {
        "session_offset_ms": 0,
        "origin": "single_source_zero",
        "trim_start_ms": 0,
        "trim_end_ms": None,
    }
    assert timeline["approval_ready"] is True
