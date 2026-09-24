from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "tools" / "acceptance" / "run-qwen-turing-stable-acceptance.ps1"


def test_turing_stable_acceptance_static_contract():
    text = SCRIPT.read_text(encoding="utf-8")

    required = (
        "Set-StrictMode -Version Latest",
        '[Parameter(Mandatory = $true)][string]$CraigZip',
        '$RequireGpuName = "RTX 2080"',
        '$ExpectedStableVersion = "0.3.14"',
        '$ExpectedWhisperRuntimeVersion = "1.1.5"',
        '$ExpectedQwenRuntimeVersion = "1.0.10"',
        '$ExpectedComputeCapability = "7.5"',
        "run-processing-stable-smoke.ps1",
        "run-qwen-recovery-physical-gate.ps1",
        "qwen-fast",
        "qwen-quality",
        "tda_qwen_physical_gate_v2",
        "attention_backend",
        "alignment_attention_backend",
        "transcription_rtf",
        "alignment_rtf",
        "asr_peak_memory_used_bytes",
        "alignment_peak_memory_used_bytes",
        "IMMUTABLE_RUN_INTEGRITY_INVALID",
        "QWEN_PHYSICAL_RECOVERY_GATE_PASS",
        "tda_qwen_turing_stable_acceptance_v1",
        "contains_audio = $false",
        "contains_transcript = $false",
        "contains_token = $false",
        "contains_local_paths = $false",
    )
    for value in required:
        assert value in text

    assert text.count('foreach ($profileId in @("qwen-fast", "qwen-quality"))') == 1
    assert "float16" in text
    assert "bfloat16" in text
    assert "experimental = $true" in text
    assert "PASS (experimental evidence only)" in text


def test_turing_stable_acceptance_uses_official_stable_then_exact_recovery():
    text = SCRIPT.read_text(encoding="utf-8")

    stable_pos = text.index('$phase = "official_stable_smoke"')
    craig_pos = text.index('$phase = "full_craig_preflight"')
    recovery_pos = text.index('$phase = "crash_retry_recovery"')

    assert stable_pos < craig_pos < recovery_pos
    assert '"-ExpectedStableVersion", $ExpectedStableVersion' in text
    assert '"-ExpectedQwenRuntimeVersion", $ExpectedQwenRuntimeVersion' in text
    assert '"-CraigZip", $CraigResolved' in text
    assert '"-CompanionExePath", $companionExe' in text
    assert '"-CompanionPayloadManifest", $payloadManifest' in text
    assert '"-QwenRuntimeCandidateManifest", $qwenCandidateManifest' in text
    assert '"-QwenInstalledRuntimeRoot", $qwenRuntimeRoot' in text
    assert '"-RequireGpuName", $RequireGpuName' in text
    assert '"-Port", [string]$RecoveryPort' in text


def test_turing_stable_acceptance_public_summary_does_not_record_private_identity():
    text = SCRIPT.read_text(encoding="utf-8")
    summary = text.split("Write-Json $summaryPath", 1)[1]

    assert "$CraigResolved" not in summary
    assert "$sourceId" not in summary
    assert "$jobId" not in summary
    assert "$runId" not in summary
    assert "path_recorded = $false" in summary
    assert "content_recorded = $false" in summary
    assert 'Compress-Archive -Path (Join-Path $share "*")' in summary


@pytest.mark.skipif(os.name != "nt", reason="PowerShell parser gate is authoritative on Windows CI")
def test_turing_stable_acceptance_parses_on_windows():
    powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe") or shutil.which("pwsh")
    assert powershell is not None

    command = (
        "$tokens=$null;$errors=$null;"
        "[System.Management.Automation.Language.Parser]::ParseFile("
        "$env:TDA_TURING_STABLE_SCRIPT,[ref]$tokens,[ref]$errors)|Out-Null;"
        "if($errors.Count -gt 0){$errors|ForEach-Object{Write-Error $_.Message};exit 1}"
    )
    env = os.environ.copy()
    env["TDA_TURING_STABLE_SCRIPT"] = str(SCRIPT)
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
