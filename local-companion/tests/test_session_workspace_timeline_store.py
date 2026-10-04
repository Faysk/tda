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


def test_schema_v12_preserves_timeline_fields_without_rewriting_source_identity(tmp_path):
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

    assert version == 12
    assert "ordering_mode" in workspace_columns
    assert {
        "timeline_mode",
        "session_offset_seconds",
        "trim_start_seconds",
        "trim_end_seconds",
        "gap_confirmed",
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
        gap_confirmed=True,
        overlap_resolution="prefer_earlier_until",
        overlap_boundary_seconds=52.0,
    )
    assert workspace["revision"] == before_second + 1
    assert workspace["parts"][1]["gap_confirmed"] is True

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
    assert recovered["parts"][1]["gap_confirmed"] is True
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


def _workspace_with_three_parts(store: Store):
    workspace = store.ensure_session_workspace("campaign-three", "session-three")
    for seed in (1, 2, 3):
        workspace = store.attach_session_source(
            "campaign-three",
            "session-three",
            source_id(seed),
            workspace["revision"],
        )
    return workspace


def test_same_order_can_be_explicitly_confirmed_as_manual_authority(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_two_parts(store)
    current_ids = [part["part_id"] for part in workspace["parts"]]

    confirmed = store.reorder_session_parts(
        "campaign-a",
        "session-a",
        current_ids,
        workspace["revision"],
    )

    assert confirmed["revision"] == workspace["revision"] + 1
    assert confirmed["ordering_mode"] == "manual"
    recovered = Store(tmp_path).session_workspace("campaign-a", "session-a")
    assert recovered["ordering_mode"] == "manual"


def test_reorder_clears_adjacency_specific_relation_decisions(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_three_parts(store)
    first, second, third = workspace["parts"]

    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", first["part_id"], workspace["revision"],
        session_offset_seconds=0.0,
    )
    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", second["part_id"], workspace["revision"],
        session_offset_seconds=70.0, gap_confirmed=True,
    )
    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", third["part_id"], workspace["revision"],
        session_offset_seconds=110.0,
        overlap_resolution="prefer_later_from",
        overlap_boundary_seconds=115.0,
    )

    reordered = store.reorder_session_parts(
        "campaign-three",
        "session-three",
        [third["part_id"], first["part_id"], second["part_id"]],
        workspace["revision"],
    )

    assert [part["gap_confirmed"] for part in reordered["parts"]] == [False, False, False]
    assert [part["overlap_resolution"] for part in reordered["parts"]] == [None, None, None]
    assert [part["overlap_boundary_seconds"] for part in reordered["parts"]] == [
        None, None, None,
    ]


def test_detach_clears_relation_decisions_before_new_adjacency(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_three_parts(store)
    first, second, third = workspace["parts"]

    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", second["part_id"], workspace["revision"],
        session_offset_seconds=70.0, gap_confirmed=True,
    )
    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", third["part_id"], workspace["revision"],
        session_offset_seconds=110.0,
        overlap_resolution="prefer_earlier_until",
        overlap_boundary_seconds=115.0,
    )

    detached = store.detach_session_part(
        "campaign-three", "session-three", second["part_id"], workspace["revision"]
    )

    assert [part["part_id"] for part in detached["parts"]] == [
        first["part_id"], third["part_id"],
    ]
    assert all(part["gap_confirmed"] is False for part in detached["parts"])
    assert all(part["overlap_resolution"] is None for part in detached["parts"])
    assert all(part["overlap_boundary_seconds"] is None for part in detached["parts"])


def test_geometry_change_invalidates_stale_current_and_following_relations(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_three_parts(store)
    first, second, third = workspace["parts"]

    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", first["part_id"], workspace["revision"],
        session_offset_seconds=0.0, trim_end_seconds=60.0,
    )
    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", second["part_id"], workspace["revision"],
        session_offset_seconds=70.0, gap_confirmed=True,
    )
    workspace = store.update_session_part_timing(
        "campaign-three", "session-three", third["part_id"], workspace["revision"],
        session_offset_seconds=110.0,
        overlap_resolution="prefer_later_from",
        overlap_boundary_seconds=115.0,
    )

    changed_first = store.update_session_part_timing(
        "campaign-three", "session-three", first["part_id"], workspace["revision"],
        session_offset_seconds=0.0, trim_end_seconds=50.0,
    )
    assert changed_first["parts"][1]["gap_confirmed"] is False

    changed_second = store.update_session_part_timing(
        "campaign-three", "session-three", second["part_id"], changed_first["revision"],
        session_offset_seconds=80.0, gap_confirmed=False,
    )
    assert changed_second["parts"][2]["overlap_resolution"] is None
    assert changed_second["parts"][2]["overlap_boundary_seconds"] is None



