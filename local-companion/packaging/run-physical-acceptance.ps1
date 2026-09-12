param(
    [Parameter(Mandatory = $true)]
    [string]$Audio,
    [string]$ModelsRoot = (Join-Path $env:LOCALAPPDATA "TDA\Models"),
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "TDA\Runtime"),
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "TDA\State"),
    [string]$OutputRoot = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance"),
    [ValidateSet("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality")]
    [string[]]$Profiles = @("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality"),
    [string]$RequireGpuName = "RTX 4070",
    [string]$ContextFile,
    [string]$GlossaryFile,
    [switch]$WriteTranscripts
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }
$audioPath = (Resolve-Path -LiteralPath $Audio -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $audioPath -PathType Leaf)) { throw "ACCEPTANCE_AUDIO_NOT_FOUND" }
$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
$models = [IO.Path]::GetFullPath($ModelsRoot)
$state = [IO.Path]::GetFullPath($StateRoot)
$output = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $models, $state, $output | Out-Null

function Get-RuntimeWorker {
    param(
        [Parameter(Mandatory = $true)][string]$Family,
        [Parameter(Mandatory = $true)][string]$RuntimeId,
        [Parameter(Mandatory = $true)][string]$Executable
    )
    $familyRoot = Join-Path $runtime $Family
    $currentPath = Join-Path $familyRoot "current.json"
    if (-not (Test-Path -LiteralPath $currentPath -PathType Leaf)) { throw "RUNTIME_${Family}_NOT_INSTALLED" }
    try { $current = Get-Content -LiteralPath $currentPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "RUNTIME_${Family}_CURRENT_INVALID" }
    if ($current.schema -ne "tda_asr_runtime_v1" -or $current.runtime_id -ne $RuntimeId) {
        throw "RUNTIME_${Family}_CURRENT_INVALID"
    }
    $version = [string]$current.version
    if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "RUNTIME_${Family}_VERSION_INVALID" }
    $versionRoot = Join-Path $familyRoot $version
    $markerPath = Join-Path $versionRoot ".tda-runtime.json"
    $workerPath = Join-Path $versionRoot $Executable
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw "RUNTIME_${Family}_MARKER_MISSING" }
    if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) { throw "RUNTIME_${Family}_WORKER_MISSING" }
    try { $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "RUNTIME_${Family}_MARKER_INVALID" }
    if (
        $marker.schema -ne "tda_asr_runtime_v1" -or
        $marker.runtime_id -ne $RuntimeId -or
        [string]$marker.version -ne $version -or
        [string]$marker.worker -ne $Executable -or
        [string]$marker.worker_sha256 -notmatch '^[a-f0-9]{64}$'
    ) { throw "RUNTIME_${Family}_MARKER_INVALID" }
    $actualSha = (Get-FileHash -LiteralPath $workerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne [string]$marker.worker_sha256) { throw "RUNTIME_${Family}_WORKER_HASH_MISMATCH" }
    return [pscustomobject]@{ Family = $Family; Version = $version; Worker = $workerPath; Sha256 = $actualSha }
}

function Invoke-JsonProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$ErrorPrefix
    )
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $null = $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "${ErrorPrefix}_START_FAILED" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $null = $stderrTask.GetAwaiter().GetResult() # Never persist stderr: it is diagnostic-only.
    $lines = @($stdout -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
    if ($lines.Count -eq 0) { throw "${ErrorPrefix}_NO_JSON" }
    try { $value = $lines[-1] | ConvertFrom-Json -Depth 32 -ErrorAction Stop }
    catch { throw "${ErrorPrefix}_INVALID_JSON" }
    if ($process.ExitCode -ne 0) {
        $code = if ($value.error) { [string]$value.error } else { "EXIT_$($process.ExitCode)" }
        throw "${ErrorPrefix}_$code"
    }
    return $value
}

