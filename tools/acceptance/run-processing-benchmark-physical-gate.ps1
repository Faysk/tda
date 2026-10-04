[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CraigZip,
    [Parameter(Mandatory = $true)][string]$CompanionPayloadManifest,
    [Parameter(Mandatory = $true)][string]$WhisperRuntimeCandidateManifest,
    [Parameter(Mandatory = $true)][string]$QwenRuntimeCandidateManifest,
    [string]$RequireGpuName = "RTX 4070",
    [ValidateRange(1024, 65535)][int]$Port = 8765,
    [string]$OutputRoot = "",
    [string]$HumanReferenceJson = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Origin = "https://dnd.faysk.dev"
$RequiredProfiles = @("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality")
$ReceiptSchema = "tda_processing_1233_physical_acceptance_v1"
. (Join-Path $PSScriptRoot "verify-processing-benchmark-quality-handoff.ps1")

function Fail([string]$Code) {
    throw [InvalidOperationException]::new($Code)
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

function Read-Json([string]$Path, [string]$Code) {
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64 -ErrorAction Stop }
    catch { Fail $Code }
}

function Write-Json([string]$Path, [object]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $temporary = "$Path.partial"
    $Value | ConvertTo-Json -Depth 64 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Assert-Sha256([object]$Value, [string]$Code) {
    if ([string]$Value -notmatch '^[a-f0-9]{64}$') { Fail $Code }
}

function Assert-RuntimeCandidateCompatibility([object]$Candidate, [string]$Family, [Version]$MinimumVersion) {
    $sourceSha = [string](Get-OptionalPropertyValue $Candidate "source_sha")
    $sourceTreeSha = [string](Get-OptionalPropertyValue $Candidate "source_tree_sha")
    $candidateTag = [string](Get-OptionalPropertyValue $Candidate "candidate_tag")
    $versionText = [string](Get-OptionalPropertyValue $Candidate "version")
    if (
        $sourceSha -notmatch '^[a-f0-9]{40}$' -or
        $sourceTreeSha -notmatch '^[a-f0-9]{40}$'
    ) { Fail ("BENCHMARK_RUNTIME_SOURCE_IDENTITY_INVALID:" + $Family) }

    try { $version = [Version]$versionText }
    catch { Fail ("BENCHMARK_RUNTIME_VERSION_INVALID:" + $Family) }
    if ($version -lt $MinimumVersion) {
        Fail ("BENCHMARK_RUNTIME_VERSION_UNSUPPORTED:" + $Family)
    }

    $tagPattern = if ($Family -eq "whisper") {
        '^companion-whisper-runtime-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$'
    } else {
        '^companion-qwen-runtime-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$'
    }
    if (
        $candidateTag -notmatch $tagPattern -or
        -not $candidateTag.EndsWith($sourceSha.Substring(0, 12))
    ) { Fail ("BENCHMARK_RUNTIME_CANDIDATE_TAG_INVALID:" + $Family) }
}

function Get-AgentHealth {
    try {
        $value = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        if (
            [string](Get-OptionalPropertyValue $value "product_id") -ne "tda-companion" -or
            [string](Get-OptionalPropertyValue $value "api_version") -ne "1" -or
            [int](Get-OptionalPropertyValue $value "port") -ne $Port -or
            [int](Get-OptionalPropertyValue $value "pid") -le 0
        ) { return $null }
        return $value
    } catch {
        return $null
    }
}

function Wait-ExactAgent([string]$ExpectedVersion, [int]$Seconds = 60) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $health = Get-AgentHealth
        if (
            $null -ne $health -and
            [string](Get-OptionalPropertyValue $health "service_version") -eq $ExpectedVersion -and
            [string](Get-OptionalPropertyValue $health "lifecycle") -eq "ready"
        ) { return $health }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function New-BrowserSession {
    try {
        $value = Invoke-RestMethod -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/session" -Headers @{
            Origin = $Origin
            Accept = "application/json"
        } -ContentType "application/json" -Body "{}" -TimeoutSec 10
    } catch {
        Fail "BENCHMARK_BROWSER_SESSION_CREATE_FAILED"
    }
    if (
        [string](Get-OptionalPropertyValue $value "schema") -ne "tda_loopback_session_v1" -or
        [string]::IsNullOrWhiteSpace([string](Get-OptionalPropertyValue $value "token"))
    ) { Fail "BENCHMARK_BROWSER_SESSION_INVALID" }
    return [string](Get-OptionalPropertyValue $value "token")
}

function Invoke-AgentJson(
    [string]$Token,
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [int]$TimeoutSec = 30,
    [string]$IdempotencyKey = ""
) {
    $headers = @{
        Origin = $Origin
        Authorization = "Bearer $Token"
        Accept = "application/json"
    }
    if ($IdempotencyKey) { $headers["Idempotency-Key"] = $IdempotencyKey }
    $params = @{
        NoProxy = $true
        Method = $Method
        Uri = "http://127.0.0.1:$Port/api/v1$Path"
        Headers = $headers
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
            Fail ("BENCHMARK_AGENT_API_" + $Matches[1])
        }
        Fail "BENCHMARK_AGENT_API_REQUEST_FAILED"
    }
}

