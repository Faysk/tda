from __future__ import annotations

import re

# 1.1.10 is the first Whisper runtime whose worker protocol understands the
# current Craig track-policy/checkpoint payload emitted by the Companion.
# Older Stable 1.1.5 workers can exit with EX_USAGE before READY when they see
# track_policy_version, which previously collapsed to WORKER_EXITED_WITHOUT_RESULT.
MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION = "1.1.10"
MIN_BENCHMARK_WHISPER_RUNTIME_VERSION = "1.1.10"
MIN_BENCHMARK_QWEN_RUNTIME_VERSION = "1.0.18"
MIN_COMPATIBLE_QWEN_RUNTIME_VERSION = "1.0.12"
_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")


def version_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not _VERSION.fullmatch(value):
        raise ValueError("RUNTIME_VERSION_INVALID")
    major, minor, patch = value.split(".")
    return int(major), int(minor), int(patch)


def runtime_version_compatible(value: str, minimum: str) -> bool:
    try:
        return version_tuple(value) >= version_tuple(minimum)
    except ValueError:
        return False


def whisper_runtime_version_compatible(value: str) -> bool:
    return runtime_version_compatible(value, MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION)


def whisper_runtime_benchmark_compatible(value: str) -> bool:
    return runtime_version_compatible(value, MIN_BENCHMARK_WHISPER_RUNTIME_VERSION)


def qwen_runtime_version_compatible(value: str) -> bool:
    return runtime_version_compatible(value, MIN_COMPATIBLE_QWEN_RUNTIME_VERSION)


def qwen_runtime_benchmark_compatible(value: str) -> bool:
    return runtime_version_compatible(value, MIN_BENCHMARK_QWEN_RUNTIME_VERSION)
