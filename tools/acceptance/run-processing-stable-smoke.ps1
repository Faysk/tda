[CmdletBinding()]
param(
    [string]$BaseUrl = "https://dnd.faysk.dev",
    [string]$ExpectedStableVersion = "0.3.14",
    [string]$ExpectedWhisperRuntimeVersion = "1.1.5",
    [string]$ExpectedQwenRuntimeVersion = "1.0.10",
    [string]$RequireGpuName = "RTX 4070",
    [ValidateRange(1024, 65535)][int]$Port = 8765,
    [string]$ResultsRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Origin = $BaseUrl.TrimEnd("/")
$ExpectedStableTag = "companion-v$ExpectedStableVersion"
$ExpectedWhisperStableTag = "companion-whisper-runtime-v$ExpectedWhisperRuntimeVersion"
$ExpectedQwenStableTag = "companion-qwen-runtime-v$ExpectedQwenRuntimeVersion"

function Fail([string]$Code) {
    throw [InvalidOperationException]::new($Code)
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-Json([string]$Path, [string]$Code) {
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64 -ErrorAction Stop }
    catch { Fail $Code }
}

function Write-Json([string]$Path, [object]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $Value | ConvertTo-Json -Depth 64 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-PublicRelease([string]$Tag) {
    try {
        $value = Invoke-RestMethod -UseBasicParsing -Headers @{
            Accept = "application/vnd.github+json"
            "X-GitHub-Api-Version" = "2022-11-28"
            "User-Agent" = "tda-processing-stable-smoke/1"
        } -Uri ("https://api.github.com/repos/Faysk/tda/releases/tags/" + [Uri]::EscapeDataString($Tag)) -TimeoutSec 30
    } catch {
        Fail ("STABLE_RELEASE_LOOKUP_FAILED:" + $Tag)
    }
    if (
        [string]$value.tag_name -ne $Tag -or
        $value.draft -ne $false -or
        $value.prerelease -ne $false
    ) {
        Fail ("STABLE_RELEASE_IDENTITY_INVALID:" + $Tag)
    }
    return $value
}

function Get-ReleaseAsset([object]$Release, [string]$Name) {
    $rows = @($Release.assets | Where-Object { [string]$_.name -eq $Name })
    if ($rows.Count -ne 1) { Fail ("STABLE_RELEASE_ASSET_COUNT_INVALID:" + $Name) }
    $asset = $rows[0]
    if ([int64]$asset.size -le 0 -or [string]$asset.browser_download_url -notmatch '^https://github\.com/Faysk/tda/releases/download/') {
        Fail ("STABLE_RELEASE_ASSET_INVALID:" + $Name)
    }
    return $asset
}

function Download-ReleaseAsset([object]$Release, [string]$Name, [string]$Destination) {
    $asset = Get-ReleaseAsset $Release $Name
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$asset.browser_download_url) -OutFile $Destination -TimeoutSec 900
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf) -or (Get-Item $Destination).Length -ne [int64]$asset.size) {
        Fail ("STABLE_RELEASE_ASSET_DOWNLOAD_INVALID:" + $Name)
    }
    if ([string]$asset.digest -match '^sha256:([a-f0-9]{64})$') {
        if ((Get-Sha256 $Destination) -ne $Matches[1]) {
            Fail ("STABLE_RELEASE_ASSET_HASH_MISMATCH:" + $Name)
        }
    }
    return $asset
}

function Get-AgentHealth {
    try {
        $value = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        if (
            [string]$value.product_id -ne "tda-companion" -or
            [string]$value.api_version -ne "1" -or
            [int]$value.port -ne $Port -or
            [int]$value.pid -le 0
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
    if ([string]$value.schema -ne "tda_loopback_session_v1" -or [string]::IsNullOrWhiteSpace([string]$value.token)) {
        Fail "BROWSER_SESSION_INVALID"
    }
    return [string]$value.token
}

function Invoke-AgentJson([string]$Token, [string]$Method, [string]$Path, [object]$Body = $null, [int]$TimeoutSec = 30) {
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
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 32 -Compress)
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        $detail = [string]$_.ErrorDetails.Message
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') {
            Fail ("AGENT_API_" + $Matches[1])
        }
        Fail "AGENT_API_REQUEST_FAILED"
    }
}