function Assert-NoActiveWork([string]$Token) {
    $jobs = Invoke-AgentJson $Token "GET" "/jobs"
    $rows = Get-OptionalPropertyValue $jobs "jobs"
    if ($null -eq $rows) { Fail "BENCHMARK_ACTIVE_WORK_RESPONSE_INVALID" }
    if (@(@($rows) | Where-Object { [string](Get-OptionalPropertyValue $_ "status") -in @("queued", "running") }).Count -gt 0) {
        Fail "BENCHMARK_ACTIVE_USER_JOB_PRESENT"
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
            Fail ("BENCHMARK_CRAIG_" + $Matches[1])
        }
        Fail "BENCHMARK_CRAIG_UPLOAD_FAILED"
    }
}

function Get-BenchmarkProfileState([string]$Token, [string]$ProfileId) {
    $capabilities = Invoke-AgentJson $Token "GET" "/capabilities"
    $transcription = Get-OptionalPropertyValue $capabilities "transcription"
    $catalog = Get-OptionalPropertyValue $transcription "catalog"
    if ($null -eq $catalog) { Fail "BENCHMARK_CAPABILITIES_CATALOG_INVALID" }
    $rows = @(@($catalog) | Where-Object { [string](Get-OptionalPropertyValue $_ "id") -eq $ProfileId })
    if ($rows.Count -ne 1) { Fail ("BENCHMARK_PROFILE_CATALOG_INVALID:" + $ProfileId) }
    return $rows[0]
}

function Ensure-BenchmarkReady([string]$Token, [string]$SourceId, [string]$ProfileId) {
    $profileState = Get-BenchmarkProfileState $Token $ProfileId
    if ((Get-OptionalPropertyValue $profileState "benchmark_ready") -eq $true) { return "already_ready" }

    $started = Invoke-AgentJson $Token "POST" "/preparation" @{
        source_id = $SourceId
        profile_id = $ProfileId
        purpose = "benchmark"
    } 30
    if (
        [string](Get-OptionalPropertyValue $started "schema") -ne "tda_profile_preparation_v1" -or
        [string](Get-OptionalPropertyValue $started "source_id") -ne $SourceId -or
        [string](Get-OptionalPropertyValue $started "profile_id") -ne $ProfileId -or
        [string](Get-OptionalPropertyValue $started "purpose") -ne "benchmark"
    ) { Fail ("BENCHMARK_PREPARATION_START_INVALID:" + $ProfileId) }

    $deadline = [DateTimeOffset]::UtcNow.AddMinutes(45)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $state = Invoke-AgentJson $Token "GET" "/preparation"
        if (
            [string](Get-OptionalPropertyValue $state "profile_id") -ne $ProfileId -or
            [string](Get-OptionalPropertyValue $state "source_id") -ne $SourceId -or
            [string](Get-OptionalPropertyValue $state "purpose") -ne "benchmark"
        ) { Fail ("BENCHMARK_PREPARATION_IDENTITY_INVALID:" + $ProfileId) }

        if ((Get-OptionalPropertyValue $state "active") -eq $true) {
            Start-Sleep -Seconds 1
            continue
        }

        $terminal = [string](Get-OptionalPropertyValue $state "state")
        if ($terminal -eq "completed") {
            $ready = Get-BenchmarkProfileState $Token $ProfileId
            if ((Get-OptionalPropertyValue $ready "benchmark_ready") -ne $true) {
                Fail ("BENCHMARK_PREPARATION_NOT_VISIBLE:" + $ProfileId)
            }
            return "prepared"
        }
        $errorCode = [string](Get-OptionalPropertyValue $state "error_code")
        if ($errorCode) { Fail ("BENCHMARK_PREPARATION_FAILED:" + $ProfileId + ":" + $errorCode) }
        Fail ("BENCHMARK_PREPARATION_TERMINAL_INVALID:" + $ProfileId)
    }
    Fail ("BENCHMARK_PREPARATION_TIMEOUT:" + $ProfileId)
}

function Submit-Benchmark([string]$Token, [string]$SourceId) {
    return Invoke-AgentJson $Token "POST" "/jobs" @{
        kind = "benchmark.craig"
        campaign_id = "benchmark-acceptance"
        session_id = "benchmark-acceptance"
        source_id = $SourceId
        glossary = ""
        context = ""
    } 30 ("issue1233-" + [Guid]::NewGuid().ToString("N"))
}

function Wait-Benchmark([string]$Token, [string]$JobId) {
    $deadline = [DateTimeOffset]::UtcNow.AddHours(4)
    $lastProgress = ""
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $job = Invoke-AgentJson $Token "GET" "/jobs/$JobId"
        $status = [string](Get-OptionalPropertyValue $job "status")
        $progress = [string](Get-OptionalPropertyValue $job "progress")
        if ($progress -and $progress -ne $lastProgress) {
            Write-Host ("Benchmark progress: " + $progress) -ForegroundColor DarkCyan
            $lastProgress = $progress
        }
        if ($status -eq "succeeded") { return $job }
        if ($status -in @("failed", "cancelled", "interrupted")) {
            $errorValue = Get-OptionalPropertyValue $job "error"
            $errorCode = [string](Get-OptionalPropertyValue $errorValue "code")
            if (-not $errorCode) { $errorCode = $status }
            Fail ("BENCHMARK_JOB_TERMINAL:" + $errorCode)
        }
        Start-Sleep -Seconds 2
    }
    Fail "BENCHMARK_JOB_TIMEOUT"
}

function Assert-RuntimeCurrent([object]$Candidate, [string]$Family, [string]$RuntimeId, [string]$WorkerName) {
    if (
        [string](Get-OptionalPropertyValue $Candidate "schema") -ne "tda_runtime_candidate_v1" -or
        [string](Get-OptionalPropertyValue $Candidate "family") -ne $Family -or
        [string](Get-OptionalPropertyValue $Candidate "runtime_id") -ne $RuntimeId -or
        [string](Get-OptionalPropertyValue $Candidate "version") -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$'
    ) { Fail ("BENCHMARK_RUNTIME_CANDIDATE_INVALID:" + $Family) }

    $candidateArchive = [string](Get-OptionalPropertyValue $Candidate "runtime_archive_sha256")
    Assert-Sha256 $candidateArchive ("BENCHMARK_RUNTIME_CANDIDATE_ARCHIVE_INVALID:" + $Family)
    $version = [string](Get-OptionalPropertyValue $Candidate "version")
    $familyRoot = Join-Path $env:LOCALAPPDATA ("TDA\Runtime\" + $Family)
    $current = Read-Json (Join-Path $familyRoot "current.json") ("BENCHMARK_RUNTIME_CURRENT_INVALID:" + $Family)
    $versionRoot = Join-Path $familyRoot $version
    $marker = Read-Json (Join-Path $versionRoot ".tda-runtime.json") ("BENCHMARK_RUNTIME_MARKER_INVALID:" + $Family)
    $worker = Join-Path $versionRoot $WorkerName
    if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) { Fail ("BENCHMARK_RUNTIME_WORKER_MISSING:" + $Family) }
    $workerSha = (Get-FileHash -LiteralPath $worker -Algorithm SHA256).Hash.ToLowerInvariant()

    if (
        [string](Get-OptionalPropertyValue $current "runtime_id") -ne $RuntimeId -or
        [string](Get-OptionalPropertyValue $current "version") -ne $version -or
        [string](Get-OptionalPropertyValue $marker "runtime_id") -ne $RuntimeId -or
        [string](Get-OptionalPropertyValue $marker "version") -ne $version -or
        [string](Get-OptionalPropertyValue $marker "archive_sha256") -ne $candidateArchive -or
        [string](Get-OptionalPropertyValue $marker "worker_sha256") -ne $workerSha
    ) { Fail ("BENCHMARK_RUNTIME_IDENTITY_MISMATCH:" + $Family) }

    return [ordered]@{
        family = $Family
        version = $version
        runtime_id = $RuntimeId
        candidate_tag = [string](Get-OptionalPropertyValue $Candidate "candidate_tag")
        source_sha = [string](Get-OptionalPropertyValue $Candidate "source_sha")
        source_tree_sha = [string](Get-OptionalPropertyValue $Candidate "source_tree_sha")
        archive_sha256 = $candidateArchive
        worker_sha256 = $workerSha
    }
}

function Assert-BenchmarkResult(
    [object]$Result,
    [string]$JobId,
    [object]$WhisperCandidate,
    [object]$QwenCandidate
) {
    if (
        [string](Get-OptionalPropertyValue $Result "schema_version") -ne "tda_processing_benchmark_v1" -or
        [string](Get-OptionalPropertyValue $Result "job_id") -ne $JobId -or
        [string](Get-OptionalPropertyValue $Result "kind") -ne "benchmark.craig" -or
        [double](Get-OptionalPropertyValue $Result "sample_seconds") -ne 300.0 -or
        [string](Get-OptionalPropertyValue $Result "execution_mode") -notin @(
            "prepared_artifacts_fresh_worker_per_profile_v1",
            "prepared_artifacts_fresh_worker_per_profile+async_telemetry_v2"
        ) -or
        (Get-OptionalPropertyValue $Result "prepared") -ne $true
    ) { Fail "BENCHMARK_RESULT_INVALID" }

    $rows = @((Get-OptionalPropertyValue $Result "profiles"))
    if ($rows.Count -ne $RequiredProfiles.Count) { Fail "BENCHMARK_RESULT_PROFILE_COUNT_INVALID" }
    $sanitized = [Collections.Generic.List[object]]::new()

    for ($i = 0; $i -lt $RequiredProfiles.Count; $i++) {
        $profileId = $RequiredProfiles[$i]
        $row = $rows[$i]
        if (
            [string](Get-OptionalPropertyValue $row "schema_version") -ne "tda_benchmark_profile_v1" -or
            [string](Get-OptionalPropertyValue $row "profile_id") -ne $profileId -or
            [double](Get-OptionalPropertyValue $row "sample_seconds") -ne 300.0
        ) { Fail ("BENCHMARK_PROFILE_RESULT_INVALID:" + $profileId) }

        $lineage = Get-OptionalPropertyValue $row "execution_lineage"
        $artifact = Get-OptionalPropertyValue $lineage "runtime_artifact"
        $gpu = Get-OptionalPropertyValue $lineage "gpu"
        $family = if ($profileId -like "whisper-*") { "whisper" } else { "qwen" }
        $candidate = if ($family -eq "whisper") { $WhisperCandidate } else { $QwenCandidate }
        $expectedRuntimeId = if ($family -eq "whisper") { "whisper-ctranslate2" } else { "qwen3-transformers" }
        $archiveSha = [string](Get-OptionalPropertyValue $artifact "archive_sha256")
        $workerSha = [string](Get-OptionalPropertyValue $artifact "worker_sha256")
        $gpuModel = [string](Get-OptionalPropertyValue $gpu "model")
        Assert-Sha256 $archiveSha ("BENCHMARK_PROFILE_ARCHIVE_INVALID:" + $profileId)
        Assert-Sha256 $workerSha ("BENCHMARK_PROFILE_WORKER_INVALID:" + $profileId)

        if (
            [string](Get-OptionalPropertyValue $lineage "runtime_family") -ne $family -or
            [string](Get-OptionalPropertyValue $artifact "runtime_id") -ne $expectedRuntimeId -or
            [string](Get-OptionalPropertyValue $artifact "version") -ne [string](Get-OptionalPropertyValue $candidate "version") -or
            $archiveSha -ne [string](Get-OptionalPropertyValue $candidate "runtime_archive_sha256") -or
            [string](Get-OptionalPropertyValue $lineage "device") -notmatch '^(?i)cuda' -or
            [string](Get-OptionalPropertyValue $gpu "vendor") -ne "NVIDIA" -or
            $gpuModel -notlike "*$RequireGpuName*"
        ) { Fail ("BENCHMARK_PROFILE_LINEAGE_INVALID:" + $profileId) }

        $sanitized.Add([ordered]@{
            profile_id = $profileId
            engine = [string](Get-OptionalPropertyValue $row "engine")
            sample_seconds = [double](Get-OptionalPropertyValue $row "sample_seconds")
            processing_seconds = [double](Get-OptionalPropertyValue $row "processing_seconds")
            rtf = Get-OptionalPropertyValue $row "rtf"
            word_count = [int](Get-OptionalPropertyValue $row "word_count")
            segment_count = [int](Get-OptionalPropertyValue $row "segment_count")
            track_count = [int](Get-OptionalPropertyValue $row "track_count")
            warning_count = [int](Get-OptionalPropertyValue $row "warning_count")
            runtime = [ordered]@{
                family = $family
                version = [string](Get-OptionalPropertyValue $artifact "version")
                runtime_id = [string](Get-OptionalPropertyValue $artifact "runtime_id")
                candidate_tag = [string](Get-OptionalPropertyValue $candidate "candidate_tag")
                source_sha = [string](Get-OptionalPropertyValue $candidate "source_sha")
                source_tree_sha = [string](Get-OptionalPropertyValue $candidate "source_tree_sha")
                archive_sha256 = $archiveSha
                worker_sha256 = $workerSha
            }
            gpu = [ordered]@{
                vendor = [string](Get-OptionalPropertyValue $gpu "vendor")
                model = $gpuModel
            }
        })
    }
    return $sanitized.ToArray()
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Fail "BENCHMARK_WINDOWS_REQUIRED" }
if ($PSVersionTable.PSVersion -lt [Version]"7.4") { Fail "BENCHMARK_POWERSHELL_7_4_REQUIRED" }
if (-not $env:LOCALAPPDATA) { Fail "BENCHMARK_LOCALAPPDATA_NOT_FOUND" }
if ($null -eq (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { Fail "BENCHMARK_NVIDIA_SMI_REQUIRED" }

$craig = (Resolve-Path -LiteralPath $CraigZip -ErrorAction Stop).Path
if ([IO.Path]::GetExtension($craig).ToLowerInvariant() -ne ".zip") { Fail "BENCHMARK_CRAIG_ZIP_REQUIRED" }
$payloadPath = (Resolve-Path -LiteralPath $CompanionPayloadManifest -ErrorAction Stop).Path
$whisperCandidatePath = (Resolve-Path -LiteralPath $WhisperRuntimeCandidateManifest -ErrorAction Stop).Path
$qwenCandidatePath = (Resolve-Path -LiteralPath $QwenRuntimeCandidateManifest -ErrorAction Stop).Path

$payload = Read-Json $payloadPath "BENCHMARK_COMPANION_PAYLOAD_INVALID"
$whisperCandidate = Read-Json $whisperCandidatePath "BENCHMARK_WHISPER_CANDIDATE_INVALID"
$qwenCandidate = Read-Json $qwenCandidatePath "BENCHMARK_QWEN_CANDIDATE_INVALID"
if (
    [string](Get-OptionalPropertyValue $payload "schema") -ne "tda_companion_payload_v1" -or
    [string](Get-OptionalPropertyValue $payload "version") -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
    [string](Get-OptionalPropertyValue $payload "source_sha") -notmatch '^[a-f0-9]{40}$' -or
    [string](Get-OptionalPropertyValue $payload "source_tree_sha") -notmatch '^[a-f0-9]{40}$'
) { Fail "BENCHMARK_COMPANION_PAYLOAD_IDENTITY_INVALID" }

Assert-RuntimeCandidateCompatibility $whisperCandidate "whisper" ([Version]"1.1.7")
Assert-RuntimeCandidateCompatibility $qwenCandidate "qwen" ([Version]"1.0.13")

$gpuRows = @(& nvidia-smi --query-gpu=name,driver_version --format=csv,noheader,nounits 2>$null)
if ($LASTEXITCODE -ne 0) { Fail "BENCHMARK_NVIDIA_SMI_FAILED" }
$gpuRow = @($gpuRows | Where-Object { $_ -like "*$RequireGpuName*" } | Select-Object -First 1)
if ($gpuRow.Count -ne 1) { Fail "BENCHMARK_REQUIRED_GPU_NOT_FOUND" }

$whisperInstalled = Assert-RuntimeCurrent $whisperCandidate "whisper" "whisper-ctranslate2" "TDAWhisperWorker.exe"
$qwenInstalled = Assert-RuntimeCurrent $qwenCandidate "qwen" "qwen3-transformers" "TDAQwenWorker.exe"

$version = [string](Get-OptionalPropertyValue $payload "version")
$exe = Join-Path $env:LOCALAPPDATA ("TDA\Companion\versions\" + $version + "\TDACompanion.exe")
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Fail "BENCHMARK_COMPANION_EXE_MISSING" }

$health = Get-AgentHealth
if ($null -ne $health -and [string](Get-OptionalPropertyValue $health "service_version") -ne $version) {
    Fail "BENCHMARK_DIFFERENT_AGENT_ALREADY_BOUND"
}
if ($null -eq $health) {
    Start-Process $exe -ArgumentList @("--agent", "--startup", "--port", [string]$Port) | Out-Null
}
$health = Wait-ExactAgent $version 60
if ($null -eq $health) { Fail "BENCHMARK_AGENT_NOT_READY" }

$token = New-BrowserSession
$stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss")
if (-not $OutputRoot) {
    $OutputRoot = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))) "TDA-PROCESSING-1233-RESULTS"
}
$root = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) ("BENCHMARK-" + $stamp)
New-Item -ItemType Directory -Force -Path $root | Out-Null
$receiptPath = Join-Path $root "PROCESSING-1233-ACCEPTANCE.json"

