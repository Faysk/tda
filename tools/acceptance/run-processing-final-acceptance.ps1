[CmdletBinding()]
param(
    [string]$ResultsRoot = "",
    [string]$RequireGpuName = "RTX 4070",
    [string]$CraigZip = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$CompanionRcTag = "companion-rc-v0.3.18-d3db290b66be"
$WhisperRuntimeRcTag = "companion-whisper-runtime-rc-v1.1.8-ce9fdda3c35e"
$QwenRuntimeRcTag = "companion-qwen-runtime-rc-v1.0.14-d3db290b66be"

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

function Get-OptionalPropertyValue([object]$Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-DirectoryFingerprint([string]$Path) {
    $root = [IO.Path]::GetFullPath($Path)
    $rows = [Collections.Generic.List[string]]::new()
    foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Recurse -Force | Sort-Object FullName)) {
        $relative = [IO.Path]::GetRelativePath($root, $file.FullName).Replace("\", "/")
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $rows.Add(("{0}|{1}|{2}" -f $relative, [int64]$file.Length, $hash))
    }
    if ($rows.Count -lt 1) { Fail "MODEL_DIRECTORY_EMPTY" }
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $rows))
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
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
$modelFingerprintsBefore = [ordered]@{}
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
    $modelFingerprintsBefore[$name] = Get-DirectoryFingerprint $modelRoot
}

