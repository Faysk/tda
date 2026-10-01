param(
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$SourceId,
    [Parameter(Mandatory = $true)][string]$RuntimeCandidateManifest,
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "TDA\Runtime"),
    [string]$ModelsRoot = (Join-Path $env:LOCALAPPDATA "TDA\Models"),
    [string]$OutputRoot = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance\whisper-1235"),
    [string]$RequireGpuName = "NVIDIA GeForce RTX 4070 Laptop GPU"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Schema = "tda_whisper_craig_containment_acceptance_v1"
$Profiles = @("whisper-turbo", "whisper-detailed")
$MaxSpanExamples = 32

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-Json([string]$Path, [string]$Code) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
            ConvertFrom-Json -Depth 64 -ErrorAction Stop
    } catch {
        throw $Code
    }
}

function Assert-FiniteNumber([object]$Value, [string]$Code) {
    if ($null -eq $Value) { throw $Code }
    try { $number = [double]$Value } catch { throw $Code }
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { throw $Code }
    return $number
}

function Get-InstalledWhisperCandidate {
    param(
        [string]$CandidatePath,
        [string]$Runtime
    )

    $candidate = Read-Json $CandidatePath "WHISPER_1235_CANDIDATE_INVALID"
    if (
        [string]$candidate.schema -ne "tda_runtime_candidate_v1" -or
        [string]$candidate.family -ne "whisper" -or
        [string]$candidate.runtime_id -ne "whisper-ctranslate2" -or
        [string]$candidate.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
        [string]$candidate.candidate_tag -notmatch '^companion-whisper-runtime-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$' -or
        [string]$candidate.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}$'
    ) {
        throw "WHISPER_1235_CANDIDATE_INVALID"
    }

    $version = [string]$candidate.version
    $versionRoot = Join-Path (Join-Path $Runtime "whisper") $version
    $markerPath = Join-Path $versionRoot ".tda-runtime.json"
    $workerPath = Join-Path $versionRoot "TDAWhisperWorker.exe"
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "WHISPER_1235_RUNTIME_MARKER_MISSING"
    }
    if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) {
        throw "WHISPER_1235_RUNTIME_WORKER_MISSING"
    }

    $marker = Read-Json $markerPath "WHISPER_1235_RUNTIME_MARKER_INVALID"
    if (
        [string]$marker.schema -ne "tda_asr_runtime_v1" -or
        [string]$marker.runtime_id -ne "whisper-ctranslate2" -or
        [string]$marker.version -ne $version -or
        [string]$marker.worker -ne "TDAWhisperWorker.exe" -or
        [string]$marker.worker_sha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$marker.archive_sha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$marker.archive_sha256 -ne [string]$candidate.runtime_archive_sha256
    ) {
        throw "WHISPER_1235_RUNTIME_MARKER_INVALID"
    }

    $workerSha = Get-Sha256 $workerPath
    if ($workerSha -ne [string]$marker.worker_sha256) {
        throw "WHISPER_1235_RUNTIME_WORKER_HASH_MISMATCH"
    }

    return [pscustomobject]@{
        Candidate = $candidate
        Marker = $marker
        Version = $version
        Worker = [IO.Path]::GetFullPath($workerPath)
        WorkerSha256 = $workerSha
        ArchiveSha256 = [string]$marker.archive_sha256
    }
}

