[CmdletBinding()]
param(
    [string]$ResultsRoot = "",
    [string]$RequireGpuName = "RTX 4070"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$CompanionRcTag = "companion-rc-v0.3.14-74a656021208"
$WhisperRuntimeRcTag = "companion-whisper-runtime-rc-v1.1.5-2579f7ec7b36"
$QwenRuntimeRcTag = "companion-qwen-runtime-rc-v1.0.10-19d9b3b64238"

function Fail([string]$Code) {
    throw [InvalidOperationException]::new($Code)
}

function Write-Json([string]$Path, [object]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $Value | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Read-Json([string]$Path, [string]$Code) {
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64 }
    catch { Fail $Code }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Fail "WINDOWS_REQUIRED" }
if ($PSVersionTable.PSVersion -lt [Version]"7.4") { Fail "POWERSHELL_7_4_REQUIRED" }
if (-not $env:LOCALAPPDATA) { Fail "LOCALAPPDATA_NOT_FOUND" }
if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) { Fail "GH_CLI_REQUIRED" }
if ($null -eq (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { Fail "NVIDIA_SMI_REQUIRED" }

& gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { Fail "GH_AUTH_REQUIRED" }

$gpuRows = @(& nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>$null)
if ($LASTEXITCODE -ne 0 -or @($gpuRows | Where-Object { $_ -like "*$RequireGpuName*" }).Count -eq 0) {
    Fail "REQUIRED_GPU_NOT_FOUND"
}

$modelsRoot = Join-Path $env:LOCALAPPDATA "TDA\Models"
foreach ($name in @(
    "qwen3-asr-0.6b-hf",
    "qwen3-asr-1.7b-hf",
    "qwen3-forced-aligner-0.6b-hf"
)) {
    $modelRoot = Join-Path $modelsRoot $name
    if (-not (Test-Path -LiteralPath $modelRoot -PathType Container)) {
        Fail ("QWEN_MODEL_DIRECTORY_MISSING:" + $name)
    }
    if (-not (Test-Path -LiteralPath (Join-Path $modelRoot ".tda-model.json") -PathType Leaf)) {
        Fail ("QWEN_MODEL_MARKER_MISSING:" + $name)
    }
}

$releaseWideScript = Join-Path $PSScriptRoot "run-final-current-source-acceptance.ps1"
$qwenRecoveryScript = Join-Path $PSScriptRoot "run-qwen-recovery-physical-gate.ps1"
foreach ($script in @($releaseWideScript, $qwenRecoveryScript)) {
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
        Fail "PROCESSING_ACCEPTANCE_SCRIPT_MISSING"
    }
}

$stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss")
if (-not $ResultsRoot) {
    $ResultsRoot = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))) "TDA-PROCESSING-FINAL-RESULTS"
}
$root = Join-Path ([IO.Path]::GetFullPath($ResultsRoot)) ("PROCESSING-" + $stamp)
$releaseWideRoot = Join-Path $root "release-wide"
$qwenRecoveryRoot = Join-Path $root "qwen-recovery"
New-Item -ItemType Directory -Force -Path $releaseWideRoot, $qwenRecoveryRoot | Out-Null

$summaryPath = Join-Path $root "PROCESSING-AUTO-RESULT.json"
$phase = "preflight"
$passed = $false
$failureCode = $null

