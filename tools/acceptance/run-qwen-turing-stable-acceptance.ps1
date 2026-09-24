[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CraigZip,
    [string]$RequireGpuName = "RTX 2080",
    [string]$BaseUrl = "https://dnd.faysk.dev",
    [ValidateRange(1024, 65535)][int]$Port = 8765,
    [ValidateRange(1024, 65535)][int]$RecoveryPort = 18765,
    [string]$ResultsRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ExpectedStableVersion = "0.3.14"
$ExpectedWhisperRuntimeVersion = "1.1.5"
$ExpectedQwenRuntimeVersion = "1.0.10"
$ExpectedComputeCapability = "7.5"
$Origin = $BaseUrl.TrimEnd("/")

function Fail([string]$Code) {
    throw [InvalidOperationException]::new($Code)
}

function Get-PowerShell7 {
    $command = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($null -eq $command) { $command = Get-Command pwsh -ErrorAction SilentlyContinue }
    if ($null -eq $command) { Fail "POWERSHELL_7_REQUIRED" }
    return [string]$command.Source
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-Json([string]$Path, [string]$Code) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64 -ErrorAction Stop
    } catch {
        Fail $Code
    }
}

function Write-Json([string]$Path, [object]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $Value | ConvertTo-Json -Depth 64 | Set-Content -LiteralPath $Path -Encoding UTF8
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

function Get-ErrorDetailMessage([object]$ErrorRecord) {
    $details = Get-OptionalPropertyValue $ErrorRecord "ErrorDetails"
    return [string](Get-OptionalPropertyValue $details "Message")
}

function Get-AgentHealth {
    try {
        $value = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        if (
            [string](Get-OptionalPropertyValue $value "product_id") -ne "tda-companion" -or
            [string](Get-OptionalPropertyValue $value "api_version") -ne "1" -or
            [string](Get-OptionalPropertyValue $value "service_version") -ne $ExpectedStableVersion -or
            [string](Get-OptionalPropertyValue $value "lifecycle") -ne "ready"
        ) {
            return $null
        }
        return $value
    } catch {
        return $null
    }
}

function New-BrowserSession {
    try {
        $value = Invoke-RestMethod -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/session" -Headers @{
            Origin = $Origin
            Accept = "application/json"
        } -ContentType "application/json" -Body "{}" -TimeoutSec 10
    } catch {
        Fail "BROWSER_SESSION_CREATE_FAILED"
    }

    $schema = [string](Get-OptionalPropertyValue $value "schema")
    $token = [string](Get-OptionalPropertyValue $value "token")
    if ($schema -ne "tda_loopback_session_v1" -or [string]::IsNullOrWhiteSpace($token)) {
        Fail "BROWSER_SESSION_INVALID"
    }
    return $token
}

function Invoke-AgentJson(
    [string]$Token,
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [int]$TimeoutSec = 30
) {
    $params = @{
        NoProxy = $true
        Method = $Method
        Uri = "http://127.0.0.1:$Port/api/v1$Path"
        Headers = @{
            Origin = $Origin
            Authorization = "Bearer $Token"
            Accept = "application/json"
        }
        TimeoutSec = $TimeoutSec
    }
    if ($Method -eq "POST" -and $null -eq $Body) {
        $Body = [ordered]@{}
    }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 32 -Compress)
    }

    try {
        return Invoke-RestMethod @params
    } catch {
        $detail = Get-ErrorDetailMessage $_
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') {
            Fail ("AGENT_API_" + $Matches[1])
        }
        Fail "AGENT_API_REQUEST_FAILED"
    }
}

function Assert-NoActiveUserWork([string]$Token) {
    $jobs = Invoke-AgentJson $Token "GET" "/jobs"
    $jobRows = Get-OptionalPropertyValue $jobs "jobs"
    if ($null -eq $jobRows) { Fail "ACTIVE_WORK_JOBS_RESPONSE_INVALID" }
    if (@(@($jobRows) | Where-Object { [string](Get-OptionalPropertyValue $_ "status") -in @("queued", "running") }).Count -gt 0) {
        Fail "ACTIVE_USER_JOB_PRESENT"
    }

    $preparation = Invoke-AgentJson $Token "GET" "/preparation"
    if ((Get-OptionalPropertyValue $preparation "active") -eq $true) {
        Fail "ACTIVE_USER_PREPARATION_PRESENT"
    }
}

