from __future__ import annotations

from datetime import datetime, timedelta, timezone
from itertools import count

import tda_companion.store as store_module
from tda_companion.store import Store


def _body() -> dict[str, object]:
    return {
        "kind": "transcription.craig",
        "campaign_id": "campaign",
        "session_id": "session",
        "source_id": "source",
        "profile_id": "qwen-fast",
        "glossary": "",
        "context": "",
        "cpu": False,
        "units": 2,
    }


def test_authoritative_job_timing_survives_reload_and_resets_on_retry(monkeypatch, tmp_path):
    base = datetime(2026, 9, 27, tzinfo=timezone.utc)
    ticks = count()

    def fake_now() -> str:
        value = base + timedelta(seconds=next(ticks))
        return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    monkeypatch.setattr(store_module, "utc_now", fake_now)

    store = Store(tmp_path)
    job_id = store.submit("timing-a", _body())["id"]
    assert store.claim() == (job_id, 1)

    running = store.get(job_id)
    assert running["timing"]["schema_version"] == "tda_job_timing_v1"
    assert running["timing"]["attempt_started_at"] is not None
    assert running["timing"]["attempt_finished_at"] is None
    assert running["timing"]["attempt_elapsed_seconds"] >= 0

    assert store.record_worker_event(
        job_id,
        1,
        "TRACK_STARTED",
        {"stage": "transcription", "track": 1, "total_tracks": 2, "speaker": "Speaker A"},
    )
    assert store.record_worker_event(
        job_id,
        1,
        "TRACK_COMPLETED",
        {"stage": "transcription", "track": 1, "total_tracks": 2, "speaker": "Speaker A"},
    )
    assert store.set_stage(job_id, 1, "alignment")
    store.fail(job_id, 1, "SYNTHETIC_FAILURE")

    persisted = Store(tmp_path).get(job_id)
    timing = persisted["timing"]
    assert timing["attempt_finished_at"] is not None
    assert timing["attempt_elapsed_seconds"] > 0
    assert timing["stage_started_at"] is not None
    assert len(timing["tracks"]) == 1
    assert timing["tracks"][0]["track"] == 1
    assert timing["tracks"][0]["speaker"] == "Speaker A"
    assert timing["tracks"][0]["finished_at"] is not None
    assert timing["tracks"][0]["processing_seconds"] > 0

    retried = store.action(job_id, "retry")
    assert retried["status"] == "queued"
    assert retried["timing"]["attempt_started_at"] is None
    assert retried["timing"]["attempt_finished_at"] is None
    assert retried["timing"]["stage_started_at"] is None
    assert retried["timing"]["tracks"] == []

    assert store.claim() == (job_id, 2)
    second = store.get(job_id)
    assert second["attempt"] == 2
    assert second["timing"]["attempt_started_at"] is not None
    assert second["timing"]["tracks"] == []


def test_schema_v9_contains_durable_job_timing_columns(tmp_path):
    store = Store(tmp_path)
    with store.read() as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        columns = {row["name"] for row in db.execute("PRAGMA table_info(jobs)").fetchall()}

    assert version == 11
    assert {
        "attempt_started_at",
        "attempt_finished_at",
        "stage_started_at",
        "timing_state",
    } <= columns
