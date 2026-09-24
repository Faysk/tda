[CmdletBinding()]
param(
    [string]$CraigZip = "",
    # Final release acceptance passes the exact RC bytes already installed and
    # verified by run-final-current-source-acceptance.ps1. This avoids testing a
    # superseded PR Actions artifact and avoids downloading the multi-GB Qwen
    # bundle twice.
    [string]$CompanionExePath = "",
    [string]$CompanionPayloadManifest = "",
    [string]$QwenRuntimeCandidateManifest = "",
    [string]$QwenInstalledRuntimeRoot = "",
    # Legacy PR-artifact mode remains available for development-only gates.
    [string]$PrHeadSha = "",
    [string]$TestedMergeSha = "",
    [string]$SourceTreeSha = "",
    [long]$CompanionWorkflowRunId = 0,
    [long]$CompanionArtifactId = 0,
    [long]$CompanionArtifactSize = 0,
    [string]$CompanionArtifactSha256 = "",
    [long]$QwenWorkflowRunId = 0,
    [long]$QwenArtifactId = 0,
    [long]$QwenArtifactSize = 0,
    [string]$QwenArtifactSha256 = "",
    [string]$QwenRuntimeVersion = "",
    [string]$QwenRuntimeArchiveSha256 = "",
    [string]$RequireGpuName = "RTX 4070",
    [ValidateRange(1024, 65535)][int]$Port = 18765,
    [string]$Repository = "Faysk/tda",
    [string]$Origin = "https://dnd.faysk.dev",
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PackSchema = "tda_qwen_recovery_physical_gate_v1"
$StartedAt = [DateTimeOffset]::UtcNow
$OriginalLocalAppData = [string]$env:LOCALAPPDATA
$AgentProcess = $null
$PairingToken = ""
$SourceId = ""
$QualityJobId = ""
$FastJobId = ""
$CraigResolved = ""
$CraigInput = ""
$EventSeen = @{}
$EventCollectors = @{}
$Verdict = "HARNESS_FAILED"
$VerdictCode = "HARNESS_UNCLASSIFIED"

function Fail-Harness([string]$Code) { throw [InvalidOperationException]::new("HARNESS_FAILED:$Code") }
function Fail-Product([string]$Code) { throw [InvalidOperationException]::new("PRODUCT_FAILED:$Code") }
function Fail-Blocked([string]$Code) { throw [InvalidOperationException]::new("BLOCKED:$Code") }

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-Json([string]$Path, [object]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $temporary = "$Path.partial"
    $Value | ConvertTo-Json -Depth 64 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Read-Json([string]$Path, [string]$Code) {
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64 }
    catch { Fail-Harness $Code }
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

function Get-RequiredProductPropertyValue([object]$Object, [string]$Name, [string]$Code) {
    $value = Get-OptionalPropertyValue $Object $Name
    if ($null -eq $value) { Fail-Product $Code }
    return $value
}

function Get-RequiredHarnessPropertyValue([object]$Object, [string]$Name, [string]$Code) {
    $value = Get-OptionalPropertyValue $Object $Name
    if ($null -eq $value) { Fail-Harness $Code }
    return $value
}

function Get-GhJson([string]$Path, [string]$Code) {
    $raw = & gh api $Path 2>&1
    if ($LASTEXITCODE -ne 0) { Fail-Harness $Code }
    try { return ($raw | Out-String) | ConvertFrom-Json -Depth 64 }
    catch { Fail-Harness $Code }
}

function Assert-HexSha([string]$Value, [string]$Code) {
    if ($Value.ToLowerInvariant() -notmatch '^[a-f0-9]{40}$') { Fail-Harness $Code }
}

function Assert-HexSha256([string]$Value, [string]$Code) {
    if ($Value.ToLowerInvariant() -notmatch '^[a-f0-9]{64}$') { Fail-Harness $Code }
}

function Assert-WorkflowArtifact(
    [long]$WorkflowRunId,
    [long]$ArtifactId,
    [string]$ExpectedName,
    [long]$ExpectedSize,
    [string]$ExpectedDigest
) {
    $run = Get-GhJson "repos/$Repository/actions/runs/$WorkflowRunId" "WORKFLOW_RUN_LOOKUP_FAILED"
    if ([long]$run.id -ne $WorkflowRunId) { Fail-Harness "WORKFLOW_RUN_ID_MISMATCH" }
    if ([string]$run.status -ne "completed" -or [string]$run.conclusion -ne "success") {
        Fail-Blocked "WORKFLOW_RUN_NOT_SUCCESSFUL:$WorkflowRunId"
    }
    if ([string]$run.event -ne "pull_request") { Fail-Harness "WORKFLOW_RUN_EVENT_INVALID:$WorkflowRunId" }
    if ([string]$run.head_sha -ne $PrHeadSha) { Fail-Harness "WORKFLOW_RUN_HEAD_MISMATCH:$WorkflowRunId" }

    $collection = Get-GhJson "repos/$Repository/actions/runs/$WorkflowRunId/artifacts?per_page=100" "WORKFLOW_ARTIFACT_LIST_FAILED"
    $artifactMatches = @($collection.artifacts | Where-Object { [long]$_.id -eq $ArtifactId })
    if ($artifactMatches.Count -ne 1) { Fail-Harness ("ARTIFACT_NOT_BOUND_TO_WORKFLOW:{0}:{1}" -f $WorkflowRunId, $ArtifactId) }
    $value = $artifactMatches[0]
    if ([string]$value.name -ne $ExpectedName) { Fail-Harness "ARTIFACT_NAME_MISMATCH" }
    if ([long]$value.size_in_bytes -ne $ExpectedSize) { Fail-Harness "ARTIFACT_SIZE_METADATA_MISMATCH" }
    if ([string]$value.digest -ne "sha256:$ExpectedDigest") { Fail-Harness "ARTIFACT_DIGEST_METADATA_MISMATCH" }
    if ($value.expired -eq $true) { Fail-Blocked "ARTIFACT_EXPIRED" }
    return [ordered]@{
        workflow_run_id = $WorkflowRunId
        workflow_name = [string]$run.name
        workflow_event = [string]$run.event
        workflow_head_sha = [string]$run.head_sha
        id = $ArtifactId
        name = $ExpectedName
        size = $ExpectedSize
        digest = "sha256:$ExpectedDigest"
        created_at = [string]$value.created_at
        expires_at = [string]$value.expires_at
    }
}

function Assert-GatePortFree {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) { Fail-Blocked "GATE_PORT_IN_USE:$Port" }
}

function Copy-IsolatedQwenModels([string]$SourceRoot, [string]$DestinationRoot, [string]$ScratchPath) {
    $directories = @(
        "qwen3-asr-0.6b-hf",
        "qwen3-asr-1.7b-hf",
        "qwen3-forced-aligner-0.6b-hf"
    )
    $sources = [Collections.Generic.List[object]]::new()
    [long]$modelBytes = 0
    foreach ($name in $directories) {
        $source = Join-Path $SourceRoot $name
        if (-not (Test-Path -LiteralPath $source -PathType Container)) {
            Fail-Blocked "QWEN_MODEL_DIRECTORY_MISSING:$name"
        }
        $marker = Join-Path $source ".tda-model.json"
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
            Fail-Blocked "QWEN_MODEL_MARKER_MISSING:$name"
        }
        $bytes = [long](Get-ChildItem -LiteralPath $source -File -Recurse -Force | Measure-Object -Property Length -Sum).Sum
        if ($bytes -le 0) { Fail-Blocked "QWEN_MODEL_DIRECTORY_EMPTY:$name" }
        $modelBytes += $bytes
        $sources.Add([ordered]@{ name = $name; path = $source; bytes = $bytes })
    }

    $root = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($ScratchPath))
    $drive = [IO.DriveInfo]::new($root)
    [long]$runtimeScratchBytes = if ($ExactRcMode) {
        # One isolated copy of the already accepted runtime; there is no second
        # Actions-artifact download/extract in exact-RC mode.
        $QwenArtifactSize + $CompanionArtifactSize
    } else {
        ($QwenArtifactSize * 3L) + ($CompanionArtifactSize * 2L)
    }
    [long]$requiredFree = $modelBytes + $runtimeScratchBytes + 2GB
    if ([long]$drive.AvailableFreeSpace -lt $requiredFree) {
        Fail-Blocked "SCRATCH_DISK_SPACE_INSUFFICIENT"
    }

    New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
    foreach ($row in $sources) {
        Write-Host ("Copying isolated model {0} ({1:N2} GB)..." -f $row.name, ($row.bytes / 1GB)) -ForegroundColor DarkCyan
        Copy-Item -LiteralPath $row.path -Destination $DestinationRoot -Recurse -Force -ErrorAction Stop
        $copied = Join-Path $DestinationRoot $row.name
        if (-not (Test-Path -LiteralPath $copied -PathType Container)) { Fail-Harness "QWEN_MODEL_COPY_MISSING:$($row.name)" }
        if (((Get-Item -LiteralPath $copied -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Fail-Harness "QWEN_MODEL_COPY_REPARSE_POINT:$($row.name)"
        }
    }
    return [ordered]@{ model_bytes = $modelBytes; required_free_bytes = $requiredFree; free_bytes_before = [long]$drive.AvailableFreeSpace }
}

function Download-ArtifactZip([long]$ArtifactId, [long]$ExpectedSize, [string]$ExpectedDigest, [string]$Destination) {
    Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    & gh api "repos/$Repository/actions/artifacts/$ArtifactId/zip" > $Destination
    if ($LASTEXITCODE -ne 0) { Fail-Harness "ARTIFACT_DOWNLOAD_FAILED:$ArtifactId" }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { Fail-Harness "ARTIFACT_DOWNLOAD_MISSING:$ArtifactId" }
    $item = Get-Item -LiteralPath $Destination
    if ([long]$item.Length -ne $ExpectedSize) { Fail-Harness "ARTIFACT_DOWNLOAD_SIZE_MISMATCH:$ArtifactId" }
    if ((Get-Sha256 $Destination) -ne $ExpectedDigest) { Fail-Harness "ARTIFACT_DOWNLOAD_HASH_MISMATCH:$ArtifactId" }
}

function Sanitize-Job([object]$Job) {
    if ($null -eq $Job) { return $null }
    $attempt = Get-OptionalPropertyValue $Job "attempt"
    $resultAvailable = Get-OptionalPropertyValue $Job "result_available"
    return [ordered]@{
        id = [string](Get-OptionalPropertyValue $Job "id")
        kind = [string](Get-OptionalPropertyValue $Job "kind")
        status = [string](Get-OptionalPropertyValue $Job "status")
        stage = [string](Get-OptionalPropertyValue $Job "stage")
        attempt = $(if ($null -eq $attempt) { $null } else { [int]$attempt })
        progress = Get-OptionalPropertyValue $Job "progress"
        error = Get-OptionalPropertyValue $Job "error"
        result_available = $(if ($null -eq $resultAvailable) { $null } else { [bool]$resultAvailable })
        updated_at = [string](Get-OptionalPropertyValue $Job "updated_at")
    }
}

function Sanitize-Event([object]$Event) {
    if ($null -eq $Event) { Fail-Product "JOB_EVENT_NULL" }
    $sequence = Get-RequiredProductPropertyValue $Event "seq" "JOB_EVENT_SEQ_MISSING"
    $code = Get-RequiredProductPropertyValue $Event "code" "JOB_EVENT_CODE_MISSING"
    $allowed = @("stage", "track", "total_tracks", "window", "attempt", "profile_id", "forced", "fence", "reason")
    $data = [ordered]@{}
    $sourceData = Get-OptionalPropertyValue $Event "data"
    if ($null -ne $sourceData) {
        foreach ($name in $allowed) {
            $value = Get-OptionalPropertyValue $sourceData $name
            if ($null -ne $value) { $data[$name] = $value }
        }
    }
    return [ordered]@{
        seq = [int]$sequence
        code = [string]$code
        at = [string](Get-OptionalPropertyValue $Event "at")
        level = [string](Get-OptionalPropertyValue $Event "level")
        data = $data
    }
}

function Get-MaxEventSequence([object[]]$Events) {
    [int]$maximum = 0
    foreach ($event in @($Events)) {
        if ($null -eq $event) { continue }
        $rawSequence = Get-OptionalPropertyValue $event "seq"
        if ($null -eq $rawSequence) { Fail-Harness "SANITIZED_EVENT_SEQ_MISSING" }
        [int]$sequence = [int]$rawSequence
        if ($sequence -gt $maximum) { $maximum = $sequence }
    }
    return $maximum
}

function Sanitize-LogRow([object]$Row) {
    $context = [ordered]@{}
    $sourceContext = Get-OptionalPropertyValue $Row "context"
    foreach ($name in @("job_id", "attempt", "profile_id", "stage", "error_code")) {
        $value = Get-OptionalPropertyValue $sourceContext $name
        if ($null -ne $value) { $context[$name] = $value }
    }
    return [ordered]@{
        at = [string](Get-OptionalPropertyValue $Row "at")
        level = [string](Get-OptionalPropertyValue $Row "level")
        component = [string](Get-OptionalPropertyValue $Row "component")
        code = [string](Get-OptionalPropertyValue $Row "code")
        message = [string](Get-OptionalPropertyValue $Row "message")
        context = $context
    }
}

function Get-PairingToken {
    $path = Join-Path $env:LOCALAPPDATA "TDA\State\pairing-token.txt"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail-Harness "PAIRING_TOKEN_FILE_MISSING" }
    $value = (Get-Content -LiteralPath $path -Raw -Encoding UTF8).Trim()
    if ($value.Length -lt 43) { Fail-Harness "PAIRING_TOKEN_INVALID" }
    return $value
}

