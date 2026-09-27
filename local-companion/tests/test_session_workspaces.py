from __future__ import annotations

import sqlite3

import pytest

from tda_companion.store import Conflict, Store


def source_id(seed: int) -> str:
    return f"craig-{seed:064x}"


def test_session_workspace_persists_parts_and_order_across_restart(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    assert workspace["revision"] == 0
    assert workspace["parts"] == []

    for seed in range(1, 4):
        workspace = store.attach_session_source(
            "campaign-a",
            "session-a",
            source_id(seed),
            workspace["revision"],
        )

    assert workspace["revision"] == 3
    assert [part["source_id"] for part in workspace["parts"]] == [
        source_id(1),
        source_id(2),
        source_id(3),
    ]
    original_parts = [part["part_id"] for part in workspace["parts"]]

    restarted = Store(tmp_path)
    recovered = restarted.session_workspace("campaign-a", "session-a")
    assert recovered["revision"] == 3
    assert [part["part_id"] for part in recovered["parts"]] == original_parts

    reordered = restarted.reorder_session_parts(
        "campaign-a",
        "session-a",
        [original_parts[2], original_parts[0], original_parts[1]],
        recovered["revision"],
    )
    assert reordered["revision"] == 4
    assert [part["part_id"] for part in reordered["parts"]] == [
        original_parts[2],
        original_parts[0],
        original_parts[1],
    ]
    assert [part["ordinal"] for part in reordered["parts"]] == [0, 1, 2]


@pytest.mark.parametrize("count", [1, 2, 3, 20])
def test_session_workspace_supports_bounded_n_parts(tmp_path, count):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-n", "session-n")
    for seed in range(1, count + 1):
        workspace = store.attach_session_source(
            "campaign-n",
            "session-n",
            source_id(seed),
            workspace["revision"],
        )
    assert len(workspace["parts"]) == count
    assert [part["ordinal"] for part in workspace["parts"]] == list(range(count))


def test_duplicate_source_attach_is_idempotent_but_stale_mutation_fails_closed(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    attached = store.attach_session_source(
        "campaign-a",
        "session-a",
        source_id(1),
        workspace["revision"],
    )

    duplicate = store.attach_session_source(
        "campaign-a",
        "session-a",
        source_id(1),
        attached["revision"],
    )
    assert duplicate["revision"] == attached["revision"]
    assert len(duplicate["parts"]) == 1

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_REVISION_CONFLICT"):
        store.attach_session_source(
            "campaign-a",
            "session-a",
            source_id(2),
            workspace["revision"],
        )


def test_distinct_source_hashes_are_not_collapsed(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    first = store.attach_session_source(
        "campaign-a", "session-a", source_id(10), workspace["revision"]
    )
    second = store.attach_session_source(
        "campaign-a", "session-a", source_id(11), first["revision"]
    )

    assert [part["source_id"] for part in second["parts"]] == [
        source_id(10),
        source_id(11),
    ]


def test_detach_preserves_other_parts_and_only_mutates_workspace_links(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    for seed in range(1, 4):
        workspace = store.attach_session_source(
            "campaign-a", "session-a", source_id(seed), workspace["revision"]
        )

    removed = workspace["parts"][1]
    detached = store.detach_session_part(
        "campaign-a",
        "session-a",
        removed["part_id"],
        workspace["revision"],
    )

    assert detached["revision"] == workspace["revision"] + 1
    assert [part["source_id"] for part in detached["parts"]] == [
        source_id(1),
        source_id(3),
    ]
    assert [part["ordinal"] for part in detached["parts"]] == [0, 1]
    assert removed["source_id"] not in {
        row[0]
        for row in sqlite3.connect(store.path)
        .execute("SELECT source_id FROM session_recording_parts")
        .fetchall()
    }


def test_reorder_requires_exact_part_set_and_current_revision(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    for seed in range(1, 3):
        workspace = store.attach_session_source(
            "campaign-a", "session-a", source_id(seed), workspace["revision"]
        )
    ids = [part["part_id"] for part in workspace["parts"]]

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_ORDER_INVALID"):
        store.reorder_session_parts(
            "campaign-a", "session-a", [ids[0]], workspace["revision"]
        )

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_ORDER_INVALID"):
        store.reorder_session_parts(
            "campaign-a", "session-a", [ids[0], ids[0]], workspace["revision"]
        )

    reordered = store.reorder_session_parts(
        "campaign-a", "session-a", list(reversed(ids)), workspace["revision"]
    )
    with pytest.raises(Conflict, match="SESSION_WORKSPACE_REVISION_CONFLICT"):
        store.detach_session_part(
            "campaign-a", "session-a", reordered["parts"][0]["part_id"], workspace["revision"]
        )



def test_timeline_override_persists_across_restart_and_uses_workspace_cas(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    workspace = store.attach_session_source(
        "campaign-a", "session-a", source_id(1), workspace["revision"]
    )
    workspace = store.attach_session_source(
        "campaign-a", "session-a", source_id(2), workspace["revision"]
    )
    first, second = workspace["parts"]

    placed_first = store.update_session_part_timeline(
        "campaign-a",
        "session-a",
        first["part_id"],
        workspace["revision"],
        session_offset_seconds=0.0,
        trim_start_seconds=0.0,
        trim_end_seconds=60.0,
        gap_confirmed=False,
        overlap_resolution=None,
        overlap_boundary_seconds=None,
    )
    placed_second = store.update_session_part_timeline(
        "campaign-a",
        "session-a",
        second["part_id"],
        placed_first["revision"],
        session_offset_seconds=75.0,
        trim_start_seconds=5.0,
        trim_end_seconds=65.0,
        gap_confirmed=True,
        overlap_resolution=None,
        overlap_boundary_seconds=None,
    )

    assert placed_second["revision"] == workspace["revision"] + 2
    configured = placed_second["parts"][1]
    assert configured["session_offset_seconds"] == 75.0
    assert configured["trim_start_seconds"] == 5.0
    assert configured["trim_end_seconds"] == 65.0
    assert configured["gap_confirmed"] is True
    assert configured["chronology_version"] == "tda_recording_chronology_v1"

    restarted = Store(tmp_path)
    recovered = restarted.session_workspace("campaign-a", "session-a")
    assert recovered["revision"] == placed_second["revision"]
    assert recovered["parts"][1]["session_offset_seconds"] == 75.0
    assert recovered["parts"][1]["trim_start_seconds"] == 5.0
    assert recovered["parts"][1]["trim_end_seconds"] == 65.0
    assert recovered["parts"][1]["gap_confirmed"] is True

    same = restarted.update_session_part_timeline(
        "campaign-a",
        "session-a",
        second["part_id"],
        recovered["revision"],
        session_offset_seconds=75.0,
        trim_start_seconds=5.0,
        trim_end_seconds=65.0,
        gap_confirmed=True,
        overlap_resolution=None,
        overlap_boundary_seconds=None,
    )
    assert same["revision"] == recovered["revision"]

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_REVISION_CONFLICT"):
        restarted.update_session_part_timeline(
            "campaign-a",
            "session-a",
            first["part_id"],
            workspace["revision"],
            session_offset_seconds=0.0,
            trim_start_seconds=0.0,
            trim_end_seconds=60.0,
            gap_confirmed=False,
            overlap_resolution=None,
            overlap_boundary_seconds=None,
        )


def test_overlap_resolution_requires_versioned_mode_and_boundary_pair(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    workspace = store.attach_session_source(
        "campaign-a", "session-a", source_id(1), workspace["revision"]
    )
    part_id = workspace["parts"][0]["part_id"]

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_OVERLAP_RESOLUTION_INVALID"):
        store.update_session_part_timeline(
            "campaign-a",
            "session-a",
            part_id,
            workspace["revision"],
            session_offset_seconds=0.0,
            trim_start_seconds=0.0,
            trim_end_seconds=None,
            gap_confirmed=False,
            overlap_resolution="prefer_later_from",
            overlap_boundary_seconds=None,
        )

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_OVERLAP_RESOLUTION_INVALID"):
        store.update_session_part_timeline(
            "campaign-a",
            "session-a",
            part_id,
            workspace["revision"],
            session_offset_seconds=0.0,
            trim_start_seconds=0.0,
            trim_end_seconds=None,
            gap_confirmed=False,
            overlap_resolution="fuzzy_magic",
            overlap_boundary_seconds=10.0,
        )

    resolved = store.update_session_part_timeline(
        "campaign-a",
        "session-a",
        part_id,
        workspace["revision"],
        session_offset_seconds=0.0,
        trim_start_seconds=0.0,
        trim_end_seconds=None,
        gap_confirmed=False,
        overlap_resolution="prefer_earlier_until",
        overlap_boundary_seconds=10.0,
    )
    assert resolved["parts"][0]["overlap_resolution"] == "prefer_earlier_until"
    assert resolved["parts"][0]["overlap_boundary_seconds"] == 10.0


def test_store_upgrades_v10_session_workspace_schema_to_v11_without_losing_parts(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-a", "session-a")
    workspace = store.attach_session_source(
        "campaign-a", "session-a", source_id(1), workspace["revision"]
    )
    part_id = workspace["parts"][0]["part_id"]

    with sqlite3.connect(store.path) as db:
        db.execute("PRAGMA user_version=10")
        db.commit()

    migrated = Store(tmp_path)
    recovered = migrated.session_workspace("campaign-a", "session-a")
    assert recovered["parts"][0]["part_id"] == part_id
    assert recovered["parts"][0]["session_offset_seconds"] is None
    assert recovered["parts"][0]["trim_start_seconds"] == 0
    assert recovered["parts"][0]["chronology_version"] == "tda_recording_chronology_v1"
    with sqlite3.connect(migrated.path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 11


def _set_timeline(
    store,
    workspace,
    part_id,
    *,
    offset,
    trim_start=0.0,
    trim_end=None,
    gap=False,
    overlap=None,
    boundary=None,
):
    return store.update_session_part_timeline(
        workspace["campaign_id"],
        workspace["session_id"],
        part_id,
        workspace["revision"],
        session_offset_seconds=offset,
        trim_start_seconds=trim_start,
        trim_end_seconds=trim_end,
        gap_confirmed=gap,
        overlap_resolution=overlap,
        overlap_boundary_seconds=boundary,
    )


def test_reorder_clears_adjacency_specific_gap_and_overlap_decisions(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-order", "session-order")
    for seed in range(1, 4):
        workspace = store.attach_session_source(
            "campaign-order",
            "session-order",
            source_id(seed),
            workspace["revision"],
        )
    first, second, third = workspace["parts"]
    workspace = _set_timeline(store, workspace, first["part_id"], offset=0.0)
    workspace = _set_timeline(
        store,
        workspace,
        second["part_id"],
        offset=50.0,
        overlap="prefer_later_from",
        boundary=55.0,
    )
    workspace = _set_timeline(
        store,
        workspace,
        third["part_id"],
        offset=100.0,
        gap=True,
    )
    assert workspace["parts"][1]["overlap_resolution"] == "prefer_later_from"
    assert workspace["parts"][2]["gap_confirmed"] is True

    reordered = store.reorder_session_parts(
        "campaign-order",
        "session-order",
        [third["part_id"], first["part_id"], second["part_id"]],
        workspace["revision"],
    )

    assert [part["gap_confirmed"] for part in reordered["parts"]] == [False, False, False]
    assert [part["overlap_resolution"] for part in reordered["parts"]] == [None, None, None]
    assert [part["overlap_boundary_seconds"] for part in reordered["parts"]] == [None, None, None]
    assert reordered["parts"][0]["session_offset_seconds"] == 100.0
    assert reordered["parts"][1]["session_offset_seconds"] == 0.0
    assert reordered["parts"][2]["session_offset_seconds"] == 50.0


def test_detach_clears_relation_decisions_for_new_adjacencies(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-detach", "session-detach")
    for seed in range(1, 4):
        workspace = store.attach_session_source(
            "campaign-detach",
            "session-detach",
            source_id(seed),
            workspace["revision"],
        )
    first, second, third = workspace["parts"]
    workspace = _set_timeline(store, workspace, first["part_id"], offset=0.0)
    workspace = _set_timeline(
        store,
        workspace,
        second["part_id"],
        offset=50.0,
        overlap="prefer_earlier_until",
        boundary=55.0,
    )
    workspace = _set_timeline(
        store,
        workspace,
        third["part_id"],
        offset=100.0,
        gap=True,
    )

    detached = store.detach_session_part(
        "campaign-detach",
        "session-detach",
        second["part_id"],
        workspace["revision"],
    )

    assert [part["part_id"] for part in detached["parts"]] == [
        first["part_id"],
        third["part_id"],
    ]
    assert all(part["gap_confirmed"] is False for part in detached["parts"])
    assert all(part["overlap_resolution"] is None for part in detached["parts"])
    assert all(part["overlap_boundary_seconds"] is None for part in detached["parts"])


def test_geometry_change_invalidates_unchanged_current_and_next_relation_decisions(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-geometry", "session-geometry")
    workspace = store.attach_session_source(
        "campaign-geometry",
        "session-geometry",
        source_id(1),
        workspace["revision"],
    )
    workspace = store.attach_session_source(
        "campaign-geometry",
        "session-geometry",
        source_id(2),
        workspace["revision"],
    )
    first, second = workspace["parts"]

    workspace = _set_timeline(
        store,
        workspace,
        first["part_id"],
        offset=0.0,
        trim_end=60.0,
    )
    workspace = _set_timeline(
        store,
        workspace,
        second["part_id"],
        offset=75.0,
        gap=True,
    )
    assert workspace["parts"][1]["gap_confirmed"] is True

    changed = _set_timeline(
        store,
        workspace,
        first["part_id"],
        offset=0.0,
        trim_end=50.0,
    )

    assert changed["parts"][1]["gap_confirmed"] is False

    # If the current part's relation decision is deliberately changed in the
    # same mutation, that is an explicit reconfirmation rather than a silent carry.
    reconfirmed = _set_timeline(
        store,
        changed,
        second["part_id"],
        offset=70.0,
        overlap="prefer_later_from",
        boundary=72.0,
    )
    assert reconfirmed["parts"][1]["overlap_resolution"] == "prefer_later_from"
    assert reconfirmed["parts"][1]["overlap_boundary_seconds"] == 72.0