function Upload-Craig([string]$Token, [string]$Path) {
    try {
        $response = Invoke-WebRequest -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/sources/craig" -Headers @{
            Origin = $Origin
            Authorization = "Bearer $Token"
            Accept = "application/json"
        } -ContentType "application/zip" -InFile $Path -TimeoutSec 900
        return $response.Content | ConvertFrom-Json -Depth 32
    } catch {
        $detail = Get-ErrorDetailMessage $_
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') {
            Fail ("CRAIG_" + $Matches[1])
        }
        Fail "CRAIG_UPLOAD_FAILED"
    }
}

function Get-ReadyProfiles([object]$Capabilities) {
    $transcription = Get-OptionalPropertyValue $Capabilities "transcription"
    $profiles = Get-OptionalPropertyValue $transcription "profiles"
    if ($null -eq $profiles) { Fail "CAPABILITIES_PROFILES_INVALID" }
    return @(@($profiles) | ForEach-Object { [string]$_ })
}

function Ensure-ProfileReady([string]$Token, [string]$SourceId, [string]$ProfileId) {
    $capabilities = Invoke-AgentJson $Token "GET" "/capabilities"
    if ($ProfileId -in @(Get-ReadyProfiles $capabilities)) { return "already_ready" }

    $started = Invoke-AgentJson $Token "POST" "/preparation" @{
        source_id = $SourceId
        profile_id = $ProfileId
    }
    if (
        [string](Get-OptionalPropertyValue $started "schema") -ne "tda_profile_preparation_v1" -or
        [string](Get-OptionalPropertyValue $started "profile_id") -ne $ProfileId
    ) {
        Fail ("PROFILE_PREPARATION_START_INVALID:" + $ProfileId)
    }

    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $status = Invoke-AgentJson $Token "GET" "/preparation"
        $state = [string](Get-OptionalPropertyValue $status "state")
        $statusProfile = [string](Get-OptionalPropertyValue $status "profile_id")
        if ($statusProfile -ne $ProfileId) { Fail ("PROFILE_PREPARATION_IDENTITY_INVALID:" + $ProfileId) }
        if ($state -eq "completed") {
            $capabilities = Invoke-AgentJson $Token "GET" "/capabilities"
            if ($ProfileId -notin @(Get-ReadyProfiles $capabilities)) {
                Fail ("PROFILE_PREPARATION_NOT_VISIBLE:" + $ProfileId)
            }
            return "prepared"
        }
        if ($state -eq "failed") {
            $errorCode = [string](Get-OptionalPropertyValue $status "error_code")
            if (-not $errorCode) { $errorCode = "PROFILE_PREPARATION_FAILED" }
            Fail ($errorCode + ":" + $ProfileId)
        }
        if ($state -eq "cancelled") { Fail ("PROFILE_PREPARATION_CANCELLED:" + $ProfileId) }
        Start-Sleep -Seconds 1
    }
    Fail ("PROFILE_PREPARATION_TIMEOUT:" + $ProfileId)
}

