[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CandidateManifest,
    [string]$InstalledRuntimeRoot = "",
    [string]$ModelsRoot = "",
    [int[]]$DurationsSeconds = @(10, 30),
    [ValidateRange(2, 5)][int]$Repeats = 2,
    [ValidateRange(60, 3600)][int]$TimeoutSeconds = 1800,
    [string]$RequireGpuName = "RTX 4070",
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RequiredRuntimeVersion = "1.0.14"
$RequiredSourceSha = "d3db290b66beb16c5b01637fddb4f9a3ed9de4a7"
$RequiredRuntimeId = "qwen3-transformers"
$ExpectedCandidateTag = "companion-qwen-runtime-rc-v1.0.14-d3db290b66be"
$RequiredCandidateManifestSha256 = "9c29b165fddfa212e61cf0c8679444e9cdad1220963ce1fa01bbdb9e61d2deb8"
$SampleRate = 16000

function Fail-Blocked([string]$Code) {
    throw [InvalidOperationException]::new("BLOCKED:$Code")
}

function Fail-Harness([string]$Code) {
    throw [InvalidOperationException]::new("HARNESS_FAILED:$Code")
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-Json([string]$Path, [string]$Code) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64
    } catch {
        Fail-Harness $Code
    }
}

function Write-Json([string]$Path, [object]$Value) {
    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $temporary = "$Path.partial"
    $Value | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Write-DigitalZeroWav([string]$Path, [int]$DurationSeconds) {
    if ($DurationSeconds -lt 1 -or $DurationSeconds -gt 240) {
        Fail-Harness "QWEN_1268_DURATION_INVALID"
    }

    [int]$channels = 1
    [int]$bitsPerSample = 16
    [int]$bytesPerSample = $bitsPerSample / 8
    [int64]$sampleCount = [int64]$DurationSeconds * [int64]$SampleRate
    [int64]$dataLength = $sampleCount * $channels * $bytesPerSample
    if ($dataLength -gt [int]::MaxValue) {
        Fail-Harness "QWEN_1268_WAV_TOO_LARGE"
    }

    $stream = [IO.File]::Open(
        $Path,
        [IO.FileMode]::Create,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )
    $writer = [IO.BinaryWriter]::new($stream, [Text.Encoding]::ASCII, $false)
    try {
        $writer.Write([Text.Encoding]::ASCII.GetBytes("RIFF"))
        $writer.Write([int](36 + $dataLength))
        $writer.Write([Text.Encoding]::ASCII.GetBytes("WAVE"))
        $writer.Write([Text.Encoding]::ASCII.GetBytes("fmt "))
        $writer.Write([int]16)
        $writer.Write([int16]1)
        $writer.Write([int16]$channels)
        $writer.Write([int]$SampleRate)
        $writer.Write([int]($SampleRate * $channels * $bytesPerSample))
        $writer.Write([int16]($channels * $bytesPerSample))
        $writer.Write([int16]$bitsPerSample)
        $writer.Write([Text.Encoding]::ASCII.GetBytes("data"))
        $writer.Write([int]$dataLength)

        $zeroChunk = [byte[]]::new(65536)
        [int64]$remaining = $dataLength
        while ($remaining -gt 0) {
            [int]$count = [int][Math]::Min($remaining, $zeroChunk.Length)
            $writer.Write($zeroChunk, 0, $count)
            $remaining -= $count
        }
        $writer.Flush()
    } finally {
        $writer.Dispose()
    }

    $expectedLength = 44 + $dataLength
    if ((Get-Item -LiteralPath $Path).Length -ne $expectedLength) {
        Fail-Harness "QWEN_1268_WAV_SIZE_INVALID"
    }
}

function Get-LastJsonObject([string]$Stdout) {
    $lines = @($Stdout -split "[\r\n]+" | Where-Object { $_.Trim() })
    for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        try {
            $value = $lines[$index] | ConvertFrom-Json -Depth 64
            if ($null -ne $value) { return $value }
        } catch {}
    }
    Fail-Harness "QWEN_1268_WORKER_JSON_MISSING"
}

