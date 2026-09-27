from __future__ import annotations

from pathlib import Path

from tda_companion.craig_ingest_http import CraigIngestBoundary


def _boundary(tmp_path: Path) -> CraigIngestBoundary:
    return CraigIngestBoundary(
        lambda *_: None,
        data_root=tmp_path,
        token="x" * 43,
        origins=frozenset({"https://dnd.faysk.dev"}),
        port=8765,
    )


def test_run_catalog_cursor_round_trip_and_validation(tmp_path: Path):
    boundary = _boundary(tmp_path)
    key = ("2026-09-27T01:02:03.000Z", "craig-" + "a" * 64, "run-job-a1")
    cursor = boundary._catalog_cursor(key)
    assert boundary._decode_catalog_cursor(cursor) == key

    for invalid in ("", "%%%", boundary._catalog_cursor((key[0], key[1], "bad run"))):
        try:
            boundary._decode_catalog_cursor(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid cursor accepted")


def test_run_catalog_pages_newest_first_without_transcript_reads(monkeypatch, tmp_path: Path):
    staging = tmp_path / "staging"
    source_a = staging / ("craig-" + "a" * 64)
    source_b = staging / ("craig-" + "b" * 64)
    source_a.mkdir(parents=True)
    source_b.mkdir(parents=True)

    class Package:
        def __init__(self, sha: str):
            self.source_sha256 = sha

    monkeypatch.setattr(
        "tda_companion.craig_ingest_http.load_craig_package",
        lambda root, verify_tracks=False: Package(root.name.removeprefix("craig-")),
    )

    def listed(root, **_):
        source_id = root.name
        suffix = "a" if source_id.endswith("a" * 64) else "b"
        return {
            "runs": [
                {
                    "run_id": f"run-{suffix}",
                    "status": "completed",
                    "source_id": source_id,
                    "profile_id": "qwen-fast",
                    "transcript_sha256": "c" * 64,
                    "transcript_size_bytes": 123,
                    "completed_at": "2026-09-27T02:00:00.000Z" if suffix == "b" else "2026-09-27T01:00:00.000Z",
                    "stats": {},
                }
            ]
        }

    monkeypatch.setattr("tda_companion.craig_ingest_http.ensure_legacy_and_list", listed)
    monkeypatch.setattr("tda_companion.craig_ingest_http.publication_target_state", lambda *_: {"publication_target": None})
    monkeypatch.setattr(
        "tda_companion.craig_ingest_http.review_summary",
        lambda *_, **__: {"status": "unknown", "draft_revision": None, "review_percent": None, "updated_at": None},
    )

    boundary = _boundary(tmp_path)
    first = boundary._run_catalog_listing(limit=1, cursor=None)
    assert [item["run_id"] for item in first["runs"]] == ["run-b"]
    assert first["has_more"] is True
    assert isinstance(first["next_cursor"], str)

    cursor = boundary._decode_catalog_cursor(first["next_cursor"])
    second = boundary._run_catalog_listing(limit=1, cursor=cursor)
    assert [item["run_id"] for item in second["runs"]] == ["run-a"]
    assert second["has_more"] is False
    assert second["next_cursor"] is None
