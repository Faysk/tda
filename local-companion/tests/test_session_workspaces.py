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


def test_manual_order_confirmation_persists_and_bumps_even_when_order_is_unchanged(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-order", "session-order")
    for seed in range(1, 3):
        workspace = store.attach_session_source(
            "campaign-order",
            "session-order",
            source_id(seed),
            workspace["revision"],
        )
    ids = [part["part_id"] for part in workspace["parts"]]
    assert workspace["order_authority"] == "unconfirmed"

    confirmed = store.reorder_session_parts(
        "campaign-order",
        "session-order",
        ids,
        workspace["revision"],
    )
    assert confirmed["revision"] == workspace["revision"] + 1
    assert confirmed["order_authority"] == "manual"

    restarted = Store(tmp_path).session_workspace("campaign-order", "session-order")
    assert restarted["order_authority"] == "manual"
    assert [part["part_id"] for part in restarted["parts"]] == ids


def test_timing_and_overlap_decisions_are_durable_and_cas_guarded(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-time", "session-time")
    for seed in range(1, 3):
        workspace = store.attach_session_source(
            "campaign-time",
            "session-time",
            source_id(seed),
            workspace["revision"],
        )
    ids = [part["part_id"] for part in workspace["parts"]]
    workspace = store.reorder_session_parts(
        "campaign-time",
        "session-time",
        ids,
        workspace["revision"],
    )

    timed = store.update_session_part_timing(
        "campaign-time",
        "session-time",
        ids[1],
        manual_offset_seconds=30.0,
        trim_start_seconds=2.0,
        trim_end_seconds=45.0,
        expected_revision=workspace["revision"],
    )
    assert timed["parts"][1]["manual_offset_seconds"] == 30.0
    assert timed["parts"][1]["trim_start_seconds"] == 2.0
    assert timed["parts"][1]["trim_end_seconds"] == 45.0

    decided = store.set_session_timeline_decision(
        "campaign-time",
        "session-time",
        ids[0],
        ids[1],
        decision="prefer_earlier_until",
        boundary_seconds=35.0,
        expected_revision=timed["revision"],
    )
    assert decided["timeline_decisions"] == [
        {
            "earlier_part_id": ids[0],
            "later_part_id": ids[1],
            "decision": "prefer_earlier_until",
            "boundary_seconds": 35.0,
            "created_at": decided["timeline_decisions"][0]["created_at"],
            "updated_at": decided["timeline_decisions"][0]["updated_at"],
        }
    ]

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_REVISION_CONFLICT"):
        store.update_session_part_timing(
            "campaign-time",
            "session-time",
            ids[0],
            manual_offset_seconds=0.0,
            trim_start_seconds=0.0,
            trim_end_seconds=None,
            expected_revision=timed["revision"],
        )

    restarted = Store(tmp_path).session_workspace("campaign-time", "session-time")
    assert restarted["parts"][1]["manual_offset_seconds"] == 30.0
    assert restarted["timeline_decisions"][0]["decision"] == "prefer_earlier_until"


def test_timing_change_and_reorder_clear_stale_adjacent_decisions(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-clear", "session-clear")
    for seed in range(1, 4):
        workspace = store.attach_session_source(
            "campaign-clear",
            "session-clear",
            source_id(seed),
            workspace["revision"],
        )
    ids = [part["part_id"] for part in workspace["parts"]]
    workspace = store.reorder_session_parts(
        "campaign-clear",
        "session-clear",
        ids,
        workspace["revision"],
    )
    workspace = store.set_session_timeline_decision(
        "campaign-clear",
        "session-clear",
        ids[0],
        ids[1],
        decision="gap_acknowledged",
        boundary_seconds=None,
        expected_revision=workspace["revision"],
    )
    assert len(workspace["timeline_decisions"]) == 1

    changed = store.update_session_part_timing(
        "campaign-clear",
        "session-clear",
        ids[0],
        manual_offset_seconds=0.0,
        trim_start_seconds=1.0,
        trim_end_seconds=None,
        expected_revision=workspace["revision"],
    )
    assert changed["timeline_decisions"] == []

    changed = store.set_session_timeline_decision(
        "campaign-clear",
        "session-clear",
        ids[0],
        ids[1],
        decision="gap_acknowledged",
        boundary_seconds=None,
        expected_revision=changed["revision"],
    )
    reordered = store.reorder_session_parts(
        "campaign-clear",
        "session-clear",
        [ids[1], ids[0], ids[2]],
        changed["revision"],
    )
    assert reordered["timeline_decisions"] == []


def test_timeline_decision_requires_current_adjacent_parts(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-edge", "session-edge")
    for seed in range(1, 4):
        workspace = store.attach_session_source(
            "campaign-edge",
            "session-edge",
            source_id(seed),
            workspace["revision"],
        )
    ids = [part["part_id"] for part in workspace["parts"]]

    with pytest.raises(Conflict, match="SESSION_TIMELINE_RELATION_NOT_FOUND"):
        store.set_session_timeline_decision(
            "campaign-edge",
            "session-edge",
            ids[0],
            ids[2],
            decision="gap_acknowledged",
            boundary_seconds=None,
            expected_revision=workspace["revision"],
        )


def test_store_migrates_v10_workspace_timing_columns_without_rewriting_parts(tmp_path):
    db_path = tmp_path / "jobs.sqlite3"
    db = sqlite3.connect(db_path)
    try:
        db.executescript(
            """
            CREATE TABLE session_workspaces (
                campaign_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0,
                created TEXT NOT NULL,
                updated TEXT NOT NULL,
                PRIMARY KEY(campaign_id, session_id)
            );
            CREATE TABLE session_recording_parts (
                part_id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                selected_run_id TEXT,
                created TEXT NOT NULL,
                updated TEXT NOT NULL,
                UNIQUE(campaign_id, session_id, source_id),
                UNIQUE(campaign_id, session_id, ordinal)
            );
            INSERT INTO session_workspaces
                (campaign_id,session_id,revision,created,updated)
            VALUES ('campaign-old','session-old',1,'2026-09-27T00:00:00Z','2026-09-27T00:00:00Z');
            INSERT INTO session_recording_parts
                (part_id,campaign_id,session_id,source_id,ordinal,selected_run_id,created,updated)
            VALUES (
                '11111111111111111111111111111111',
                'campaign-old',
                'session-old',
                'craig-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                0,
                NULL,
                '2026-09-27T00:00:00Z',
                '2026-09-27T00:00:00Z'
            );
            PRAGMA user_version=10;
            """
        )
        db.commit()
    finally:
        db.close()

    migrated = Store(tmp_path)
    workspace = migrated.session_workspace("campaign-old", "session-old")
    assert workspace["order_authority"] == "unconfirmed"
    assert workspace["parts"][0]["manual_offset_seconds"] is None
    assert workspace["parts"][0]["trim_start_seconds"] == 0.0
    assert workspace["parts"][0]["trim_end_seconds"] is None

    db = sqlite3.connect(migrated.path)
    try:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 11
    finally:
        db.close()