$releaseWideScript = Join-Path $PSScriptRoot "run-final-current-source-acceptance.ps1"
$qwenRecoveryScript = Join-Path $PSScriptRoot "run-qwen-recovery-physical-gate.ps1"
$benchmarkScript = Join-Path $PSScriptRoot "run-processing-benchmark-physical-gate.ps1"
foreach ($script in @($releaseWideScript, $qwenRecoveryScript, $benchmarkScript)) {
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
    $whisperCandidatePath = Join-Path $downloadsRoot "whisper-runtime-candidate.json"
    $qwenCandidatePath = Join-Path $downloadsRoot "qwen-runtime-candidate.json"
    foreach ($path in @($companionPayloadPath, $whisperCandidatePath, $qwenCandidatePath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "RELEASE_WIDE_EXACT_RC_HANDOFF_MISSING" }
    }
    $companionPayload = Read-Json $companionPayloadPath "RELEASE_WIDE_COMPANION_PAYLOAD_INVALID"
    $qwenCandidate = Read-Json $qwenCandidatePath "RELEASE_WIDE_QWEN_CANDIDATE_INVALID"
    $installedAcceptancePath = Join-Path $privateRoot ($CompanionRcTag + ".json")
    if (-not (Test-Path -LiteralPath $installedAcceptancePath -PathType Leaf)) {
        Fail "RELEASE_WIDE_INSTALLED_ACCEPTANCE_RECEIPT_MISSING"
    }
    $installedAcceptance = Read-Json $installedAcceptancePath "RELEASE_WIDE_INSTALLED_ACCEPTANCE_RECEIPT_INVALID"
    $installedChecks = Get-OptionalPropertyValue $installedAcceptance "checks"
    $installedObservations = Get-OptionalPropertyValue $installedChecks "observations"
    $bitsResume = Get-OptionalPropertyValue $installedChecks "background_download_resume"
    if (
        [string](Get-OptionalPropertyValue $installedAcceptance "schema") -ne "tda_installed_acceptance_v3" -or
        (Get-OptionalPropertyValue $installedAcceptance "pass") -ne $true -or
        (Get-OptionalPropertyValue $installedObservations "craig_survives_agent_loss") -ne $true -or
        (Get-OptionalPropertyValue $bitsResume "pass") -ne $true -or
        (Get-OptionalPropertyValue $bitsResume "same_job") -ne $true -or
        (Get-OptionalPropertyValue $bitsResume "reused_job") -ne $true
    ) {
        Fail "RELEASE_WIDE_DATA_PRESERVATION_EVIDENCE_INVALID"
    }
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
        RequiredQwenRuntimeVersion = [string]$qwenCandidate.version
        RequireGpuName = $RequireGpuName
        OutputRoot = $qwenRecoveryRoot
    }
    & $qwenRecoveryScript @recoveryArgs
    if ($LASTEXITCODE -ne 0) { Fail "QWEN_RECOVERY_ACCEPTANCE_FAILED" }

    $qwenRecoveryRuns = @(Get-ChildItem -LiteralPath $qwenRecoveryRoot -Directory -Filter "TDA-QWEN-GATE-EVIDENCE-*" | Sort-Object Name)
    if ($qwenRecoveryRuns.Count -ne 1) { Fail "QWEN_RECOVERY_EVIDENCE_HANDOFF_INVALID" }
    $qwenRecoveryEvidenceRoot = $qwenRecoveryRuns[0].FullName
    $qwenRecoveryVerdict = Read-Json (Join-Path $qwenRecoveryEvidenceRoot "verdict.json") "QWEN_RECOVERY_VERDICT_INVALID"
    $qwenQualityResult = Read-Json (Join-Path $qwenRecoveryEvidenceRoot "qwen-quality-result.json") "QWEN_RECOVERY_QUALITY_RESULT_INVALID"
    $immutableRun = Read-Json (Join-Path $qwenRecoveryEvidenceRoot "immutable-run-validation.json") "QWEN_RECOVERY_IMMUTABLE_RUN_INVALID"
    $persistedTracks = @(Get-OptionalPropertyValue $qwenQualityResult "persisted_tracks_before_crash")
    $qualityTranscriptSha = [string](Get-OptionalPropertyValue $qwenQualityResult "transcript_sha256")
    $immutableTranscriptSha = [string](Get-OptionalPropertyValue $immutableRun "transcript_sha256")
    $computedTranscriptSha = [string](Get-OptionalPropertyValue $immutableRun "computed_transcript_sha256")
    $qualityAttempt = Get-OptionalPropertyValue $qwenQualityResult "attempt"
    $immutableAttempt = Get-OptionalPropertyValue $immutableRun "attempt"
    if (
        [string](Get-OptionalPropertyValue $qwenRecoveryVerdict "schema") -ne "tda_qwen_recovery_physical_gate_v1" -or
        [string](Get-OptionalPropertyValue $qwenRecoveryVerdict "verdict") -ne "PASS" -or
        [string](Get-OptionalPropertyValue $qwenRecoveryVerdict "code") -ne "QWEN_PHYSICAL_RECOVERY_GATE_PASS" -or
        [string](Get-OptionalPropertyValue $qwenQualityResult "status") -ne "succeeded" -or
        $null -eq $qualityAttempt -or [int]$qualityAttempt -lt 2 -or
        $persistedTracks.Count -lt 1 -or
        [string](Get-OptionalPropertyValue $immutableRun "profile_id") -ne "qwen-quality" -or
        $null -eq $immutableAttempt -or [int]$immutableAttempt -ne [int]$qualityAttempt -or
        $qualityTranscriptSha -notmatch '^[a-f0-9]{64}$' -or
        $immutableTranscriptSha -ne $qualityTranscriptSha -or
        $computedTranscriptSha -ne $qualityTranscriptSha
    ) {
        Fail "QWEN_RECOVERY_TRANSCRIPTION_RETRY_EVIDENCE_INVALID"
    }

    $benchmarkReceipt = $null
    if ($CraigZip) {
        Write-Host "Phase 3/3: exact-RC real Craig 5-minute four-profile benchmark..." -ForegroundColor Cyan
        $phase = "real_benchmark_acceptance"
        $benchmarkRoot = Join-Path $root "real-benchmark"
        & $benchmarkScript -CraigZip $CraigZip -CompanionPayloadManifest $companionPayloadPath -WhisperRuntimeCandidateManifest $whisperCandidatePath -QwenRuntimeCandidateManifest $qwenCandidatePath -RequireGpuName $RequireGpuName -OutputRoot $benchmarkRoot
        if ($LASTEXITCODE -ne 0) { Fail "PROCESSING_BENCHMARK_ACCEPTANCE_FAILED" }
        $benchmarkRuns = @(Get-ChildItem -LiteralPath $benchmarkRoot -Directory -Filter "BENCHMARK-*" | Sort-Object Name)
        if ($benchmarkRuns.Count -ne 1) { Fail "PROCESSING_BENCHMARK_RECEIPT_HANDOFF_INVALID" }
        $benchmarkReceipt = Join-Path $benchmarkRuns[0].FullName "PROCESSING-1233-ACCEPTANCE.json"
        if (-not (Test-Path -LiteralPath $benchmarkReceipt -PathType Leaf)) { Fail "PROCESSING_BENCHMARK_RECEIPT_MISSING" }
        $benchmarkValue = Read-Json $benchmarkReceipt "PROCESSING_BENCHMARK_RECEIPT_INVALID"
        if ([string]$benchmarkValue.schema -ne "tda_processing_1233_physical_acceptance_v1" -or $benchmarkValue.pass -ne $true) {
            Fail "PROCESSING_BENCHMARK_RECEIPT_INVALID"
        }
    }

    $modelFingerprintsAfter = [ordered]@{}
    foreach ($name in @($modelFingerprintsBefore.Keys)) {
        $modelRoot = Join-Path $modelsRoot $name
        if (-not (Test-Path -LiteralPath $modelRoot -PathType Container)) {
            Fail ("QWEN_MODEL_DIRECTORY_NOT_PRESERVED:" + $name)
        }
        $modelFingerprintsAfter[$name] = Get-DirectoryFingerprint $modelRoot
        if ([string]$modelFingerprintsAfter[$name] -ne [string]$modelFingerprintsBefore[$name]) {
            Fail ("QWEN_MODEL_DATA_CHANGED:" + $name)
        }
    }

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
        normal_transcription_retry_verified = $(if ($passed) { $true } else { $false })
        persisted_checkpoint_reuse_verified = $(if ($passed) { $true } else { $false })
        existing_craig_survives_agent_loss = $(if ($passed) { $true } else { $false })
        existing_model_data_preserved = $(if ($passed) { $true } else { $false })
        release_wide_results = "release-wide"
        qwen_recovery_results = "qwen-recovery"
        real_benchmark_requested = (-not [string]::IsNullOrWhiteSpace($CraigZip))
        real_benchmark_receipt = $(if ($null -ne (Get-Variable benchmarkReceipt -ErrorAction SilentlyContinue) -and $benchmarkReceipt) { "real-benchmark" } else { $null })
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