function Get-RequiredGpu([string]$RequiredName) {
    $tool = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if ($null -eq $tool) {
        $tool = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    }
    if ($null -eq $tool) {
        throw "WHISPER_1235_NVIDIA_SMI_MISSING"
    }

    $rows = @(& $tool.Source --query-gpu=name,driver_version --format=csv,noheader,nounits 2>$null)
    if ($LASTEXITCODE -ne 0 -or $rows.Count -lt 1) {
        throw "WHISPER_1235_GPU_QUERY_FAILED"
    }

    foreach ($row in $rows) {
        $parts = @([string]$row -split ',', 2)
        if ($parts.Count -ne 2) { continue }
        $name = $parts[0].Trim()
        $driver = $parts[1].Trim()
        if (-not $RequiredName -or $name.IndexOf($RequiredName, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return [pscustomobject]@{ Name = $name; DriverVersion = $driver }
        }
    }
    throw "WHISPER_1235_GPU_NAME_MISMATCH"
}

function Invoke-WhisperCraigWorker {
    param(
        [object]$Runtime,
        [string]$Data,
        [string]$Models,
        [string]$Source,
        [string]$Profile,
        [bool]$Benchmark,
        [string]$JobId
    )

    $payload = [ordered]@{
        source_id = $Source
        profile_id = $Profile
        glossary = ""
        context = ""
        cpu = $false
    }
    if ($Benchmark) {
        $payload.benchmark_mode = $true
        $payload.benchmark_sample_seconds = 300.0
    }

    $command = [ordered]@{
        protocol = "tda_worker_v1"
        type = "run"
        job_id = $JobId
        attempt = 1
        kind = "transcription.craig"
        payload = $payload
    }

    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = [string]$Runtime.Worker
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment["TDA_ASR_RUNTIME_FAMILY"] = "whisper"
    $start.Environment["TDA_ASR_RUNTIME_VERSION"] = [string]$Runtime.Version
    $start.Environment["TDA_ASR_RUNTIME_ARTIFACT"] = ([ordered]@{
        runtime_id = "whisper-ctranslate2"
        version = [string]$Runtime.Version
        worker_sha256 = [string]$Runtime.WorkerSha256
        archive_sha256 = [string]$Runtime.ArchiveSha256
    } | ConvertTo-Json -Compress)
    $start.Environment["TDA_WORKER_DATA_ROOT"] = $Data
    $start.Environment["TDA_WORKER_MODELS_ROOT"] = $Models

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) {
        throw "WHISPER_1235_WORKER_START_FAILED"
    }

    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine(($command | ConvertTo-Json -Depth 16 -Compress))
    $process.StandardInput.Flush()
    $process.StandardInput.Close()

    $lastSeq = -1
    $result = $null
    $errorCode = $null
    $spanCount = 0
    $spanExamples = [Collections.Generic.List[object]]::new()
    $exitCode = 70

    try {
        while ($true) {
            $line = $process.StandardOutput.ReadLine()
            if ($null -eq $line) { break }
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $message = $line | ConvertFrom-Json -Depth 64 -ErrorAction Stop
            } catch {
                throw "WHISPER_1235_WORKER_PROTOCOL_INVALID"
            }
            if (
                [string]$message.protocol -ne "tda_worker_v1" -or
                [string]$message.job_id -ne $JobId -or
                [int]$message.attempt -ne 1 -or
                [int]$message.seq -le $lastSeq
            ) {
                throw "WHISPER_1235_WORKER_PROTOCOL_INVALID"
            }
            $lastSeq = [int]$message.seq

            if ([string]$message.type -eq "error") {
                $candidateCode = [string]$message.payload.code
                $errorCode = if ($candidateCode -match '^[A-Z0-9_]{1,96}$') {
                    $candidateCode
                } else {
                    "WORKER_EXECUTION_FAILED"
                }
            }
            if ([string]$message.type -eq "result") {
                $result = $message.payload
            }
            if (
                [string]$message.type -eq "event" -and
                [string]$message.payload.code -eq "WHISPER_SEGMENT_SPAN_WIDENED"
            ) {
                $spanCount += 1
                if ($spanExamples.Count -lt $MaxSpanExamples) {
                    $spanExamples.Add([ordered]@{
                        track = [int]$message.payload.track
                        segment = [int]$message.payload.segment
                        start_seconds = Assert-FiniteNumber $message.payload.start_seconds "WHISPER_1235_SPAN_EVENT_INVALID"
                        end_seconds = Assert-FiniteNumber $message.payload.end_seconds "WHISPER_1235_SPAN_EVENT_INVALID"
                        relative_start_seconds = Assert-FiniteNumber $message.payload.relative_start_seconds "WHISPER_1235_SPAN_EVENT_INVALID"
                        relative_end_seconds = Assert-FiniteNumber $message.payload.relative_end_seconds "WHISPER_1235_SPAN_EVENT_INVALID"
                    })
                }
            }
        }
        $process.WaitForExit()
        $exitCode = [int]$process.ExitCode
        $null = $stderrTask.GetAwaiter().GetResult()
    } finally {
        try {
            if (-not $process.HasExited) {
                $process.Kill($true)
                $process.WaitForExit(5000)
            }
        } catch {
            # Best-effort teardown only; preserve the original acceptance failure.
        }
        $process.Dispose()
    }

    if ($exitCode -ne 0 -or $null -eq $result) {
        if ($errorCode) { throw "WHISPER_1235_WORKER_$errorCode" }
        throw "WHISPER_1235_WORKER_FAILED"
    }

    return [pscustomobject]@{
        Result = $result
        SpanCount = $spanCount
        SpanExamples = @($spanExamples)
    }
}

