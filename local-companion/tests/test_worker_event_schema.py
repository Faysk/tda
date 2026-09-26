from __future__ import annotations

import math

from tda_companion.worker_event_schema import sanitize_worker_event


def test_known_activity_event_drops_content_and_unknown_fields():
    value = sanitize_worker_event(
        {
            "code": "QWEN_WINDOW_TRANSCRIBED",
            "stage": "transcription",
            "track": 2,
            "total_tracks": 4,
            "window": 89,
            "speaker": "Álice 🐉",
            "text": "segredo reconhecido",
            "context": "segredo de contexto",
            "path": "C:\\Users\\private\\audio.flac",
        }
    )

    assert value.code == "QWEN_WINDOW_TRANSCRIBED"
    assert value.data == {
        "stage": "transcription",
        "track": 2,
        "total_tracks": 4,
        "window": 89,
        "speaker": "Álice 🐉",
    }
    assert value.schema_drift is True
    assert value.dropped_fields == 3


def test_unknown_event_never_persists_raw_code_or_payload():
    value = sanitize_worker_event(
        {
            "code": "USER_SECRET_AS_EVENT_NAME",
            "detail": "não pode persistir",
            "count": 2,
        }
    )

    assert value.code == "WORKER_EVENT_UNRECOGNIZED"
    assert value.data == {}
    assert value.schema_drift is True
    assert value.dropped_fields == 2


def test_alignment_failure_preserves_declared_diagnostics_only():
    value = sanitize_worker_event(
        {
            "code": "QWEN_ALIGNMENT_WINDOW_FAILED",
            "stage": "alignment",
            "track": 2,
            "window": 89,
            "failure_class": "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
            "overflow_seconds": 1.25,
            "owned_word_count": 11,
            "runtime_version": "1.0.12",
            "worker_sha256": "A" * 64,
            "transcript": "não",
        }
    )

    assert value.data == {
        "stage": "alignment",
        "track": 2,
        "window": 89,
        "failure_class": "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
        "overflow_seconds": 1.25,
        "owned_word_count": 11,
        "runtime_version": "1.0.12",
        "worker_sha256": "a" * 64,
    }
    assert value.dropped_fields == 1


def test_invalid_numeric_and_nested_values_are_dropped_without_failing_event():
    value = sanitize_worker_event(
        {
            "code": "QWEN_ALIGNMENT_WINDOW_FAILED",
            "stage": "alignment",
            "track": 1,
            "window": 7,
            "overflow_seconds": math.inf,
            "owned_word_count": -1,
            "first_window": "true",
            "detail": {"text": "nested"},
        }
    )

    assert value.code == "QWEN_ALIGNMENT_WINDOW_FAILED"
    assert value.data == {
        "stage": "alignment",
        "track": 1,
        "window": 7,
    }
    assert value.schema_drift is True
    assert value.dropped_fields == 4


def test_whisper_and_future_recovery_metadata_remain_supported():
    whisper = sanitize_worker_event(
        {
            "code": "WHISPER_MODEL_CONSTRUCT_FAILED",
            "stage": "model_load",
            "device": "cuda:0",
            "compute_type": "float16",
            "memory_error": True,
            "duration_ms": 123,
        }
    )
    recovery = sanitize_worker_event(
        {
            "code": "QWEN_ALIGNMENT_WINDOW_RECOVERY_STARTED",
            "stage": "alignment",
            "track": 2,
            "window": 89,
            "failure_class": "QWEN_ALIGNMENT_TIMESTAMP_OWNED_OVERFLOW",
            "context_seconds": 6.0,
        }
    )

    assert whisper.schema_drift is False
    assert whisper.data["memory_error"] is True
    assert recovery.schema_drift is False
    assert recovery.data["context_seconds"] == 6.0
