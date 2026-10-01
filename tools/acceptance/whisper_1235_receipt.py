from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

SCHEMA = "tda_whisper_craig_containment_acceptance_v1"
FAMILY = "whisper"
VERSION = "1.1.8"
PROFILES = ("whisper-turbo", "whisper-detailed")
MAX_JSON_BYTES = 512 * 1024
MAX_SPAN_EXAMPLES = 32

_TAG = re.compile(r"^companion-whisper-runtime-rc-v1\.1\.8-[a-f0-9]{12}$")
_SHA40 = re.compile(r"^[a-f0-9]{40}$")
_SHA64 = re.compile(r"^[a-f0-9]{64}$")


class Whisper1235EvidenceError(RuntimeError):
    pass


def _fail(code: str) -> None:
    raise Whisper1235EvidenceError(code)


def _load_json(path: Path, code: str) -> tuple[dict[str, Any], bytes]:
    if path.is_symlink() or not path.is_file():
        _fail(code)
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise Whisper1235EvidenceError(code) from exc
    if not raw or len(raw) > MAX_JSON_BYTES:
        _fail(code)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise Whisper1235EvidenceError(code) from exc
    if not isinstance(value, dict):
        _fail(code)
    return value, raw


def _exact_keys(value: object, expected: tuple[str, ...], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != set(expected):
        _fail(code)
    return value


def _safe_text(value: object, code: str, maximum: int = 160) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or any(ord(ch) < 32 or ord(ch) == 127 for ch in value)
    ):
        _fail(code)
    return value