function Get-PublicRunMetrics {
    param(
        [string]$PackageRoot,
        [object]$WorkerResult,
        [string]$ExpectedProfile
    )

    $runId = [string]$WorkerResult.run_id
    if ($runId -notmatch '^[A-Za-z0-9_-]{1,256}$') {
        throw "WHISPER_1235_RUN_ID_INVALID"
    }
    $runRoot = Join-Path (Join-Path $PackageRoot "runs") $runId
    $manifestPath = Join-Path $runRoot "run.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "WHISPER_1235_RUN_MANIFEST_MISSING"
    }
    $manifest = Read-Json $manifestPath "WHISPER_1235_RUN_MANIFEST_INVALID"
    if (
        [string]$manifest.run_id -ne $runId -or
        [string]$manifest.profile_id -ne $ExpectedProfile -or
        [string]$manifest.device -ne "cuda" -or
        [string]$manifest.transcript_sha256 -notmatch '^[a-f0-9]{64}$' -or
        $null -eq $manifest.stats
    ) {
        throw "WHISPER_1235_RUN_MANIFEST_INVALID"
    }

    return [pscustomobject]@{
        Path = [IO.Path]::GetFullPath($manifestPath)
        InitialSha256 = Get-Sha256 $manifestPath
        Metrics = [ordered]@{
            audio_work_seconds = Assert-FiniteNumber $manifest.stats.audio_work_seconds "WHISPER_1235_RUN_METRICS_INVALID"
            session_duration_seconds = Assert-FiniteNumber $manifest.stats.session_duration_seconds "WHISPER_1235_RUN_METRICS_INVALID"
            processing_seconds = Assert-FiniteNumber $manifest.stats.processing_seconds "WHISPER_1235_RUN_METRICS_INVALID"
            rtf = Assert-FiniteNumber $manifest.stats.rtf "WHISPER_1235_RUN_METRICS_INVALID"
            word_count = [int]$manifest.stats.word_count
            segment_count = [int]$manifest.stats.segment_count
            track_count = [int]$manifest.stats.track_count
            turn_count = [int]$manifest.stats.turn_count
            deduplicated_segment_count = [int]$manifest.stats.deduplicated_segment_count
        }
    }
}

$data = (Resolve-Path -LiteralPath $DataRoot -ErrorAction Stop).Path
$models = (Resolve-Path -LiteralPath $ModelsRoot -ErrorAction Stop).Path
$runtimeRootResolved = (Resolve-Path -LiteralPath $RuntimeRoot -ErrorAction Stop).Path
$candidatePath = (Resolve-Path -LiteralPath $RuntimeCandidateManifest -ErrorAction Stop).Path
if ($SourceId -notmatch '^[A-Za-z0-9_-]{1,128}$') {
    throw "WHISPER_1235_SOURCE_ID_INVALID"
}
$packageRoot = Join-Path (Join-Path $data "staging") $SourceId
if (-not (Test-Path -LiteralPath $packageRoot -PathType Container)) {
    throw "WHISPER_1235_SOURCE_NOT_STAGED"
}
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$output = [IO.Path]::GetFullPath($OutputRoot)

$runtime = Get-InstalledWhisperCandidate -CandidatePath $candidatePath -Runtime $runtimeRootResolved
if ([string]$runtime.Version -ne "1.1.7") {
    throw "WHISPER_1235_RUNTIME_VERSION_REQUIRED"
}
$gpu = Get-RequiredGpu $RequireGpuName
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

$profileEvidence = [Collections.Generic.List[object]]::new()
$runChecks = [Collections.Generic.List[object]]::new()

