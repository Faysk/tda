from __future__ import annotations

import re
from pathlib import Path

import tda_companion.worker_event_schema as schema_module
from tda_companion.worker_event_schema import (
    registered_worker_event_codes,
    sanitize_worker_event,
)


def test_known_activity_event_drops_private_extra_fields_without_losing_safe_metadata():
    event = sanitize_worker_event(
        {
            "code": "QWEN_WINDOW_TRANSCRIBED",
            "stage": "transcription",
            "track": 2,
            "total_tracks": 4,
            "speaker": "Álice",
            "window": 89,
            "start_seconds": 7860.125,
            "end_seconds": 7890.75,
            "text": "segredo reconhecido",
            "path": "C:/private/audio.flac",
        }
    )

    assert event.code == "QWEN_WINDOW_TRANSCRIBED"
    assert event.level == "info"
    assert event.data == {
        "stage": "transcription",
        "track": 2,
        "total_tracks": 4,
        "speaker": "Álice",
        "window": 89,
        "start_seconds": 7860.125,
        "end_seconds": 7890.75,
    }
    assert event.drift_reason == "unexpected_or_invalid_field"
    assert event.rejected_field_count == 2
    assert "segredo" not in repr(event)


def test_activity_counts_are_bounded_and_terminal_zero_is_valid():
    qwen = sanitize_worker_event(
        {
            "code": "QWEN_WINDOW_TRANSCRIBED",
            "stage": "transcription",
            "track": 1,
            "total_tracks": 1,
            "speaker": "Alice",
            "window": 2,
            "completed_window_count": 2,
        }
    )
    assert qwen.data["completed_window_count"] == 2

    whisper_terminal = sanitize_worker_event(
        {
            "code": "TRACK_COMPLETED",
            "stage": "transcription",
            "track": 2,
            "total_tracks": 2,
            "speaker": "Bob",
            "completed_segment_count": 0,
        }
    )
    assert whisper_terminal.code == "TRACK_COMPLETED"
    assert whisper_terminal.data["completed_segment_count"] == 0

    invalid = sanitize_worker_event(
        {
            "code": "TRACK_COMPLETED",
            "stage": "transcription",
            "track": 2,
            "total_tracks": 2,
            "speaker": "Bob",
            "completed_segment_count": -1,
        }
    )
    assert "completed_segment_count" not in invalid.data
    assert invalid.drift_reason == "unexpected_or_invalid_field"



def test_qwen_empty_window_signal_events_keep_only_bounded_numeric_evidence():
    base = {
        "stage": "transcription",
        "track": 2,
        "total_tracks": 4,
        "window": 1,
        "completed_window_count": 1,
        "start_seconds": 0.0,
        "end_seconds": 240.0,
        "sample_count": 3_840_000,
        "peak_dbfs": -32.5,
        "rms_dbfs": -44.0,
        "silence_peak_threshold_dbfs": -84.0,
        "silence_rms_threshold_dbfs": -90.0,
        "speaker": "Private Name",
        "text": "private transcript",
        "path": "C:/private/audio.flac",
    }

    rejected = sanitize_worker_event(
        {"code": "QWEN_WINDOW_EMPTY_ASR_REJECTED", **base}
    )
    assert rejected.code == "QWEN_WINDOW_EMPTY_ASR_REJECTED"
    assert rejected.level == "warning"
    assert rejected.data["sample_count"] == 3_840_000
    assert rejected.data["peak_dbfs"] == -32.5
    assert rejected.data["rms_dbfs"] == -44.0
    assert rejected.data["silence_peak_threshold_dbfs"] == -84.0
    assert rejected.data["silence_rms_threshold_dbfs"] == -90.0
    assert "speaker" not in rejected.data
    assert "text" not in rejected.data
    assert "path" not in rejected.data
    assert rejected.drift_reason == "unexpected_or_invalid_field"

    skipped = sanitize_worker_event({"code": "QWEN_WINDOW_UNRECOGNIZED_SKIPPED", **base})
    assert skipped.code == "QWEN_WINDOW_UNRECOGNIZED_SKIPPED"
    assert skipped.level == "warning"
    assert skipped.data["start_seconds"] == 0.0
    assert skipped.data["end_seconds"] == 240.0
    assert not {"speaker", "text", "path"} & set(skipped.data)

    confirmed = sanitize_worker_event(
        {
            "code": "QWEN_WINDOW_SILENCE_CONFIRMED",
            **{**base, "peak_dbfs": -120.0, "rms_dbfs": -120.0},
        }
    )
    assert confirmed.code == "QWEN_WINDOW_SILENCE_CONFIRMED"
    assert confirmed.level == "info"
    assert confirmed.data["peak_dbfs"] == -120.0

    malformed = sanitize_worker_event(
        {
            "code": "QWEN_WINDOW_EMPTY_ASR_REJECTED",
            **{**base, "rms_dbfs": float("nan")},
        }
    )
    assert malformed.code == "WORKER_EVENT_SCHEMA_INVALID"
    assert malformed.data["reason"] == "invalid_required_field"




