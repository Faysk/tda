#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "local-companion"))

from tda_companion.asr_models import (  # noqa: E402
    PROFILE_REGISTRY,
    QWEN_FORCED_ALIGNER_MODEL_ID,
    QWEN_FORCED_ALIGNER_REVISION,
)


def current_revision(model_id: str) -> str:
    encoded = urllib.parse.quote(model_id, safe="/")
    request = urllib.request.Request(
        f"https://huggingface.co/api/models/{encoded}",
        headers={"User-Agent": "TDA-Companion-model-audit/1"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        value = json.load(response)
    revision = value.get("sha") if isinstance(value, dict) else None
    if not isinstance(revision, str) or len(revision) != 40:
        raise RuntimeError(f"HUGGINGFACE_REVISION_INVALID:{model_id}")
    return revision


def main() -> int:
    expected: dict[str, str] = {}
    for profile in PROFILE_REGISTRY.values():
        if not profile.revision:
            raise RuntimeError(f"MODEL_REVISION_UNPINNED:{profile.id}")
        previous = expected.setdefault(profile.model_id, profile.revision)
        if previous != profile.revision:
            raise RuntimeError(f"MODEL_REVISION_CONFLICT:{profile.model_id}")

    expected[QWEN_FORCED_ALIGNER_MODEL_ID] = QWEN_FORCED_ALIGNER_REVISION

    stale: list[str] = []
    for model_id in sorted(expected):
        pinned = expected[model_id]
        current = current_revision(model_id)
        state = "current" if pinned == current else "STALE"
        print(f"{model_id}: {pinned} -> {current} [{state}]")
        if pinned != current:
            stale.append(f"{model_id}: pinned {pinned}, upstream {current}")

    if stale:
        print("\nASR model freshness requirement failed:", file=sys.stderr)
        for item in stale:
            print(f"- {item}", file=sys.stderr)
        print(
            "Audit the upstream change, update the exact revision, and rerun model/runtime/RTX gates.",
            file=sys.stderr,
        )
        return 1

    print("\nAll TDA ASR model revisions match the current upstream revisions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
