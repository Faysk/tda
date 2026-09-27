from __future__ import annotations

import sqlite3

import pytest

from tda_companion.store import Conflict, Store


def source_id(seed: int) -> str:
    return f"craig-{seed:064x}"


def _workspace_with_two_parts(store: Store):
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    for seed in (1, 2):
        workspace = store.attach_session_source(
            "campaign-a",
            "session-a",
            source_id(seed),
            workspace["revision"],
        )
    return workspace


def test_schema_v11_adds_timeline_fields_without_rewriting_source_identity(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_two_parts(store)

    with sqlite3.connect(store.path) as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        workspace_columns = {
            row[1] for row in db.execute("PRAGMA table_info(session_workspaces)")
        }
        part_columns = {
            row[1]
            for row in db.execute("PRAGMA table_info(session_recording_parts)")
        }

    assert version == 11
    assert "ordering_mode" in workspace_columns
    assert {
        "timeline_mode",
        "session_offset_seconds",
        "trim_start_seconds",
        "trim_end_seconds",
        "overlap_resolution",
        "overlap_boundary_seconds",
    } <= part_columns
    assert [part["source_id"] for part in workspace["parts"]] == [
        source_id(1),
        source_id(2),
    ]


def test_manual_timing_persists_across_restart_and_is_cas_guarded(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_two_parts(store)
    first_id = workspace["parts"][0]["part_id"]
    second_id = workspace["parts"][1]["part_id"]

    workspace = store.update_session_part_timing(
        "campaign-a",
        "session-a",
        first_id,
        workspace["revision"],
        session_offset_seconds=0.0,
        trim_start_seconds=5.0,
        trim_end_seconds=55.0,
    )
    assert workspace["ordering_mode"] == "manual"
    assert workspace["parts"][0]["timeline_mode"] == "manual"
    assert workspace["parts"][0]["session_offset_seconds"] == 0.0
    assert workspace["parts"][0]["trim_start_seconds"] == 5.0
    assert workspace["parts"][0]["trim_end_seconds"] == 55.0

    before_second = workspace["revision"]
    workspace = store.update_session_part_timing(
        "campaign-a",
        "session-a",
        second_id,
        workspace["revision"],
        session_offset_seconds=50.0,
        overlap_resolution="prefer_earlier_until",
        overlap_boundary_seconds=52.0,
    )
    assert workspace["revision"] == before_second + 1

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_REVISION_CONFLICT"):
        store.update_session_part_timing(
            "campaign-a",
            "session-a",
            second_id,
            before_second,
            session_offset_seconds=60.0,
        )

    restarted = Store(tmp_path)
    recovered = restarted.session_workspace("campaign-a", "session-a")
    assert recovered["ordering_mode"] == "manual"
    assert recovered["parts"][0]["trim_start_seconds"] == 5.0
    assert recovered["parts"][1]["overlap_resolution"] == "prefer_earlier_until"
    assert recovered["parts"][1]["overlap_boundary_seconds"] == 52.0


def test_automatic_timeline_reorders_and_sets_offsets_atomically(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_two_parts(store)
    first, second = workspace["parts"]

    automatic = store.apply_automatic_session_timeline(
        "campaign-a",
        "session-a",
        [
            {
                "part_id": second["part_id"],
                "source_id": second["source_id"],
                "ordinal": 0,
                "session_offset_seconds": 0.0,
            },
            {
                "part_id": first["part_id"],
                "source_id": first["source_id"],
                "ordinal": 1,
                "session_offset_seconds": 120.0,
            },
        ],
        workspace["revision"],
    )

    assert automatic["ordering_mode"] == "automatic"
    assert [part["part_id"] for part in automatic["parts"]] == [
        second["part_id"],
        first["part_id"],
    ]
    assert [part["timeline_mode"] for part in automatic["parts"]] == [
        "automatic",
        "automatic",
    ]
    assert [part["session_offset_seconds"] for part in automatic["parts"]] == [
        0.0,
        120.0,
    ]


def test_automatic_derivation_never_overwrites_manual_timing(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_two_parts(store)
    first, second = workspace["parts"]
    manual = store.update_session_part_timing(
        "campaign-a",
        "session-a",
        first["part_id"],
        workspace["revision"],
        session_offset_seconds=0.0,
    )

    with pytest.raises(
        Conflict, match="SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE"
    ):
        store.apply_automatic_session_timeline(
            "campaign-a",
            "session-a",
            [
                {
                    "part_id": first["part_id"],
                    "source_id": first["source_id"],
                    "ordinal": 0,
                    "session_offset_seconds": 0.0,
                },
                {
                    "part_id": second["part_id"],
                    "source_id": second["source_id"],
                    "ordinal": 1,
                    "session_offset_seconds": 60.0,
                },
            ],
            manual["revision"],
        )


@pytest.mark.parametrize(
    "kwargs,code",
    [
        (
            {
                "session_offset_seconds": 0.0,
                "trim_start_seconds": 5.0,
                "trim_end_seconds": 5.0,
            },
            "SESSION_WORKSPACE_TRIM_RANGE_INVALID",
        ),
        (
            {
                "session_offset_seconds": 0.0,
                "overlap_resolution": "prefer_earlier_until",
                "overlap_boundary_seconds": None,
            },
            "SESSION_WORKSPACE_OVERLAP_RESOLUTION_INVALID",
        ),
    ],
)
def test_store_rejects_incoherent_timing_contract(tmp_path, kwargs, code):
    store = Store(tmp_path)
    workspace = _workspace_with_two_parts(store)
    with pytest.raises(Conflict, match=code):
        store.update_session_part_timing(
            "campaign-a",
            "session-a",
            workspace["parts"][0]["part_id"],
            workspace["revision"],
            **kwargs,
        )