def test_qwen_empty_window_recovery_events_preserve_safe_profile_metadata():
    started = sanitize_worker_event(
        {
            "code": "QWEN_EMPTY_WINDOW_RECOVERY_STARTED",
            "stage": "transcription",
            "track": 2,
            "total_tracks": 4,
            "window": 217,
            "profile": "qwen-fast",
            "strategy": "same-profile-2x30s",
            "count": 2,
            "start_seconds": 11664.0,
            "end_seconds": 11724.0,
            "text": "private transcript",
        }
    )
    assert started.code == "QWEN_EMPTY_WINDOW_RECOVERY_STARTED"
    assert started.data["profile"] == "qwen-fast"
    assert started.data["strategy"] == "same-profile-2x30s"
    assert started.data["count"] == 2
    assert "text" not in started.data

    recovered = sanitize_worker_event(
        {
            "code": "QWEN_EMPTY_WINDOW_RECOVERED",
            "stage": "transcription",
            "track": 2,
            "total_tracks": 4,
            "window": 217,
            "profile": "qwen-fast",
            "strategy": "same-profile-2x30s",
            "count": 2,
            "start_seconds": 11664.0,
            "end_seconds": 11724.0,
        }
    )
    assert recovered.code == "QWEN_EMPTY_WINDOW_RECOVERED"
    assert recovered.data["profile"] == "qwen-fast"
    assert recovered.data["strategy"] == "same-profile-2x30s"
    assert recovered.drift_reason is None



def test_benchmark_profile_events_preserve_only_bounded_outcome_metadata():
    failed = sanitize_worker_event(
        {
            "code": "BENCHMARK_PROFILE_FAILED",
            "stage": "benchmark",
            "profile": "qwen-fast",
            "attempted_count": 3,
            "completed_count": 2,
            "failed_count": 1,
            "error_code": "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
            "recoverable": True,
            "scope": "profile",
            "continuation": "continue",
            "text": "private transcript",
            "path": "C:/private/audio.flac",
        }
    )

    assert failed.code == "BENCHMARK_PROFILE_FAILED"
    assert failed.level == "warning"
    assert failed.data == {
        "stage": "benchmark",
        "profile": "qwen-fast",
        "attempted_count": 3,
        "completed_count": 2,
        "failed_count": 1,
        "error_code": "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
        "recoverable": True,
        "scope": "profile",
        "continuation": "continue",
    }
    assert failed.drift_reason == "unexpected_or_invalid_field"
    assert failed.rejected_field_count == 2

    completed = sanitize_worker_event(
        {
            "code": "BENCHMARK_PROFILE_COMPLETED",
            "stage": "benchmark",
            "profile": "whisper-turbo",
            "attempted_count": 1,
            "completed_count": 1,
            "failed_count": 0,
        }
    )
    assert completed.code == "BENCHMARK_PROFILE_COMPLETED"
    assert completed.drift_reason is None
    assert completed.data["completed_count"] == 1