function Invoke-QwenAcceptance(
    [string]$Worker,
    [string]$Audio,
    [string]$Models,
    [string]$RequiredGpu,
    [int]$Timeout
) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Worker
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    [void]$start.ArgumentList.Add("--acceptance")
    [void]$start.ArgumentList.Add("--audio")
    [void]$start.ArgumentList.Add($Audio)
    [void]$start.ArgumentList.Add("--models-root")
    [void]$start.ArgumentList.Add($Models)
    [void]$start.ArgumentList.Add("--profile")
    [void]$start.ArgumentList.Add("qwen-fast")
    if ($RequiredGpu) {
        [void]$start.ArgumentList.Add("--require-gpu-name")
        [void]$start.ArgumentList.Add($RequiredGpu)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) {
        Fail-Harness "QWEN_1268_WORKER_START_FAILED"
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($Timeout * 1000)) {
        try { $process.Kill($true) } catch {}
        try { $process.WaitForExit(10000) } catch {}
        Fail-Harness "QWEN_1268_WORKER_TIMEOUT"
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    [void]$stderrTask.GetAwaiter().GetResult()
    $exitCode = $process.ExitCode
    $process.Dispose()

    $value = Get-LastJsonObject $stdout
    $pass = ($value.pass -eq $true)
    $errorCode = if ($pass) { $null } else { [string]$value.error }

    $transcriptSha = $null
    $wordCount = $null
    $gpuName = $null
    $gpuMatch = $null
    if ($pass) {
        if ($null -eq $value.inference -or $null -eq $value.alignment -or $null -eq $value.gpu) {
            Fail-Harness "QWEN_1268_SUCCESS_RECEIPT_INVALID"
        }
        $transcriptSha = [string]$value.inference.transcript_sha256
        $wordCount = [int]$value.alignment.word_count
        $gpuName = [string]$value.gpu.name
        $gpuMatch = $value.gpu.required_name_match
        if (
            $transcriptSha -notmatch '^[a-f0-9]{64}$' -or
            $wordCount -lt 1 -or
            ($RequiredGpu -and $gpuMatch -ne $true)
        ) {
            Fail-Harness "QWEN_1268_SUCCESS_RECEIPT_INVALID"
        }
    } else {
        if ($errorCode -notmatch '^[A-Z0-9_]{1,96}$') {
            Fail-Harness "QWEN_1268_FAILURE_CODE_INVALID"
        }
    }

    return [ordered]@{
        exit_code = [int]$exitCode
        pass = [bool]$pass
        error_code = $errorCode
        transcript_sha256 = $transcriptSha
        aligned_word_count = $wordCount
        gpu_name = $gpuName
        required_gpu_match = $gpuMatch
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Fail-Blocked "WINDOWS_REQUIRED"
}
if ($PSVersionTable.PSVersion -lt [Version]"7.4") {
    Fail-Blocked "POWERSHELL_7_4_REQUIRED"
}
if (-not $env:LOCALAPPDATA) {
    Fail-Blocked "LOCALAPPDATA_NOT_FOUND"
}
if (-not $DurationsSeconds -or $DurationsSeconds.Count -lt 2) {
    Fail-Harness "QWEN_1268_MULTIPLE_LENGTHS_REQUIRED"
}
if (@($DurationsSeconds | Select-Object -Unique).Count -ne $DurationsSeconds.Count) {
    Fail-Harness "QWEN_1268_DUPLICATE_DURATION"
}
foreach ($duration in $DurationsSeconds) {
    if ($duration -lt 1 -or $duration -gt 240) {
        Fail-Harness "QWEN_1268_DURATION_INVALID"
    }
}

try {
    $candidatePath = (Resolve-Path -LiteralPath $CandidateManifest -ErrorAction Stop).Path
} catch {
    Fail-Blocked "QWEN_1268_CANDIDATE_MANIFEST_NOT_FOUND"
}
$candidateManifestSha = Get-Sha256 $candidatePath
if ($candidateManifestSha -ne $RequiredCandidateManifestSha256) {
    Fail-Harness "QWEN_1268_CANDIDATE_MANIFEST_HASH_MISMATCH"
}
$candidate = Read-Json $candidatePath "QWEN_1268_CANDIDATE_MANIFEST_INVALID"
if (
    [string]$candidate.schema -ne "tda_runtime_candidate_v1" -or
    [string]$candidate.family -ne "qwen" -or
    [string]$candidate.runtime_id -ne $RequiredRuntimeId -or
    [string]$candidate.platform -ne "windows-x64" -or
    [string]$candidate.version -ne $RequiredRuntimeVersion -or
    [string]$candidate.source_sha -ne $RequiredSourceSha -or
    [string]$candidate.candidate_tag -ne $ExpectedCandidateTag -or
    [string]$candidate.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}$'
) {
    Fail-Harness "QWEN_1268_CANDIDATE_IDENTITY_MISMATCH"
}

