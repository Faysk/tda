from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("qwen_full_run_structure.py")
SPEC = importlib.util.spec_from_file_location("qwen_full_run_structure", MODULE_PATH)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)

SOURCE_SHA = "b2ac78347d88b2761e51be38a60aa266933e3b00f30e72c50626fbe599849b1e"


def transcript() -> dict:
    tracks = []
    for number in range(1, 5):
        tracks.append(
            {
                "number": number,
                "speaker": f"speaker-{number}",
                "source_filename": f"{number}.flac",
                "source_sha256": f"{number}" * 64,
                "duration_seconds": 300.0,
                "segments": [
                    {
                        "id": f"seg-{number}",
                        "start": 1.0,
                        "end": 2.0,
                        "text": "synthetic",
                        "words": [
                            {
                                "text": "synthetic",
                                "start": 1.0,
                                "end": 2.0,
                                "confidence": 0.9,
                            }
                        ],
                    }
                ],
                "timeline_offset_seconds": 0.0,
                "identity": None,
            }
        )
    return {
        "recording_id": "synthetic",
        "source_sha256": SOURCE_SHA,
        "language": "pt",
        "engine": {
            "engine": "qwen3",
            "model": "synthetic",
            "profile": "qwen-fast",
            "device": "cuda",
            "compute_type": "bfloat16",
            "alignment": "synthetic",
            "model_revision": "deadbeef",
        },
        "tracks": tracks,
        "stats": {
            "audio_work_seconds": 1200.0,
            "session_duration_seconds": 300.0,
            "processing_seconds": 10.0,
            "word_count": 4,
            "segment_count": 4,
            "track_count": 4,
            "rtf": 0.01,
            "turn_count": 0,
            "deduplicated_segment_count": 0,
            "duration_semantics": "session_extent_v1",
            "processing_metrics": None,
        },
        "turns": [],
        "warnings": [],
        "created_at": "2026-10-01T12:00:00Z",
        "schema_version": "tda_transcript_v1",
    }


class QwenFullRunStructureTests(unittest.TestCase):
    def write_fixture(self, root: Path, value: dict, *, attempt: int = 2):
        transcript_path = root / "transcript.json"
        transcript_path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
        digest = hashlib.sha256(transcript_path.read_bytes()).hexdigest()
        marker = {
            "schema_version": "tda_transcription_run_v1",
            "run_id": "run-job-a2",
            "origin": "asr",
            "status": "completed",
            "source_id": "craig-" + SOURCE_SHA,
            "source_sha256": SOURCE_SHA,
            "job_id": "job",
            "attempt": attempt,
            "profile_id": "qwen-fast",
            "engine": "qwen3",
            "model": "synthetic",
            "model_revision": "deadbeef",
            "device": "cuda",
            "compute_type": "bfloat16",
            "alignment": "synthetic",
            "language": "pt",
            "context_sha256": "0" * 64,
            "glossary_sha256": "0" * 64,
            "transcript_schema_version": "tda_transcript_v1",
            "artifact": "transcript.json",
            "transcript_sha256": digest,
            "transcript_size_bytes": transcript_path.stat().st_size,
            "created_at": "2026-10-01T12:00:00Z",
            "completed_at": "2026-10-01T12:10:00Z",
            "stats": {
                **value["stats"],
                "warning_count": len(value["warnings"]),
            },
        }
        marker_path = root / "run.json"
        marker_path.write_text(json.dumps(marker, sort_keys=True), encoding="utf-8")
        return transcript_path, marker_path

    def validate(self, transcript_path: Path, marker_path: Path):
        return module.validate_full_run(
            transcript_path=transcript_path,
            run_marker_path=marker_path,
            source_id="craig-" + SOURCE_SHA,
            expected_source_sha256=SOURCE_SHA,
            job_id="job",
            attempt=2,
            expected_profile_id="qwen-fast",
            expected_track_count=4,
            repo_root=Path(__file__).resolve().parents[2],
        )

    def test_valid_full_run_emits_only_structural_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript_path, marker_path = self.write_fixture(root, transcript())
            receipt = self.validate(transcript_path, marker_path)

        self.assertTrue(receipt["immutable_run_verified"])
        self.assertEqual(receipt["track_numbers"], [1, 2, 3, 4])
        self.assertEqual(receipt["audio_work_seconds"], 1200.0)
        self.assertEqual(receipt["session_duration_seconds"], 300.0)
        serialized = json.dumps(receipt, sort_keys=True)
        self.assertNotIn("synthetic", serialized)
        self.assertNotIn("speaker-", serialized)
        self.assertFalse(receipt["contains_transcript"])
        self.assertFalse(receipt["contains_paths"])

    def test_source_mismatch_fails_closed(self):
        value = transcript()
        value["source_sha256"] = "a" * 64
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript_path, marker_path = self.write_fixture(root, value)
            with self.assertRaisesRegex(
                module.QwenFullRunStructureError,
                "QWEN_1236_FULL_RUN_SOURCE_MISMATCH",
            ):
                self.validate(transcript_path, marker_path)

    def test_missing_track_fails_canonical_transcript_validation(self):
        value = transcript()
        value["tracks"].pop()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript_path, marker_path = self.write_fixture(root, value)
            with self.assertRaisesRegex(
                module.QwenFullRunStructureError,
                "QWEN_1236_FULL_RUN_TRANSCRIPT_INVALID",
            ):
                self.validate(transcript_path, marker_path)

    def test_first_attempt_cannot_satisfy_recovery_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript_path, marker_path = self.write_fixture(root, transcript(), attempt=1)
            with self.assertRaisesRegex(
                module.QwenFullRunStructureError,
                "QWEN_1236_FULL_RUN_RETRY_ATTEMPT_INVALID",
            ):
                module.validate_full_run(
                    transcript_path=transcript_path,
                    run_marker_path=marker_path,
                    source_id="craig-" + SOURCE_SHA,
                    expected_source_sha256=SOURCE_SHA,
                    job_id="job",
                    attempt=1,
                    expected_profile_id="qwen-fast",
                    expected_track_count=4,
                    repo_root=Path(__file__).resolve().parents[2],
                )


if __name__ == "__main__":
    unittest.main()
