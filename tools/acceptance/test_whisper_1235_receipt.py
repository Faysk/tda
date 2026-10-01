from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from whisper_1235_receipt import Whisper1235EvidenceError, validate_receipt, verify_files


def candidate() -> dict:
    return {
        "schema": "tda_runtime_candidate_v1",
        "family": "whisper",
        "runtime_id": "whisper-ctranslate2",
        "platform": "windows-x64",
        "version": "1.1.8",
        "source_sha": "1" * 40,
        "source_tree_sha": "2" * 40,
        "workflow_run_id": 123,
        "candidate_tag": "companion-whisper-runtime-rc-v1.1.8-" + ("1" * 12),
        "stable_tag": "companion-whisper-runtime-v1.1.8",
        "runtime_archive_sha256": "3" * 64,
        "assets": [{"name": "runtime.zip", "size": 1, "sha256": "4" * 64}],
    }


def span() -> dict:
    return {
        "track": 1,
        "segment": 7,
        "start_seconds": 10.0,
        "end_seconds": 11.0,
        "relative_start_seconds": -0.051,
        "relative_end_seconds": 0.0,
    }


def receipt() -> dict:
    c = candidate()
    sample = {
        "sample_seconds": 300.0,
        "audio_work_seconds": 1200.0,
        "session_duration_seconds": 300.0,
        "processing_seconds": 10.0,
        "rtf": 0.01,
        "word_count": 50,
        "segment_count": 10,
        "track_count": 4,
        "warning_count": 1,
        "span_widened_count": 1,
        "span_examples": [span()],
    }
    metrics = {
        "audio_work_seconds": 48000.0,
        "session_duration_seconds": 12000.0,
        "processing_seconds": 100.0,
        "rtf": 0.01,
        "word_count": 5000,
        "segment_count": 800,
        "track_count": 4,
        "turn_count": 600,
        "deduplicated_segment_count": 3,
    }
    full = {
        "metrics": metrics,
        "span_widened_count": 0,
        "span_examples": [],
        "run_committed": True,
    }
    return {
        "schema": "tda_whisper_craig_containment_acceptance_v1",
        "pass": True,
        "accepted_at": "2026-10-01T16:30:00.0000000+00:00",
        "candidate": {
            "candidate_tag": c["candidate_tag"],
            "version": c["version"],
            "runtime_id": c["runtime_id"],
            "source_sha": c["source_sha"],
            "source_tree_sha": c["source_tree_sha"],
            "workflow_run_id": c["workflow_run_id"],
            "runtime_archive_sha256": c["runtime_archive_sha256"],
            "worker_sha256": "5" * 64,
            "python": "3.12.14",
            "packages": {
                "faster_whisper": "1.2.1",
                "ctranslate2": "4.8.2",
                "pyav": "18.1.0",
            },
        },
        "gpu": {
            "name": "NVIDIA GeForce RTX 4070 Laptop GPU",
            "driver_version": "616.56",
            "required_name_match": True,
        },
        "profiles": [
            {"profile_id": "whisper-turbo", "sample": copy.deepcopy(sample), "full": copy.deepcopy(full)},
            {"profile_id": "whisper-detailed", "sample": copy.deepcopy(sample), "full": copy.deepcopy(full)},
        ],
        "immutable_runs_verified": True,
        "contains_audio": False,
        "contains_transcript": False,
        "contains_text": False,
        "contains_speaker": False,
        "contains_local_paths": False,
        "contains_source_id": False,
    }


class Whisper1235ReceiptTests(unittest.TestCase):
    def test_valid_receipt_is_retained_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            evidence = root / "evidence"
            evidence.mkdir()
            c = candidate()
            candidate_path = root / "candidate.json"
            candidate_path.write_text(json.dumps(c), encoding="utf-8")
            receipt_path = evidence / f"{c['candidate_tag']}.whisper-1235.json"
            payload = json.dumps(receipt(), separators=(",", ":")).encode()
            receipt_path.write_bytes(payload)
            retained = root / "prepared" / "Whisper-1235-acceptance.json"

            result = verify_files(candidate_path, evidence, retained)

            self.assertEqual(result["required"], True)
            self.assertEqual(retained.read_bytes(), payload)
            self.assertEqual(len(str(result["sha256"])), 64)

    def test_other_runtime_version_does_not_require_issue_gate(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            c = candidate()
            c["version"] = "1.1.9"
            c["candidate_tag"] = "companion-whisper-runtime-rc-v1.1.9-" + ("1" * 12)
            path = root / "candidate.json"
            path.write_text(json.dumps(c), encoding="utf-8")

            result = verify_files(path, root / "missing", root / "unused.json")

            self.assertEqual(result, {"required": False})

    def test_identity_drift_is_rejected(self):
        value = receipt()
        value["candidate"]["source_sha"] = "9" * 40
        with self.assertRaisesRegex(Whisper1235EvidenceError, "IDENTITY_MISMATCH:source_sha"):
            validate_receipt(candidate(), value)

    def test_extra_field_cannot_hide_private_content(self):
        value = receipt()
        value["profiles"][0]["sample"]["transcript"] = "private"
        with self.assertRaisesRegex(Whisper1235EvidenceError, "SAMPLE_SHAPE_INVALID"):
            validate_receipt(candidate(), value)

    def test_privacy_flag_must_be_false(self):
        value = receipt()
        value["contains_transcript"] = True
        with self.assertRaisesRegex(Whisper1235EvidenceError, "PRIVACY_INVALID:contains_transcript"):
            validate_receipt(candidate(), value)

    def test_four_track_shape_is_required(self):
        value = receipt()
        value["profiles"][1]["full"]["metrics"]["track_count"] = 3
        with self.assertRaisesRegex(Whisper1235EvidenceError, "FULL_TRACK_COUNT_INVALID"):
            validate_receipt(candidate(), value)

    def test_span_examples_are_numeric_allowlisted_and_material(self):
        value = receipt()
        value["profiles"][0]["sample"]["span_examples"][0]["text"] = "private"
        with self.assertRaisesRegex(Whisper1235EvidenceError, "SPAN_EXAMPLE_SHAPE_INVALID"):
            validate_receipt(candidate(), value)

        value = receipt()
        value["profiles"][0]["sample"]["span_examples"][0]["relative_start_seconds"] = -0.049
        with self.assertRaisesRegex(Whisper1235EvidenceError, "SPAN_RELATION_INVALID"):
            validate_receipt(candidate(), value)

    def test_nonempty_speech_and_committed_full_run_are_required(self):
        value = receipt()
        value["profiles"][0]["sample"]["word_count"] = 0
        with self.assertRaisesRegex(Whisper1235EvidenceError, "SAMPLE_WORD_COUNT_INVALID"):
            validate_receipt(candidate(), value)

        value = receipt()
        value["profiles"][0]["full"]["run_committed"] = False
        with self.assertRaisesRegex(Whisper1235EvidenceError, "FULL_RUN_COMMIT_REQUIRED"):
            validate_receipt(candidate(), value)


if __name__ == "__main__":
    unittest.main()