def test_unknown_or_malformed_event_code_never_persists_raw_code_or_payload():
    for payload in (
        {"code": "PRIVATE_WORDS_FROM_TRANSCRIPT", "detail": "segredo"},
        {"code": "new-event", "text": "segredo"},
        {"code": 123, "path": "C:/private"},
    ):
        event = sanitize_worker_event(payload)
        assert event.code == "WORKER_EVENT_UNRECOGNIZED"
        assert event.data == {}
        assert event.level == "warning"
        assert event.drift_reason == "unknown_code"
        assert "segredo" not in repr(event)
        assert "PRIVATE_WORDS_FROM_TRANSCRIPT" not in repr(event)


def test_invalid_required_metadata_degrades_to_safe_schema_event():
    event = sanitize_worker_event(
        {
            "code": "QWEN_WINDOW_TRANSCRIBED",
            "stage": "transcription",
            "track": -1,
            "total_tracks": 4,
            "speaker": "Alice",
            "window": 2,
            "text": "secret",
        }
    )

    assert event.code == "WORKER_EVENT_SCHEMA_INVALID"
    assert event.level == "warning"
    assert event.data["reason"] == "invalid_required_field"
    assert event.data["rejected_field_count"] >= 2
    assert "text" not in event.data
    assert "secret" not in repr(event)


def test_alignment_failure_keeps_only_allowlisted_bounded_diagnostics():
    payload = {
        "code": "QWEN_ALIGNMENT_WINDOW_FAILED",
        "stage": "alignment",
        "track": 2,
        "window": 89,
        "failure_class": "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
        "window_start_seconds": 4752.0,
        "window_end_seconds": 4812.0,
        "ownership_left_seconds": 4755.0,
        "ownership_right_seconds": 4809.0,
        "first_window": False,
        "last_window": False,
        "runtime_version": "1.0.12",
        "worker_sha256": "a" * 64,
        "aligned_item": 1,
        "relative_start_seconds": -0.01,
        "relative_end_seconds": 130.16,
        "overflow_seconds": 70.16,
        "previous_end_seconds": 4752.0,
        "aligned_word_count": 411,
        "owned_word_count": 0,
        "text": "must never survive",
    }

    event = sanitize_worker_event(payload)

    assert event.code == "QWEN_ALIGNMENT_WINDOW_FAILED"
    assert event.level == "error"
    assert event.data["failure_class"] == payload["failure_class"]
    assert event.data["worker_sha256"] == "a" * 64
    assert event.data["relative_start_seconds"] == -0.01
    assert event.data["overflow_seconds"] == 70.16
    assert "text" not in event.data
    assert event.drift_reason == "unexpected_or_invalid_field"


def test_invalid_optional_numeric_metadata_is_dropped_without_invalidating_event():
    event = sanitize_worker_event(
        {
            "code": "QWEN_RUNTIME_FINGERPRINT_READY",
            "stage": "runtime_fingerprint",
            "runtime_version": "1.0.12",
            "worker_sha256": "b" * 64,
            "duration_ms": 12.5,
            "bogus": float("inf"),
        }
    )

    assert event.code == "QWEN_RUNTIME_FINGERPRINT_READY"
    assert event.data["duration_ms"] == 12.5
    assert "bogus" not in event.data
    assert event.drift_reason == "unexpected_or_invalid_field"


def test_mirror_reason_is_an_enum_not_an_arbitrary_short_string():
    valid = sanitize_worker_event(
        {
            "code": "COMPATIBILITY_MIRROR_WRITE_FAILED",
            "stage": "result_prepare",
            "reason": "hash_mismatch",
        }
    )
    assert valid.code == "COMPATIBILITY_MIRROR_WRITE_FAILED"
    assert valid.level == "warning"

    invalid = sanitize_worker_event(
        {
            "code": "COMPATIBILITY_MIRROR_WRITE_FAILED",
            "stage": "result_prepare",
            "reason": "recognized_words_here",
        }
    )
    assert invalid.code == "WORKER_EVENT_SCHEMA_INVALID"
    assert invalid.data["reason"] == "invalid_required_field"


