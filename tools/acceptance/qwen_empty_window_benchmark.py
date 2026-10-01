#!/usr/bin/env python3
"""Qwen-only physical acceptance for #1236.

Runs the existing isolated Qwen worker against the already-staged local Craig
source for the canonical 300-second benchmark window. The receipt deliberately
contains no source id, local path, audio, transcript text, speaker names or
pairing credentials.

The normal four-profile benchmark is not used here because independent Whisper
release defects (#1233/#1234) must not block diagnosis of the Qwen regression.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

EXPECTED_RUNTIME_VERSION = "1.0.13"
SAMPLE_SECONDS = 300.0
EXPECTED_SOURCE_SHA256 = "b2ac78347d88b2761e51be38a60aa266933e3b00f30e72c50626fbe599849b1e"
EXPECTED_TRACK_COUNT = 4
EXPECTED_AUDIO_WORK_SECONDS = SAMPLE_SECONDS * EXPECTED_TRACK_COUNT
QWEN_PROFILES = ("qwen-fast", "qwen-quality")
_ERROR = re.compile(r"^[A-Z0-9_]{1,96}$")
_SOURCE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
DIAGNOSTIC_CODES = frozenset(
    {"QWEN_WINDOW_SILENCE_CONFIRMED", "QWEN_WINDOW_EMPTY_ASR_REJECTED"}
)
DIAGNOSTIC_FIELDS = frozenset(
    {
        "code",
        "stage",
        "track",
        "window",
        "completed_window_count",
        "start_seconds",
        "end_seconds",
        "sample_count",
        "peak_dbfs",
        "rms_dbfs",
        "silence_peak_threshold_dbfs",
        "silence_rms_threshold_dbfs",
    }
)
BENCHMARK_FIELDS = frozenset(
    {
        "schema_version",
        "kind",
        "profile_id",
        "engine",
        "model",
        "model_revision",
        "device",
        "compute_type",
        "alignment",
        "sample_seconds",
        "audio_work_seconds",
        "session_duration_seconds",
        "processing_timing_version",
        "processing_seconds",
        "rtf",
        "word_count",
        "segment_count",
        "track_count",
        "warning_count",
    }
)


class QwenEmptyWindowAcceptanceError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _default_root() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise QwenEmptyWindowAcceptanceError("LOCALAPPDATA_NOT_FOUND")
    return Path(local) / "TDA"


def _source_binding(source_id: str, sample_seconds: float) -> str:
    if not _SOURCE.fullmatch(source_id):
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_SOURCE_ID_INVALID")
    if source_id != f"craig-{EXPECTED_SOURCE_SHA256}":
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_SOURCE_MISMATCH")
    payload = f"tda-qwen-1236-v1\0{source_id}\0{sample_seconds:.3f}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _runtime_receipt(state: object, expected_version: str) -> dict[str, str]:
    if not isinstance(state, dict) or state.get("status") != "ready":
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_RUNTIME_NOT_READY")
    version = state.get("version")
    runtime_id = state.get("runtime_id")
    worker_sha256 = state.get("worker_sha256")
    archive_sha256 = state.get("archive_sha256")
    if version != expected_version:
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_RUNTIME_VERSION_MISMATCH")
    if (
        runtime_id != "qwen3-transformers"
        or not isinstance(worker_sha256, str)
        or not re.fullmatch(r"[0-9a-f]{64}", worker_sha256)
        or not isinstance(archive_sha256, str)
        or not re.fullmatch(r"[0-9a-f]{64}", archive_sha256)
    ):
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_RUNTIME_IDENTITY_INVALID")
    return {
        "runtime_id": runtime_id,
        "version": version,
        "worker_sha256": worker_sha256,
        "archive_sha256": archive_sha256,
    }


def _require_gate(
    value: object,
    *,
    profile_id: str,
    runtime: dict[str, str],
) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("ready") is not True:
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_PHYSICAL_GATE_NOT_READY")
    if value.get("profile_id") != profile_id:
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_PHYSICAL_GATE_INVALID")
    artifact = value.get("runtime_artifact")
    if not isinstance(artifact, dict):
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_PHYSICAL_GATE_INVALID")
    for key in ("runtime_id", "version", "worker_sha256", "archive_sha256"):
        if artifact.get(key) != runtime[key]:
            raise QwenEmptyWindowAcceptanceError("QWEN_1236_PHYSICAL_GATE_STALE")
    gpu = value.get("gpu") if isinstance(value.get("gpu"), dict) else {}
    return {
        "profile_id": profile_id,
        "accepted_at": value.get("accepted_at"),
        "runtime_version": value.get("runtime_version"),
        "gpu": {
            "name": str(gpu.get("name") or ""),
            "compute_capability": str(gpu.get("compute_capability") or ""),
            "total_memory_bytes": int(gpu.get("total_memory_bytes") or 0),
        },
    }


def _event_payload(message: object) -> dict[str, Any] | None:
    if getattr(message, "type", None) != "event":
        return None
    payload = getattr(message, "payload", None)
    if not isinstance(payload, dict) or payload.get("code") not in DIAGNOSTIC_CODES:
        return None
    sanitized = {key: payload[key] for key in DIAGNOSTIC_FIELDS if key in payload}
    code = sanitized.get("code")
    if not isinstance(code, str) or code not in DIAGNOSTIC_CODES:
        return None
    return sanitized


def _benchmark_payload(payload: object, profile_id: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_BENCHMARK_RESULT_INVALID")
    result = {key: payload[key] for key in BENCHMARK_FIELDS if key in payload}
    if (
        result.get("schema_version") != "tda_benchmark_profile_v1"
        or result.get("kind") != "benchmark.profile"
        or result.get("profile_id") != profile_id
        or float(result.get("sample_seconds") or 0.0) != SAMPLE_SECONDS
    ):
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_BENCHMARK_RESULT_INVALID")
    track_count = int(result.get("track_count") or 0)
    audio_work_seconds = float(result.get("audio_work_seconds") or 0.0)
    session_duration_seconds = float(result.get("session_duration_seconds") or 0.0)
    if (
        track_count != EXPECTED_TRACK_COUNT
        or abs(audio_work_seconds - EXPECTED_AUDIO_WORK_SECONDS) > 0.001
        or abs(session_duration_seconds - SAMPLE_SECONDS) > 0.001
    ):
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_BENCHMARK_COVERAGE_INVALID")
    return result


def _error_code(exc: BaseException) -> str:
    code = getattr(exc, "code", None)
    if isinstance(code, str) and _ERROR.fullmatch(code):
        return code
    return "QWEN_1236_UNCLASSIFIED_FAILURE"


def _profile_classification(
    terminal: str,
    error_code: str | None,
    diagnostics: list[dict[str, Any]],
) -> str:
    codes = {str(item.get("code") or "") for item in diagnostics}
    if terminal != "result":
        if (
            error_code == "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN"
            and "QWEN_WINDOW_EMPTY_ASR_REJECTED" in codes
        ):
            return "empty_recognition_with_signal"
        if error_code:
            return "other_failure"
        return "invalid_outcome"
    if "QWEN_WINDOW_EMPTY_ASR_REJECTED" in codes:
        return "invalid_outcome"
    if "QWEN_WINDOW_SILENCE_CONFIRMED" in codes:
        return "confirmed_near_digital_silence"
    return "empty_condition_not_reproduced"


def _assert_receipt_privacy(value: object) -> None:
    forbidden_keys = {
        "source_id",
        "speaker",
        "text",
        "transcript",
        "transcription",
        "audio",
        "path",
        "worker",
        "token",
        "authorization",
    }

    def visit(node: object) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                if str(key).strip().lower() in forbidden_keys:
                    raise QwenEmptyWindowAcceptanceError("QWEN_1236_RECEIPT_PRIVACY_INVALID")
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True).lower()
    for marker in ("localappdata", "\\\\users\\\\", "/users/", "bearer ", "pairing-token"):
        if marker in serialized:
            raise QwenEmptyWindowAcceptanceError("QWEN_1236_RECEIPT_PRIVACY_INVALID")


def run_acceptance(
    *,
    source_id: str,
    runtime_root: Path,
    state_root: Path,
    models_root: Path,
    supervisor: object,
    runtime_inspector: Callable[..., dict[str, Any]],
    gate_inspector: Callable[..., dict[str, Any]],
    sample_seconds: float = SAMPLE_SECONDS,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> dict[str, Any]:
    if sample_seconds != SAMPLE_SECONDS:
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_SAMPLE_CONTRACT_INVALID")
    source_binding = _source_binding(source_id, sample_seconds)

    runtime = _runtime_receipt(
        runtime_inspector(runtime_root, verify_worker=True),
        EXPECTED_RUNTIME_VERSION,
    )
    gates: list[dict[str, Any]] = []
    for profile_id in QWEN_PROFILES:
        gates.append(
            _require_gate(
                gate_inspector(
                    state_root,
                    runtime_root,
                    models_root,
                    profile_id=profile_id,
                    verify_model_content=False,
                ),
                profile_id=profile_id,
                runtime=runtime,
            )
        )

    profile_receipts: list[dict[str, Any]] = []
    for index, profile_id in enumerate(QWEN_PROFILES, start=1):
        diagnostics: list[dict[str, Any]] = []

        def on_event(message: object) -> None:
            payload = _event_payload(message)
            if payload is not None:
                diagnostics.append(payload)

        terminal = "error"
        code: str | None = None
        benchmark: dict[str, Any] | None = None
        try:
            outcome = supervisor.run_craig(
                job_id=f"qwen1236-{index}",
                attempt=1,
                source_id=source_id,
                profile_id=profile_id,
                glossary="",
                context="",
                cpu=False,
                benchmark_sample_seconds=sample_seconds,
                on_progress=lambda _message: None,
                on_event=on_event,
                is_cancelled=lambda: False,
            )
            terminal = str(getattr(outcome, "terminal", ""))
            if terminal != "result":
                raise QwenEmptyWindowAcceptanceError("QWEN_1236_BENCHMARK_TERMINAL_INVALID")
            benchmark = _benchmark_payload(getattr(outcome, "payload", None), profile_id)
        except QwenEmptyWindowAcceptanceError:
            raise
        except BaseException as exc:
            code = _error_code(exc)
            if code == "QWEN_1236_UNCLASSIFIED_FAILURE":
                raise
            terminal = "error"

        classification = _profile_classification(terminal, code, diagnostics)
        diagnostic_complete = classification in {
            "confirmed_near_digital_silence",
            "empty_condition_not_reproduced",
            "empty_recognition_with_signal",
        }
        profile_receipts.append(
            {
                "profile_id": profile_id,
                "terminal": terminal,
                "error_code": code,
                "classification": classification,
                "diagnostic_complete": diagnostic_complete,
                "benchmark": benchmark,
                "diagnostics": diagnostics,
            }
        )

    completed = all(
        item["terminal"] == "result"
        and item["classification"]
        in {"confirmed_near_digital_silence", "empty_condition_not_reproduced"}
        for item in profile_receipts
    )
    diagnosed = all(item["diagnostic_complete"] is True for item in profile_receipts)
    receipt = {
        "schema": "tda_qwen_empty_window_acceptance_v1",
        "accepted_at": now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "issue": 1236,
        "runtime": runtime,
        "source_sha256": EXPECTED_SOURCE_SHA256,
        "source_binding_sha256": source_binding,
        "sample_seconds": sample_seconds,
        "expected_track_count": EXPECTED_TRACK_COUNT,
        "expected_audio_work_seconds": EXPECTED_AUDIO_WORK_SECONDS,
        "profiles": profile_receipts,
        "physical_gates": gates,
        "candidate_completed_both_profiles": completed,
        "diagnostic_complete": diagnosed,
        "stable_promotion_eligible": completed and diagnosed,
        "privacy": {
            "contains_source_id": False,
            "contains_paths": False,
            "contains_audio": False,
            "contains_transcript": False,
            "contains_speaker_names": False,
        },
    }
    _assert_receipt_privacy(receipt)
    return receipt


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    _assert_receipt_privacy(receipt)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(payload, encoding="utf-8")
    os.replace(temporary, path)


def _load_dependencies(repo_root: Path):
    package_root = (repo_root / "local-companion").resolve()
    if not package_root.is_dir():
        raise QwenEmptyWindowAcceptanceError("QWEN_1236_REPOSITORY_LAYOUT_INVALID")
    sys.path.insert(0, str(package_root))
    from tda_companion.qwen_physical_gate import inspect_qwen_physical_gate
    from tda_companion.qwen_runtime import inspect_qwen_runtime
    from tda_companion.worker_supervisor import WorkerSupervisor

    return inspect_qwen_runtime, inspect_qwen_physical_gate, WorkerSupervisor


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run #1236 Qwen-only physical acceptance on the staged local Craig source."
    )
    parser.add_argument("--confirm", required=True, choices=["RUN"])
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--sample-seconds", type=float, default=SAMPLE_SECONDS)
    parser.add_argument("--tda-root", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))
    try:
        tda_root = args.tda_root.resolve() if args.tda_root else _default_root().resolve()
        data_root = tda_root / "Data"
        models_root = tda_root / "Models"
        runtime_root = tda_root / "Runtime"
        state_root = tda_root / "State"
        output = (
            args.output.resolve()
            if args.output
            else state_root / "acceptance" / "qwen-empty-window" / "qwen-empty-window.json"
        )
        runtime_inspector, gate_inspector, supervisor_type = _load_dependencies(
            args.repo_root.resolve()
        )
        supervisor = supervisor_type(
            data_root=data_root,
            models_root=models_root,
            runtime_root=runtime_root,
            state_root=state_root,
        )
        receipt = run_acceptance(
            source_id=args.source_id,
            runtime_root=runtime_root,
            state_root=state_root,
            models_root=models_root,
            supervisor=supervisor,
            runtime_inspector=runtime_inspector,
            gate_inspector=gate_inspector,
            sample_seconds=args.sample_seconds,
        )
        _write_receipt(output, receipt)
        print(
            "QWEN_1236_ACCEPTANCE "
            f"completed={str(receipt['candidate_completed_both_profiles']).lower()} "
            f"diagnostic_complete={str(receipt['diagnostic_complete']).lower()} "
            f"stable_promotion_eligible={str(receipt['stable_promotion_eligible']).lower()}"
        )
        return 0 if receipt["diagnostic_complete"] else 2
    except QwenEmptyWindowAcceptanceError as exc:
        print(exc.code, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
