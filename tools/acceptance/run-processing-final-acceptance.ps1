[CmdletBinding()]
param(
    [string]$ResultsRoot = "",
    [string]$RequireGpuName = "RTX 4070"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$CompanionRcTag = "companion-rc-v0.3.14-19d9b3b64238"
$WhisperRuntimeRcTag = "companion-whisper-runtime-rc-v1.1.5-2579f7ec7b36"
$QwenRuntimeRcTag = "companion-qwen-runtime-rc-v1.0.10-19d9b3b64238"

$PrHeadSha = "b1c072311457b1be8e1cf3e6e78b9914f7a12144"
$TestedMergeSha = "c7e74df88a09b3f7dd2cb688a312f2dc547f890d"
$SourceTreeSha = "733505c0ee650c79c0f9355b616cb98c0671f866"

$CompanionWorkflowRunId = 35941486263
$CompanionArtifactId = 10785600787
$CompanionArtifactSize = 83221539
$CompanionArtifactSha256 = "042d4301098ddb814448a47f4d54b5fcc95bdf9b5c14679ae33b3116e43ea3b8"

$QwenWorkflowRunId = 35941486132
$QwenArtifactId = 10784868492
$QwenArtifactSize = 2723915745
$QwenArtifactSha256 = "b372dde1a6f200120a9342e60d3462f9680472f3aa6ce6955d92cfacc18493eb"
$QwenRuntimeVersion = "1.0.10"
$QwenRuntimeArchiveSha256 = "b2528830e7d78f21cd54e44c578fb32dc767009435fdc9ffdaf459f1056a3e4e"

function Fail([string]$Code) {
    throw [InvalidOperationException]::new($Code)
}

function Write-Json([string]$Path, [object]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $Value | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $Path -Encoding UTF8
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

    Write-Host "Phase 2/2: normal-Agent Qwen crash/retry recovery..." -ForegroundColor Cyan
    $phase = "qwen_recovery_acceptance"
    $recoveryArgs = @{
        PrHeadSha = $PrHeadSha
        TestedMergeSha = $TestedMergeSha
        SourceTreeSha = $SourceTreeSha
        CompanionWorkflowRunId = $CompanionWorkflowRunId
        CompanionArtifactId = $CompanionArtifactId
        CompanionArtifactSize = $CompanionArtifactSize
        CompanionArtifactSha256 = $CompanionArtifactSha256
        QwenWorkflowRunId = $QwenWorkflowRunId
        QwenArtifactId = $QwenArtifactId
        QwenArtifactSize = $QwenArtifactSize
        QwenArtifactSha256 = $QwenArtifactSha256
        QwenRuntimeVersion = $QwenRuntimeVersion
        QwenRuntimeArchiveSha256 = $QwenRuntimeArchiveSha256
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
        release_source_tree = $SourceTreeSha
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
