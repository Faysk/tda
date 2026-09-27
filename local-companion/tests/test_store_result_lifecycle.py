from __future__ import annotations

from pathlib import Path

import pytest

from tda_companion.store import Conflict, Store


def _completed_transcription(store: Store):
    source_id = "craig-" + "b" * 64
    job = store.submit(
        "idem-result-delete",
        {
            "kind": "transcription.craig",
            "campaign_id": "campaign",
            "session_id": "session",
            "source_id": source_id,
            "profile_id": "whisper-turbo",
            "glossary": "",
            "context": "",
            "cpu": False,
            "units": 1,
        },
    )
    assert store.claim() == (job["id"], 1)
    assert store.progress(job["id"], 1, completed=1, total=1, stage="transcribing")
    run_id = f"run-{job['id']}-a1"
    digest = "d" * 64
    result = {
        "schema_version": "tda_local_result_v1",
        "transcription": {
            "run_id": run_id,
            "sha256": digest,
        },
    }
    assert store.complete(job["id"], 1, result)
    return job["id"], run_id, digest


def test_mark_result_deleted_preserves_terminal_truth_and_hides_availability(tmp_path: Path):
    store = Store(tmp_path)
    job_id, run_id, digest = _completed_transcription(store)

    before = store.get(job_id)
    assert before["status"] == "succeeded"
    assert before["result_available"] is True

    changed = store.mark_result_deleted(job_id, run_id, digest)
    assert changed == {"updated": True, "state": "deleted_local"}

    after = store.get(job_id)
    assert after["status"] == "succeeded"
    assert after["result_available"] is False
    with pytest.raises(Conflict, match="RESULT_DELETED_LOCAL"):
        store.result(job_id)

    assert store.mark_result_deleted(job_id, run_id, digest) == {
        "updated": False,
        "state": "deleted_local",
    }


def test_queue_cleanup_preserves_deleted_result_state_in_terminal_receipt(tmp_path: Path):
    store = Store(tmp_path)
    job_id, run_id, digest = _completed_transcription(store)
    store.mark_result_deleted(job_id, run_id, digest)

    store.remove(job_id)
    receipt = store.terminal_receipt(job_id)
    assert receipt is not None
    assert receipt["status"] == "succeeded"
    assert receipt["result_available"] is False
    assert receipt["result_state"] == "deleted_local"

    assert store.mark_result_deleted(job_id, run_id, digest) == {
        "updated": False,
        "state": "deleted_local",
    }


def test_mark_result_deleted_rejects_mismatched_historical_identity(tmp_path: Path):
    store = Store(tmp_path)
    job_id, run_id, digest = _completed_transcription(store)

    with pytest.raises(Conflict, match="RESULT_ARTIFACT_MISMATCH"):
        store.mark_result_deleted(job_id, run_id + "-other", digest)

    assert store.get(job_id)["result_available"] is True