try {
    Write-Host "TDA PROCESSING FINAL ACCEPTANCE - ONE COMMAND" -ForegroundColor Cyan

    Write-Host "Phase 1/2: installed + four-profile release acceptance..." -ForegroundColor Cyan
    $phase = "release_wide_acceptance"
    $releaseArgs = @{
        CompanionRcTag = $CompanionRcTag
        WhisperRuntimeRcTag = $WhisperRuntimeRcTag
        QwenRuntimeRcTag = $QwenRuntimeRcTag
        ResultsRoot = $releaseWideRoot
        RequireGpuName = $RequireGpuName
    }
    & $releaseWideScript @releaseArgs
    if ($LASTEXITCODE -ne 0) { Fail "RELEASE_WIDE_ACCEPTANCE_FAILED" }

    # Phase 1 already installed and byte-verified the exact promotable RCs.
    # Reuse those exact local bytes for the isolated recovery gate instead of
    # downloading an older PR Actions artifact with a different archive/source identity.
    $finalRuns = @(Get-ChildItem -LiteralPath $releaseWideRoot -Directory -Filter "FINAL-*" | Sort-Object Name)
    if ($finalRuns.Count -ne 1) { Fail "RELEASE_WIDE_PRIVATE_HANDOFF_INVALID" }
    $privateRoot = Join-Path $finalRuns[0].FullName "_private"
    $downloadsRoot = Join-Path $privateRoot "downloads"
    $companionPayloadPath = Join-Path $downloadsRoot "TDACompanion-payload-manifest.json"
    $qwenCandidatePath = Join-Path $downloadsRoot "qwen-runtime-candidate.json"
    foreach ($path in @($companionPayloadPath, $qwenCandidatePath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "RELEASE_WIDE_EXACT_RC_HANDOFF_MISSING" }
    }
    $companionPayload = Read-Json $companionPayloadPath "RELEASE_WIDE_COMPANION_PAYLOAD_INVALID"
    $qwenCandidate = Read-Json $qwenCandidatePath "RELEASE_WIDE_QWEN_CANDIDATE_INVALID"
    if (
        [string]$companionPayload.schema -ne "tda_companion_payload_v1" -or
        [string]$companionPayload.source_tree_sha -notmatch '^[a-f0-9]{40}$' -or
        [string]$qwenCandidate.schema -ne "tda_runtime_candidate_v1" -or
        [string]$qwenCandidate.family -ne "qwen" -or
        [string]$qwenCandidate.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}$'
    ) { Fail "RELEASE_WIDE_EXACT_RC_IDENTITY_INVALID" }

    $companionExe = Join-Path $env:LOCALAPPDATA ("TDA\Companion\versions\{0}\TDACompanion.exe" -f [string]$companionPayload.version)
    $qwenInstalledRuntime = Join-Path $env:LOCALAPPDATA ("TDA\Runtime\qwen\{0}" -f [string]$qwenCandidate.version)
    if (-not (Test-Path -LiteralPath $companionExe -PathType Leaf)) { Fail "RELEASE_WIDE_COMPANION_EXE_MISSING" }
    if (-not (Test-Path -LiteralPath $qwenInstalledRuntime -PathType Container)) { Fail "RELEASE_WIDE_QWEN_RUNTIME_MISSING" }
    $releaseSourceTree = [string]$companionPayload.source_tree_sha

    Write-Host "Phase 2/2: exact-RC normal-Agent Qwen crash/retry recovery..." -ForegroundColor Cyan
    $phase = "qwen_recovery_acceptance"
    $recoveryArgs = @{
        CompanionExePath = $companionExe
        CompanionPayloadManifest = $companionPayloadPath
        QwenRuntimeCandidateManifest = $qwenCandidatePath
        QwenInstalledRuntimeRoot = $qwenInstalledRuntime
        RequireGpuName = $RequireGpuName
        OutputRoot = $qwenRecoveryRoot
    }
    & $qwenRecoveryScript @recoveryArgs
    if ($LASTEXITCODE -ne 0) { Fail "QWEN_RECOVERY_ACCEPTANCE_FAILED" }

    $passed = $true
} catch {
    $failureCode = [string]$_.Exception.Message
    if ($failureCode -notmatch '^[A-Z0-9_.:-]{1,180}$') {
        $failureCode = "PROCESSING_FINAL_ACCEPTANCE_FAILED"
    }
    Write-Host ("PROCESSING FINAL ACCEPTANCE FAILED phase={0} code={1}" -f $phase, $failureCode) -ForegroundColor Red
} finally {
    Write-Json $summaryPath ([ordered]@{
        schema = "tda_processing_final_acceptance_v1"
        pass = $passed
        completed_at = [DateTimeOffset]::UtcNow.ToString("o")
        phase = $phase
        failure_code = $failureCode
        gpu_requirement = $RequireGpuName
        companion_rc = $CompanionRcTag
        whisper_runtime_rc = $WhisperRuntimeRcTag
        qwen_runtime_rc = $QwenRuntimeRcTag
        release_source_tree = $(if ($null -ne (Get-Variable releaseSourceTree -ErrorAction SilentlyContinue)) { $releaseSourceTree } else { $null })
        qwen_recovery_identity = "exact_installed_rc"
        qwen_recovery_input = "generated_synthetic"
        release_wide_results = "release-wide"
        qwen_recovery_results = "qwen-recovery"
        contains_audio = $false
        contains_transcript = $false
        contains_token = $false
        contains_paths = $false
    })
    Write-Host ("Combined result: " + $summaryPath) -ForegroundColor Cyan
}

if ($passed) {
    Write-Host "PROCESSING FINAL ACCEPTANCE: PASS" -ForegroundColor Green
    exit 0
}
exit 1
