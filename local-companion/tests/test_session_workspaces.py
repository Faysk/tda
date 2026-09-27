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



def test_session_timing_decisions_are_cas_guarded_and_survive_restart(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-time", "session-time")
    for seed in range(1, 3):
        workspace = store.attach_session_source(
            "campaign-time",
            "session-time",
            source_id(seed),
            workspace["revision"],
        )

    first_part, second_part = workspace["parts"]
    timed = store.update_session_part_timing(
        "campaign-time",
        "session-time",
        first_part["part_id"],
        workspace["revision"],
        manual_offset_seconds=12.5,
        trim_start_seconds=1.25,
        trim_end_seconds=55.0,
        gap_confirmed=True,
        overlap_boundary_seconds=20.0,
    )
    assert timed["revision"] == workspace["revision"] + 1
    assert timed["chronology_mode"] == "manual"
    assert timed["parts"][0]["manual_offset_seconds"] == 12.5
    assert timed["parts"][0]["trim_start_seconds"] == 1.25
    assert timed["parts"][0]["trim_end_seconds"] == 55.0
    assert timed["parts"][0]["gap_confirmed"] is True
    assert timed["parts"][0]["overlap_boundary_seconds"] == 20.0

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_REVISION_CONFLICT"):
        store.update_session_part_timing(
            "campaign-time",
            "session-time",
            second_part["part_id"],
            workspace["revision"],
            manual_offset_seconds=70.0,
        )

    reopened = Store(tmp_path)
    recovered = reopened.session_workspace("campaign-time", "session-time")
    assert recovered["revision"] == timed["revision"]
    assert recovered["chronology_mode"] == "manual"
    assert recovered["parts"][0]["manual_offset_seconds"] == 12.5
    assert recovered["parts"][0]["trim_start_seconds"] == 1.25
    assert recovered["parts"][0]["trim_end_seconds"] == 55.0
    assert recovered["parts"][0]["gap_confirmed"] is True
    assert recovered["parts"][0]["overlap_boundary_seconds"] == 20.0


def test_manual_reorder_claims_chronology_authority_even_when_order_is_unchanged(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-order", "session-order")
    workspace = store.attach_session_source(
        "campaign-order",
        "session-order",
        source_id(1),
        workspace["revision"],
    )
    ids = [part["part_id"] for part in workspace["parts"]]
    assert workspace["chronology_mode"] == "automatic"

    manual = store.reorder_session_parts(
        "campaign-order",
        "session-order",
        ids,
        workspace["revision"],
    )
    assert manual["chronology_mode"] == "manual"
    assert manual["revision"] == workspace["revision"] + 1

    repeated = store.reorder_session_parts(
        "campaign-order",
        "session-order",
        ids,
        manual["revision"],
    )
    assert repeated["revision"] == manual["revision"]


def test_session_timing_rejects_invalid_trim_ranges_without_mutating_workspace(tmp_path):
    store = Store(tmp_path)
    workspace = store.ensure_session_workspace("campaign-invalid", "session-invalid")
    workspace = store.attach_session_source(
        "campaign-invalid",
        "session-invalid",
        source_id(1),
        workspace["revision"],
    )
    part_id = workspace["parts"][0]["part_id"]

    with pytest.raises(Conflict, match="SESSION_WORKSPACE_TIMING_INVALID"):
        store.update_session_part_timing(
            "campaign-invalid",
            "session-invalid",
            part_id,
            workspace["revision"],
            trim_start_seconds=20.0,
            trim_end_seconds=10.0,
        )

    unchanged = store.session_workspace("campaign-invalid", "session-invalid")
    assert unchanged["revision"] == workspace["revision"]
    assert unchanged["chronology_mode"] == "automatic"
    assert unchanged["parts"][0]["trim_start_seconds"] is None
    assert unchanged["parts"][0]["trim_end_seconds"] is None


def test_v10_session_workspace_schema_migrates_timing_columns_without_losing_parts(tmp_path):
    database = tmp_path / "jobs.sqlite3"
    with sqlite3.connect(database) as db:
        db.executescript(
            """
            CREATE TABLE jobs (
                id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, signature TEXT NOT NULL,
                body TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0,
                error TEXT, result TEXT, updated TEXT NOT NULL,
                attempt_started_at TEXT, attempt_finished_at TEXT,
                stage_started_at TEXT, timing_state TEXT
            );
            CREATE TABLE events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                code TEXT NOT NULL,
                at TEXT NOT NULL,
                attempt INTEGER,
                level TEXT NOT NULL DEFAULT 'info',
                data TEXT
            );
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE idempotency_keys (
                key TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                signature TEXT NOT NULL
            );
            CREATE TABLE terminal_job_receipts (
                job_id TEXT PRIMARY KEY,
                attempt INTEGER NOT NULL,
                status TEXT NOT NULL,
                result_available INTEGER NOT NULL,
                updated TEXT NOT NULL
            );
            CREATE TABLE job_activity (
                job_id TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                track INTEGER NOT NULL,
                metric TEXT NOT NULL,
                value INTEGER NOT NULL,
                updated TEXT NOT NULL,
                PRIMARY KEY(job_id, attempt, track, metric)
            );
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
            INSERT INTO settings VALUES ('device', 'legacy-device');
            INSERT INTO settings VALUES ('paused', 'false');
            INSERT INTO session_workspaces VALUES (
                'campaign-migrate',
                'session-migrate',
                1,
                '2026-09-27T20:00:00Z',
                '2026-09-27T20:00:00Z'
            );
            INSERT INTO session_recording_parts VALUES (
                '11111111111111111111111111111111',
                'campaign-migrate',
                'session-migrate',
                'craig-0000000000000000000000000000000000000000000000000000000000000001',
                0,
                NULL,
                '2026-09-27T20:00:00Z',
                '2026-09-27T20:00:00Z'
            );
            PRAGMA user_version=10;
            """
        )

    migrated = Store(tmp_path)
    workspace = migrated.session_workspace("campaign-migrate", "session-migrate")
    assert workspace["chronology_mode"] == "automatic"
    assert workspace["parts"][0]["manual_offset_seconds"] is None
    assert workspace["parts"][0]["trim_start_seconds"] is None
    assert workspace["parts"][0]["trim_end_seconds"] is None
    assert workspace["parts"][0]["gap_confirmed"] is False
    assert workspace["parts"][0]["overlap_boundary_seconds"] is None

    with sqlite3.connect(database) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 11
        workspace_columns = {
            row[1] for row in db.execute("PRAGMA table_info(session_workspaces)").fetchall()
        }
        part_columns = {
            row[1] for row in db.execute("PRAGMA table_info(session_recording_parts)").fetchall()
        }
    assert "chronology_mode" in workspace_columns
    assert {
        "manual_offset_seconds",
        "trim_start_seconds",
        "trim_end_seconds",
        "gap_confirmed",
        "overlap_boundary_seconds",
    } <= part_columns
