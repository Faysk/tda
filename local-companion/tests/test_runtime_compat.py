from __future__ import annotations

import json
from pathlib import Path

from tda_companion.rc_runtime_artifacts import RC_QWEN_VERSION, RC_WHISPER_VERSION
from tda_companion.runtime_compat import (
    MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
    MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
    qwen_runtime_version_compatible,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def _runtime_version(name: str) -> str:
    value = json.loads(
        (REPO_ROOT / "local-companion" / "runtime" / name).read_text(encoding="utf-8")
    )
    return str(value["version"])


def test_companion_rejects_buggy_qwen_1_0_10_and_requires_repaired_1_0_11():
    assert MIN_COMPATIBLE_QWEN_RUNTIME_VERSION == "1.0.11"
    assert qwen_runtime_version_compatible("1.0.10") is False
    assert qwen_runtime_version_compatible("1.0.11") is True
    assert qwen_runtime_version_compatible("1.0.12") is True


def test_current_runtime_builds_are_not_older_than_companion_minimums():
    from tda_companion.runtime_compat import version_tuple

    qwen = _runtime_version("qwen-windows-x64.json")
    whisper = _runtime_version("whisper-windows-x64.json")
    assert version_tuple(qwen) >= version_tuple(MIN_COMPATIBLE_QWEN_RUNTIME_VERSION)
    assert version_tuple(whisper) >= version_tuple(MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION)
    assert RC_QWEN_VERSION == qwen
    assert RC_WHISPER_VERSION == whisper