function Assert-TuringGate([string]$ProfileId, [string]$Destination) {
    $gatePath = Join-Path $env:LOCALAPPDATA "TDA\State\qwen-physical-gates\$ProfileId.json"
    if (-not (Test-Path -LiteralPath $gatePath -PathType Leaf)) {
        Fail ("QWEN_GATE_RECEIPT_MISSING:" + $ProfileId)
    }
    $gate = Read-Json $gatePath ("QWEN_GATE_RECEIPT_INVALID:" + $ProfileId)
    $gpu = Get-OptionalPropertyValue $gate "gpu"
    $metrics = Get-OptionalPropertyValue $gate "metrics"
    if (
        [string](Get-OptionalPropertyValue $gate "schema") -ne "tda_qwen_physical_gate_v2" -or
        (Get-OptionalPropertyValue $gate "contains_audio") -ne $false -or
        (Get-OptionalPropertyValue $gate "contains_transcript") -ne $false -or
        $null -eq $gpu -or
        $null -eq $metrics
    ) {
        Fail ("QWEN_GATE_RECEIPT_CONTRACT_INVALID:" + $ProfileId)
    }

    $gpuName = [string](Get-OptionalPropertyValue $gpu "name")
    $computeCapability = [string](Get-OptionalPropertyValue $gpu "compute_capability")
    if ($gpuName -notlike "*$RequireGpuName*" -or $computeCapability -ne $ExpectedComputeCapability) {
        Fail ("QWEN_GATE_TURING_IDENTITY_INVALID:" + $ProfileId)
    }

    $computeType = [string](Get-OptionalPropertyValue $metrics "compute_type")
    $attentionBackend = [string](Get-OptionalPropertyValue $metrics "attention_backend")
    $alignmentBackend = [string](Get-OptionalPropertyValue $metrics "alignment_attention_backend")
    $asrPeak = [long](Get-OptionalPropertyValue $metrics "asr_peak_memory_used_bytes")
    $alignmentPeak = [long](Get-OptionalPropertyValue $metrics "alignment_peak_memory_used_bytes")
    $transcriptionRtf = [double](Get-OptionalPropertyValue $metrics "transcription_rtf")
    $alignmentRtf = [double](Get-OptionalPropertyValue $metrics "alignment_rtf")
    $audioSeconds = [double](Get-OptionalPropertyValue $metrics "audio_seconds")

    if (
        $computeType -notin @("float16", "bfloat16") -or
        -not $attentionBackend -or $attentionBackend -eq "unknown" -or
        -not $alignmentBackend -or $alignmentBackend -eq "unknown" -or
        $asrPeak -le 0 -or $alignmentPeak -le 0 -or
        $transcriptionRtf -lt 0 -or $alignmentRtf -lt 0 -or
        $audioSeconds -le 0
    ) {
        Fail ("QWEN_GATE_METRICS_INVALID:" + $ProfileId)
    }

    Copy-Item -LiteralPath $gatePath -Destination $Destination -Force
    return [ordered]@{
        profile_id = $ProfileId
        gpu_name = $gpuName
        compute_capability = $computeCapability
        compute_type = $computeType
        attention_backend = $attentionBackend
        alignment_attention_backend = $alignmentBackend
        audio_seconds = [Math]::Round($audioSeconds, 3)
        transcription_rtf = [Math]::Round($transcriptionRtf, 6)
        alignment_rtf = [Math]::Round($alignmentRtf, 6)
        asr_peak_memory_used_bytes = $asrPeak
        alignment_peak_memory_used_bytes = $alignmentPeak
    }
}

function Submit-Transcription([string]$Token, [string]$SourceId, [string]$ProfileId) {
    $body = @{
        kind = "transcription.craig"
        campaign_id = "turing-experimental"
        session_id = "turing-experimental"
        source_id = $SourceId
        profile_id = $ProfileId
        glossary = ""
        context = ""
        cpu = $false
    }
    $idempotency = "turing-$ProfileId-" + [Guid]::NewGuid().ToString("N")
    try {
        return Invoke-RestMethod -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/jobs" -Headers @{
            Origin = $Origin
            Authorization = "Bearer $Token"
            Accept = "application/json"
            "Idempotency-Key" = $idempotency
        } -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 16 -Compress) -TimeoutSec 30
    } catch {
        $detail = Get-ErrorDetailMessage $_
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') {
            Fail ("JOB_SUBMIT_" + $Matches[1] + ":" + $ProfileId)
        }
        Fail ("JOB_SUBMIT_FAILED:" + $ProfileId)
    }
}

function Wait-JobSucceeded([string]$Token, [string]$JobId, [string]$ProfileId) {
    $started = [DateTimeOffset]::UtcNow
    $deadline = $started.AddHours(4)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $job = Invoke-AgentJson $Token "GET" "/jobs/$JobId"
        $status = [string](Get-OptionalPropertyValue $job "status")
        if ($status -eq "succeeded") {
            return [ordered]@{
                job = $job
                elapsed_seconds = [Math]::Round(([DateTimeOffset]::UtcNow - $started).TotalSeconds, 3)
            }
        }
        if ($status -in @("failed", "cancelled", "interrupted")) {
            $error = Get-OptionalPropertyValue $job "error"
            $errorCode = [string](Get-OptionalPropertyValue $error "code")
            if (-not $errorCode) { $errorCode = $status.ToUpperInvariant() }
            Fail ("JOB_TERMINAL_" + $errorCode + ":" + $ProfileId)
        }
        Start-Sleep -Seconds 1
    }
    Fail ("JOB_TIMEOUT:" + $ProfileId)
}

