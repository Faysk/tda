from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "tools" / "acceptance" / "run-final-current-source-acceptance.ps1"


def test_final_runner_accepts_stable_or_rc_runtime_release_tags():
    text = SCRIPT.read_text(encoding="utf-8")

    assert '[string]$WhisperRuntimeRcTag' in text
    assert '[string]$QwenRuntimeRcTag' in text
    assert "^companion-whisper-runtime-v[0-9]+" in text
    assert "^companion-qwen-runtime-v[0-9]+" in text
    assert '$stableTagProperty = $Candidate.PSObject.Properties["stable_tag"]' in text
    assert '[string]$stableTagProperty.Value -ne $Tag' in text
    assert "[string]$Candidate.candidate_tag -ne $Tag" in text


def test_runtime_receipts_remain_bound_to_original_candidate_tag():
    text = SCRIPT.read_text(encoding="utf-8")

    assert (
        '$expected=if($family -eq "whisper"){[string]$wm.candidate_tag}'
        'else{[string]$qm.candidate_tag}'
    ) in text
    assert 'Join-Path $shareReceipts "$([string]$wm.candidate_tag).json"' in text
    assert 'Join-Path $shareReceipts "$([string]$qm.candidate_tag).json"' in text


@pytest.mark.skipif(os.name != "nt", reason="PowerShell parser gate is authoritative on Windows CI")
def test_final_current_source_runner_parses_on_windows():
    powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe") or shutil.which("pwsh")
    assert powershell is not None

    command = (
        "$tokens=$null;$errors=$null;"
        "[System.Management.Automation.Language.Parser]::ParseFile("
        "$env:TDA_FINAL_CURRENT_SOURCE_SCRIPT,[ref]$tokens,[ref]$errors)|Out-Null;"
        "if($errors.Count -gt 0){$errors|ForEach-Object{Write-Error $_.Message};exit 1}"
    )
    env = os.environ.copy()
    env["TDA_FINAL_CURRENT_SOURCE_SCRIPT"] = str(SCRIPT)
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