foreach ($profile in $Profiles) {
    Write-Host "[$profile] Craig sample 300s through packaged runtime $($runtime.Version)..."
    $sample = Invoke-WhisperCraigWorker -Runtime $runtime -Data $data -Models $models -Source $SourceId -Profile $profile -Benchmark $true -JobId ("whisper1235-" + $profile.Replace("-", "_") + "-sample-" + $stamp)
    if (
        [string]$sample.Result.kind -ne "benchmark.profile" -or
        [string]$sample.Result.profile_id -ne $profile -or
        [string]$sample.Result.device -ne "cuda" -or
        [double]$sample.Result.sample_seconds -ne 300.0
    ) {
        throw "WHISPER_1235_SAMPLE_RESULT_INVALID"
    }

    $sampleMetrics = [ordered]@{
        sample_seconds = 300.0
        audio_work_seconds = Assert-FiniteNumber $sample.Result.audio_work_seconds "WHISPER_1235_SAMPLE_METRICS_INVALID"
        session_duration_seconds = Assert-FiniteNumber $sample.Result.session_duration_seconds "WHISPER_1235_SAMPLE_METRICS_INVALID"
        processing_seconds = Assert-FiniteNumber $sample.Result.processing_seconds "WHISPER_1235_SAMPLE_METRICS_INVALID"
        rtf = Assert-FiniteNumber $sample.Result.rtf "WHISPER_1235_SAMPLE_METRICS_INVALID"
        word_count = [int]$sample.Result.word_count
        segment_count = [int]$sample.Result.segment_count
        track_count = [int]$sample.Result.track_count
        warning_count = [int]$sample.Result.warning_count
        span_widened_count = [int]$sample.SpanCount
        span_examples = @($sample.SpanExamples)
    }

    Write-Host "[$profile] Craig full transcription through packaged runtime $($runtime.Version)..."
    $full = Invoke-WhisperCraigWorker -Runtime $runtime -Data $data -Models $models -Source $SourceId -Profile $profile -Benchmark $false -JobId ("whisper1235-" + $profile.Replace("-", "_") + "-full-" + $stamp)
    if (
        [string]$full.Result.kind -ne "transcription.craig" -or
        [string]$full.Result.profile_id -ne $profile
    ) {
        throw "WHISPER_1235_FULL_RESULT_INVALID"
    }

    $run = Get-PublicRunMetrics -PackageRoot $packageRoot -WorkerResult $full.Result -ExpectedProfile $profile
    $runChecks.Add($run)
    $profileEvidence.Add([ordered]@{
        profile_id = $profile
        sample = $sampleMetrics
        full = [ordered]@{
            metrics = $run.Metrics
            span_widened_count = [int]$full.SpanCount
            span_examples = @($full.SpanExamples)
            run_committed = $true
        }
    })
}

foreach ($run in $runChecks) {
    if ((Get-Sha256 $run.Path) -ne [string]$run.InitialSha256) {
        throw "WHISPER_1235_IMMUTABLE_RUN_CHANGED"
    }
}

$receipt = [ordered]@{
    schema = $Schema
    pass = $true
    accepted_at = [DateTimeOffset]::UtcNow.ToString("o")
    candidate = [ordered]@{
        candidate_tag = [string]$runtime.Candidate.candidate_tag
        version = [string]$runtime.Version
        runtime_id = "whisper-ctranslate2"
        runtime_archive_sha256 = [string]$runtime.ArchiveSha256
        worker_sha256 = [string]$runtime.WorkerSha256
    }
    gpu = [ordered]@{
        name = [string]$gpu.Name
        driver_version = [string]$gpu.DriverVersion
        required_name_match = $true
    }
    profiles = @($profileEvidence)
    immutable_runs_verified = $true
    contains_audio = $false
    contains_transcript = $false
    contains_local_paths = $false
    contains_source_id = $false
}

$receiptPath = Join-Path $output "whisper-1235-acceptance.json"
$temporary = "$receiptPath.partial"
$receipt | ConvertTo-Json -Depth 64 -Compress |
    Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
Move-Item -LiteralPath $temporary -Destination $receiptPath -Force

Write-Host "Whisper #1235 Craig containment acceptance: PASS"
Write-Host "Sanitized receipt: $receiptPath"