function Verify-ImmutableRun(
    [string]$Token,
    [string]$SourceId,
    [string]$JobId,
    [string]$ProfileId,
    [object]$Job
) {
    $result = Invoke-AgentJson $Token "GET" "/jobs/$JobId/result"
    $transcription = Get-OptionalPropertyValue $result "transcription"
    if ($null -eq $transcription) { Fail ("RESULT_TRANSCRIPTION_MISSING:" + $ProfileId) }

    $runId = [string](Get-OptionalPropertyValue $transcription "run_id")
    $digest = [string](Get-OptionalPropertyValue $transcription "sha256")
    if ($runId -notmatch '^[A-Za-z0-9_-]{1,160}$' -or $digest -notmatch '^[a-f0-9]{64}$') {
        Fail ("RESULT_IDENTITY_INVALID:" + $ProfileId)
    }

    $runRoot = Join-Path $env:LOCALAPPDATA ("TDA\Data\staging\" + $SourceId + "\runs\" + $runId)
    $markerPath = Join-Path $runRoot "run.json"
    $transcriptPath = Join-Path $runRoot "transcript.json"
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { Fail ("RUN_MARKER_MISSING:" + $ProfileId) }
    if (-not (Test-Path -LiteralPath $transcriptPath -PathType Leaf)) { Fail ("RUN_TRANSCRIPT_MISSING:" + $ProfileId) }

    $marker = Read-Json $markerPath ("RUN_MARKER_INVALID:" + $ProfileId)
    $attempt = Get-OptionalPropertyValue $Job "attempt"
    if (
        [string](Get-OptionalPropertyValue $marker "profile_id") -ne $ProfileId -or
        [string](Get-OptionalPropertyValue $marker "job_id") -ne $JobId -or
        $null -eq $attempt -or
        [int](Get-OptionalPropertyValue $marker "attempt") -ne [int]$attempt -or
        [string](Get-OptionalPropertyValue $marker "transcript_sha256") -ne $digest -or
        (Get-Sha256 $transcriptPath) -ne $digest
    ) {
        Fail ("IMMUTABLE_RUN_INTEGRITY_INVALID:" + $ProfileId)
    }

    return [ordered]@{
        profile_id = $ProfileId
        status = "succeeded"
        attempt = [int]$attempt
        immutable_run_verified = $true
    }
}

function Write-EvidenceManifest([string]$ShareRoot) {
    $rows = [Collections.Generic.List[object]]::new()
    foreach ($file in Get-ChildItem -LiteralPath $ShareRoot -File | Sort-Object Name) {
        if ($file.Name -eq "EVIDENCE-MANIFEST.json") { continue }
        $rows.Add([ordered]@{
            name = $file.Name
            size = [long]$file.Length
            sha256 = Get-Sha256 $file.FullName
        })
    }
    Write-Json (Join-Path $ShareRoot "EVIDENCE-MANIFEST.json") ([ordered]@{
        schema = "tda_qwen_turing_stable_evidence_manifest_v1"
        files = @($rows)
    })
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Fail "WINDOWS_REQUIRED" }
if ($PSVersionTable.PSVersion -lt [Version]"7.4") { Fail "POWERSHELL_7_4_REQUIRED" }
if (-not $env:LOCALAPPDATA) { Fail "LOCALAPPDATA_NOT_FOUND" }
if ($Port -eq $RecoveryPort) { Fail "PORTS_MUST_DIFFER" }
if ($null -eq (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { Fail "NVIDIA_SMI_REQUIRED" }

$CraigResolved = (Resolve-Path -LiteralPath $CraigZip -ErrorAction Stop).Path
if ([IO.Path]::GetExtension($CraigResolved).ToLowerInvariant() -ne ".zip") { Fail "CRAIG_ZIP_REQUIRED" }

$gpuRows = @(& nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits 2>$null)
if ($LASTEXITCODE -ne 0 -or $gpuRows.Count -eq 0) { Fail "NVIDIA_GPU_QUERY_FAILED" }
$gpuMatch = @($gpuRows | Where-Object { $_ -like "*$RequireGpuName*" })
if ($gpuMatch.Count -ne 1) { Fail "REQUIRED_GPU_NOT_FOUND_OR_AMBIGUOUS" }

$pwsh = Get-PowerShell7
$stableSmokeScript = Join-Path $PSScriptRoot "run-processing-stable-smoke.ps1"
$recoveryScript = Join-Path $PSScriptRoot "run-qwen-recovery-physical-gate.ps1"
foreach ($scriptPath in @($stableSmokeScript, $recoveryScript)) {
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { Fail "ACCEPTANCE_SCRIPT_MISSING" }
}

if (-not $ResultsRoot) {
    $ResultsRoot = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))) "TDA-QWEN-TURING-STABLE-RESULTS"
}
$stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss")
$root = Join-Path ([IO.Path]::GetFullPath($ResultsRoot)) ("TURING-" + $stamp)
$stableRoot = Join-Path $root "stable-smoke"
$fullCraigRoot = Join-Path $root "full-craig"
$recoveryRoot = Join-Path $root "recovery"
$share = Join-Path $root "SEND-THIS"
New-Item -ItemType Directory -Force -Path $stableRoot, $fullCraigRoot, $recoveryRoot, $share | Out-Null