function Assert-NoActiveUserWork {
    $health = Get-AgentHealth
    $jobsDb = Join-Path $env:LOCALAPPDATA "TDA\Data\jobs.sqlite3"
    if ($null -eq $health) {
        if (Test-Path -LiteralPath $jobsDb -PathType Leaf) {
            Fail "ACTIVE_WORK_PREFLIGHT_UNAVAILABLE"
        }
        return
    }

    $token = New-BrowserSession
    $jobs = Invoke-AgentJson $token "GET" "/jobs"
    if (@($jobs.jobs | Where-Object { [string]$_.status -in @("queued", "running") }).Count -gt 0) {
        Fail "ACTIVE_USER_JOB_PRESENT_BEFORE_STABLE_SMOKE"
    }
    $preparation = Invoke-AgentJson $token "GET" "/preparation"
    if ($preparation.active -eq $true) {
        Fail "ACTIVE_USER_PREPARATION_PRESENT_BEFORE_STABLE_SMOKE"
    }
}

function Test-InstalledPayload([object]$Candidate, [object]$Payload) {
    try {
        if (
            [string]$Payload.schema -ne "tda_companion_payload_v1" -or
            [string]$Payload.version -ne $ExpectedStableVersion -or
            [string]$Payload.source_sha -ne [string]$Candidate.source_sha -or
            [string]$Payload.source_tree_sha -ne [string]$Candidate.source_tree_sha
        ) {
            return $false
        }

        $root = Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$ExpectedStableVersion"
        foreach ($property in $Payload.files.PSObject.Properties) {
            $name = [string]$property.Name
            if ([IO.Path]::GetFileName($name) -ne $name) { return $false }
            $file = Join-Path $root $name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
            if ((Get-Item $file).Length -ne [int64]$property.Value.size) { return $false }
            if ((Get-Sha256 $file) -ne [string]$property.Value.sha256) { return $false }
        }
        return $true
    } catch {
        return $false
    }
}

function Wait-ExactAgent([int]$Seconds = 60) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $health = Get-AgentHealth
        if (
            $null -ne $health -and
            [string]$health.service_version -eq $ExpectedStableVersion -and
            [string]$health.lifecycle -eq "ready"
        ) {
            return $health
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function Ensure-ProfileReady([string]$Token, [string]$SourceId, [string]$ProfileId) {
    $capabilities = Invoke-AgentJson $Token "GET" "/capabilities"
    $ready = @($capabilities.transcription.profiles | ForEach-Object { [string]$_ })
    if ($ProfileId -in $ready) { return "already_ready" }

    $started = Invoke-AgentJson $Token "POST" "/preparation" @{
        source_id = $SourceId
        profile_id = $ProfileId
    }
    if (
        [string]$started.schema -ne "tda_profile_preparation_v1" -or
        [string]$started.source_id -ne $SourceId -or
        [string]$started.profile_id -ne $ProfileId
    ) {
        Fail ("PROFILE_PREPARATION_START_INVALID:" + $ProfileId)
    }

    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(40)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $status = Invoke-AgentJson $Token "GET" "/preparation"
        if ([string]$status.profile_id -ne $ProfileId) {
            Fail ("PROFILE_PREPARATION_IDENTITY_INVALID:" + $ProfileId)
        }
        if ([string]$status.state -eq "completed") {
            $capabilities = Invoke-AgentJson $Token "GET" "/capabilities"
            $ready = @($capabilities.transcription.profiles | ForEach-Object { [string]$_ })
            if ($ProfileId -notin $ready) { Fail ("PROFILE_PREPARATION_NOT_VISIBLE:" + $ProfileId) }
            return "prepared"
        }
        if ([string]$status.state -eq "failed") {
            $code = if ($status.error_code) { [string]$status.error_code } else { "PROFILE_PREPARATION_FAILED" }
            Fail ($code + ":" + $ProfileId)
        }
        if ([string]$status.state -eq "cancelled") {
            Fail ("PROFILE_PREPARATION_CANCELLED:" + $ProfileId)
        }
        Start-Sleep -Seconds 1
    }
    Fail ("PROFILE_PREPARATION_TIMEOUT:" + $ProfileId)
}

function Assert-RuntimeCurrent([string]$Family, [string]$ExpectedVersion, [string]$RuntimeId) {
    $root = Join-Path $env:LOCALAPPDATA "TDA\Runtime\$Family"
    $current = Read-Json (Join-Path $root "current.json") ("RUNTIME_CURRENT_INVALID:" + $Family)
    if ([string]$current.runtime_id -ne $RuntimeId -or [string]$current.version -ne $ExpectedVersion) {
        Fail ("RUNTIME_CURRENT_VERSION_MISMATCH:" + $Family)
    }
    $marker = Read-Json (Join-Path (Join-Path $root $ExpectedVersion) ".tda-runtime.json") ("RUNTIME_MARKER_INVALID:" + $Family)
    if (
        [string]$marker.runtime_id -ne $RuntimeId -or
        [string]$marker.version -ne $ExpectedVersion -or
        [string]$marker.archive_sha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$marker.worker_sha256 -notmatch '^[a-f0-9]{64}$'
    ) {
        Fail ("RUNTIME_MARKER_IDENTITY_MISMATCH:" + $Family)
    }
    return [ordered]@{
        version = $ExpectedVersion
        archive_sha256 = [string]$marker.archive_sha256
        worker_sha256 = [string]$marker.worker_sha256
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
        $detail = [string]$_.ErrorDetails.Message
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') {
            Fail ("CRAIG_" + $Matches[1])
        }
        Fail "CRAIG_UPLOAD_FAILED"
    }
}

function Submit-Transcription([string]$Token, [string]$SourceId, [string]$IdempotencyKey) {
    $body = @{
        kind = "transcription.craig"
        campaign_id = "stable-smoke"
        session_id = "stable-smoke"
        source_id = $SourceId
        profile_id = "qwen-fast"
        glossary = ""
        context = ""
        cpu = $false
    } | ConvertTo-Json -Depth 16 -Compress
    try {
        return Invoke-RestMethod -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/jobs" -Headers @{
            Origin = $Origin
            Authorization = "Bearer $Token"
            Accept = "application/json"
            "Idempotency-Key" = $IdempotencyKey
        } -ContentType "application/json" -Body $body -TimeoutSec 30
    } catch {
        $detail = [string]$_.ErrorDetails.Message
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') {
            Fail ("STABLE_SMOKE_JOB_SUBMIT_" + $Matches[1])
        }
        Fail "STABLE_SMOKE_JOB_SUBMIT_FAILED"
    }
}

