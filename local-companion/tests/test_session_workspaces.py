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