$passed = $false
$failure = $null
try {
    Assert-NoActiveWork $token
    $uploaded = Upload-Craig $token $craig
    $sourceId = [string](Get-OptionalPropertyValue $uploaded "source_id")
    $trackCount = Get-OptionalPropertyValue $uploaded "track_count"
    if ($sourceId -notmatch '^craig-[a-f0-9]{64}$' -or $null -eq $trackCount -or [int]$trackCount -lt 1) {
        Fail "BENCHMARK_CRAIG_INGEST_INVALID"
    }

    foreach ($profileId in $RequiredProfiles) {
        Write-Host ("Preparing benchmark profile: " + $profileId) -ForegroundColor Cyan
        [void](Ensure-BenchmarkReady $token $sourceId $profileId)
    }

    Write-Host "Submitting the real 5-minute four-profile benchmark..." -ForegroundColor Cyan
    $job = Submit-Benchmark $token $sourceId
    $jobId = [string](Get-OptionalPropertyValue $job "id")
    if ([string]::IsNullOrWhiteSpace($jobId)) { Fail "BENCHMARK_JOB_ID_MISSING" }
    [void](Wait-Benchmark $token $jobId)
    $result = Invoke-AgentJson $token "GET" "/jobs/$jobId/result"
    $profiles = Assert-BenchmarkResult $result $jobId $whisperCandidate $qwenCandidate
    $evidence = Assert-BenchmarkEvidence $token $result $root $HumanReferenceJson

    Write-Json $receiptPath ([ordered]@{
        schema = $ReceiptSchema
        pass = $true
        accepted_at = [DateTimeOffset]::UtcNow.ToString("o")
        source = [ordered]@{
            repository_source_sha = [string](Get-OptionalPropertyValue $payload "source_sha")
            repository_source_tree_sha = [string](Get-OptionalPropertyValue $payload "source_tree_sha")
            sample_seconds = 300
            track_count = [int]$trackCount
        }
        companion = [ordered]@{
            version = $version
        }
        runtimes = [ordered]@{
            whisper = $whisperInstalled
            qwen = $qwenInstalled
        }
        profiles = $profiles
        evidence = $evidence
        contains_audio = $false
        contains_transcript = $false
        contains_token = $false
        contains_paths = $false
        contains_local_paths = $false
    })
    $passed = $true
} catch {
    $failure = [string]$_.Exception.Message
    if ($failure -notmatch '^[A-Z0-9_.:-]{1,220}$') { $failure = "BENCHMARK_ACCEPTANCE_FAILED" }
    Write-Json $receiptPath ([ordered]@{
        schema = $ReceiptSchema
        pass = $false
        accepted_at = [DateTimeOffset]::UtcNow.ToString("o")
        error_code = $failure
        source = [ordered]@{
            repository_source_sha = [string](Get-OptionalPropertyValue $payload "source_sha")
            repository_source_tree_sha = [string](Get-OptionalPropertyValue $payload "source_tree_sha")
            sample_seconds = 300
        }
        contains_audio = $false
        contains_transcript = $false
        contains_token = $false
        contains_paths = $false
        contains_local_paths = $false
    })
    Write-Host ("PROCESSING #1233 BENCHMARK FAILED: " + $failure) -ForegroundColor Red
}

Write-Host ("Sanitized benchmark receipt: " + $receiptPath) -ForegroundColor Cyan
if ($passed) {
    Write-Host "PROCESSING #1233 + #1417 BENCHMARK EVIDENCE: PASS" -ForegroundColor Green
    exit 0
}
exit 1
