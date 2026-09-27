from __future__ import annotations

import sqlite3

from tda_companion.store import Store


BODY = {
    "kind": "synthetic.fixture",
    "campaign_id": "campaign",
    "session_id": "session",
    "source_id": "source",
    "units": 2,
}


def test_job_and_attempt_clocks_survive_reload_and_retry(tmp_path):
    store = Store(tmp_path)
    job = store.submit("timing", BODY)
    assert job["submitted_at"] is not None
    assert job["job_started_at"] is None
    assert job["attempt_started_at"] is None
    assert job["stage_started_at"] is None

    assert store.claim() == (job["id"], 1)
    first = store.get(job["id"])
    assert first["job_started_at"] is not None
    assert first["attempt_started_at"] is not None
    assert first["stage_started_at"] is not None
    first_job_started = first["job_started_at"]

    store.fail(job["id"], 1, "SYNTHETIC_FAILURE")
    store.action(job["id"], "retry")
    queued = store.get(job["id"])
    assert queued["job_started_at"] == first_job_started
    assert queued["attempt_started_at"] is None
    assert queued["stage_started_at"] is None

    assert Store(tmp_path).get(job["id"])["job_started_at"] == first_job_started


def test_track_timing_is_attempt_scoped_and_marks_checkpoint_reuse(tmp_path):
    store = Store(tmp_path)
    job_id = store.submit("track-timing", BODY)["id"]
    assert store.claim() == (job_id, 1)

    assert store.record_worker_event(
        job_id,
        1,
        "TRACK_STARTED",
        {"stage": "transcription", "track": 1, "total_tracks": 2, "speaker": "Alice"},
    )
    assert store.record_worker_event(
        job_id,
        1,
        "TRACK_COMPLETED",
        {"stage": "transcription", "track": 1, "total_tracks": 2, "speaker": "Alice"},
    )
    assert store.record_worker_event(
        job_id,
        1,
        "ASR_CHECKPOINT_REUSED",
        {"stage": "transcription", "track": 2, "total_tracks": 2, "speaker": "Bob"},
    )

    timing = store.timing(job_id)
    assert timing["schema_version"] == "tda_job_timing_v1"
    assert timing["attempt"] == 1
    assert timing["tracks"][0]["track"] == 1
    assert timing["tracks"][0]["started_at"] is not None
    assert timing["tracks"][0]["completed_at"] is not None
    assert timing["tracks"][0]["reused"] is False
    assert timing["tracks"][1] == {
        "track": 2,
        "speaker": "Bob",
        "started_at": None,
        "completed_at": None,
        "reused": True,
    }


def test_v8_migration_keeps_historical_clocks_unknown(tmp_path):
    store = Store(tmp_path)
    job_id = store.submit("legacy-clock", BODY)["id"]
    with sqlite3.connect(store.path) as db:
        for column in ("submitted_at", "job_started_at", "attempt_started_at", "stage_started_at"):
            db.execute(f"UPDATE jobs SET {column}=NULL WHERE id=?", (job_id,))
        db.execute("PRAGMA user_version=8")
        db.commit()

    migrated = Store(tmp_path)
    job = migrated.get(job_id)
    assert job["submitted_at"] is None
    assert job["job_started_at"] is None
    assert job["attempt_started_at"] is None
    assert job["stage_started_at"] is None
    with sqlite3.connect(migrated.path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 9
