from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "tools" / "acceptance" / "run-qwen-recovery-physical-gate.ps1"


def test_qwen_recovery_physical_gate_static_contract():
    text = SCRIPT.read_text(encoding="utf-8")
    required = (
        "Set-StrictMode -Version Latest",
        "HARNESS_FAILED",
        "PRODUCT_FAILED",
        "BLOCKED",
        "LOCALAPPDATA",
        "QWEN_WINDOW_TRANSCRIBED",
        "ASR_TEXT_CHECKPOINT_SAVED",
        "ASR_TEXT_CHECKPOINT_REUSED",
        "PROCESS_INTERRUPTED",
        "RUN_COMMIT_FENCE_WON",
        "EVIDENCE_PAIRING_TOKEN_LEAK",
        "EVIDENCE_PRIVATE_FILENAME_LEAK",
        "TDA-QWEN-GATE-EVIDENCE",
        "CompanionWorkflowRunId",
        "QwenWorkflowRunId",
        "QwenRuntimeArchiveSha256",
        "QWEN_RUNTIME_MARKER_IDENTITY_MISMATCH",
        "WORKFLOW_RUN_HEAD_MISMATCH",
        "ARTIFACT_NOT_BOUND_TO_WORKFLOW",
        "Copy-IsolatedQwenModels",
        "QWEN_MODEL_COPY_REPARSE_POINT",
        "GATE_PORT_IN_USE",
    )
    for value in required:
        assert value in text
    assert "--port" in text
    assert "18765" in text
    assert "run.json" in text  # canonical immutable-run commit marker; never legacy manifest.json
    assert "IMMUTABLE_RUN_MARKER_MISSING" in text
    assert "IMMUTABLE_RUN_TRANSCRIPT_HASH_MISMATCH" in text
    assert "speaker" not in text.lower()  # evidence must not copy participant identity
    assert "New-Item -ItemType Junction" not in text  # scratch models must be real copies
    assert "$scratchPrefix = $ScratchRoot" in text  # cleanup covers the whole harness tree
    assert "QWEN_RUNTIME_VERSION_INVALID" in text
    assert "if (-not $OriginalLocalAppData)" in text
    assert "QWEN_RUNTIME_MARKER_IDENTITY_MISMATCH" in text
    assert "qwen-runtime-install.json" in text
    assert text.count("[CmdletBinding()]") == 1
    assert text.count('if ($Verdict -ne "PASS") { exit 1 }') == 1
    assert text.count("Qwen physical gate verdict:") == 1
    assert len(text.splitlines()) < 1200
    assert "qwen-runtime-install.json" in text


def test_qwen_recovery_physical_gate_does_not_target_default_agent_port_for_gate():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "[ValidateRange(1024, 65535)][int]$Port = 18765" in text
    assert '"http://127.0.0.1:$Port/api/v1/' in text


def test_qwen_recovery_physical_gate_uses_named_failure_classes_before_export():
    text = SCRIPT.read_text(encoding="utf-8")
    catch_pos = text.index("} catch {")
    verdict_pos = text.index('Write-Json (Join-Path $EvidenceRoot "verdict.json")')
    manifest_pos = text.index("Write-EvidenceManifest $EvidenceRoot")
    assert catch_pos < verdict_pos < manifest_pos


@pytest.mark.skipif(os.name != "nt", reason="PowerShell parser gate is authoritative on Windows CI")
def test_qwen_recovery_physical_gate_parses_on_windows():
    powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe") or shutil.which("pwsh")
    assert powershell is not None
    command = (
        "$tokens=$null;$errors=$null;"
        "[System.Management.Automation.Language.Parser]::ParseFile($env:TDA_QWEN_GATE_SCRIPT,[ref]$tokens,[ref]$errors)|Out-Null;"
        "if($errors.Count -gt 0){$errors|ForEach-Object{Write-Error $_.Message};exit 1}"
    )
    env = os.environ.copy()
    env["TDA_QWEN_GATE_SCRIPT"] = str(SCRIPT)
    completed = subprocess.run(
        [powershell, "-NoProfile", "-Command", command],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr or completed.stdout