def _positive_int(value: object, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        _fail(code)
    return value


def _nonnegative_int(value: object, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        _fail(code)
    return value


def _finite_number(value: object, code: str, *, nonnegative: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(code)
    number = float(value)
    if not math.isfinite(number) or (nonnegative and number < 0):
        _fail(code)
    return number


def _sha(value: object, pattern: re.Pattern[str], code: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        _fail(code)
    return value


def _validate_candidate(candidate: object) -> dict[str, Any]:
    if not isinstance(candidate, dict):
        _fail("WHISPER_1235_CANDIDATE_INVALID")
    if candidate.get("family") != FAMILY or candidate.get("version") != VERSION:
        return candidate
    tag = candidate.get("candidate_tag")
    if not isinstance(tag, str) or _TAG.fullmatch(tag) is None:
        _fail("WHISPER_1235_CANDIDATE_TAG_INVALID")
    if candidate.get("runtime_id") != "whisper-ctranslate2":
        _fail("WHISPER_1235_CANDIDATE_RUNTIME_INVALID")
    _sha(candidate.get("source_sha"), _SHA40, "WHISPER_1235_CANDIDATE_SOURCE_INVALID")
    _sha(candidate.get("source_tree_sha"), _SHA40, "WHISPER_1235_CANDIDATE_TREE_INVALID")
    _sha(candidate.get("runtime_archive_sha256"), _SHA64, "WHISPER_1235_CANDIDATE_ARCHIVE_INVALID")
    _positive_int(candidate.get("workflow_run_id"), "WHISPER_1235_CANDIDATE_RUN_INVALID")
    return candidate


def _validate_span_examples(phase: dict[str, Any]) -> None:
    count = _nonnegative_int(phase.get("span_widened_count"), "WHISPER_1235_SPAN_COUNT_INVALID")
    examples = phase.get("span_examples")
    if not isinstance(examples, list) or len(examples) != min(count, MAX_SPAN_EXAMPLES):
        _fail("WHISPER_1235_SPAN_EXAMPLES_INVALID")
    keys = (
        "track",
        "segment",
        "start_seconds",
        "end_seconds",
        "relative_start_seconds",
        "relative_end_seconds",
    )
    for example in examples:
        item = _exact_keys(example, keys, "WHISPER_1235_SPAN_EXAMPLE_SHAPE_INVALID")
        track = _positive_int(item.get("track"), "WHISPER_1235_SPAN_TRACK_INVALID")
        _positive_int(item.get("segment"), "WHISPER_1235_SPAN_SEGMENT_INVALID")
        if track > 4:
            _fail("WHISPER_1235_SPAN_TRACK_INVALID")
        start = _finite_number(item.get("start_seconds"), "WHISPER_1235_SPAN_START_INVALID", nonnegative=True)
        end = _finite_number(item.get("end_seconds"), "WHISPER_1235_SPAN_END_INVALID", nonnegative=True)
        before = _finite_number(item.get("relative_start_seconds"), "WHISPER_1235_SPAN_RELATIVE_START_INVALID")
        after = _finite_number(item.get("relative_end_seconds"), "WHISPER_1235_SPAN_RELATIVE_END_INVALID")
        if end < start or before > 0 or after < 0 or (before >= -0.05 and after <= 0.05):
            _fail("WHISPER_1235_SPAN_RELATION_INVALID")


def validate_receipt(candidate: object, receipt: object) -> None:
    candidate_value = _validate_candidate(candidate)
    if candidate_value.get("family") != FAMILY or candidate_value.get("version") != VERSION:
        return

    top = _exact_keys(
        receipt,
        (
            "schema",
            "pass",
            "accepted_at",
            "candidate",
            "gpu",
            "profiles",
            "immutable_runs_verified",
            "contains_audio",
            "contains_transcript",
            "contains_text",
            "contains_speaker",
            "contains_local_paths",
            "contains_source_id",
        ),
        "WHISPER_1235_ACCEPTANCE_SHAPE_INVALID",
    )
    if top.get("schema") != SCHEMA or top.get("pass") is not True:
        _fail("WHISPER_1235_ACCEPTANCE_RECEIPT_INVALID")
    _safe_text(top.get("accepted_at"), "WHISPER_1235_ACCEPTED_AT_INVALID", 64)

    identity = _exact_keys(
        top.get("candidate"),
        (
            "candidate_tag",
            "version",
            "runtime_id",
            "source_sha",
            "source_tree_sha",
            "workflow_run_id",
            "runtime_archive_sha256",
            "worker_sha256",
            "python",
            "packages",
        ),
        "WHISPER_1235_CANDIDATE_SHAPE_INVALID",
    )
    for field in (
        "candidate_tag",
        "version",
        "runtime_id",
        "source_sha",
        "source_tree_sha",
        "workflow_run_id",
        "runtime_archive_sha256",
    ):
        if identity.get(field) != candidate_value.get(field):
            _fail(f"WHISPER_1235_ACCEPTANCE_IDENTITY_MISMATCH:{field}")
    _sha(identity.get("worker_sha256"), _SHA64, "WHISPER_1235_WORKER_SHA_INVALID")
    _safe_text(identity.get("python"), "WHISPER_1235_PYTHON_VERSION_INVALID", 64)
    packages = _exact_keys(
        identity.get("packages"),
        ("faster_whisper", "ctranslate2", "pyav"),
        "WHISPER_1235_PACKAGE_SHAPE_INVALID",
    )
    for key, value in packages.items():
        _safe_text(value, f"WHISPER_1235_PACKAGE_VERSION_INVALID:{key}", 64)

    gpu = _exact_keys(
        top.get("gpu"),
        ("name", "driver_version", "required_name_match"),
        "WHISPER_1235_GPU_SHAPE_INVALID",
    )
    _safe_text(gpu.get("name"), "WHISPER_1235_GPU_NAME_INVALID")
    _safe_text(gpu.get("driver_version"), "WHISPER_1235_GPU_DRIVER_INVALID", 64)
    if gpu.get("required_name_match") is not True:
        _fail("WHISPER_1235_GPU_IDENTITY_INVALID")

    for field in (
        "contains_audio",
        "contains_transcript",
        "contains_text",
        "contains_speaker",
        "contains_local_paths",
        "contains_source_id",
    ):
        if top.get(field) is not False:
            _fail(f"WHISPER_1235_ACCEPTANCE_PRIVACY_INVALID:{field}")
    if top.get("immutable_runs_verified") is not True:
        _fail("WHISPER_1235_IMMUTABLE_RUN_REQUIRED")

    profiles = top.get("profiles")
    if (
        not isinstance(profiles, list)
        or len(profiles) != len(PROFILES)
        or any(not isinstance(item, dict) for item in profiles)
        or [item.get("profile_id") for item in profiles] != list(PROFILES)
    ):
        _fail("WHISPER_1235_PROFILE_EVIDENCE_INVALID")

    sample_keys = (
        "sample_seconds",
        "audio_work_seconds",
        "session_duration_seconds",
        "processing_seconds",
        "rtf",
        "word_count",
        "segment_count",
        "track_count",
        "warning_count",
        "span_widened_count",
        "span_examples",
    )
    full_keys = ("metrics", "span_widened_count", "span_examples", "run_committed")
    metric_keys = (
        "audio_work_seconds",
        "session_duration_seconds",
        "processing_seconds",
        "rtf",
        "word_count",
        "segment_count",
        "track_count",
        "turn_count",
        "deduplicated_segment_count",
    )

    for profile in profiles:
        item = _exact_keys(profile, ("profile_id", "sample", "full"), "WHISPER_1235_PROFILE_SHAPE_INVALID")
        sample = _exact_keys(item.get("sample"), sample_keys, "WHISPER_1235_SAMPLE_SHAPE_INVALID")
        full = _exact_keys(item.get("full"), full_keys, "WHISPER_1235_FULL_SHAPE_INVALID")
        metrics = _exact_keys(full.get("metrics"), metric_keys, "WHISPER_1235_FULL_METRICS_SHAPE_INVALID")

        if _finite_number(sample.get("sample_seconds"), "WHISPER_1235_SAMPLE_DURATION_INVALID", nonnegative=True) != 300.0:
            _fail("WHISPER_1235_SAMPLE_DURATION_INVALID")
        if _positive_int(sample.get("track_count"), "WHISPER_1235_SAMPLE_TRACK_COUNT_INVALID") != 4:
            _fail("WHISPER_1235_SAMPLE_TRACK_COUNT_INVALID")
        _positive_int(sample.get("segment_count"), "WHISPER_1235_SAMPLE_SEGMENT_COUNT_INVALID")
        _positive_int(sample.get("word_count"), "WHISPER_1235_SAMPLE_WORD_COUNT_INVALID")
        _nonnegative_int(sample.get("warning_count"), "WHISPER_1235_SAMPLE_WARNING_COUNT_INVALID")
        for key in ("audio_work_seconds", "session_duration_seconds", "processing_seconds", "rtf"):
            _finite_number(sample.get(key), f"WHISPER_1235_SAMPLE_METRIC_INVALID:{key}", nonnegative=True)

        if full.get("run_committed") is not True:
            _fail("WHISPER_1235_FULL_RUN_COMMIT_REQUIRED")
        if _positive_int(metrics.get("track_count"), "WHISPER_1235_FULL_TRACK_COUNT_INVALID") != 4:
            _fail("WHISPER_1235_FULL_TRACK_COUNT_INVALID")
        _positive_int(metrics.get("segment_count"), "WHISPER_1235_FULL_SEGMENT_COUNT_INVALID")
        _positive_int(metrics.get("word_count"), "WHISPER_1235_FULL_WORD_COUNT_INVALID")
        _positive_int(metrics.get("turn_count"), "WHISPER_1235_FULL_TURN_COUNT_INVALID")
        _nonnegative_int(metrics.get("deduplicated_segment_count"), "WHISPER_1235_FULL_DEDUP_COUNT_INVALID")
        for key in ("audio_work_seconds", "session_duration_seconds", "processing_seconds", "rtf"):
            _finite_number(metrics.get(key), f"WHISPER_1235_FULL_METRIC_INVALID:{key}", nonnegative=True)

        _validate_span_examples(sample)
        _validate_span_examples(full)


def verify_files(candidate_path: Path, evidence_root: Path, retained_output: Path) -> dict[str, object]:
    candidate, _ = _load_json(candidate_path, "WHISPER_1235_CANDIDATE_INVALID")
    candidate = _validate_candidate(candidate)
    if candidate.get("family") != FAMILY or candidate.get("version") != VERSION:
        return {"required": False}

    tag = str(candidate["candidate_tag"])
    receipt_path = evidence_root.resolve() / f"{tag}.whisper-1235.json"
    receipt, raw = _load_json(receipt_path, "WHISPER_1235_ACCEPTANCE_RECEIPT_MISSING")
    validate_receipt(candidate, receipt)

    retained = retained_output.resolve()
    retained.parent.mkdir(parents=True, exist_ok=True)
    if retained.is_symlink():
        _fail("WHISPER_1235_RETAINED_OUTPUT_INVALID")
    retained.write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    return {"required": True, "sha256": digest}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-manifest", required=True, type=Path)
    parser.add_argument("--evidence-root", required=True, type=Path)
    parser.add_argument("--retained-output", required=True, type=Path)
    return parser


def main() -> int:
    args = _parser().parse_args()
    result = verify_files(args.candidate_manifest, args.evidence_root, args.retained_output)
    print("required=" + ("true" if result["required"] else "false"))
    if result.get("sha256"):
        print("sha256=" + str(result["sha256"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
