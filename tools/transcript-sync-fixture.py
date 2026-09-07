"""Generate synthetic data with the preserved legacy exporter; never reads user recordings."""
import importlib
import json
import pathlib
import sys
import types

root = pathlib.Path(__file__).resolve().parents[1]
package = types.ModuleType("legacy_fixture")
package.__path__ = [str(pathlib.Path(sys.argv[1]).resolve())]
sys.modules[package.__name__] = package
publication = importlib.import_module("legacy_fixture.publication")
artifacts = importlib.import_module("legacy_fixture.artifacts")

timeline = [
    {"id": "speaker-0", "speaker": "Jogadora Á", "track": "track-1.flac", "start": 1.0, "end": 2.125, "text": "Olá, dragão 🐉!", "words": []},
    {"id": "speaker-1", "speaker": "Mestre", "track": "track-2.flac", "start": 2.5, "end": 4.0, "text": "A porta está fechada.", "words": [{"word": "A", "start": 2.5, "end": 2.75, "probability": 0.9876}]},
]
session = {"recording_id": "fixture-source", "start_time": "2026-01-01T12:00:00Z", "title": "Synthetic test only", "speakers": ["Jogadora Á", "Mestre"], "format": "fixture.testdata", "transcript": timeline}
manifest = {"transcript": {"sha256": artifacts.sha256_json(timeline)}}
bundle = publication.build_publication_bundle(session, manifest)
bundle["generated_at"] = "2026-01-01T12:00:00Z"
canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
payload = {k: v for k, v in bundle.items() if k not in ("publication_id", "generated_at")}
result = {"schema_version": "tda_local_result_v1", "campaign_id": "11111111-1111-4111-8111-111111111111", "session_id": "22222222-2222-4222-8222-222222222222", "source_id": session["recording_id"], "job_id": "fixture-job", "publication_bundle": bundle, "import_artifacts": {"publication_payload_json": canonical(payload), "transcript_json": canonical(timeline)}, "sync": {"status": "not_configured"}}
output = root / "src/features/transcript-sync/fixtures/python-import.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"schemaVersion": "tda_transcript_import_v1", "result": result}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("SYNTHETIC_PYTHON_FIXTURE_GENERATED", bundle["publication_id"])