function Invoke-AgentJson([string]$Method, [string]$Path, [object]$Body = $null, [int]$TimeoutSec = 30) {
    $headers = @{ Authorization = "Bearer $PairingToken"; Accept = "application/json"; Origin = $Origin }
    $params = @{
        NoProxy = $true
        Method = $Method
        Uri = "http://127.0.0.1:$Port/api/v1$Path"
        Headers = $headers
        TimeoutSec = $TimeoutSec
    }
    # The Agent requires every POST to carry application/json, including
    # action endpoints whose logical payload is empty (cancel/retry).
    if ($Method -eq "POST" -and $null -eq $Body) {
        $Body = [ordered]@{}
    }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 16 -Compress)
    }
    try { return Invoke-RestMethod @params }
    catch {
        $detail = [string]$_.ErrorDetails.Message
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') { Fail-Product ("API_" + $Matches[1]) }
        Fail-Product "AGENT_API_UNAVAILABLE"
    }
}

function Upload-Craig([string]$Path) {
    $headers = @{ Authorization = "Bearer $PairingToken"; Accept = "application/json"; Origin = $Origin }
    try {
        $response = Invoke-WebRequest -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/sources/craig" -Headers $headers -ContentType "application/zip" -InFile $Path -TimeoutSec 900
        return $response.Content | ConvertFrom-Json -Depth 32
    } catch {
        $detail = [string]$_.ErrorDetails.Message
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') { Fail-Product ("CRAIG_" + $Matches[1]) }
        Fail-Product "CRAIG_UPLOAD_TRANSPORT_FAILED"
    }
}

function Wait-AgentHealth([int]$TimeoutSeconds = 90) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    $last = $null
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        try {
            $last = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
            if ([string]$last.product_id -eq "tda-companion" -and [string]$last.api_version -eq "1" -and [string]$last.lifecycle -eq "ready") { return $last }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    Fail-Product "AGENT_START_TIMEOUT"
}

function Start-GateAgent([string]$Executable) {
    $agentArguments = @("--headless", "--port", [string]$Port, "--origin", $Origin)
    $process = Start-Process -FilePath $Executable -ArgumentList $agentArguments -PassThru -WindowStyle Hidden
    $health = Wait-AgentHealth 90
    if ([int]$health.pid -ne [int]$process.Id) {
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
        Fail-Product "AGENT_PORT_OWNERSHIP_MISMATCH"
    }
    return $process
}

function Stop-ProcessTree([int]$ProcessId) {
    if ($ProcessId -le 0) { return }
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    Start-Sleep -Milliseconds 500
}

function Capture-Events([string]$JobId) {
    if (-not $EventSeen.ContainsKey($JobId)) { $EventSeen[$JobId] = @{} }
    if (-not $EventCollectors.ContainsKey($JobId)) { $EventCollectors[$JobId] = [Collections.Generic.List[object]]::new() }
    $value = Invoke-AgentJson "GET" "/jobs/$JobId/events"
    $rawEvents = Get-OptionalPropertyValue $value "events"
    if ($null -eq $rawEvents) { Fail-Product "JOB_EVENTS_RESPONSE_INVALID" }
    foreach ($event in @($rawEvents | Sort-Object { [int](Get-RequiredProductPropertyValue $_ "seq" "JOB_EVENT_SEQ_MISSING") })) {
        $key = [string](Get-RequiredProductPropertyValue $event "seq" "JOB_EVENT_SEQ_MISSING")
        if (-not $EventSeen[$JobId].ContainsKey($key)) {
            $EventSeen[$JobId][$key] = $true
            $EventCollectors[$JobId].Add((Sanitize-Event $event))
        }
    }
    return @($EventCollectors[$JobId])
}

function Get-Job([string]$JobId) { return Invoke-AgentJson "GET" "/jobs/$JobId" }