$needWhisper = @($Profiles | Where-Object { $_ -like "whisper-*" }).Count -gt 0
$needQwen = @($Profiles | Where-Object { $_ -like "qwen-*" }).Count -gt 0
$whisper = if ($needWhisper) { Get-RuntimeWorker -Family "whisper" -RuntimeId "whisper-ctranslate2" -Executable "TDAWhisperWorker.exe" } else { $null }
$qwen = if ($needQwen) { Get-RuntimeWorker -Family "qwen" -RuntimeId "qwen3-transformers" -Executable "TDAQwenWorker.exe" } else { $null }

$probes = [ordered]@{}
if ($whisper) { $probes.whisper = Invoke-JsonProcess -Executable $whisper.Worker -Arguments @("--probe") -ErrorPrefix "WHISPER_PROBE" }
if ($qwen) { $probes.qwen = Invoke-JsonProcess -Executable $qwen.Worker -Arguments @("--probe") -ErrorPrefix "QWEN_PROBE" }

$results = [ordered]@{}
foreach ($profile in $Profiles) {
    $isQwen = $profile -like "qwen-*"
    $selected = if ($isQwen) { $qwen } else { $whisper }
    if (-not $selected) { throw "PROFILE_RUNTIME_MISSING:$profile" }
    $arguments = [Collections.Generic.List[string]]::new()
    foreach ($value in @("--acceptance", "--audio", $audioPath, "--models-root", $models, "--profile", $profile, "--require-gpu-name", $RequireGpuName)) {
        $arguments.Add([string]$value)
    }
    if ($ContextFile) {
        $context = (Resolve-Path -LiteralPath $ContextFile -ErrorAction Stop).Path
        $arguments.Add("--context-file"); $arguments.Add($context)
    }
    if ($GlossaryFile) {
        $glossary = (Resolve-Path -LiteralPath $GlossaryFile -ErrorAction Stop).Path
        $arguments.Add("--glossary-file"); $arguments.Add($glossary)
    }
    if ($WriteTranscripts) {
        $transcriptPath = Join-Path $output "$profile-transcript.json"
        $arguments.Add("--transcript-out"); $arguments.Add($transcriptPath)
    }
    if ($isQwen) {
        $arguments.Add("--record-gate")
        $arguments.Add("--runtime-root"); $arguments.Add($runtime)
        $arguments.Add("--state-root"); $arguments.Add($state)
    }
    Write-Host "Testing $profile on required GPU '$RequireGpuName'..."
    $receipt = Invoke-JsonProcess -Executable $selected.Worker -Arguments $arguments.ToArray() -ErrorPrefix ("ACCEPTANCE_" + $profile.Replace("-", "_").ToUpperInvariant())
    if ($receipt.pass -ne $true) { throw "ACCEPTANCE_FAILED:$profile" }
    $results[$profile] = $receipt
}

$first = $results[$Profiles[0]]
$suite = [ordered]@{
    schema = "tda_physical_acceptance_suite_v1"
    pass = $true
    accepted_at = [DateTimeOffset]::UtcNow.ToString("o")
    required_gpu_name = $RequireGpuName
    audio_sha256 = [string]$first.audio_sha256
    profiles = @($Profiles)
    runtimes = [ordered]@{
        whisper = if ($whisper) { [ordered]@{ version = $whisper.Version; worker_sha256 = $whisper.Sha256 } } else { $null }
        qwen = if ($qwen) { [ordered]@{ version = $qwen.Version; worker_sha256 = $qwen.Sha256 } } else { $null }
    }
    probes = $probes
    results = $results
    transcripts_written = [bool]$WriteTranscripts
    contains_audio = $false
    contains_transcript = $false
}
$receiptPath = Join-Path $output "physical-acceptance-suite.json"
$temporary = "$receiptPath.partial"
$suite | ConvertTo-Json -Depth 32 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
Move-Item -LiteralPath $temporary -Destination $receiptPath -Force

Write-Host "Physical acceptance suite: PASS"
Write-Host "Sanitized receipt: $receiptPath"
if ($WriteTranscripts) { Write-Host "Local transcripts were explicitly requested and written under: $output" }
