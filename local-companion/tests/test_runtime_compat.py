from __future__ import annotations

import json
from pathlib import Path

from tda_companion.runtime_compat import (
    MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
    MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def _runtime_version(name: str) -> str:
    value = json.loads(
        (REPO_ROOT / "local-companion" / "runtime" / name).read_text(encoding="utf-8")
    )
    return str(value["version"])


def test_current_runtime_builds_match_the_companion_minimums():
    assert _runtime_version("qwen-windows-x64.json") == MIN_COMPATIBLE_QWEN_RUNTIME_VERSION
    assert _runtime_version("whisper-windows-x64.json") == MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION
