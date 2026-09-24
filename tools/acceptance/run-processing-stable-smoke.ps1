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

function Get-NestedPropertyValue([object]$Object, [string[]]$Path) {
    $current = $Object
    foreach ($name in $Path) {
        $current = Get-OptionalPropertyValue $current $name
        if ($null -eq $current) { return $null }
    }
    return $current
}

function Get-ErrorDetailMessage([object]$ErrorRecord) {
    $details = Get-OptionalPropertyValue $ErrorRecord "ErrorDetails"
    return [string](Get-OptionalPropertyValue $details "Message")
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
        [string](Get-OptionalPropertyValue $value "tag_name") -ne $Tag -or
        (Get-OptionalPropertyValue $value "draft") -ne $false -or
        (Get-OptionalPropertyValue $value "prerelease") -ne $false
    ) {
        Fail ("STABLE_RELEASE_IDENTITY_INVALID:" + $Tag)
    }
    return $value
}

function Get-ReleaseAsset([object]$Release, [string]$Name) {
    $assets = Get-OptionalPropertyValue $Release "assets"
    $rows = @(@($assets) | Where-Object { [string](Get-OptionalPropertyValue $_ "name") -eq $Name })
    if ($rows.Count -ne 1) { Fail ("STABLE_RELEASE_ASSET_COUNT_INVALID:" + $Name) }
    $asset = $rows[0]
    $size = Get-OptionalPropertyValue $asset "size"
    $downloadUrl = [string](Get-OptionalPropertyValue $asset "browser_download_url")
    if ($null -eq $size -or [int64]$size -le 0 -or $downloadUrl -notmatch '^https://github\.com/Faysk/tda/releases/download/') {
        Fail ("STABLE_RELEASE_ASSET_INVALID:" + $Name)
    }
    return $asset
}

function Download-ReleaseAsset([object]$Release, [string]$Name, [string]$Destination) {
    $asset = Get-ReleaseAsset $Release $Name
    $downloadUrl = [string](Get-OptionalPropertyValue $asset "browser_download_url")
    $expectedSize = Get-OptionalPropertyValue $asset "size"
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $Destination -TimeoutSec 900
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf) -or $null -eq $expectedSize -or (Get-Item $Destination).Length -ne [int64]$expectedSize) {
        Fail ("STABLE_RELEASE_ASSET_DOWNLOAD_INVALID:" + $Name)
    }
    $digest = [string](Get-OptionalPropertyValue $asset "digest")
    if ($digest -match '^sha256:([a-f0-9]{64})$') {
        if ((Get-Sha256 $Destination) -ne $Matches[1]) {
            Fail ("STABLE_RELEASE_ASSET_HASH_MISMATCH:" + $Name)
        }
    }
    return $asset
}

function Get-AgentHealth {
    try {
        $value = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        $healthPort = Get-OptionalPropertyValue $value "port"
        $healthPid = Get-OptionalPropertyValue $value "pid"
        if (
            [string](Get-OptionalPropertyValue $value "product_id") -ne "tda-companion" -or
            [string](Get-OptionalPropertyValue $value "api_version") -ne "1" -or
            $null -eq $healthPort -or [int]$healthPort -ne $Port -or
            $null -eq $healthPid -or [int]$healthPid -le 0
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
        $detail = Get-ErrorDetailMessage $_
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
    $jobRows = Get-OptionalPropertyValue $jobs "jobs"
    if ($null -eq $jobRows) { Fail "ACTIVE_WORK_JOBS_RESPONSE_INVALID" }
    if (@(@($jobRows) | Where-Object { [string](Get-OptionalPropertyValue $_ "status") -in @("queued", "running") }).Count -gt 0) {
        Fail "ACTIVE_USER_JOB_PRESENT_BEFORE_STABLE_SMOKE"
    }
    $preparation = Invoke-AgentJson $token "GET" "/preparation"
    if ((Get-OptionalPropertyValue $preparation "active") -eq $true) {
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

function Test-MsiProductCode([string]$Value) {
    $guid = [Guid]::Empty
    return [Guid]::TryParseExact($Value, "B", [ref]$guid)
}

function Get-StableRuntimeIdentity(
    [object]$Release,
    [string]$Family,
    [string]$ExpectedVersion,
    [string]$ExpectedRuntimeId,
    [string]$Destination
) {
    [void](Download-ReleaseAsset $Release "TDARuntime-candidate.json" $Destination)
    $candidate = Read-Json $Destination ("STABLE_RUNTIME_CANDIDATE_INVALID:" + $Family)
    $archiveSha = [string](Get-OptionalPropertyValue $candidate "runtime_archive_sha256")
    if (
        [string](Get-OptionalPropertyValue $candidate "schema") -ne "tda_runtime_candidate_v1" -or
        [string](Get-OptionalPropertyValue $candidate "family") -ne $Family -or
        [string](Get-OptionalPropertyValue $candidate "runtime_id") -ne $ExpectedRuntimeId -or
        [string](Get-OptionalPropertyValue $candidate "version") -ne $ExpectedVersion -or
        $archiveSha -notmatch '^[a-f0-9]{64}$'
    ) {
        Fail ("STABLE_RUNTIME_CANDIDATE_IDENTITY_INVALID:" + $Family)
    }
    return [ordered]@{
        version = $ExpectedVersion
        runtime_id = $ExpectedRuntimeId
        archive_sha256 = $archiveSha
    }
}

function Wait-ExactAgent([int]$Seconds = 60) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $health = Get-AgentHealth
        if (
            $null -ne $health -and
            [string](Get-OptionalPropertyValue $health "service_version") -eq $ExpectedStableVersion -and
            [string](Get-OptionalPropertyValue $health "lifecycle") -eq "ready"
        ) {
            return $health
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function Get-ReadyProfiles([object]$Capabilities) {
    $transcription = Get-OptionalPropertyValue $Capabilities "transcription"
    $profiles = Get-OptionalPropertyValue $transcription "profiles"
    if ($null -eq $profiles) { Fail "CAPABILITIES_TRANSCRIPTION_PROFILES_INVALID" }
    return @(@($profiles) | ForEach-Object { [string]$_ })
}

function Ensure-ProfileReady([string]$Token, [string]$SourceId, [string]$ProfileId) {
    $capabilities = Invoke-AgentJson $Token "GET" "/capabilities"
    $ready = @(Get-ReadyProfiles $capabilities)
    if ($ProfileId -in $ready) { return "already_ready" }

    $started = Invoke-AgentJson $Token "POST" "/preparation" @{
        source_id = $SourceId
        profile_id = $ProfileId
    }
    if (
        [string](Get-OptionalPropertyValue $started "schema") -ne "tda_profile_preparation_v1" -or
        [string](Get-OptionalPropertyValue $started "source_id") -ne $SourceId -or
        [string](Get-OptionalPropertyValue $started "profile_id") -ne $ProfileId
    ) {
        Fail ("PROFILE_PREPARATION_START_INVALID:" + $ProfileId)
    }

    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(40)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $status = Invoke-AgentJson $Token "GET" "/preparation"
        $statusProfile = [string](Get-OptionalPropertyValue $status "profile_id")
        $statusState = [string](Get-OptionalPropertyValue $status "state")
        if ($statusProfile -ne $ProfileId) {
            Fail ("PROFILE_PREPARATION_IDENTITY_INVALID:" + $ProfileId)
        }
        if ($statusState -eq "completed") {
            $capabilities = Invoke-AgentJson $Token "GET" "/capabilities"
            $ready = @(Get-ReadyProfiles $capabilities)
            if ($ProfileId -notin $ready) { Fail ("PROFILE_PREPARATION_NOT_VISIBLE:" + $ProfileId) }
            return "prepared"
        }
        if ($statusState -eq "failed") {
            $errorCode = [string](Get-OptionalPropertyValue $status "error_code")
            $code = if ($errorCode) { $errorCode } else { "PROFILE_PREPARATION_FAILED" }
            Fail ($code + ":" + $ProfileId)
        }
        if ($statusState -eq "cancelled") {
            Fail ("PROFILE_PREPARATION_CANCELLED:" + $ProfileId)
        }
        Start-Sleep -Seconds 1
    }
    Fail ("PROFILE_PREPARATION_TIMEOUT:" + $ProfileId)
}

function Assert-RuntimeCurrent(
    [string]$Family,
    [string]$ExpectedVersion,
    [string]$RuntimeId,
    [string]$ExpectedArchiveSha256
) {
    $root = Join-Path $env:LOCALAPPDATA "TDA\Runtime\$Family"
    $current = Read-Json (Join-Path $root "current.json") ("RUNTIME_CURRENT_INVALID:" + $Family)
    if (
        [string](Get-OptionalPropertyValue $current "runtime_id") -ne $RuntimeId -or
        [string](Get-OptionalPropertyValue $current "version") -ne $ExpectedVersion
    ) {
        Fail ("RUNTIME_CURRENT_VERSION_MISMATCH:" + $Family)
    }

    $marker = Read-Json (Join-Path (Join-Path $root $ExpectedVersion) ".tda-runtime.json") ("RUNTIME_MARKER_INVALID:" + $Family)
    $archiveSha = [string](Get-OptionalPropertyValue $marker "archive_sha256")
    $workerSha = [string](Get-OptionalPropertyValue $marker "worker_sha256")
    if (
        [string](Get-OptionalPropertyValue $marker "runtime_id") -ne $RuntimeId -or
        [string](Get-OptionalPropertyValue $marker "version") -ne $ExpectedVersion -or
        $archiveSha -ne $ExpectedArchiveSha256 -or
        $workerSha -notmatch '^[a-f0-9]{64}$'
    ) {
        Fail ("RUNTIME_MARKER_IDENTITY_MISMATCH:" + $Family)
    }

    return [ordered]@{
        version = $ExpectedVersion
        archive_sha256 = $archiveSha
        worker_sha256 = $workerSha
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
        $detail = Get-ErrorDetailMessage $_
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
        $status = [string](Get-OptionalPropertyValue $job "status")
        if (-not $status) { Fail "STABLE_SMOKE_JOB_STATUS_MISSING" }
        if ($status -eq "succeeded") { return $job }
        if ($status -in @("failed", "cancelled", "interrupted")) {
            $errorValue = Get-OptionalPropertyValue $job "error"
            $errorCode = [string](Get-OptionalPropertyValue $errorValue "code")
            $code = if ($errorCode) { $errorCode } else { $status }
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
    $manifestAsset = Get-OptionalPropertyValue $manifest "asset"
    $manifestAssetUrl = [string](Get-OptionalPropertyValue $manifestAsset "url")
    $manifestAssetSha = [string](Get-OptionalPropertyValue $manifestAsset "sha256")
    $manifestAssetSize = Get-OptionalPropertyValue $manifestAsset "size"
    if (
        [string](Get-OptionalPropertyValue $manifest "channel") -ne "stable" -or
        [string](Get-OptionalPropertyValue $manifest "version") -ne $ExpectedStableVersion -or
        [string](Get-OptionalPropertyValue $manifest "tag") -ne $ExpectedStableTag -or
        [string](Get-OptionalPropertyValue $manifest "minimum_api") -ne "1" -or
        [string](Get-OptionalPropertyValue $manifest "minimum_service_version") -ne "0.3.14" -or
        $manifestAssetUrl -ne "/api/downloads/companion/windows?tag=$ExpectedStableTag" -or
        $manifestAssetSha -notmatch '^[a-f0-9]{64}$' -or
        $null -eq $manifestAssetSize -or [int64]$manifestAssetSize -le 0
    ) {
        Fail "WEB_STABLE_MANIFEST_IDENTITY_INVALID"
    }

    $phase = "web_download"
    $msi = Join-Path $downloads "TDACompanion-x64.msi"
    Invoke-WebRequest -UseBasicParsing -Uri ($Origin + $manifestAssetUrl) -OutFile $msi -TimeoutSec 900
    if ((Get-Item $msi).Length -ne [int64]$manifestAssetSize) { Fail "WEB_STABLE_MSI_SIZE_MISMATCH" }
    if ((Get-Sha256 $msi) -ne $manifestAssetSha) { Fail "WEB_STABLE_MSI_HASH_MISMATCH" }

    $phase = "stable_release_identity"
    $release = Get-PublicRelease $ExpectedStableTag
    $whisperRelease = Get-PublicRelease $ExpectedWhisperStableTag
    $qwenRelease = Get-PublicRelease $ExpectedQwenStableTag
    $whisperExpected = Get-StableRuntimeIdentity $whisperRelease "whisper" $ExpectedWhisperRuntimeVersion "whisper-ctranslate2" (Join-Path $downloads "whisper-stable-candidate.json")
    $qwenExpected = Get-StableRuntimeIdentity $qwenRelease "qwen" $ExpectedQwenRuntimeVersion "qwen3-transformers" (Join-Path $downloads "qwen-stable-candidate.json")

    $candidatePath = Join-Path $downloads "TDACompanion-candidate.json"
    $payloadPath = Join-Path $downloads "TDACompanion-payload-manifest.json"
    [void](Download-ReleaseAsset $release "TDACompanion-candidate.json" $candidatePath)
    [void](Download-ReleaseAsset $release "TDACompanion-payload-manifest.json" $payloadPath)
    $candidate = Read-Json $candidatePath "STABLE_CANDIDATE_INVALID"
    $payload = Read-Json $payloadPath "STABLE_PAYLOAD_INVALID"
    $candidateSourceSha = [string](Get-OptionalPropertyValue $candidate "source_sha")
    $candidateTreeSha = [string](Get-OptionalPropertyValue $candidate "source_tree_sha")
    $candidateMsi = Get-NestedPropertyValue $candidate @("assets", "msi")
    $candidateMsiSha = [string](Get-OptionalPropertyValue $candidateMsi "sha256")
    $candidateMsiSize = Get-OptionalPropertyValue $candidateMsi "size"
    if (
        [string](Get-OptionalPropertyValue $candidate "schema") -ne "tda_companion_candidate_v2" -or
        [string](Get-OptionalPropertyValue $candidate "version") -ne $ExpectedStableVersion -or
        $candidateSourceSha -notmatch '^[a-f0-9]{40}$' -or
        $candidateTreeSha -notmatch '^[a-f0-9]{40}$' -or
        $candidateMsiSha -ne $manifestAssetSha -or
        $null -eq $candidateMsiSize -or [int64]$candidateMsiSize -ne [int64]$manifestAssetSize -or
        [string](Get-OptionalPropertyValue $payload "schema") -ne "tda_companion_payload_v1" -or
        [string](Get-OptionalPropertyValue $payload "version") -ne $ExpectedStableVersion -or
        [string](Get-OptionalPropertyValue $payload "source_sha") -ne $candidateSourceSha -or
        [string](Get-OptionalPropertyValue $payload "source_tree_sha") -ne $candidateTreeSha
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
        if ($currentVersion -eq $ExpectedStableVersion) {
            $registryKey = "HKCU:\Software\Faysk\TDA Companion"
            if (-not (Test-Path $registryKey)) { Fail "SUPERSEDED_PRODUCT_REGISTRY_MISSING" }
            $metadata = Get-ItemProperty $registryKey
            if ([string](Get-OptionalPropertyValue $metadata "Version") -ne $ExpectedStableVersion) { Fail "SUPERSEDED_VERSION_MISMATCH" }
            $productCode = [string](Get-OptionalPropertyValue $metadata "ProductCode")
            if (-not (Test-MsiProductCode $productCode)) { Fail "SUPERSEDED_PRODUCT_CODE_INVALID" }
            $uninstall = Start-Process msiexec.exe -ArgumentList @("/x", $productCode, "/qn", "/norestart") -Wait -PassThru
            if ([int]$uninstall.ExitCode -notin @(0, 3010)) { Fail "SUPERSEDED_UNINSTALL_FAILED" }
            $installMode = "replaced_superseded_same_version"
        } else {
            $installMode = "installed"
        }

        $install = Start-Process msiexec.exe -ArgumentList @("/i", ('"{0}"' -f $msi), "/qn", "/norestart") -Wait -PassThru
        if ([int]$install.ExitCode -notin @(0, 3010)) { Fail "STABLE_MSI_INSTALL_FAILED" }
        if (-not (Test-InstalledPayload $candidate $payload)) { Fail "STABLE_INSTALLED_PAYLOAD_MISMATCH" }
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
    $sourceId = [string](Get-OptionalPropertyValue $craig "source_id")
    $craigTrackCount = Get-OptionalPropertyValue $craig "track_count"
    if ($sourceId -notmatch '^craig-[a-f0-9]{64}$' -or $null -eq $craigTrackCount -or [int]$craigTrackCount -lt 2) {
        Fail "STABLE_SMOKE_CRAIG_INGEST_INVALID"
    }

    $phase = "stable_runtime_preparation"
    [void](Ensure-ProfileReady $token $sourceId "whisper-turbo")
    [void](Ensure-ProfileReady $token $sourceId "qwen-fast")
    $whisperRuntime = Assert-RuntimeCurrent "whisper" $ExpectedWhisperRuntimeVersion "whisper-ctranslate2" ([string](Get-OptionalPropertyValue $whisperExpected "archive_sha256"))
    $qwenRuntime = Assert-RuntimeCurrent "qwen" $ExpectedQwenRuntimeVersion "qwen3-transformers" ([string](Get-OptionalPropertyValue $qwenExpected "archive_sha256"))

    $phase = "qwen_fast_processing"
    $idempotencyKey = "stable-smoke-" + [Guid]::NewGuid().ToString("N")
    $job = Submit-Transcription $token $sourceId $idempotencyKey
    $jobId = [string](Get-OptionalPropertyValue $job "id")
    if (-not $jobId) { Fail "STABLE_SMOKE_JOB_ID_MISSING" }

    $replay = Submit-Transcription $token $sourceId $idempotencyKey
    if ([string](Get-OptionalPropertyValue $replay "id") -ne $jobId) {
        Fail "STABLE_SMOKE_IDEMPOTENCY_REPLAY_MISMATCH"
    }

    $terminal = Wait-JobSucceeded $token $jobId
    if (
        [string](Get-OptionalPropertyValue $terminal "status") -ne "succeeded" -or
        (Get-OptionalPropertyValue $terminal "result_available") -ne $true
    ) {
        Fail "STABLE_SMOKE_JOB_RESULT_NOT_AVAILABLE"
    }

    $events = Invoke-AgentJson $token "GET" "/jobs/$jobId/events"
    $rawEventRows = Get-OptionalPropertyValue $events "events"
    if ($null -eq $rawEventRows) { Fail "STABLE_SMOKE_EVENTS_RESPONSE_INVALID" }
    $eventRows = @($rawEventRows)
    if (@($eventRows | Where-Object { [string](Get-OptionalPropertyValue $_ "code") -eq "QWEN_WINDOW_TRANSCRIBED" }).Count -lt 1) {
        Fail "STABLE_SMOKE_QWEN_ACTIVITY_MISSING"
    }
    if (@($eventRows | Where-Object { [string](Get-OptionalPropertyValue $_ "code") -eq "RUN_COMMIT_FENCE_WON" }).Count -lt 1) {
        Fail "STABLE_SMOKE_RUN_COMMIT_MISSING"
    }

    $result = Invoke-AgentJson $token "GET" "/jobs/$jobId/result"
    $transcription = Get-OptionalPropertyValue $result "transcription"
    if ($null -eq $transcription) { Fail "STABLE_SMOKE_RESULT_TRANSCRIPTION_MISSING" }
    $runId = [string](Get-OptionalPropertyValue $transcription "run_id")
    $resultSha = [string](Get-OptionalPropertyValue $transcription "sha256")
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
        [string](Get-OptionalPropertyValue $marker "run_id") -ne $runId -or
        [string](Get-OptionalPropertyValue $marker "job_id") -ne $jobId -or
        [string](Get-OptionalPropertyValue $marker "profile_id") -ne "qwen-fast" -or
        [string](Get-OptionalPropertyValue $marker "transcript_sha256") -ne $resultSha
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
