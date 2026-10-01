from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

MODULE_PATH = Path(__file__).with_name("qwen_empty_window_benchmark.py")
SPEC = importlib.util.spec_from_file_location("qwen_empty_window_benchmark", MODULE_PATH)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


def runtime_state(version: str = "1.0.14") -> dict[str, Any]:
    return {
        "status": "ready",
        "version": version,
        "worker": r"C:\\private\\TDAQwenWorker.exe",
        "runtime_id": "qwen3-transformers",
        "worker_sha256": "a" * 64,
        "archive_sha256": "b" * 64,
    }


def gate(profile_id: str, version: str = "1.0.14") -> dict[str, Any]:
    return {
        "status": "ready",
        "ready": True,
        "profile_id": profile_id,
        "accepted_at": "2026-10-01T12:00:00Z",
        "runtime_version": version,
        "runtime_artifact": {
            "runtime_id": "qwen3-transformers",
            "version": version,
            "worker_sha256": "a" * 64,
            "archive_sha256": "b" * 64,
        },
        "gpu": {
            "name": "NVIDIA GeForce RTX 4070 Laptop GPU",
            "compute_capability": "8.9",
            "total_memory_bytes": 8 * 1024**3,
        },
    }


def benchmark(profile_id: str, **overrides: Any) -> dict[str, Any]:
    value = {
        "schema_version": "tda_benchmark_profile_v1",
        "kind": "benchmark.profile",
        "profile_id": profile_id,
        "engine": "qwen3",
        "model": "synthetic-model",
        "model_revision": "deadbeef",
        "device": "cuda",
        "compute_type": "bfloat16",
        "alignment": "synthetic-aligner",
        "sample_seconds": 300.0,
        "audio_work_seconds": 1200.0,
        "session_duration_seconds": 300.0,
        "processing_timing_version": "fresh-work-v1",
        "processing_seconds": 12.0,
        "rtf": 0.04,
        "word_count": 42,
        "segment_count": 8,
        "track_count": 4,
        "warning_count": 0,
        "execution_lineage": {"private": "must be discarded"},
    }
    value.update(overrides)
    return value


