from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tda_companion.api import create_app
from tda_companion.benchmark_bundles import BENCHMARK_PROFILES
from tda_companion.store import Store


TOKEN = "t" * 43
ORIGIN = "https://dnd.faysk.dev"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Origin": ORIGIN,
}


def _client(tmp_path: Path) -> tuple[TestClient, Path]:
    data = tmp_path / "Data"
    data.mkdir(parents=True, exist_ok=True)
    app = create_app(data, TOKEN, {ORIGIN}, run_worker=False)
    return TestClient(app, base_url="http://127.0.0.1:8765"), data


def _benchmark_body() -> dict:
    return {
        "kind": "benchmark.craig",
        "campaign_id": "benchmark-local",
        "session_id": "benchmark-local",
        "source_id": "craig-" + "a" * 64,
        "glossary": "",
        "context": "",
        "units": 4,
        "sample_seconds": 300.0,
        "sample_identity_sha256": "b" * 64,
        "track_count": 1,
        "audio_work_seconds": 300.0,
        "profiles": list(BENCHMARK_PROFILES),
        "prepared": True,
    }


def test_benchmark_retry_endpoint_resets_progress_for_the_new_attempt(tmp_path: Path):
    client, data = _client(tmp_path)
    store = Store(data)
    queued = store.submit("benchmark-retry-api", _benchmark_body())
    claimed = store.claim()
    assert claimed is not None
    job_id, first_attempt = claimed
    assert job_id == queued["id"]

    assert store.progress(job_id, first_attempt, completed=1, total=4, stage="benchmark")
    assert store.progress(job_id, first_attempt, completed=2, total=4, stage="benchmark")
    store.fail(
        job_id,
        first_attempt,
        "WORKER_EXECUTION_FAILED",
        recoverable=True,
    )

    with client:
        response = client.post(
            f"/api/v1/jobs/{job_id}/retry",
            headers=HEADERS,
            json={},
        )

        assert response.status_code == 200
        retried = response.json()
        assert retried["id"] == job_id
        assert retried["status"] == "queued"
        assert retried["progress"] == {
            "completed": 0,
            "total": 4,
            "unit": "profiles",
        }

        second = store.claim()
        assert second == (job_id, first_attempt + 1)
        for completed in range(1, 5):
            assert store.progress(
                job_id,
                second[1],
                completed=completed,
                total=4,
                stage="benchmark",
            )


def test_nonrecoverable_terminal_job_rejects_retry_but_can_be_discarded(tmp_path: Path):
    client, data = _client(tmp_path)
    store = Store(data)
    queued = store.submit("benchmark-nonrecoverable-api", _benchmark_body())
    claimed = store.claim()
    assert claimed is not None
    store.fail(
        queued["id"],
        claimed[1],
        "WORKER_PROGRESS_GAP",
        recoverable=False,
    )

    with client:
        retry = client.post(
            f"/api/v1/jobs/{queued['id']}/retry",
            headers=HEADERS,
            json={},
        )
        assert retry.status_code == 409
        assert retry.json()["error"]["code"] == "JOB_NOT_RETRYABLE"

        delete = client.post(
            f"/api/v1/jobs/{queued['id']}/delete",
            headers=HEADERS,
            json={},
        )
        assert delete.status_code == 200
        assert delete.json() == {"deleted": True, "id": queued["id"]}


def test_new_benchmark_identity_is_independent_from_retry_and_old_job_delete(tmp_path: Path):
    client, data = _client(tmp_path)
    store = Store(data)
    body = _benchmark_body()

    old = store.submit("benchmark-old-intent", body)
    first = store.claim()
    assert first is not None
    store.fail(old["id"], first[1], "WORKER_EXECUTION_FAILED", recoverable=True)

    new = store.submit("benchmark-new-intent", body)
    assert new["id"] != old["id"]
    assert new["progress"] == {"completed": 0, "total": 4, "unit": "profiles"}

    with client:
        deleted = client.post(
            f"/api/v1/jobs/{old['id']}/delete",
            headers=HEADERS,
            json={},
        )
        assert deleted.status_code == 200
        receipt = store.terminal_receipt(old["id"])
        assert receipt is not None
        assert receipt["job_id"] == old["id"]
        assert receipt["status"] == "failed"
        assert receipt["result_available"] is False

        preserved = client.get(f"/api/v1/jobs/{new['id']}", headers=HEADERS)
        assert preserved.status_code == 200
        assert preserved.json()["id"] == new["id"]
        assert preserved.json()["status"] == "queued"