if (-not $InstalledRuntimeRoot) {
    $InstalledRuntimeRoot = Join-Path $env:LOCALAPPDATA "TDA\Runtime\qwen\$RequiredRuntimeVersion"
}
try {
    $runtimeRoot = (Resolve-Path -LiteralPath $InstalledRuntimeRoot -ErrorAction Stop).Path
} catch {
    Fail-Blocked "QWEN_1268_RUNTIME_NOT_INSTALLED"
}
if ([IO.Path]::GetFileName($runtimeRoot) -ne $RequiredRuntimeVersion) {
    Fail-Harness "QWEN_1268_RUNTIME_PATH_VERSION_MISMATCH"
}

$worker = Join-Path $runtimeRoot "TDAQwenWorker.exe"
$markerPath = Join-Path $runtimeRoot ".tda-runtime.json"
if (
    -not (Test-Path -LiteralPath $worker -PathType Leaf) -or
    -not (Test-Path -LiteralPath $markerPath -PathType Leaf)
) {
    Fail-Blocked "QWEN_1268_RUNTIME_INCOMPLETE"
}
$marker = Read-Json $markerPath "QWEN_1268_RUNTIME_MARKER_INVALID"
$workerSha = Get-Sha256 $worker
if (
    [string]$marker.schema -ne "tda_asr_runtime_v1" -or
    [string]$marker.runtime_id -ne $RequiredRuntimeId -or
    [string]$marker.version -ne $RequiredRuntimeVersion -or
    [string]$marker.archive_sha256 -ne [string]$candidate.runtime_archive_sha256 -or
    [string]$marker.worker_sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$marker.worker_sha256 -ne $workerSha
) {
    Fail-Harness "QWEN_1268_RUNTIME_IDENTITY_MISMATCH"
}

if (-not $ModelsRoot) {
    $ModelsRoot = Join-Path $env:LOCALAPPDATA "TDA\Models"
}
try {
    $models = (Resolve-Path -LiteralPath $ModelsRoot -ErrorAction Stop).Path
} catch {
    Fail-Blocked "QWEN_1268_MODELS_ROOT_NOT_FOUND"
}

$outputBase = if ($OutputRoot) {
    [IO.Path]::GetFullPath($OutputRoot)
} else {
    Join-Path $PSScriptRoot "results"
}
New-Item -ItemType Directory -Force -Path $outputBase | Out-Null
$stamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
$receiptPath = Join-Path $outputBase "qwen-1268-digital-zero-$stamp.json"
$scratch = Join-Path $env:TEMP "TDA-QWEN-1268-$stamp"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null