function Wait-JobSucceeded([string]$Token, [string]$JobId) {
    $deadline = [DateTimeOffset]::UtcNow.AddHours(1)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $job = Invoke-AgentJson $Token "GET" "/jobs/$JobId"
        if ([string]$job.status -eq "succeeded") { return $job }
        if ([string]$job.status -in @("failed", "cancelled", "interrupted")) {
            $code = if ($null -ne $job.error -and $job.error.code) { [string]$job.error.code } else { [string]$job.status }
            Fail ("STABLE_SMOKE_JOB_TERMINAL:" + $code)
        }
        Start-Sleep -Seconds 1
    }
    Fail "STABLE_SMOKE_JOB_TIMEOUT"
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Fail "WINDOWS_REQUIRED" }
if ($PSVersionTable.PSVersion -lt [Version]"7.4") { Fail "POWERSHELL_7_4_REQUIRED" }
if (-not $env:LOCALAPPDATA) { Fail "LOCALAPPDATA_NOT_FOUND" }
if ($null -eq (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { Fail "NVIDIA_SMI_REQUIRED" }

$gpuRows = @(& nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits 2>$null)
if ($LASTEXITCODE -ne 0 -or @($gpuRows | Where-Object { $_ -like "*$RequireGpuName*" }).Count -eq 0) {
    Fail "REQUIRED_GPU_NOT_FOUND"
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$generator = Join-Path $PSScriptRoot "generate-physical-acceptance-fixture.ps1"
if (-not (Test-Path -LiteralPath $generator -PathType Leaf)) { Fail "FIXTURE_GENERATOR_MISSING" }

if (-not $ResultsRoot) { $ResultsRoot = Join-Path $repoRoot "TDA-PROCESSING-STABLE-SMOKE" }
$stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss")
$runRoot = Join-Path ([IO.Path]::GetFullPath($ResultsRoot)) ("STABLE-" + $stamp)
$private = Join-Path $runRoot "_private"
$downloads = Join-Path $private "downloads"
$fixtureRoot = Join-Path $private "fixture"
$share = Join-Path $runRoot "SEND-THIS"
New-Item -ItemType Directory -Force -Path $downloads, $fixtureRoot, $share | Out-Null

$summaryPath = Join-Path $share "STABLE-SMOKE.json"
$manifestPath = Join-Path $share "EVIDENCE-MANIFEST.json"
$zipPath = "$share.zip"
$passed = $false
$phase = "bootstrap"
$failureCode = $null
$jobId = ""
$runId = ""
$resultSha = ""
$sourceId = ""
$installMode = ""
$whisperRuntime = $null
$qwenRuntime = $null

try {
    Write-Host "TDA PROCESSING STABLE SMOKE" -ForegroundColor Cyan

    $phase = "web_manifest"
    $manifestResponse = Invoke-WebRequest -UseBasicParsing -Uri "$Origin/api/downloads/companion/windows/manifest" -Headers @{
        Accept = "application/json"
        "Cache-Control" = "no-cache"
        Pragma = "no-cache"
    } -TimeoutSec 30
    if ([int]$manifestResponse.StatusCode -ne 200) { Fail "WEB_STABLE_MANIFEST_HTTP_INVALID" }
    if ([string]$manifestResponse.Headers["Cache-Control"] -notmatch 'no-store') { Fail "WEB_STABLE_MANIFEST_CACHE_INVALID" }
    $manifest = $manifestResponse.Content | ConvertFrom-Json -Depth 32
    if (
        [string]$manifest.channel -ne "stable" -or
        [string]$manifest.version -ne $ExpectedStableVersion -or
        [string]$manifest.tag -ne $ExpectedStableTag -or
        [string]$manifest.minimum_api -ne "1" -or
        [string]$manifest.minimum_service_version -ne "0.3.14" -or
        [string]$manifest.asset.url -ne "/api/downloads/companion/windows?tag=$ExpectedStableTag" -or
        [string]$manifest.asset.sha256 -notmatch '^[a-f0-9]{64}$' -or
        [int64]$manifest.asset.size -le 0
    ) {
        Fail "WEB_STABLE_MANIFEST_IDENTITY_INVALID"
    }

    $phase = "web_download"
    $msi = Join-Path $downloads "TDACompanion-x64.msi"
    Invoke-WebRequest -UseBasicParsing -Uri ($Origin + [string]$manifest.asset.url) -OutFile $msi -TimeoutSec 900
    if ((Get-Item $msi).Length -ne [int64]$manifest.asset.size) { Fail "WEB_STABLE_MSI_SIZE_MISMATCH" }
    if ((Get-Sha256 $msi) -ne [string]$manifest.asset.sha256) { Fail "WEB_STABLE_MSI_HASH_MISMATCH" }

    $phase = "stable_release_identity"
    $release = Get-PublicRelease $ExpectedStableTag
    [void](Get-PublicRelease $ExpectedWhisperStableTag)
    [void](Get-PublicRelease $ExpectedQwenStableTag)

    $candidatePath = Join-Path $downloads "TDACompanion-candidate.json"
    $payloadPath = Join-Path $downloads "TDACompanion-payload-manifest.json"
    [void](Download-ReleaseAsset $release "TDACompanion-candidate.json" $candidatePath)
    [void](Download-ReleaseAsset $release "TDACompanion-payload-manifest.json" $payloadPath)
    $candidate = Read-Json $candidatePath "STABLE_CANDIDATE_INVALID"
    $payload = Read-Json $payloadPath "STABLE_PAYLOAD_INVALID"
    if (
        [string]$candidate.schema -ne "tda_companion_candidate_v2" -or
        [string]$candidate.version -ne $ExpectedStableVersion -or
        [string]$candidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
        [string]$candidate.source_tree_sha -notmatch '^[a-f0-9]{40}$' -or
        [string]$candidate.assets.msi.sha256 -ne [string]$manifest.asset.sha256 -or
        [int64]$candidate.assets.msi.size -ne [int64]$manifest.asset.size -or
        [string]$payload.schema -ne "tda_companion_payload_v1" -or
        [string]$payload.version -ne $ExpectedStableVersion -or
        [string]$payload.source_sha -ne [string]$candidate.source_sha -or
        [string]$payload.source_tree_sha -ne [string]$candidate.source_tree_sha
    ) {
        Fail "STABLE_RELEASE_PAYLOAD_IDENTITY_INVALID"
    }

    $phase = "active_work_preflight"
    Assert-NoActiveUserWork

    $phase = "stable_install"
    $currentVersionPath = Join-Path $env:LOCALAPPDATA "TDA\Companion\current-version.txt"
    $currentVersion = ""
    if (Test-Path -LiteralPath $currentVersionPath -PathType Leaf) {
        try { $currentVersion = (Get-Content -LiteralPath $currentVersionPath -Raw -Encoding UTF8).Trim() } catch {}
    }
    if ($currentVersion -eq $ExpectedStableVersion -and (Test-InstalledPayload $candidate $payload)) {
        $installMode = "reused_exact"
    } else {
        $install = Start-Process msiexec.exe -ArgumentList @("/i", ('"{0}"' -f $msi), "/qn", "/norestart") -Wait -PassThru
        if ([int]$install.ExitCode -notin @(0, 3010)) { Fail "STABLE_MSI_INSTALL_FAILED" }
        if (-not (Test-InstalledPayload $candidate $payload)) { Fail "STABLE_INSTALLED_PAYLOAD_MISMATCH" }
        $installMode = "installed"
    }

    $appRoot = Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$ExpectedStableVersion"
    $exe = Join-Path $appRoot "TDACompanion.exe"
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Fail "STABLE_COMPANION_EXE_MISSING" }
    $health = Wait-ExactAgent 20
    if ($null -eq $health) {
        Start-Process $exe -ArgumentList @("--agent", "--startup", "--port", [string]$Port) | Out-Null
        $health = Wait-ExactAgent 60
    }
    if ($null -eq $health) { Fail "STABLE_AGENT_NOT_READY" }

    $phase = "synthetic_fixture"
    & $generator -OutputRoot $fixtureRoot -TargetSeconds 80 -CraigTrackCount 2
    if ($LASTEXITCODE -ne 0) { Fail "STABLE_SMOKE_FIXTURE_FAILED" }
    $craigPath = Join-Path $fixtureRoot "tda-installed-acceptance-craig.zip"
    if (-not (Test-Path -LiteralPath $craigPath -PathType Leaf)) { Fail "STABLE_SMOKE_CRAIG_MISSING" }

    $phase = "browser_session"
    $token = New-BrowserSession
    $craig = Upload-Craig $token $craigPath
    $sourceId = [string]$craig.source_id
    if ($sourceId -notmatch '^craig-[a-f0-9]{64}$' -or [int]$craig.track_count -lt 2) {
        Fail "STABLE_SMOKE_CRAIG_INGEST_INVALID"
    }

    $phase = "stable_runtime_preparation"
    [void](Ensure-ProfileReady $token $sourceId "whisper-turbo")
    [void](Ensure-ProfileReady $token $sourceId "qwen-fast")
    $whisperRuntime = Assert-RuntimeCurrent "whisper" $ExpectedWhisperRuntimeVersion "whisper-ctranslate2"
    $qwenRuntime = Assert-RuntimeCurrent "qwen" $ExpectedQwenRuntimeVersion "qwen3-transformers"

    $phase = "qwen_fast_processing"
    $idempotencyKey = "stable-smoke-" + [Guid]::NewGuid().ToString("N")
    $job = Submit-Transcription $token $sourceId $idempotencyKey
    $jobId = [string]$job.id
    if (-not $jobId) { Fail "STABLE_SMOKE_JOB_ID_MISSING" }

    $replay = Submit-Transcription $token $sourceId $idempotencyKey
    if ([string]$replay.id -ne $jobId) {
        Fail "STABLE_SMOKE_IDEMPOTENCY_REPLAY_MISMATCH"
    }

    $terminal = Wait-JobSucceeded $token $jobId
    if ([string]$terminal.status -ne "succeeded" -or $terminal.result_available -ne $true) {
        Fail "STABLE_SMOKE_JOB_RESULT_NOT_AVAILABLE"
    }

    $events = Invoke-AgentJson $token "GET" "/jobs/$jobId/events"
    $eventRows = @($events.events)
    if (@($eventRows | Where-Object { [string]$_.code -eq "QWEN_WINDOW_TRANSCRIBED" }).Count -lt 1) {
        Fail "STABLE_SMOKE_QWEN_ACTIVITY_MISSING"
    }
    if (@($eventRows | Where-Object { [string]$_.code -eq "RUN_COMMIT_FENCE_WON" }).Count -lt 1) {
        Fail "STABLE_SMOKE_RUN_COMMIT_MISSING"
    }

    $result = Invoke-AgentJson $token "GET" "/jobs/$jobId/result"
    $transcription = $result.transcription
    $runId = [string]$transcription.run_id
    $resultSha = [string]$transcription.sha256
    if ($runId -notmatch '^[A-Za-z0-9_-]{1,160}$' -or $resultSha -notmatch '^[a-f0-9]{64}$') {
        Fail "STABLE_SMOKE_RESULT_IDENTITY_INVALID"
    }

    $packageRoot = Join-Path $env:LOCALAPPDATA ("TDA\Data\staging\" + $sourceId)
    $runRootLocal = Join-Path (Join-Path $packageRoot "runs") $runId
    $markerPath = Join-Path $runRootLocal "run.json"
    $transcriptPath = Join-Path $runRootLocal "transcript.json"
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { Fail "STABLE_SMOKE_RUN_MARKER_MISSING" }
    if (-not (Test-Path -LiteralPath $transcriptPath -PathType Leaf)) { Fail "STABLE_SMOKE_TRANSCRIPT_MISSING" }
    $marker = Read-Json $markerPath "STABLE_SMOKE_RUN_MARKER_INVALID"
    if (
        [string]$marker.run_id -ne $runId -or
        [string]$marker.job_id -ne $jobId -or
        [string]$marker.profile_id -ne "qwen-fast" -or
        [string]$marker.transcript_sha256 -ne $resultSha
    ) {
        Fail "STABLE_SMOKE_RUN_MARKER_IDENTITY_INVALID"
    }
    if ((Get-Sha256 $transcriptPath) -ne $resultSha) { Fail "STABLE_SMOKE_TRANSCRIPT_HASH_MISMATCH" }

    $passed = $true
} catch {
    $failureCode = [string]$_.Exception.Message
    if ($failureCode -notmatch '^[A-Z0-9_.:-]{1,200}$') { $failureCode = "STABLE_SMOKE_FAILED" }
    Write-Host ("STABLE SMOKE FAILED phase={0} code={1}" -f $phase, $failureCode) -ForegroundColor Red
} finally {
    Write-Json $summaryPath ([ordered]@{
        schema = "tda_processing_stable_smoke_v1"
        pass = $passed
        completed_at = [DateTimeOffset]::UtcNow.ToString("o")
        phase = $phase
        failure_code = $failureCode
        web_origin = $Origin
        stable_tag = $ExpectedStableTag
        stable_version = $ExpectedStableVersion
        web_msi_sha256 = if (Test-Path -LiteralPath (Join-Path $downloads "TDACompanion-x64.msi") -PathType Leaf) { Get-Sha256 (Join-Path $downloads "TDACompanion-x64.msi") } else { $null }
        install_mode = $installMode
        whisper_runtime = $whisperRuntime
        qwen_runtime = $qwenRuntime
        profile_id = "qwen-fast"
        source_id = $sourceId
        job_id = $jobId
        run_id = $runId
        transcript_sha256 = $resultSha
        gpu_requirement = $RequireGpuName
        contains_audio = $false
        contains_transcript = $false
        contains_token = $false
        contains_paths = $false
    })

    Remove-Item $manifestPath -Force -ErrorAction SilentlyContinue
    $evidence = @(Get-ChildItem -LiteralPath $share -File | Sort-Object Name | ForEach-Object {
        [ordered]@{
            path = $_.Name
            bytes = [int64]$_.Length
            sha256 = Get-Sha256 $_.FullName
        }
    })
    Write-Json $manifestPath $evidence
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    try { Compress-Archive -Path (Join-Path $share "*") -DestinationPath $zipPath -CompressionLevel Optimal }
    catch { Write-Warning "STABLE_SMOKE_EVIDENCE_ZIP_FAILED" }

    Write-Host ("Stable smoke evidence: " + $zipPath) -ForegroundColor Cyan
}

if ($passed) {
    Write-Host "PROCESSING STABLE SMOKE: PASS" -ForegroundColor Green
    exit 0
}
exit 1