function Save-JobEvidence([string]$JobId, [string]$Name, [string]$EvidenceRoot) {
    if (-not $JobId) { return }
    try { Write-Json (Join-Path $EvidenceRoot "$Name-job.json") (Sanitize-Job (Get-Job $JobId)) } catch {}
    try { Write-Json (Join-Path $EvidenceRoot "$Name-events.json") @(Capture-Events $JobId) } catch {}
}

function Save-Logs([string]$EvidenceRoot) {
    try {
        $value = Invoke-AgentJson "GET" "/logs"
        $rows = @($value.logs)
        $sanitized = @($rows | Select-Object -Last 100 | ForEach-Object { Sanitize-LogRow $_ })
        Write-Json (Join-Path $EvidenceRoot "agent-log-tail.json") $sanitized
    } catch {}
}

function Wait-Preparation([string]$Source, [string]$ProfileId, [int]$TimeoutSeconds = 2400) {
    $started = Invoke-AgentJson "POST" "/preparation" @{ source_id = $Source; profile_id = $ProfileId }
    if ([string]$started.profile_id -ne $ProfileId -or [string]$started.source_id -ne $Source) { Fail-Product "PREPARATION_START_IDENTITY_INVALID:$ProfileId" }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $state = Invoke-AgentJson "GET" "/preparation"
        if ([string]$state.profile_id -ne $ProfileId) { Fail-Product "PREPARATION_PROFILE_DRIFT:$ProfileId" }
        if ([string]$state.state -eq "completed") { return $state }
        if ([string]$state.state -eq "failed") { Fail-Product ("PREPARATION_" + [string]$state.error_code + ":" + $ProfileId) }
        Start-Sleep -Seconds 1
    }
    Fail-Product "PREPARATION_TIMEOUT:$ProfileId"
}

function Submit-Transcription([string]$Source, [string]$ProfileId) {
    $key = "gate-$ProfileId-" + [Guid]::NewGuid().ToString("N")
    $headers = @{ Authorization = "Bearer $PairingToken"; Accept = "application/json"; Origin = $Origin; "Idempotency-Key" = $key }
    $body = @{
        kind = "transcription.craig"
        campaign_id = "physical-gate"
        session_id = ("gate-" + $ProfileId)
        source_id = $Source
        profile_id = $ProfileId
        glossary = ""
        context = ""
        cpu = $false
    } | ConvertTo-Json -Compress
    try {
        return Invoke-RestMethod -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/jobs" -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 30
    } catch {
        $detail = [string]$_.ErrorDetails.Message
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') { Fail-Product ("JOB_SUBMIT_" + $Matches[1] + ":" + $ProfileId) }
        throw
    }
}

function Wait-ForEvent([string]$JobId, [string]$Code, [Nullable[int]]$Track, [int]$TimeoutSeconds) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $job = Get-Job $JobId
        $events = Capture-Events $JobId
        $match = @($events | Where-Object {
            $eventCode = [string](Get-OptionalPropertyValue $_ "code")
            $eventData = Get-OptionalPropertyValue $_ "data"
            $eventTrack = Get-OptionalPropertyValue $eventData "track"
            $eventCode -eq $Code -and ($null -eq $Track -or ($null -ne $eventTrack -and [int]$eventTrack -eq [int]$Track))
        } | Select-Object -Last 1)
        if ($match.Count -gt 0) { return $match[0] }
        if ([string]$job.status -in @("succeeded", "failed", "interrupted", "cancelled")) {
            $errorCode = if ($null -ne $job.error) { [string]$job.error.code } else { "none" }
            Fail-Product ("JOB_TERMINAL_BEFORE_EVENT:{0}:{1}:{2}" -f $Code, [string]$job.status, $errorCode)
        }
        Start-Sleep -Milliseconds 750
    }
    Fail-Product "JOB_EVENT_TIMEOUT:$Code"
}

function Wait-Terminal([string]$JobId, [string[]]$Allowed, [int]$TimeoutSeconds) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $job = Get-Job $JobId
        [void](Capture-Events $JobId)
        if ([string]$job.status -in @("succeeded", "failed", "interrupted", "cancelled")) {
            if ([string]$job.status -notin $Allowed) {
                $errorCode = if ($null -ne $job.error) { [string]$job.error.code } else { "none" }
                Fail-Product "JOB_TERMINAL_UNEXPECTED:$($job.status):$errorCode"
            }
            return $job
        }
        Start-Sleep -Seconds 1
    }
    Fail-Product "JOB_TERMINAL_TIMEOUT"
}

function Wait-QwenWorkersGone([string]$ScratchPrefix, [int]$TimeoutSeconds = 20) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $rows = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $path = [string]$_.ExecutablePath
            $path -and $path.StartsWith($ScratchPrefix, [StringComparison]::OrdinalIgnoreCase) -and $path -match 'Qwen'
        })
        if ($rows.Count -eq 0) { return }
        Start-Sleep -Milliseconds 500
    }
    Fail-Product "QWEN_WORKER_NOT_STOPPED"
}

function Write-EvidenceManifest([string]$EvidenceRoot) {
    $entries = [Collections.Generic.List[object]]::new()
    foreach ($file in Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse | Sort-Object FullName) {
        if ($file.Name -eq "manifest.json") { continue }
        $relative = [IO.Path]::GetRelativePath($EvidenceRoot, $file.FullName).Replace('\\', '/')
        $entries.Add([ordered]@{ path = $relative; size = [long]$file.Length; sha256 = Get-Sha256 $file.FullName })
    }
    Write-Json (Join-Path $EvidenceRoot "manifest.json") ([ordered]@{ schema = "tda_qwen_gate_evidence_manifest_v1"; files = @($entries) })
}

function Assert-NoEvidenceLeak([string]$EvidenceRoot, [string]$SecretToken, [string]$PrivatePath) {
    $privateName = [IO.Path]::GetFileName($PrivatePath)
    foreach ($file in Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse) {
        if ($file.Extension -notin @(".json", ".txt")) { continue }
        $text = [string](Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue)
        if ($SecretToken -and $text.Contains($SecretToken)) { Fail-Harness "EVIDENCE_PAIRING_TOKEN_LEAK" }
        if ($privateName -and $text.Contains($privateName)) { Fail-Harness "EVIDENCE_PRIVATE_FILENAME_LEAK" }
    }
}