$cases = [Collections.Generic.List[object]]::new()
$allDeterministic = $true
$hallucinationReproduced = $false

try {
    foreach ($duration in ($DurationsSeconds | Sort-Object)) {
        $wav = Join-Path $scratch ("digital-zero-{0}s.wav" -f $duration)
        Write-DigitalZeroWav $wav $duration
        $audioSha = Get-Sha256 $wav
        $runs = [Collections.Generic.List[object]]::new()

        Write-Host ("Qwen #1268: digital-zero {0}s x{1}..." -f $duration, $Repeats) -ForegroundColor Cyan
        for ($attempt = 1; $attempt -le $Repeats; $attempt++) {
            $result = Invoke-QwenAcceptance $worker $wav $models $RequireGpuName $TimeoutSeconds
            $runs.Add([ordered]@{
                attempt = $attempt
                exit_code = $result.exit_code
                pass = $result.pass
                error_code = $result.error_code
                transcript_sha256 = $result.transcript_sha256
                aligned_word_count = $result.aligned_word_count
                gpu_name = $result.gpu_name
                required_gpu_match = $result.required_gpu_match
            })
        }

        $fingerprints = @(
            $runs | ForEach-Object {
                "{0}|{1}|{2}|{3}" -f (
                    [bool]$_.pass,
                    [string]$_.error_code,
                    [string]$_.transcript_sha256,
                    [string]$_.aligned_word_count
                )
            } | Select-Object -Unique
        )
        $deterministic = ($fingerprints.Count -eq 1)
        $hallucinated = @($runs | Where-Object {
            $_.pass -eq $true -and
            [string]$_.transcript_sha256 -match '^[a-f0-9]{64}$' -and
            [int]$_.aligned_word_count -gt 0
        }).Count -eq $Repeats

        if (-not $deterministic) { $allDeterministic = $false }
        if ($hallucinated) { $hallucinationReproduced = $true }

        $cases.Add([ordered]@{
            duration_seconds = [int]$duration
            sample_rate_hz = $SampleRate
            pcm_format = "s16le-mono"
            audio_sha256 = $audioSha
            deterministic_across_repeats = [bool]$deterministic
            hallucination_reproduced = [bool]$hallucinated
            runs = @($runs)
        })
    }

    $receipt = [ordered]@{
        schema = "tda_qwen_1268_digital_zero_v1"
        issue = 1268
        created_at = [DateTimeOffset]::UtcNow.ToString("o")
        contains_audio = $false
        contains_transcript = $false
        runtime = [ordered]@{
            runtime_id = $RequiredRuntimeId
            version = $RequiredRuntimeVersion
            source_sha = $RequiredSourceSha
            candidate_tag = $ExpectedCandidateTag
            candidate_manifest_sha256 = $candidateManifestSha
            runtime_archive_sha256 = [string]$candidate.runtime_archive_sha256
            worker_sha256 = $workerSha
        }
        probe = [ordered]@{
            profile_id = "qwen-fast"
            require_gpu_name = $RequireGpuName
            durations_seconds = @($DurationsSeconds | Sort-Object)
            repeats_per_duration = $Repeats
        }
        cases = @($cases)
        summary = [ordered]@{
            deterministic_across_repeats = [bool]$allDeterministic
            hallucination_reproduced = [bool]$hallucinationReproduced
        }
    }
    Write-Json $receiptPath $receipt

    if (-not $allDeterministic) {
        Fail-Harness "QWEN_1268_NONDETERMINISTIC_REPRODUCTION"
    }
    if (-not $hallucinationReproduced) {
        Fail-Harness "QWEN_1268_HALLUCINATION_NOT_REPRODUCED"
    }

    Write-Host "QWEN #1268 DIGITAL-ZERO REPRODUCTION: PASS" -ForegroundColor Green
    Write-Host ("Sanitized receipt: {0}" -f $receiptPath) -ForegroundColor DarkCyan
} finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
