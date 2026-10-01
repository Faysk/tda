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
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "WHISPER_1235_POWERSHELL7_REQUIRED"
}

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
    if ($null -eq $Value) {
        throw $Code
    }
    try {
        $number = [double]$Value
    } catch {
        throw $Code
    }
    if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
        throw $Code
    }
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
        [string]$candidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
        [string]$candidate.candidate_tag -notmatch '^companion-whisper-runtime-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$' -or
        [string]$candidate.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}$'
    ) {
        throw "WHISPER_1235_CANDIDATE_INVALID"
    }

    $version = [string]$candidate.version
    $sourcePrefix = ([string]$candidate.source_sha).Substring(0, 12)
    $expectedTag = "companion-whisper-runtime-rc-v$version-$sourcePrefix"
    if ([string]$candidate.candidate_tag -ne $expectedTag) {
        throw "WHISPER_1235_CANDIDATE_IDENTITY_MISMATCH"
    }

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
        if ($parts.Count -ne 2) {
            continue
        }
        $name = $parts[0].Trim()
        $driver = $parts[1].Trim()
        if (
            -not $RequiredName -or
            $name.IndexOf($RequiredName, [StringComparison]::OrdinalIgnoreCase) -ge 0
        ) {
            return [pscustomobject]@{
                Name = $name
                DriverVersion = $driver
            }
        }
    }
    throw "WHISPER_1235_GPU_NAME_MISMATCH"
}

function Assert-ExactRuntimeLineage {
    param(
        [object]$Lineage,
        [object]$Runtime,
        [string]$Code
    )

    if (
        $null -eq $Lineage -or
        [string]$Lineage.schema_version -ne "tda_execution_lineage_v1" -or
        [string]$Lineage.runtime_family -ne "whisper" -or
        [string]$Lineage.runtime_version -ne [string]$Runtime.Version -or
        [string]$Lineage.device -notmatch '^cuda(?::[0-9]{1,2})?$' -or
        $null -eq $Lineage.runtime_artifact -or
        [string]$Lineage.runtime_artifact.runtime_id -ne "whisper-ctranslate2" -or
        [string]$Lineage.runtime_artifact.version -ne [string]$Runtime.Version -or
        [string]$Lineage.runtime_artifact.worker_sha256 -ne [string]$Runtime.WorkerSha256 -or
        [string]$Lineage.runtime_artifact.archive_sha256 -ne [string]$Runtime.ArchiveSha256
    ) {
        throw $Code
    }

    if ($RequireGpuName) {
        if ($null -eq $Lineage.gpu) {
            throw $Code
        }
        $model = [string]$Lineage.gpu.model
        if (
            -not $model -or
            $model.IndexOf($RequireGpuName, [StringComparison]::OrdinalIgnoreCase) -lt 0
        ) {
            throw $Code
        }
    }
}

function Invoke-WhisperCraigWorker {
    param(
        [object]$Runtime,
        [string]$Data,
        [string]$Models,
        [string]$Source,
        [string]$WhisperProfile,
        [bool]$Benchmark,
        [string]$JobId
    )

    $payload = [ordered]@{
        source_id = $Source
        profile_id = $WhisperProfile
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
    $utf8 = [Text.UTF8Encoding]::new($false)
    $start.StandardInputEncoding = $utf8
    $start.StandardOutputEncoding = $utf8
    $start.StandardErrorEncoding = $utf8
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
            if ($null -eq $line) {
                break
            }
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }

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
                if ($candidateCode -match '^[A-Z0-9_]{1,96}$') {
                    $errorCode = $candidateCode
                } else {
                    $errorCode = "WORKER_EXECUTION_FAILED"
                }
            }

            if ([string]$message.type -eq "result") {
                $result = $message.payload
            }

            if (
                [string]$message.type -eq "event" -and
                [string]$message.payload.code -eq "WHISPER_SEGMENT_SPAN_WIDENED"
            ) {
                $track = [int]$message.payload.track
                $segment = [int]$message.payload.segment
                if ($track -lt 1 -or $segment -lt 1) {
                    throw "WHISPER_1235_SPAN_EVENT_INVALID"
                }
                $spanCount += 1
                if ($spanExamples.Count -lt $MaxSpanExamples) {
                    $spanExamples.Add([ordered]@{
                        track = $track
                        segment = $segment
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
            # Best-effort teardown only. Preserve the original acceptance failure.
        }
        $process.Dispose()
    }

    if ($exitCode -ne 0 -or $null -eq $result) {
        if ($errorCode) {
            throw "WHISPER_1235_WORKER_$errorCode"
        }
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
        [string]$ExpectedProfile,
        [object]$Runtime
    )

    $runId = [string]$WorkerResult.run_id
    if ($runId -notmatch '^[A-Za-z0-9_-]{1,256}$') {
        throw "WHISPER_1235_RUN_ID_INVALID"
    }

    $runRoot = Join-Path (Join-Path $PackageRoot "runs") $runId
    $manifestPath = Join-Path $runRoot "run.json"
    $transcriptPath = Join-Path $runRoot "transcript.json"
    if (
        -not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $transcriptPath -PathType Leaf)
    ) {
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

    Assert-ExactRuntimeLineage $manifest.execution_lineage $Runtime "WHISPER_1235_RUN_LINEAGE_INVALID"

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

foreach ($whisperProfile in $Profiles) {
    Write-Host "[$whisperProfile] Craig sample 300s through packaged runtime $($runtime.Version)..."
    $sampleJob = "whisper1235-" + $whisperProfile.Replace("-", "_") + "-sample-" + $stamp
    $sample = Invoke-WhisperCraigWorker -Runtime $runtime -Data $data -Models $models -Source $SourceId -WhisperProfile $whisperProfile -Benchmark $true -JobId $sampleJob

    if (
        [string]$sample.Result.kind -ne "benchmark.profile" -or
        [string]$sample.Result.profile_id -ne $whisperProfile -or
        [string]$sample.Result.device -ne "cuda" -or
        [double]$sample.Result.sample_seconds -ne 300.0
    ) {
        throw "WHISPER_1235_SAMPLE_RESULT_INVALID"
    }
    Assert-ExactRuntimeLineage $sample.Result.execution_lineage $runtime "WHISPER_1235_SAMPLE_LINEAGE_INVALID"

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

    Write-Host "[$whisperProfile] Craig full transcription through packaged runtime $($runtime.Version)..."
    $fullJob = "whisper1235-" + $whisperProfile.Replace("-", "_") + "-full-" + $stamp
    $full = Invoke-WhisperCraigWorker -Runtime $runtime -Data $data -Models $models -Source $SourceId -WhisperProfile $whisperProfile -Benchmark $false -JobId $fullJob

    if (
        [string]$full.Result.kind -ne "transcription.craig" -or
        [string]$full.Result.profile_id -ne $whisperProfile
    ) {
        throw "WHISPER_1235_FULL_RESULT_INVALID"
    }

    $run = Get-PublicRunMetrics -PackageRoot $packageRoot -WorkerResult $full.Result -ExpectedProfile $whisperProfile -Runtime $runtime
    $runChecks.Add($run)
    $profileEvidence.Add([ordered]@{
        profile_id = $whisperProfile
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
    contains_text = $false
    contains_speaker = $false
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
