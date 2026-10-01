from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "tools" / "acceptance" / "run-whisper-1235-finalize.ps1"


def test_whisper_1235_finalize_harness_is_exact_candidate_and_fail_closed():
    text = HARNESS.read_text(encoding="utf-8")

    assert "companion-whisper-runtime-rc-v1.1.8-ce9fdda3c35e" in text
    assert "ce9fdda3c35e34ae3e2fc3fb3465355378b2891b" in text
    assert "c96c924a50d43d0c5007a302e119400ae8ab67fc" in text
    assert "cdd1f165ac60ef300843a9ce2f7dd802c95a6c6c48b6108f642e8e28d3e71bd6" in text
    assert "48ea9080d0c9807f2adbff976474efbdf0e41f8a0ec96247b0a6c68f721eb950" in text
    assert "bd3677ba2efc74bcd40fcdf78010e0ada2e72b498d0e7a77802527e7ce1ec770" in text
    assert "NVIDIA GeForce RTX 4070 Laptop GPU" in text

    assert 'tda_companion.rc_runtime_artifacts", "install-candidate"' in text
    assert "generate-physical-acceptance-fixture.ps1" in text
    assert '"tda_whisper_gpu_acceptance_v1"' in text
    assert 'tda_companion.runtime_release_evidence", "seal-physical"' in text
    assert 'tda_companion.runtime_release_evidence", "verify-promotion"' in text
    assert "run-whisper-craig-containment-acceptance.ps1" in text
    assert "whisper_1235_receipt.py" in text

    assert "Publish-Evidence $genericValidated $genericDestination" in text
    assert "Publish-Evidence $specificValidated $specificDestination" in text
    assert "WHISPER_1235_EVIDENCE_CONFLICT" in text
    assert "Invoke-Expression" not in text


def test_whisper_1235_finalize_harness_does_not_rebuild_or_promote_runtime():
    text = HARNESS.read_text(encoding="utf-8")

    assert "build_whisper_runtime.py" not in text
    assert "gh release edit" not in text
    assert "runtime-promote.yml" not in text
    assert "Stable promotion must reuse the same RC release object." in text