$summaryPath = Join-Path $share "TURING-STABLE-ACCEPTANCE.json"
$passed = $false
$phase = "preflight"
$failureCode = $null
$trackCount = $null
$profileRuns = @()
$gateMetrics = @()

try {
    Write-Host "TDA QWEN TURING STABLE ACCEPTANCE" -ForegroundColor Cyan
    Write-Host "Experimental only: PASS does not automatically widen the official support matrix." -ForegroundColor Yellow

    $phase = "official_stable_smoke"
    $stableArgs = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $stableSmokeScript,
        "-BaseUrl", $Origin,
        "-ExpectedStableVersion", $ExpectedStableVersion,
        "-ExpectedWhisperRuntimeVersion", $ExpectedWhisperRuntimeVersion,
        "-ExpectedQwenRuntimeVersion", $ExpectedQwenRuntimeVersion,
        "-RequireGpuName", $RequireGpuName,
        "-Port", [string]$Port,
        "-ResultsRoot", $stableRoot
    )
    & $pwsh @stableArgs
    if ($LASTEXITCODE -ne 0) { Fail "OFFICIAL_STABLE_SMOKE_FAILED" }

    $stableRuns = @(Get-ChildItem -LiteralPath $stableRoot -Directory -Filter "STABLE-*" | Sort-Object Name -Descending)
    if ($stableRuns.Count -lt 1) { Fail "STABLE_SMOKE_HANDOFF_MISSING" }
    $stableRun = $stableRuns[0]
    $stableSummaryPath = Join-Path $stableRun.FullName "SEND-THIS\STABLE-SMOKE.json"
    $stableSummary = Read-Json $stableSummaryPath "STABLE_SMOKE_SUMMARY_INVALID"
    if (
        [string](Get-OptionalPropertyValue $stableSummary "schema") -ne "tda_processing_stable_smoke_v1" -or
        (Get-OptionalPropertyValue $stableSummary "pass") -ne $true
    ) { Fail "STABLE_SMOKE_NOT_PASS" }

    $downloads = Join-Path $stableRun.FullName "_private\downloads"
    $payloadManifest = Join-Path $downloads "TDACompanion-payload-manifest.json"
    $qwenCandidateManifest = Join-Path $downloads "qwen-stable-candidate.json"
    foreach ($path in @($payloadManifest, $qwenCandidateManifest)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "STABLE_PRIVATE_HANDOFF_MISSING" }
    }

    $companionExe = Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$ExpectedStableVersion\TDACompanion.exe"
    $qwenRuntimeRoot = Join-Path $env:LOCALAPPDATA "TDA\Runtime\qwen\$ExpectedQwenRuntimeVersion"
    if (-not (Test-Path -LiteralPath $companionExe -PathType Leaf)) { Fail "STABLE_COMPANION_EXE_MISSING" }
    if (-not (Test-Path -LiteralPath $qwenRuntimeRoot -PathType Container)) { Fail "STABLE_QWEN_RUNTIME_MISSING" }

    $phase = "full_craig_preflight"
    $health = Get-AgentHealth
    if ($null -eq $health) { Fail "STABLE_AGENT_NOT_READY" }
    $token = New-BrowserSession
    Assert-NoActiveUserWork $token

    $craig = Upload-Craig $token $CraigResolved
    $sourceId = [string](Get-OptionalPropertyValue $craig "source_id")
    $trackCountValue = Get-OptionalPropertyValue $craig "track_count"
    if ($sourceId -notmatch '^craig-[a-f0-9]{64}$' -or $null -eq $trackCountValue -or [int]$trackCountValue -lt 1) {
        Fail "CRAIG_INGEST_INVALID"
    }
    $trackCount = [int]$trackCountValue

    foreach ($profileId in @("qwen-fast", "qwen-quality")) {
        $phase = "prepare_" + $profileId
        [void](Ensure-ProfileReady $token $sourceId $profileId)
        $gateCopy = Join-Path $share ("physical-gate-" + $profileId + ".json")
        $gateMetrics += ,(Assert-TuringGate $profileId $gateCopy)

        $phase = "full_craig_" + $profileId
        $submitted = Submit-Transcription $token $sourceId $profileId
        $jobId = [string](Get-OptionalPropertyValue $submitted "id")
        if (-not $jobId) { Fail ("JOB_ID_MISSING:" + $profileId) }
        $terminal = Wait-JobSucceeded $token $jobId $profileId
        $job = Get-OptionalPropertyValue $terminal "job"
        $verified = Verify-ImmutableRun $token $sourceId $jobId $profileId $job
        $profileRuns += ,[ordered]@{
            profile_id = $profileId
            status = [string](Get-OptionalPropertyValue $verified "status")
            attempt = [int](Get-OptionalPropertyValue $verified "attempt")
            elapsed_seconds = [double](Get-OptionalPropertyValue $terminal "elapsed_seconds")
            immutable_run_verified = $true
        }
    }

    $phase = "crash_retry_recovery"
    $recoveryArgs = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $recoveryScript,
        "-CraigZip", $CraigResolved,
        "-CompanionExePath", $companionExe,
        "-CompanionPayloadManifest", $payloadManifest,
        "-QwenRuntimeCandidateManifest", $qwenCandidateManifest,
        "-QwenInstalledRuntimeRoot", $qwenRuntimeRoot,
        "-RequireGpuName", $RequireGpuName,
        "-Port", [string]$RecoveryPort,
        "-OutputRoot", $recoveryRoot
    )
    & $pwsh @recoveryArgs
    if ($LASTEXITCODE -ne 0) { Fail "QWEN_RECOVERY_GATE_FAILED" }

    $recoveryRuns = @(Get-ChildItem -LiteralPath $recoveryRoot -Directory -Filter "TDA-QWEN-GATE-EVIDENCE-*" | Sort-Object Name -Descending)
    if ($recoveryRuns.Count -lt 1) { Fail "QWEN_RECOVERY_EVIDENCE_MISSING" }
    $verdict = Read-Json (Join-Path $recoveryRuns[0].FullName "verdict.json") "QWEN_RECOVERY_VERDICT_INVALID"
    if (
        [string](Get-OptionalPropertyValue $verdict "verdict") -ne "PASS" -or
        [string](Get-OptionalPropertyValue $verdict "code") -ne "QWEN_PHYSICAL_RECOVERY_GATE_PASS"
    ) { Fail "QWEN_RECOVERY_NOT_PASS" }

    $passed = $true
    $phase = "complete"
} catch {
    $failureCode = [string]$_.Exception.Message
    if ($failureCode -notmatch '^[A-Z0-9_.:-]{1,200}$') {
        $failureCode = "TURING_STABLE_ACCEPTANCE_FAILED"
    }
    Write-Host ("TURING STABLE ACCEPTANCE FAILED phase={0} code={1}" -f $phase, $failureCode) -ForegroundColor Red
} finally {
    Write-Json $summaryPath ([ordered]@{
        schema = "tda_qwen_turing_stable_acceptance_v1"
        pass = $passed
        experimental = $true
        completed_at = [DateTimeOffset]::UtcNow.ToString("o")
        phase = $phase
        failure_code = $failureCode
        gpu_requirement = $RequireGpuName
        expected_compute_capability = $ExpectedComputeCapability
        gpu = [string]$gpuMatch[0]
        stable = [ordered]@{
            companion = $ExpectedStableVersion
            whisper_runtime = $ExpectedWhisperRuntimeVersion
            qwen_runtime = $ExpectedQwenRuntimeVersion
        }
        real_craig = [ordered]@{
            provided_locally = $true
            track_count = $trackCount
            path_recorded = $false
            content_recorded = $false
        }
        qwen_profiles = @($profileRuns)
        physical_gate_metrics = @($gateMetrics)
        recovery = [ordered]@{
            required = $true
            pass = $(if ($passed) { $true } else { $null })
            checkpoint_reuse_required = $true
            immutable_run_required = $true
        }
        contains_audio = $false
        contains_transcript = $false
        contains_token = $false
        contains_local_paths = $false
    })

    Write-EvidenceManifest $share
    $zipPath = $share + ".zip"
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $share "*") -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host ("Sanitized evidence: " + $zipPath) -ForegroundColor Cyan
}

if ($passed) {
    Write-Host "TDA QWEN TURING STABLE ACCEPTANCE: PASS (experimental evidence only)" -ForegroundColor Green
    exit 0
}
exit 1