def test_user_confirmed_sequence_persists_restart_and_reorder_invalidates_only_derived_timing(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-seq", "session-seq")
    for seed in (1, 2, 3):
        workspace = store.attach_session_source(
            "campaign-seq",
            "session-seq",
            source_id(seed),
            workspace["revision"],
        )

    middle = workspace["parts"][1]
    workspace = store.select_session_part_run(
        "campaign-seq",
        "session-seq",
        middle["part_id"],
        "run-middle-stable",
        workspace["revision"],
    )
    placements = [
        {
            "part_id": row["part_id"],
            "source_id": row["source_id"],
            "ordinal": index,
            "session_offset_seconds": offset,
        }
        for index, (row, offset) in enumerate(
            zip(workspace["parts"], (0.0, 30.0, 75.0), strict=True)
        )
    ]
    confirmed = store.apply_user_confirmed_session_sequence(
        "campaign-seq",
        "session-seq",
        placements,
        workspace["revision"],
    )

    assert confirmed["ordering_mode"] == "manual"
    assert [row["timeline_mode"] for row in confirmed["parts"]] == [
        "sequence",
        "sequence",
        "sequence",
    ]
    assert [row["session_offset_seconds"] for row in confirmed["parts"]] == [
        0.0,
        30.0,
        75.0,
    ]

    restarted = Store(tmp_path).session_workspace("campaign-seq", "session-seq")
    assert [row["timeline_mode"] for row in restarted["parts"]] == [
        "sequence",
        "sequence",
        "sequence",
    ]
    assert [row["session_offset_seconds"] for row in restarted["parts"]] == [
        0.0,
        30.0,
        75.0,
    ]

    reordered_ids = [
        restarted["parts"][1]["part_id"],
        restarted["parts"][0]["part_id"],
        restarted["parts"][2]["part_id"],
    ]
    reordered = Store(tmp_path).reorder_session_parts(
        "campaign-seq",
        "session-seq",
        reordered_ids,
        restarted["revision"],
    )

    assert [row["part_id"] for row in reordered["parts"]] == reordered_ids
    assert [row["timeline_mode"] for row in reordered["parts"]] == [
        "unresolved",
        "unresolved",
        "unresolved",
    ]
    assert [row["session_offset_seconds"] for row in reordered["parts"]] == [
        None,
        None,
        None,
    ]
    selected_by_source = {
        row["source_id"]: row["selected_run_id"] for row in reordered["parts"]
    }
    assert selected_by_source[source_id(2)] == "run-middle-stable"
    assert selected_by_source[source_id(1)] is None
    assert selected_by_source[source_id(3)] is None

    reconfirmed = Store(tmp_path).apply_user_confirmed_session_sequence(
        "campaign-seq",
        "session-seq",
        [
            {
                "part_id": row["part_id"],
                "source_id": row["source_id"],
                "ordinal": index,
                "session_offset_seconds": offset,
            }
            for index, (row, offset) in enumerate(
                zip(reordered["parts"], (0.0, 45.0, 75.0), strict=True)
            )
        ],
        reordered["revision"],
    )
    assert [row["timeline_mode"] for row in reconfirmed["parts"]] == [
        "sequence",
        "sequence",
        "sequence",
    ]
    assert [row["session_offset_seconds"] for row in reconfirmed["parts"]] == [
        0.0,
        45.0,
        75.0,
    ]


def test_confirmed_sequence_is_cas_guarded_and_idempotent(tmp_path):
    store = Store(tmp_path)
    workspace = _workspace_with_two_parts(store)
    placements = [
        {
            "part_id": row["part_id"],
            "source_id": row["source_id"],
            "ordinal": index,
            "session_offset_seconds": float(index * 60),
        }
        for index, row in enumerate(workspace["parts"])
    ]
    confirmed = store.apply_user_confirmed_session_sequence(
        "campaign-a",
        "session-a",
        placements,
        workspace["revision"],
    )
    repeated = store.apply_user_confirmed_session_sequence(
        "campaign-a",
        "session-a",
        placements,
        confirmed["revision"],
    )
    assert repeated["revision"] == confirmed["revision"]

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_REVISION_CONFLICT"):
        store.apply_user_confirmed_session_sequence(
            "campaign-a",
            "session-a",
            placements,
            workspace["revision"],
        )