$ExactRcValues = @(
    $CompanionExePath,
    $CompanionPayloadManifest,
    $QwenRuntimeCandidateManifest,
    $QwenInstalledRuntimeRoot
)
$ExactRcProvided = @($ExactRcValues | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count
$ExactRcMode = $ExactRcProvided -eq $ExactRcValues.Count
if ($ExactRcProvided -gt 0 -and -not $ExactRcMode) { Fail-Harness "EXACT_RC_INPUTS_INCOMPLETE" }

$CompanionPayload = $null
$QwenCandidate = $null
$CompanionExeResolved = ""
$QwenInstalledRuntimeResolved = ""
if ($ExactRcMode) {
    try {
        $CompanionExeResolved = (Resolve-Path -LiteralPath $CompanionExePath -ErrorAction Stop).Path
        $CompanionPayloadManifest = (Resolve-Path -LiteralPath $CompanionPayloadManifest -ErrorAction Stop).Path
        $QwenRuntimeCandidateManifest = (Resolve-Path -LiteralPath $QwenRuntimeCandidateManifest -ErrorAction Stop).Path
        $QwenInstalledRuntimeResolved = (Resolve-Path -LiteralPath $QwenInstalledRuntimeRoot -ErrorAction Stop).Path
    } catch {
        Fail-Harness "EXACT_RC_INPUT_PATH_MISSING"
    }
    if (-not (Test-Path -LiteralPath $CompanionExeResolved -PathType Leaf)) { Fail-Harness "EXACT_RC_COMPANION_EXE_MISSING" }
    if (-not (Test-Path -LiteralPath $QwenInstalledRuntimeResolved -PathType Container)) { Fail-Harness "EXACT_RC_QWEN_RUNTIME_MISSING" }

    $CompanionPayload = Read-Json $CompanionPayloadManifest "EXACT_RC_PAYLOAD_INVALID"
    $QwenCandidate = Read-Json $QwenRuntimeCandidateManifest "EXACT_RC_QWEN_CANDIDATE_INVALID"
    if (
        [string]$CompanionPayload.schema -ne "tda_companion_payload_v1" -or
        [string]$CompanionPayload.version -ne "0.3.14" -or
        [string]$CompanionPayload.source_sha -notmatch '^[a-f0-9]{40}$' -or
        [string]$CompanionPayload.source_tree_sha -notmatch '^[a-f0-9]{40}$'
    ) { Fail-Harness "EXACT_RC_PAYLOAD_IDENTITY_INVALID" }
    $exeMeta = $CompanionPayload.files.'TDACompanion.exe'
    if ($null -eq $exeMeta -or [string]$exeMeta.sha256 -notmatch '^[a-f0-9]{64}$') {
        Fail-Harness "EXACT_RC_COMPANION_EXE_IDENTITY_MISSING"
    }
    if ((Get-Sha256 $CompanionExeResolved) -ne [string]$exeMeta.sha256) {
        Fail-Harness "EXACT_RC_COMPANION_EXE_HASH_MISMATCH"
    }

    if (
        [string]$QwenCandidate.schema -ne "tda_runtime_candidate_v1" -or
        [string]$QwenCandidate.family -ne "qwen" -or
        [string]$QwenCandidate.runtime_id -ne "qwen3-transformers" -or
        [string]$QwenCandidate.platform -ne "windows-x64" -or
        [string]$QwenCandidate.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
        [string]$QwenCandidate.candidate_tag -notmatch '^companion-qwen-runtime-rc-v' -or
        [string]$QwenCandidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
        [string]$QwenCandidate.source_tree_sha -notmatch '^[a-f0-9]{40}$' -or
        [string]$QwenCandidate.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}$'
    ) { Fail-Harness "EXACT_RC_QWEN_CANDIDATE_IDENTITY_INVALID" }

    $QwenRuntimeVersion = [string]$QwenCandidate.version
    $QwenRuntimeArchiveSha256 = [string]$QwenCandidate.runtime_archive_sha256
    if ([IO.Path]::GetFileName($QwenInstalledRuntimeResolved) -ne $QwenRuntimeVersion) {
        Fail-Harness "EXACT_RC_QWEN_RUNTIME_PATH_VERSION_MISMATCH"
    }
    $installedMarkerPath = Join-Path $QwenInstalledRuntimeResolved ".tda-runtime.json"
    $installedMarker = Read-Json $installedMarkerPath "EXACT_RC_QWEN_RUNTIME_MARKER_INVALID"
    $installedWorker = Join-Path $QwenInstalledRuntimeResolved "TDAQwenWorker.exe"
    if (
        [string]$installedMarker.schema -ne "tda_asr_runtime_v1" -or
        [string]$installedMarker.runtime_id -ne "qwen3-transformers" -or
        [string]$installedMarker.version -ne $QwenRuntimeVersion -or
        [string]$installedMarker.archive_sha256 -ne $QwenRuntimeArchiveSha256 -or
        [string]$installedMarker.worker_sha256 -notmatch '^[a-f0-9]{64}$' -or
        -not (Test-Path -LiteralPath $installedWorker -PathType Leaf) -or
        (Get-Sha256 $installedWorker) -ne [string]$installedMarker.worker_sha256
    ) { Fail-Harness "EXACT_RC_QWEN_RUNTIME_IDENTITY_MISMATCH" }

    $CompanionArtifactSize = [long](Get-Item -LiteralPath $CompanionExeResolved).Length
    $QwenArtifactSize = [long](Get-ChildItem -LiteralPath $QwenInstalledRuntimeResolved -File -Recurse -Force | Measure-Object -Property Length -Sum).Sum
} else {
    Assert-HexSha $PrHeadSha "PR_HEAD_SHA_INVALID"
    Assert-HexSha $TestedMergeSha "MERGE_SHA_INVALID"
    Assert-HexSha $SourceTreeSha "TREE_SHA_INVALID"
    Assert-HexSha256 $CompanionArtifactSha256 "COMPANION_ARTIFACT_SHA_INVALID"
    Assert-HexSha256 $QwenArtifactSha256 "QWEN_ARTIFACT_SHA_INVALID"
    Assert-HexSha256 $QwenRuntimeArchiveSha256 "QWEN_RUNTIME_ARCHIVE_SHA_INVALID"
    if ($QwenRuntimeVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { Fail-Harness "QWEN_RUNTIME_VERSION_INVALID" }
}
if ($Repository -ne "Faysk/tda") { Fail-Harness "REPOSITORY_INVALID" }
if ($Origin -ne "https://dnd.faysk.dev") { Fail-Harness "ORIGIN_INVALID" }
if (-not $OriginalLocalAppData) { Fail-Blocked "LOCALAPPDATA_NOT_FOUND" }
if ($PSVersionTable.PSVersion -lt [Version]"7.4") { Fail-Blocked "POWERSHELL_7_4_REQUIRED" }
if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) { Fail-Blocked "GH_CLI_REQUIRED" }
if ($null -eq (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { Fail-Blocked "NVIDIA_SMI_REQUIRED" }
& gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { Fail-Blocked "GH_AUTH_REQUIRED" }

$OutputBase = if ($OutputRoot) { [IO.Path]::GetFullPath($OutputRoot) } else { Join-Path $PSScriptRoot "results" }
New-Item -ItemType Directory -Force -Path $OutputBase | Out-Null
$RunStamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
$EvidenceRoot = Join-Path $OutputBase "TDA-QWEN-GATE-EVIDENCE-$RunStamp"
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
$ScratchRoot = Join-Path $env:TEMP ("TDA-QWEN-GATE-" + $RunStamp)
$ScratchLocal = Join-Path $ScratchRoot "LocalAppData"
$Downloads = Join-Path $ScratchRoot "downloads"
$CompanionExtract = Join-Path $ScratchRoot "companion-artifact"
$CompanionPortable = Join-Path $ScratchRoot "companion-portable"
$QwenZip = Join-Path $Downloads "qwen-actions-artifact.zip"
$CompanionZip = Join-Path $Downloads "companion-actions-artifact.zip"
New-Item -ItemType Directory -Force -Path $ScratchLocal, $Downloads, $CompanionExtract, $CompanionPortable | Out-Null

try {
    if ($CraigZip) {
        $CraigResolved = (Resolve-Path -LiteralPath $CraigZip -ErrorAction Stop).Path
        if ([IO.Path]::GetExtension($CraigResolved).ToLowerInvariant() -ne ".zip") {
            Fail-Blocked "CRAIG_ZIP_REQUIRED"
        }
        $CraigInput = "provided"
    } else {
        $fixtureScript = Join-Path $PSScriptRoot "generate-physical-acceptance-fixture.ps1"
        if (-not (Test-Path -LiteralPath $fixtureScript -PathType Leaf)) {
            Fail-Harness "SYNTHETIC_CRAIG_GENERATOR_MISSING"
        }
        $fixtureRoot = Join-Path $ScratchRoot "synthetic-craig"
        try {
            & $fixtureScript -OutputRoot $fixtureRoot -TargetSeconds 80 -CraigTrackCount 2
        } catch {
            Fail-Harness "SYNTHETIC_CRAIG_GENERATION_FAILED"
        }
        $fixtureMetadataPath = Join-Path $fixtureRoot "fixture.json"
        $fixtureMetadata = Read-Json $fixtureMetadataPath "SYNTHETIC_CRAIG_METADATA_INVALID"
        if ($fixtureMetadata.synthetic -ne $true -or [int]$fixtureMetadata.craig.track_count -lt 2) {
            Fail-Harness "SYNTHETIC_CRAIG_CONTRACT_INVALID"
        }
        $CraigResolved = (Resolve-Path -LiteralPath (Join-Path $fixtureRoot "tda-installed-acceptance-craig.zip") -ErrorAction Stop).Path
        if ((Get-Sha256 $CraigResolved) -ne [string]$fixtureMetadata.craig.sha256) {
            Fail-Harness "SYNTHETIC_CRAIG_HASH_MISMATCH"
        }
        $CraigInput = "generated_synthetic"
    }

    if ($ExactRcMode) {
        $companionMeta = [ordered]@{
            input_mode = "exact_installed_rc"
            version = [string]$CompanionPayload.version
            source_sha = [string]$CompanionPayload.source_sha
            source_tree_sha = [string]$CompanionPayload.source_tree_sha
            executable_sha256 = Get-Sha256 $CompanionExeResolved
        }
        $qwenMeta = [ordered]@{
            input_mode = "exact_installed_rc"
            candidate_tag = [string]$QwenCandidate.candidate_tag
            version = [string]$QwenCandidate.version
            source_sha = [string]$QwenCandidate.source_sha
            source_tree_sha = [string]$QwenCandidate.source_tree_sha
            runtime_archive_sha256 = [string]$QwenCandidate.runtime_archive_sha256
        }
    } else {
        $head = Get-GhJson "repos/$Repository/commits/$PrHeadSha" "PR_HEAD_LOOKUP_FAILED"
        $merge = Get-GhJson "repos/$Repository/commits/$TestedMergeSha" "MERGE_LOOKUP_FAILED"
        if ([string]$head.commit.tree.sha -ne $SourceTreeSha) { Fail-Harness "PR_HEAD_TREE_MISMATCH" }
        if ([string]$merge.commit.tree.sha -ne $SourceTreeSha) { Fail-Harness "MERGE_TREE_MISMATCH" }
        if (@($merge.parents | Where-Object { [string]$_.sha -eq $PrHeadSha }).Count -ne 1) { Fail-Harness "MERGE_PARENT_HEAD_MISSING" }

        $companionMeta = Assert-WorkflowArtifact $CompanionWorkflowRunId $CompanionArtifactId "TDACompanion-windows-x64" $CompanionArtifactSize $CompanionArtifactSha256
        $qwenMeta = Assert-WorkflowArtifact $QwenWorkflowRunId $QwenArtifactId "TDAQwenRuntimeBundle-windows-x64" $QwenArtifactSize $QwenArtifactSha256
    }

    Assert-GatePortFree

    $gpuRaw = @(& nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits 2>$null)
    if ($LASTEXITCODE -ne 0 -or $gpuRaw.Count -eq 0) { Fail-Blocked "NVIDIA_GPU_QUERY_FAILED" }
    if (@($gpuRaw | Where-Object { $_ -like "*$RequireGpuName*" }).Count -eq 0) { Fail-Blocked "REQUIRED_GPU_NOT_FOUND" }

    Write-Json (Join-Path $EvidenceRoot "identity.json") ([ordered]@{
        schema = $PackSchema
        input_mode = $(if ($ExactRcMode) { "exact_installed_rc" } else { "legacy_pr_artifact" })
        pr_head_sha = $(if ($ExactRcMode) { $null } else { $PrHeadSha })
        tested_merge_sha = $(if ($ExactRcMode) { $null } else { $TestedMergeSha })
        source_tree_sha = $(if ($ExactRcMode) { [string]$CompanionPayload.source_tree_sha } else { $SourceTreeSha })
        companion_artifact = $companionMeta
        qwen_artifact = $qwenMeta
        qwen_runtime_version = $QwenRuntimeVersion
        qwen_runtime_archive_sha256 = $QwenRuntimeArchiveSha256
        required_gpu_name = $RequireGpuName
        craig_input = $CraigInput
        port = $Port
    })
    Write-Json (Join-Path $EvidenceRoot "environment.json") ([ordered]@{
        windows = [Environment]::OSVersion.VersionString
        powershell = $PSVersionTable.PSVersion.ToString()
        gpu = @($gpuRaw)
    })

    if ($ExactRcMode) {
        Write-Host "Reusing exact installed Companion RC and Qwen Runtime RC bytes..." -ForegroundColor Cyan
        $CompanionExe = $CompanionExeResolved
    } else {
        Write-Host "Downloading exact Companion artifact $CompanionArtifactId..." -ForegroundColor Cyan
        Download-ArtifactZip $CompanionArtifactId $CompanionArtifactSize $CompanionArtifactSha256 $CompanionZip
        Write-Host "Downloading exact Qwen artifact $QwenArtifactId (~2.7 GB)..." -ForegroundColor Cyan
        Download-ArtifactZip $QwenArtifactId $QwenArtifactSize $QwenArtifactSha256 $QwenZip

        Expand-Archive -LiteralPath $CompanionZip -DestinationPath $CompanionExtract -Force
        $payloadPath = Join-Path $CompanionExtract "TDACompanion-payload-manifest.json"
        $payload = Read-Json $payloadPath "COMPANION_PAYLOAD_INVALID"
        if ([string]$payload.source_sha -ne $TestedMergeSha) { Fail-Harness "COMPANION_SOURCE_SHA_MISMATCH" }
        if ([string]$payload.source_tree_sha -ne $SourceTreeSha) { Fail-Harness "COMPANION_TREE_SHA_MISMATCH" }
        $portableZip = @(Get-ChildItem -LiteralPath $CompanionExtract -Filter "TDACompanion-*-windows-x64.zip" -File)
        if ($portableZip.Count -ne 1) { Fail-Harness "COMPANION_PORTABLE_ZIP_INVALID" }
        Expand-Archive -LiteralPath $portableZip[0].FullName -DestinationPath $CompanionPortable -Force
        $CompanionExe = Join-Path $CompanionPortable "app\TDACompanion.exe"
        if (-not (Test-Path -LiteralPath $CompanionExe -PathType Leaf)) { Fail-Harness "COMPANION_EXE_MISSING" }
        $expectedExe = [string]$payload.files.'TDACompanion.exe'.sha256
        if ((Get-Sha256 $CompanionExe) -ne $expectedExe) { Fail-Harness "COMPANION_EXE_HASH_MISMATCH" }
    }

    $ScratchTda = Join-Path $ScratchLocal "TDA"
    New-Item -ItemType Directory -Force -Path $ScratchTda | Out-Null
    $RealModels = Join-Path $OriginalLocalAppData "TDA\Models"
    $ScratchModels = Join-Path $ScratchTda "Models"
    if (-not (Test-Path -LiteralPath $RealModels -PathType Container)) { Fail-Blocked "EXISTING_MODELS_ROOT_REQUIRED" }
    $modelCopy = Copy-IsolatedQwenModels $RealModels $ScratchModels $ScratchRoot
    Write-Json (Join-Path $EvidenceRoot "model-copy.json") ([ordered]@{
        isolated_copy = $true
        model_bytes = [long]$modelCopy.model_bytes
        required_free_bytes = [long]$modelCopy.required_free_bytes
        free_bytes_before = [long]$modelCopy.free_bytes_before
        directories = @("qwen3-asr-0.6b-hf", "qwen3-asr-1.7b-hf", "qwen3-forced-aligner-0.6b-hf")
    })

    $env:LOCALAPPDATA = $ScratchLocal
    if ($ExactRcMode) {
        $scratchRuntimeFamily = Join-Path $ScratchLocal "TDA\Runtime\qwen"
        $scratchRuntimeVersion = Join-Path $scratchRuntimeFamily $QwenRuntimeVersion
        New-Item -ItemType Directory -Force -Path $scratchRuntimeFamily | Out-Null
        if (Test-Path -LiteralPath $scratchRuntimeVersion) { Remove-Item -LiteralPath $scratchRuntimeVersion -Recurse -Force }
        Copy-Item -LiteralPath $QwenInstalledRuntimeResolved -Destination $scratchRuntimeVersion -Recurse -Force

        $sourceCurrent = Join-Path (Split-Path -Parent $QwenInstalledRuntimeResolved) "current.json"
        $scratchCurrent = Join-Path $scratchRuntimeFamily "current.json"
        if (-not (Test-Path -LiteralPath $sourceCurrent -PathType Leaf)) { Fail-Harness "EXACT_RC_QWEN_CURRENT_MISSING" }
        Copy-Item -LiteralPath $sourceCurrent -Destination $scratchCurrent -Force
        $currentJson = Read-Json $scratchCurrent "EXACT_RC_QWEN_CURRENT_INVALID"
        if (
            [string]$currentJson.schema -ne "tda_asr_runtime_v1" -or
            [string]$currentJson.runtime_id -ne "qwen3-transformers" -or
            [string]$currentJson.version -ne $QwenRuntimeVersion
        ) { Fail-Harness "EXACT_RC_QWEN_CURRENT_IDENTITY_MISMATCH" }

        $runtimeMarkerPath = Join-Path $scratchRuntimeVersion ".tda-runtime.json"
        $runtimeMarker = Read-Json $runtimeMarkerPath "QWEN_RUNTIME_MARKER_INVALID"
        $scratchWorker = Join-Path $scratchRuntimeVersion "TDAQwenWorker.exe"
        if (
            [string]$runtimeMarker.schema -ne "tda_asr_runtime_v1" -or
            [string]$runtimeMarker.runtime_id -ne "qwen3-transformers" -or
            [string]$runtimeMarker.version -ne $QwenRuntimeVersion -or
            [string]$runtimeMarker.archive_sha256 -ne $QwenRuntimeArchiveSha256 -or
            [string]$runtimeMarker.worker_sha256 -notmatch '^[a-f0-9]{64}$' -or
            -not (Test-Path -LiteralPath $scratchWorker -PathType Leaf) -or
            (Get-Sha256 $scratchWorker) -ne [string]$runtimeMarker.worker_sha256
        ) { Fail-Harness "EXACT_RC_QWEN_COPY_IDENTITY_MISMATCH" }

        $installJson = [pscustomobject]@{
            schema = "tda_runtime_exact_rc_copy_v1"
            ok = $true
            runtime = "qwen"
            status = "ready"
            version = $QwenRuntimeVersion
            reused = $true
        }
    } else {
        $installResult = Join-Path $ScratchRoot "qwen-install.json"
        $installArgs = @(
            "--install-rc-runtime", "qwen",
            "--rc-artifact", $QwenZip,
            "--rc-artifact-sha256", $QwenArtifactSha256,
            "--rc-result-file", $installResult
        )
        $install = Start-Process -FilePath $CompanionExe -ArgumentList $installArgs -Wait -PassThru -WindowStyle Hidden
        if (-not (Test-Path -LiteralPath $installResult -PathType Leaf)) { Fail-Product "QWEN_RUNTIME_INSTALL_RESULT_MISSING" }
        $installJson = Read-Json $installResult "QWEN_RUNTIME_INSTALL_RESULT_INVALID"
        if ($install.ExitCode -ne 0 -or $installJson.ok -ne $true -or [string]$installJson.runtime -ne "qwen" -or [string]$installJson.status -ne "ready") {
            $code = if ($installJson.error) { [string]$installJson.error } else { "QWEN_RUNTIME_INSTALL_FAILED" }
            Fail-Product $code
        }
        if ([string]$installJson.version -ne $QwenRuntimeVersion) { Fail-Product "QWEN_RUNTIME_VERSION_MISMATCH" }
        $runtimeMarkerPath = Join-Path $ScratchLocal ("TDA\Runtime\qwen\{0}\.tda-runtime.json" -f $QwenRuntimeVersion)
        if (-not (Test-Path -LiteralPath $runtimeMarkerPath -PathType Leaf)) { Fail-Product "QWEN_RUNTIME_MARKER_MISSING" }
        $runtimeMarker = Read-Json $runtimeMarkerPath "QWEN_RUNTIME_MARKER_INVALID"
        if (
            [string]$runtimeMarker.schema -ne "tda_asr_runtime_v1" -or
            [string]$runtimeMarker.runtime_id -ne "qwen3-transformers" -or
            [string]$runtimeMarker.version -ne $QwenRuntimeVersion -or
            [string]$runtimeMarker.archive_sha256 -ne $QwenRuntimeArchiveSha256 -or
            [string]$runtimeMarker.worker_sha256 -notmatch '^[a-f0-9]{64}$'
        ) {
            Fail-Product "QWEN_RUNTIME_MARKER_IDENTITY_MISMATCH"
        }
    }
    Write-Json (Join-Path $EvidenceRoot "qwen-runtime-install.json") ([ordered]@{
        schema = [string]$installJson.schema
        ok = [bool]$installJson.ok
        runtime = [string]$installJson.runtime
        status = [string]$installJson.status
        version = [string]$installJson.version
        reused = [bool]$installJson.reused
        input_mode = $(if ($ExactRcMode) { "exact_installed_rc" } else { "legacy_pr_artifact" })
        candidate_tag = $(if ($ExactRcMode) { [string]$QwenCandidate.candidate_tag } else { $null })
        archive_sha256 = [string]$runtimeMarker.archive_sha256
        worker_sha256 = [string]$runtimeMarker.worker_sha256
    })

    Assert-GatePortFree
    $AgentProcess = Start-GateAgent $CompanionExe
    $PairingToken = Get-PairingToken

    $craig = Upload-Craig $CraigResolved
    $SourceId = [string]$craig.source_id
    if ($SourceId -notmatch '^craig-[a-f0-9]{64}$' -or [int]$craig.track_count -lt 2) { Fail-Product "CRAIG_INGEST_INVALID" }
    Write-Json (Join-Path $EvidenceRoot "source-summary.json") ([ordered]@{ track_count = [int]$craig.track_count; reused = [bool]$craig.reused })

    Write-Host "Physical preparation: qwen-fast..." -ForegroundColor Cyan
    $prepFast = Wait-Preparation $SourceId "qwen-fast" 2400
    Write-Json (Join-Path $EvidenceRoot "preparation-qwen-fast.json") ([ordered]@{
        state = [string]$prepFast.state; profile_id = [string]$prepFast.profile_id; stage = [string]$prepFast.stage; error_code = $prepFast.error_code; elapsed_seconds = $prepFast.elapsed_seconds
    })
    Write-Host "Physical preparation: qwen-quality..." -ForegroundColor Cyan
    $prepQuality = Wait-Preparation $SourceId "qwen-quality" 2400
    Write-Json (Join-Path $EvidenceRoot "preparation-qwen-quality.json") ([ordered]@{
        state = [string]$prepQuality.state; profile_id = [string]$prepQuality.profile_id; stage = [string]$prepQuality.stage; error_code = $prepQuality.error_code; elapsed_seconds = $prepQuality.elapsed_seconds
    })

    foreach ($profileId in @("qwen-fast", "qwen-quality")) {
        $gate = Join-Path $env:LOCALAPPDATA "TDA\State\qwen-physical-gates\$profileId.json"
        if (-not (Test-Path -LiteralPath $gate -PathType Leaf)) { Fail-Product "QWEN_GATE_RECEIPT_MISSING:$profileId" }
        $gateValue = Read-Json $gate "QWEN_GATE_RECEIPT_INVALID:$profileId"
        if ([string]$gateValue.schema -ne "tda_qwen_physical_gate_v2" -or $gateValue.contains_audio -ne $false -or $gateValue.contains_transcript -ne $false) {
            Fail-Product "QWEN_GATE_RECEIPT_INVALID:$profileId"
        }
        Copy-Item -LiteralPath $gate -Destination (Join-Path $EvidenceRoot "physical-gate-$profileId.json") -Force
    }

    Write-Host "Normal qwen-quality worker + bounded cancel..." -ForegroundColor Cyan
    $quality = Submit-Transcription $SourceId "qwen-quality"
    $QualityJobId = [string]$quality.id
    if (-not $QualityJobId) { Fail-Product "QWEN_QUALITY_JOB_ID_MISSING" }
    [void](Wait-ForEvent $QualityJobId "QWEN_WINDOW_TRANSCRIBED" $null 1800)
    $cancelStarted = [DateTimeOffset]::UtcNow
    [void](Invoke-AgentJson "POST" "/jobs/$QualityJobId/cancel")
    $qualityTerminal = Wait-Terminal $QualityJobId @("cancelled") 30
    $cancelSeconds = ([DateTimeOffset]::UtcNow - $cancelStarted).TotalSeconds
    Wait-QwenWorkersGone $ScratchRoot 20
    Write-Json (Join-Path $EvidenceRoot "qwen-quality-cancel.json") ([ordered]@{
        job = Sanitize-Job $qualityTerminal
        cancel_settle_seconds = [Math]::Round($cancelSeconds, 3)
    })
    Save-JobEvidence $QualityJobId "qwen-quality" $EvidenceRoot

    Write-Host "qwen-fast checkpoint -> hard Agent crash -> retry..." -ForegroundColor Cyan
    $fast = Submit-Transcription $SourceId "qwen-fast"
    $FastJobId = [string]$fast.id
    if (-not $FastJobId) { Fail-Product "QWEN_FAST_JOB_ID_MISSING" }
    [void](Wait-ForEvent $FastJobId "ASR_TEXT_CHECKPOINT_SAVED" ([Nullable[int]]1) 1800)
    [void](Capture-Events $FastJobId)
    $preCrash = @(Capture-Events $FastJobId)
    $preCrashMaxSeq = Get-MaxEventSequence $preCrash
    if ($preCrashMaxSeq -le 0) { Fail-Harness "PRECRASH_EVENT_SEQUENCE_INVALID" }
    $persistedTracks = @($preCrash | Where-Object { [string](Get-OptionalPropertyValue $_ "code") -eq "ASR_TEXT_CHECKPOINT_SAVED" } | ForEach-Object {
        $eventData = Get-OptionalPropertyValue $_ "data"
        $trackValue = Get-OptionalPropertyValue $eventData "track"
        if ($null -eq $trackValue) { Fail-Product "ASR_TEXT_CHECKPOINT_EVENT_TRACK_MISSING" }
        [int]$trackValue
    } | Sort-Object -Unique)
    if (1 -notin $persistedTracks) { Fail-Product "TRACK1_TEXT_CHECKPOINT_NOT_DURABLE" }
    Write-Json (Join-Path $EvidenceRoot "qwen-fast-precrash.json") ([ordered]@{ max_seq = $preCrashMaxSeq; persisted_tracks = $persistedTracks; job = Sanitize-Job (Get-Job $FastJobId) })

    $crashedPid = [int]$AgentProcess.Id
    Stop-ProcessTree $crashedPid
    $AgentProcess = $null
    Start-Sleep -Seconds 2
    $agentStillAlive = $false
    try {
        $still = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        if ($null -ne $still) { $agentStillAlive = $true }
    } catch {}
    if ($agentStillAlive) { Fail-Harness "SCRATCH_AGENT_SURVIVED_HARD_CRASH" }
    Wait-QwenWorkersGone $ScratchRoot 20
    Assert-GatePortFree

    $AgentProcess = Start-GateAgent $CompanionExe
    $PairingToken = Get-PairingToken
    $recoveredDeadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    $interrupted = $null
    while ([DateTimeOffset]::UtcNow -lt $recoveredDeadline) {
        $candidate = Get-Job $FastJobId
        [void](Capture-Events $FastJobId)
        $candidateStatus = [string](Get-RequiredProductPropertyValue $candidate "status" "RECOVERY_JOB_STATUS_MISSING")
        if ($candidateStatus -eq "interrupted") { $interrupted = $candidate; break }
        if ($candidateStatus -in @("succeeded", "failed", "cancelled")) { Fail-Product "RECOVERY_TERMINAL_UNEXPECTED:$candidateStatus" }
        Start-Sleep -Milliseconds 500
    }
    if ($null -eq $interrupted) { Fail-Product "PROCESS_INTERRUPTED_NOT_OBSERVED" }
    $interruptedError = Get-OptionalPropertyValue $interrupted "error"
    $interruptedCode = [string](Get-OptionalPropertyValue $interruptedError "code")
    $interruptedRecoverable = Get-OptionalPropertyValue $interruptedError "recoverable"
    if ($null -eq $interruptedError -or $interruptedCode -ne "PROCESS_INTERRUPTED" -or $interruptedRecoverable -ne $true) {
        Fail-Product "PROCESS_INTERRUPTED_CONTRACT_INVALID"
    }
    Write-Json (Join-Path $EvidenceRoot "qwen-fast-interrupted.json") (Sanitize-Job $interrupted)

    [void](Invoke-AgentJson "POST" "/jobs/$FastJobId/retry")
    $fastFinal = Wait-Terminal $FastJobId @("succeeded") 3600
    $allFastEvents = @(Capture-Events $FastJobId)
    $retryEvents = @($allFastEvents | Where-Object {
        $sequence = Get-OptionalPropertyValue $_ "seq"
        $null -ne $sequence -and [int]$sequence -gt $preCrashMaxSeq
    })
    foreach ($track in $persistedTracks) {
        $reuseCount = @($retryEvents | Where-Object {
            $eventCode = [string](Get-OptionalPropertyValue $_ "code")
            $eventData = Get-OptionalPropertyValue $_ "data"
            $eventTrack = Get-OptionalPropertyValue $eventData "track"
            $eventCode -eq "ASR_TEXT_CHECKPOINT_REUSED" -and $null -ne $eventTrack -and [int]$eventTrack -eq $track
        }).Count
        $retranscribed = @($retryEvents | Where-Object {
            $eventCode = [string](Get-OptionalPropertyValue $_ "code")
            $eventData = Get-OptionalPropertyValue $_ "data"
            $eventTrack = Get-OptionalPropertyValue $eventData "track"
            $eventCode -eq "QWEN_WINDOW_TRANSCRIBED" -and $null -ne $eventTrack -and [int]$eventTrack -eq $track
        }).Count
        if ($reuseCount -lt 1) { Fail-Product "TEXT_CHECKPOINT_NOT_REUSED:track-$track" }
        if ($retranscribed -ne 0) { Fail-Product "PERSISTED_TRACK_RETRANSCRIBED:track-$track" }
    }
    if (@($retryEvents | Where-Object { [string](Get-OptionalPropertyValue $_ "code") -eq "RUN_COMMIT_FENCE_WON" }).Count -lt 1) { Fail-Product "RUN_COMMIT_FENCE_NOT_OBSERVED" }

    $result = Invoke-AgentJson "GET" "/jobs/$FastJobId/result"
    $transcription = Get-OptionalPropertyValue $result "transcription"
    if ($null -eq $transcription) { Fail-Product "QWEN_FAST_RESULT_TRANSCRIPTION_MISSING" }
    $runId = [string](Get-OptionalPropertyValue $transcription "run_id")
    $resultDigest = [string](Get-OptionalPropertyValue $transcription "sha256")
    if ($runId -eq "" -or $resultDigest -notmatch '^[a-f0-9]{64}    if ($runId -notmatch '^[A-Za-z0-9_-]{1,160}$') { Fail-Product "QWEN_FAST_RUN_ID_INVALID" }
    $packageRoot = Join-Path $env:LOCALAPPDATA ("TDA\Data\staging\" + $SourceId)
    $runRoot = Join-Path (Join-Path $packageRoot "runs") $runId
    $runMarkerPath = Join-Path $runRoot "run.json"
    $runTranscriptPath = Join-Path $runRoot "transcript.json"
    if (-not (Test-Path -LiteralPath $runMarkerPath -PathType Leaf)) { Fail-Product "IMMUTABLE_RUN_MARKER_MISSING" }
    if (-not (Test-Path -LiteralPath $runTranscriptPath -PathType Leaf)) { Fail-Product "IMMUTABLE_RUN_TRANSCRIPT_MISSING" }
    $runMarker = Read-Json $runMarkerPath "IMMUTABLE_RUN_MARKER_INVALID"
    $finalAttempt = Get-RequiredProductPropertyValue $fastFinal "attempt" "QWEN_FAST_FINAL_ATTEMPT_MISSING"
    if (
        [string](Get-OptionalPropertyValue $runMarker "run_id") -ne $runId -or
        [string](Get-OptionalPropertyValue $runMarker "job_id") -ne $FastJobId -or
        [int](Get-OptionalPropertyValue $runMarker "attempt") -ne [int]$finalAttempt
    ) {
        Fail-Product "IMMUTABLE_RUN_IDENTITY_MISMATCH"
    }
    if (
        [string](Get-OptionalPropertyValue $runMarker "profile_id") -ne "qwen-fast" -or
        [string](Get-OptionalPropertyValue $runMarker "transcript_sha256") -ne $resultDigest
    ) {
        Fail-Product "IMMUTABLE_RUN_MANIFEST_MISMATCH"
    }
    $computedTranscriptDigest = Get-Sha256 $runTranscriptPath
    if ($computedTranscriptDigest -ne $resultDigest) { Fail-Product "IMMUTABLE_RUN_TRANSCRIPT_HASH_MISMATCH" }
    Write-Json (Join-Path $EvidenceRoot "immutable-run-validation.json") ([ordered]@{
        marker = "run.json"
        run_id = $runId
        job_id = $FastJobId
        attempt = [int]$finalAttempt
        profile_id = "qwen-fast"
        transcript_sha256 = $resultDigest
        computed_transcript_sha256 = $computedTranscriptDigest
        marker_schema = [string](Get-OptionalPropertyValue $runMarker "schema")
    })
    Write-Json (Join-Path $EvidenceRoot "qwen-fast-result.json") ([ordered]@{
        status = [string](Get-OptionalPropertyValue $fastFinal "status")
        attempt = [int]$finalAttempt
        persisted_tracks_before_crash = $persistedTracks
        run_id = $runId
        transcript_sha256 = $resultDigest
    })
    Save-JobEvidence $FastJobId "qwen-fast" $EvidenceRoot
    Save-Logs $EvidenceRoot

    $Verdict = "PASS"
    $VerdictCode = "QWEN_PHYSICAL_RECOVERY_GATE_PASS"
} catch {
    $message = [string]$_.Exception.Message
    if ($message -match '^PRODUCT_FAILED:(.+)$') { $Verdict = "PRODUCT_FAILED"; $VerdictCode = $Matches[1] }
    elseif ($message -match '^BLOCKED:(.+)$') { $Verdict = "BLOCKED"; $VerdictCode = $Matches[1] }
    elseif ($message -match '^HARNESS_FAILED:(.+)$') { $Verdict = "HARNESS_FAILED"; $VerdictCode = $Matches[1] }
    else {
        $Verdict = "HARNESS_FAILED"
        $exceptionType = [string]$_.Exception.GetType().Name
        $safeType = ($exceptionType -replace '[^A-Za-z0-9_]', '_').ToUpperInvariant()
        $VerdictCode = "HARNESS_EXCEPTION_$safeType"
        $scriptName = ""
        $commandName = ""
        [int]$lineNumber = 0
        $errorId = ""
        try {
            $invocation = Get-OptionalPropertyValue $_ "InvocationInfo"
            if ($null -ne $invocation) {
                $scriptName = [IO.Path]::GetFileName([string](Get-OptionalPropertyValue $invocation "ScriptName"))
                $lineValue = Get-OptionalPropertyValue $invocation "ScriptLineNumber"
                if ($null -ne $lineValue) { $lineNumber = [int]$lineValue }
                $myCommand = Get-OptionalPropertyValue $invocation "MyCommand"
                $commandName = [string](Get-OptionalPropertyValue $myCommand "Name")
            }
            $errorId = [string](Get-OptionalPropertyValue $_ "FullyQualifiedErrorId")
        } catch {}
        Write-Json (Join-Path $EvidenceRoot "harness-error.json") ([ordered]@{
            exception_type = $exceptionType
            error_id = $errorId
            script = $scriptName
            line = $lineNumber
            command = $commandName
        })
    }
    try { Save-JobEvidence $QualityJobId "qwen-quality-failure" $EvidenceRoot } catch {}
    try { Save-JobEvidence $FastJobId "qwen-fast-failure" $EvidenceRoot } catch {}
    try { Save-Logs $EvidenceRoot } catch {}
} finally {
    try {
        if ($null -ne $AgentProcess -and -not $AgentProcess.HasExited) { Stop-ProcessTree ([int]$AgentProcess.Id) }
    } catch {}
    try {
        $scratchPrefix = $ScratchRoot
        foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
            $path = [string]$process.ExecutablePath
            if ($path -and $path.StartsWith($scratchPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                try { Stop-ProcessTree ([int]$process.ProcessId) } catch {}
            }
        }
    } catch {}
    $env:LOCALAPPDATA = $OriginalLocalAppData

    $finished = [DateTimeOffset]::UtcNow
    Write-Json (Join-Path $EvidenceRoot "verdict.json") ([ordered]@{
        schema = $PackSchema
        verdict = $Verdict
        code = $VerdictCode
        started_at = $StartedAt.ToString("o")
        finished_at = $finished.ToString("o")
        elapsed_seconds = [Math]::Round(($finished - $StartedAt).TotalSeconds, 3)
    })
    try { Assert-NoEvidenceLeak $EvidenceRoot $PairingToken $CraigResolved } catch {
        $Verdict = "HARNESS_FAILED"
        $VerdictCode = [string]$_.Exception.Message
        Write-Json (Join-Path $EvidenceRoot "verdict.json") ([ordered]@{ schema = $PackSchema; verdict = $Verdict; code = $VerdictCode })
    }
    Write-EvidenceManifest $EvidenceRoot
    $zip = "$EvidenceRoot.zip"
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $EvidenceRoot "*") -DestinationPath $zip -CompressionLevel Optimal

    try {
        Remove-Item -LiteralPath $ScratchRoot -Recurse -Force -ErrorAction SilentlyContinue
    } catch {}

    Write-Host ""
    Write-Host "Qwen physical gate verdict: $Verdict / $VerdictCode" -ForegroundColor $(if ($Verdict -eq "PASS") { "Green" } else { "Yellow" })
    Write-Host "Evidence: $zip"
}

if ($Verdict -ne "PASS") { exit 1 }
exit 0
) {
        Fail-Product "QWEN_FAST_RESULT_INVALID"
    }
    if ($runId -notmatch '^[A-Za-z0-9_-]{1,160}$') { Fail-Product "QWEN_FAST_RUN_ID_INVALID" }
    $packageRoot = Join-Path $env:LOCALAPPDATA ("TDA\Data\staging\" + $SourceId)
    $runRoot = Join-Path (Join-Path $packageRoot "runs") $runId
    $runMarkerPath = Join-Path $runRoot "run.json"
    $runTranscriptPath = Join-Path $runRoot "transcript.json"
    if (-not (Test-Path -LiteralPath $runMarkerPath -PathType Leaf)) { Fail-Product "IMMUTABLE_RUN_MARKER_MISSING" }
    if (-not (Test-Path -LiteralPath $runTranscriptPath -PathType Leaf)) { Fail-Product "IMMUTABLE_RUN_TRANSCRIPT_MISSING" }
    $runMarker = Read-Json $runMarkerPath "IMMUTABLE_RUN_MARKER_INVALID"
    if ([string]$runMarker.run_id -ne $runId -or [string]$runMarker.job_id -ne $FastJobId -or [int]$runMarker.attempt -ne [int]$fastFinal.attempt) {
        Fail-Product "IMMUTABLE_RUN_IDENTITY_MISMATCH"
    }
    if ([string]$runMarker.profile_id -ne "qwen-fast" -or [string]$runMarker.transcript_sha256 -ne $resultDigest) {
        Fail-Product "IMMUTABLE_RUN_MANIFEST_MISMATCH"
    }
    $computedTranscriptDigest = Get-Sha256 $runTranscriptPath
    if ($computedTranscriptDigest -ne $resultDigest) { Fail-Product "IMMUTABLE_RUN_TRANSCRIPT_HASH_MISMATCH" }
    Write-Json (Join-Path $EvidenceRoot "immutable-run-validation.json") ([ordered]@{
        marker = "run.json"
        run_id = $runId
        job_id = $FastJobId
        attempt = [int]$fastFinal.attempt
        profile_id = "qwen-fast"
        transcript_sha256 = $resultDigest
        computed_transcript_sha256 = $computedTranscriptDigest
        marker_schema = [string]$runMarker.schema
    })
    Write-Json (Join-Path $EvidenceRoot "qwen-fast-result.json") ([ordered]@{
        status = [string]$fastFinal.status
        attempt = [int]$fastFinal.attempt
        persisted_tracks_before_crash = $persistedTracks
        run_id = $runId
        transcript_sha256 = $resultDigest
    })
    Save-JobEvidence $FastJobId "qwen-fast" $EvidenceRoot
    Save-Logs $EvidenceRoot

    $Verdict = "PASS"
    $VerdictCode = "QWEN_PHYSICAL_RECOVERY_GATE_PASS"
} catch {
    $message = [string]$_.Exception.Message
    if ($message -match '^PRODUCT_FAILED:(.+)$') { $Verdict = "PRODUCT_FAILED"; $VerdictCode = $Matches[1] }
    elseif ($message -match '^BLOCKED:(.+)$') { $Verdict = "BLOCKED"; $VerdictCode = $Matches[1] }
    elseif ($message -match '^HARNESS_FAILED:(.+)$') { $Verdict = "HARNESS_FAILED"; $VerdictCode = $Matches[1] }
    else {
        $Verdict = "HARNESS_FAILED"
        $exceptionType = [string]$_.Exception.GetType().Name
        $safeType = ($exceptionType -replace '[^A-Za-z0-9_]', '_').ToUpperInvariant()
        $VerdictCode = "HARNESS_EXCEPTION_$safeType"
        $scriptName = [IO.Path]::GetFileName([string]$_.InvocationInfo.ScriptName)
        $commandName = [string]$_.InvocationInfo.MyCommand.Name
        Write-Json (Join-Path $EvidenceRoot "harness-error.json") ([ordered]@{
            exception_type = $exceptionType
            script = $scriptName
            line = [int]$_.InvocationInfo.ScriptLineNumber
            command = $commandName
        })
    }
    try { Save-JobEvidence $QualityJobId "qwen-quality-failure" $EvidenceRoot } catch {}
    try { Save-JobEvidence $FastJobId "qwen-fast-failure" $EvidenceRoot } catch {}
    try { Save-Logs $EvidenceRoot } catch {}
} finally {
    try {
        if ($null -ne $AgentProcess -and -not $AgentProcess.HasExited) { Stop-ProcessTree ([int]$AgentProcess.Id) }
    } catch {}
    try {
        $scratchPrefix = $ScratchRoot
        foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
            $path = [string]$process.ExecutablePath
            if ($path -and $path.StartsWith($scratchPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                try { Stop-ProcessTree ([int]$process.ProcessId) } catch {}
            }
        }
    } catch {}
    $env:LOCALAPPDATA = $OriginalLocalAppData

    $finished = [DateTimeOffset]::UtcNow
    Write-Json (Join-Path $EvidenceRoot "verdict.json") ([ordered]@{
        schema = $PackSchema
        verdict = $Verdict
        code = $VerdictCode
        started_at = $StartedAt.ToString("o")
        finished_at = $finished.ToString("o")
        elapsed_seconds = [Math]::Round(($finished - $StartedAt).TotalSeconds, 3)
    })
    try { Assert-NoEvidenceLeak $EvidenceRoot $PairingToken $CraigResolved } catch {
        $Verdict = "HARNESS_FAILED"
        $VerdictCode = [string]$_.Exception.Message
        Write-Json (Join-Path $EvidenceRoot "verdict.json") ([ordered]@{ schema = $PackSchema; verdict = $Verdict; code = $VerdictCode })
    }
    Write-EvidenceManifest $EvidenceRoot
    $zip = "$EvidenceRoot.zip"
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $EvidenceRoot "*") -DestinationPath $zip -CompressionLevel Optimal

    try {
        Remove-Item -LiteralPath $ScratchRoot -Recurse -Force -ErrorAction SilentlyContinue
    } catch {}

    Write-Host ""
    Write-Host "Qwen physical gate verdict: $Verdict / $VerdictCode" -ForegroundColor $(if ($Verdict -eq "PASS") { "Green" } else { "Yellow" })
    Write-Host "Evidence: $zip"
}

if ($Verdict -ne "PASS") { exit 1 }
exit 0
