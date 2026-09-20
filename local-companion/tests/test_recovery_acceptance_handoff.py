from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "local-companion" / "packaging" / "run-recovery-acceptance.ps1"


def _value() -> str:
    return SCRIPT.read_text(encoding="utf-8")


def test_recovery_acceptance_handoff_binds_both_receipts_to_the_same_candidate():
    value = _value()
    assert "tda_companion_candidate_v2" in value
    assert "run-installed-acceptance.ps1" in value
    assert "run-physical-acceptance.ps1" in value
    assert "tda_installed_acceptance_v3" in value
    assert "tda_physical_acceptance_suite_v2" in value
    assert "source_sha" in value
    assert "source_tree_sha" in value
    assert "msi_sha256" in value
    assert "payload_manifest_sha256" in value
    assert '"$tag.json"' in value
    assert '"$tag.physical.json"' in value
    assert "RECOVERY_INSTALLED_RECEIPT_MISMATCH" in value
    assert "RECOVERY_PHYSICAL_RECEIPT_MISMATCH" in value


def test_recovery_acceptance_handoff_is_local_fail_closed_and_transcript_free():
    value = _value()
    folded = value.casefold()
    assert "writetranscripts" not in folded
    assert "transcripts_written -ne $false" in value
    assert ".staging-" in value
    assert "finally {" in value
    assert "contains_token" in value
    assert "contains_paths" in value
    assert "contains_transcript" in value
    assert "gh release" not in folded
    assert "invoke-webrequest" not in folded
    assert "invoke-restmethod" not in folded