def test_all_current_literal_worker_event_codes_are_registered():
    package_root = Path(schema_module.__file__).resolve().parent
    files = (
        package_root / "asr_whisper.py",
        package_root / "asr_qwen_strict.py",
        package_root / "asr_worker.py",
    )
    literal_codes: set[str] = set()
    for path in files:
        literal_codes.update(
            re.findall(r'["\']code["\']\s*:\s*["\']([A-Z0-9_]+)["\']', path.read_text(encoding="utf-8"))
        )

    # These literals belong to strict terminal/error messages, not type="event".
    literal_codes.difference_update(
        {
            "TRANSCRIPT_VALIDATION_FAILED",
            "WORKER_RUNTIME_BOOTSTRAP_FAILED",
            "WORKER_KIND_UNSUPPORTED",
            "WORKER_EXECUTION_FAILED",
        }
    )
    # Current producers also select these event codes dynamically.
    literal_codes.update(
        {
            "ASR_TEXT_CHECKPOINT_REUSED",
            "ASR_TEXT_CHECKPOINT_COMPAT_REUSED",
            "COMPATIBILITY_MIRROR_LEGACY_PRESERVED",
        }
    )

    assert literal_codes <= registered_worker_event_codes()




def test_qwen_track_order_events_keep_only_safe_structural_metadata():
    reordered = sanitize_worker_event(
        {
            "code": "QWEN_TRACK_SEGMENTS_REORDERED",
            "stage": "alignment",
            "track": 2,
            "total_tracks": 4,
            "count": 2,
            "text": "private transcript",
            "path": "C:/private/audio.flac",
        }
    )
    assert reordered.code == "QWEN_TRACK_SEGMENTS_REORDERED"
    assert reordered.level == "warning"
    assert reordered.data == {
        "stage": "alignment",
        "track": 2,
        "total_tracks": 4,
        "count": 2,
    }
    assert reordered.drift_reason == "unexpected_or_invalid_field"

    failed = sanitize_worker_event(
        {
            "code": "QWEN_TRACK_VALIDATION_FAILED",
            "stage": "alignment",
            "track": 2,
            "total_tracks": 4,
            "failure_class": "QWEN_TRACK_SEGMENTS_OUT_OF_ORDER",
            "detail": "private transcript",
        }
    )
    assert failed.code == "QWEN_TRACK_VALIDATION_FAILED"
    assert failed.level == "error"
    assert failed.data["failure_class"] == "QWEN_TRACK_SEGMENTS_OUT_OF_ORDER"
    assert "detail" not in failed.data


def test_registered_recovery_events_cover_the_current_qwen_v5_path():
    registered = registered_worker_event_codes()
    assert {
        "QWEN_ALIGNMENT_WINDOW_RECOVERY_STARTED",
        "QWEN_ALIGNMENT_WINDOW_RECOVERY_FAILED",
        "QWEN_ALIGNMENT_WINDOW_RECOVERED",
    } <= registered


def test_whisper_span_widening_event_keeps_only_sanitized_numeric_boundaries():
    event = sanitize_worker_event(
        {
            "code": "WHISPER_SEGMENT_SPAN_WIDENED",
            "stage": "transcription",
            "track": 2,
            "segment": 3,
            "start_seconds": 100.2,
            "end_seconds": 100.8,
            "relative_start_seconds": -0.051,
            "relative_end_seconds": 0.051,
            "text": "private transcript",
            "path": "C:/private/audio.flac",
            "speaker": "Private Name",
        }
    )

    assert event.code == "WHISPER_SEGMENT_SPAN_WIDENED"
    assert event.level == "warning"
    assert event.data == {
        "stage": "transcription",
        "track": 2,
        "segment": 3,
        "start_seconds": 100.2,
        "end_seconds": 100.8,
        "relative_start_seconds": -0.051,
        "relative_end_seconds": 0.051,
    }
    assert event.drift_reason == "unexpected_or_invalid_field"
    assert event.rejected_field_count == 3
    assert "private" not in repr(event).lower()