class WorkerFailure(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class FakeSupervisor:
    def __init__(self, behavior: dict[str, object]):
        self.behavior = behavior
        self.calls: list[dict[str, Any]] = []

    def run_craig(self, **kwargs: Any):
        self.calls.append(dict(kwargs))
        profile_id = str(kwargs["profile_id"])
        behavior = self.behavior[profile_id]
        if isinstance(behavior, tuple):
            events, terminal = behavior
        else:
            events, terminal = [], behavior
        for payload in events:
            kwargs["on_event"](SimpleNamespace(type="event", payload=payload))
        if isinstance(terminal, BaseException):
            raise terminal
        return SimpleNamespace(terminal="result", payload=terminal)


class QwenEmptyWindowAcceptanceTests(unittest.TestCase):
    def run_acceptance(
        self,
        supervisor: FakeSupervisor,
        *,
        runtime_version: str = "1.0.14",
    ) -> dict[str, Any]:
        return module.run_acceptance(
            source_id="craig-" + module.EXPECTED_SOURCE_SHA256,
            runtime_root=Path("/runtime"),
            state_root=Path("/state"),
            models_root=Path("/models"),
            supervisor=supervisor,
            runtime_inspector=lambda *_args, **_kwargs: runtime_state(runtime_version),
            gate_inspector=lambda *_args, profile_id, **_kwargs: gate(
                profile_id, runtime_version
            ),
            now=lambda: datetime(2026, 10, 1, 12, 30, tzinfo=timezone.utc),
        )

    def test_success_receipt_is_qwen_only_exact_and_private(self):
        supervisor = FakeSupervisor(
            {
                "qwen-fast": (
                    [
                        {
                            "code": "QWEN_WINDOW_SILENCE_CONFIRMED",
                            "stage": "transcription",
                            "track": 1,
                            "window": 1,
                            "completed_window_count": 1,
                            "start_seconds": 0.0,
                            "end_seconds": 240.0,
                            "sample_count": 3_840_000,
                            "peak_dbfs": -120.0,
                            "rms_dbfs": -120.0,
                            "silence_peak_threshold_dbfs": -84.0,
                            "silence_rms_threshold_dbfs": -90.0,
                            "speaker": "Private Name",
                            "text": "private transcript",
                            "path": r"C:\\Users\\Private\\audio.flac",
                        }
                    ],
                    benchmark("qwen-fast"),
                ),
                "qwen-quality": benchmark("qwen-quality"),
            }
        )

        receipt = self.run_acceptance(supervisor)

        self.assertTrue(receipt["candidate_completed_both_profiles"])
        self.assertTrue(receipt["diagnostic_complete"])
        self.assertTrue(receipt["stable_promotion_eligible"])
        self.assertEqual(
            [row["profile_id"] for row in receipt["profiles"]],
            ["qwen-fast", "qwen-quality"],
        )
        self.assertEqual(
            receipt["profiles"][0]["classification"],
            "confirmed_near_digital_silence",
        )
        self.assertNotIn("execution_lineage", receipt["profiles"][0]["benchmark"])
        diagnostic = receipt["profiles"][0]["diagnostics"][0]
        self.assertNotIn("speaker", diagnostic)
        self.assertNotIn("text", diagnostic)
        self.assertNotIn("path", diagnostic)
        serialized = json.dumps(receipt, sort_keys=True)
        self.assertNotIn("craig-" + module.EXPECTED_SOURCE_SHA256, serialized)
        self.assertEqual(receipt["source_sha256"], module.EXPECTED_SOURCE_SHA256)
        self.assertEqual(receipt["expected_track_count"], 4)
        self.assertEqual(receipt["expected_audio_work_seconds"], 1200.0)
        self.assertNotIn("Private Name", serialized)
        self.assertNotIn("private transcript", serialized)
        self.assertEqual(
            [call["profile_id"] for call in supervisor.calls],
            ["qwen-fast", "qwen-quality"],
        )
        self.assertTrue(all(call["benchmark_sample_seconds"] == 300.0 for call in supervisor.calls))

    def test_uncertain_empty_recognition_is_diagnosed_but_not_promotion_eligible(self):
        supervisor = FakeSupervisor(
            {
                "qwen-fast": (
                    [
                        {
                            "code": "QWEN_WINDOW_EMPTY_ASR_REJECTED",
                            "stage": "transcription",
                            "track": 2,
                            "window": 1,
                            "completed_window_count": 1,
                            "start_seconds": 0.0,
                            "end_seconds": 240.0,
                            "sample_count": 3_840_000,
                            "peak_dbfs": -32.5,
                            "rms_dbfs": -44.0,
                            "silence_peak_threshold_dbfs": -84.0,
                            "silence_rms_threshold_dbfs": -90.0,
                            "audio": "must never survive",
                        }
                    ],
                    WorkerFailure("QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN"),
                ),
                "qwen-quality": benchmark("qwen-quality"),
            }
        )

        receipt = self.run_acceptance(supervisor)

        self.assertFalse(receipt["candidate_completed_both_profiles"])
        self.assertTrue(receipt["diagnostic_complete"])
        self.assertFalse(receipt["stable_promotion_eligible"])
        failed = receipt["profiles"][0]
        self.assertEqual(failed["error_code"], "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN")
        self.assertEqual(failed["classification"], "empty_recognition_with_signal")
        self.assertNotIn("audio", failed["diagnostics"][0])

    def test_later_unrelated_failure_is_not_misclassified_as_silence(self):
        supervisor = FakeSupervisor(
            {
                "qwen-fast": (
                    [
                        {
                            "code": "QWEN_WINDOW_SILENCE_CONFIRMED",
                            "stage": "transcription",
                            "track": 1,
                            "window": 1,
                            "completed_window_count": 1,
                            "start_seconds": 0.0,
                            "end_seconds": 240.0,
                            "sample_count": 3_840_000,
                            "peak_dbfs": -120.0,
                            "rms_dbfs": -120.0,
                            "silence_peak_threshold_dbfs": -84.0,
                            "silence_rms_threshold_dbfs": -90.0,
                        }
                    ],
                    WorkerFailure("QWEN_ALIGNMENT_REQUIRED"),
                ),
                "qwen-quality": benchmark("qwen-quality"),
            }
        )

        receipt = self.run_acceptance(supervisor)

        failed = receipt["profiles"][0]
        self.assertEqual(failed["classification"], "other_failure")
        self.assertEqual(failed["error_code"], "QWEN_ALIGNMENT_REQUIRED")
        self.assertFalse(failed["diagnostic_complete"])
        self.assertFalse(receipt["stable_promotion_eligible"])

    def test_wrong_source_fails_before_runtime_or_worker_execution(self):
        supervisor = FakeSupervisor(
            {
                "qwen-fast": benchmark("qwen-fast"),
                "qwen-quality": benchmark("qwen-quality"),
            }
        )
        runtime_calls = 0

        def inspect_runtime(*_args: Any, **_kwargs: Any):
            nonlocal runtime_calls
            runtime_calls += 1
            return runtime_state()

        with self.assertRaisesRegex(
            module.QwenEmptyWindowAcceptanceError,
            "QWEN_1236_SOURCE_MISMATCH",
        ):
            module.run_acceptance(
                source_id="craig-" + "d" * 64,
                runtime_root=Path("/runtime"),
                state_root=Path("/state"),
                models_root=Path("/models"),
                supervisor=supervisor,
                runtime_inspector=inspect_runtime,
                gate_inspector=lambda *_args, profile_id, **_kwargs: gate(profile_id),
            )
        self.assertEqual(runtime_calls, 0)
        self.assertEqual(supervisor.calls, [])

    def test_benchmark_requires_exact_four_track_300_second_coverage(self):
        invalid_payloads = (
            benchmark("qwen-fast", track_count=3),
            benchmark("qwen-fast", audio_work_seconds=900.0),
            benchmark("qwen-fast", session_duration_seconds=240.0),
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                supervisor = FakeSupervisor(
                    {
                        "qwen-fast": payload,
                        "qwen-quality": benchmark("qwen-quality"),
                    }
                )
                with self.assertRaisesRegex(
                    module.QwenEmptyWindowAcceptanceError,
                    "QWEN_1236_BENCHMARK_COVERAGE_INVALID",
                ):
                    self.run_acceptance(supervisor)

    def test_rejected_empty_event_cannot_become_promotion_eligible_on_result(self):
        supervisor = FakeSupervisor(
            {
                "qwen-fast": (
                    [
                        {
                            "code": "QWEN_WINDOW_EMPTY_ASR_REJECTED",
                            "stage": "transcription",
                            "track": 2,
                            "window": 1,
                            "completed_window_count": 1,
                            "start_seconds": 0.0,
                            "end_seconds": 60.0,
                            "sample_count": 960_000,
                            "peak_dbfs": -32.5,
                            "rms_dbfs": -44.0,
                            "silence_peak_threshold_dbfs": -84.0,
                            "silence_rms_threshold_dbfs": -90.0,
                        }
                    ],
                    benchmark("qwen-fast"),
                ),
                "qwen-quality": benchmark("qwen-quality"),
            }
        )

        receipt = self.run_acceptance(supervisor)

        self.assertFalse(receipt["candidate_completed_both_profiles"])
        self.assertFalse(receipt["diagnostic_complete"])
        self.assertFalse(receipt["stable_promotion_eligible"])
        self.assertEqual(receipt["profiles"][0]["classification"], "invalid_outcome")

    def test_cli_cannot_override_exact_runtime_contract(self):
        with self.assertRaises(SystemExit):
            module.parse_args(
                [
                    "--confirm",
                    "RUN",
                    "--source-id",
                    "craig-" + module.EXPECTED_SOURCE_SHA256,
                    "--expected-runtime-version",
                    "1.0.14",
                ]
            )

    def test_wrong_runtime_version_fails_before_worker_execution(self):
        supervisor = FakeSupervisor(
            {
                "qwen-fast": benchmark("qwen-fast"),
                "qwen-quality": benchmark("qwen-quality"),
            }
        )
        with self.assertRaisesRegex(
            module.QwenEmptyWindowAcceptanceError,
            "QWEN_1236_RUNTIME_VERSION_MISMATCH",
        ):
            self.run_acceptance(supervisor, runtime_version="1.0.12")
        self.assertEqual(supervisor.calls, [])

    def test_stale_profile_gate_fails_before_worker_execution(self):
        supervisor = FakeSupervisor(
            {
                "qwen-fast": benchmark("qwen-fast"),
                "qwen-quality": benchmark("qwen-quality"),
            }
        )

        def inspect_gate(*_args: Any, profile_id: str, **_kwargs: Any):
            value = gate(profile_id)
            if profile_id == "qwen-quality":
                value["runtime_artifact"] = {**value["runtime_artifact"], "worker_sha256": "d" * 64}
            return value

        with self.assertRaisesRegex(
            module.QwenEmptyWindowAcceptanceError,
            "QWEN_1236_PHYSICAL_GATE_STALE",
        ):
            module.run_acceptance(
                source_id="craig-" + module.EXPECTED_SOURCE_SHA256,
                runtime_root=Path("/runtime"),
                state_root=Path("/state"),
                models_root=Path("/models"),
                supervisor=supervisor,
                runtime_inspector=lambda *_args, **_kwargs: runtime_state(),
                gate_inspector=inspect_gate,
            )
        self.assertEqual(supervisor.calls, [])


if __name__ == "__main__":
    unittest.main()
