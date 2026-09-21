param(
    [Parameter(Mandatory = $true)]
    [string]$Audio,
    [Parameter(Mandatory = $true)]
    [string]$CandidateManifest,
    [Parameter(Mandatory = $true)]
    [string]$CandidateMsi,
    [Parameter(Mandatory = $true)]
    [string]$PayloadManifest,
    [string]$ModelsRoot = (Join-Path $env:LOCALAPPDATA "TDA\Models"),
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "TDA\Runtime"),
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "TDA\State"),
    [string]$OutputRoot = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance"),
    [ValidateSet("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality")]
    [string[]]$Profiles = @("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality"),
    [string]$RequireGpuName = "RTX 4070",
    [string]$ContextFile,
    [string]$GlossaryFile,
    [string]$WhisperRuntimeCandidateManifest,
    [string]$QwenRuntimeCandidateManifest,
    [string]$RuntimeAcceptanceOutputRoot,
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

$runtimeCandidateCount = @(
    @($WhisperRuntimeCandidateManifest, $QwenRuntimeCandidateManifest) |
        Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
).Count
if ($runtimeCandidateCount -notin @(0, 2)) {
    throw "RUNTIME_ACCEPTANCE_CANDIDATES_INCOMPLETE"
}
$sealRuntimeReceipts = $runtimeCandidateCount -eq 2
if ($RuntimeAcceptanceOutputRoot -and -not $sealRuntimeReceipts) {
    throw "RUNTIME_ACCEPTANCE_OUTPUT_WITHOUT_CANDIDATES"
}
$runtimeAcceptanceOutput = if ($RuntimeAcceptanceOutputRoot) {
    [IO.Path]::GetFullPath($RuntimeAcceptanceOutputRoot)
} else {
    Join-Path $output "runtime-acceptance"
}
if ($sealRuntimeReceipts) {
    New-Item -ItemType Directory -Force -Path $runtimeAcceptanceOutput | Out-Null
}

$requiredProfiles = @("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality")
if ($Profiles.Count -ne $requiredProfiles.Count -or @($requiredProfiles | Where-Object { $_ -notin $Profiles }).Count -ne 0) {
    throw "PHYSICAL_ACCEPTANCE_ALL_PROFILES_REQUIRED"
}

$candidateManifestPath = (Resolve-Path -LiteralPath $CandidateManifest -ErrorAction Stop).Path
$candidateMsiPath = (Resolve-Path -LiteralPath $CandidateMsi -ErrorAction Stop).Path
$payloadManifestPath = (Resolve-Path -LiteralPath $PayloadManifest -ErrorAction Stop).Path
try { $candidate = Get-Content -LiteralPath $candidateManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 32 -ErrorAction Stop }
catch { throw "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID" }
if (
    $candidate.schema -ne "tda_companion_candidate_v2" -or
    $candidate.channel -ne "rc" -or
    [string]$candidate.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
    [string]$candidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$candidate.source_tree_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$candidate.tag -notmatch '^companion-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$'
) { throw "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID" }
if (-not ([string]$candidate.tag).EndsWith(([string]$candidate.source_sha).Substring(0, 12))) {
    throw "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID"
}
$msiAsset = $candidate.assets.msi
$payloadAsset = $candidate.assets.payload_manifest
if (
    -not $msiAsset -or -not $payloadAsset -or
    [string]$msiAsset.name -ne "TDACompanion-x64.msi" -or
    [string]$payloadAsset.name -ne "TDACompanion-payload-manifest.json" -or
    [string]$msiAsset.sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$payloadAsset.sha256 -notmatch '^[a-f0-9]{64}$'
) { throw "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID" }
$actualMsiSha = (Get-FileHash -LiteralPath $candidateMsiPath -Algorithm SHA256).Hash.ToLowerInvariant()
$actualPayloadSha = (Get-FileHash -LiteralPath $payloadManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualMsiSha -ne [string]$msiAsset.sha256) { throw "PHYSICAL_ACCEPTANCE_MSI_MISMATCH" }
if ($actualPayloadSha -ne [string]$payloadAsset.sha256) { throw "PHYSICAL_ACCEPTANCE_PAYLOAD_MISMATCH" }
try { $payloadIdentity = Get-Content -LiteralPath $payloadManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 32 -ErrorAction Stop }
catch { throw "PHYSICAL_ACCEPTANCE_PAYLOAD_INVALID" }
if (
    [string]$payloadIdentity.version -ne [string]$candidate.version -or
    [string]$payloadIdentity.source_sha -ne [string]$candidate.source_sha -or
    [string]$payloadIdentity.source_tree_sha -ne [string]$candidate.source_tree_sha
) { throw "PHYSICAL_ACCEPTANCE_PAYLOAD_IDENTITY_MISMATCH" }

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
        [string]$marker.worker_sha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$marker.archive_sha256 -notmatch '^[a-f0-9]{64}$'
    ) { throw "RUNTIME_${Family}_MARKER_INVALID" }
    $actualSha = (Get-FileHash -LiteralPath $workerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne [string]$marker.worker_sha256) { throw "RUNTIME_${Family}_WORKER_HASH_MISMATCH" }
    return [pscustomobject]@{
        Family = $Family
        Version = $version
        Worker = $workerPath
        Sha256 = $actualSha
        ArchiveSha256 = [string]$marker.archive_sha256
    }
}

function Get-InstalledCompanionExecutable([string]$Version) {
    $path = Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$Version\TDACompanion.exe"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "RUNTIME_ACCEPTANCE_COMPANION_EXE_MISSING"
    }
    return [IO.Path]::GetFullPath($path)
}

function Read-RuntimeCandidate([string]$Path, [string]$ExpectedFamily) {
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    try {
        $value = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8 |
            ConvertFrom-Json -Depth 32 -ErrorAction Stop
    } catch {
        throw "RUNTIME_ACCEPTANCE_CANDIDATE_INVALID:$ExpectedFamily"
    }
    if (
        [string]$value.schema -ne "tda_runtime_candidate_v1" -or
        [string]$value.family -ne $ExpectedFamily -or
        [string]$value.candidate_tag -notmatch "^companion-$ExpectedFamily-runtime-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$" -or
        [string]$value.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}    param(
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

$whisperRuntimeCandidate = $null
$qwenRuntimeCandidate = $null
$runtimeSealCompanion = $null
if ($sealRuntimeReceipts) {
    $whisperRuntimeCandidate = Read-RuntimeCandidate $WhisperRuntimeCandidateManifest "whisper"
    $qwenRuntimeCandidate = Read-RuntimeCandidate $QwenRuntimeCandidateManifest "qwen"
    $runtimeSealCompanion = Get-InstalledCompanionExecutable ([string]$candidate.version)
}

$needWhisper = @($Profiles | Where-Object { $_ -like "whisper-*" }).Count -gt 0
$needQwen = @($Profiles | Where-Object { $_ -like "qwen-*" }).Count -gt 0
$whisper = if ($needWhisper) { Get-RuntimeWorker -Family "whisper" -RuntimeId "whisper-ctranslate2" -Executable "TDAWhisperWorker.exe" } else { $null }
$qwen = if ($needQwen) { Get-RuntimeWorker -Family "qwen" -RuntimeId "qwen3-transformers" -Executable "TDAQwenWorker.exe" } else { $null }

$probes = [ordered]@{}
if ($whisper) { $probes.whisper = Invoke-JsonProcess -Executable $whisper.Worker -Arguments @("--probe") -ErrorPrefix "WHISPER_PROBE" }
if ($qwen) { $probes.qwen = Invoke-JsonProcess -Executable $qwen.Worker -Arguments @("--probe") -ErrorPrefix "QWEN_PROBE" }

$results = [ordered]@{}
$qwenGates = [ordered]@{}
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
    if ($isQwen) {
        $gatePath = Join-Path (Join-Path $state "qwen-physical-gates") "$profile.json"
        if (-not (Test-Path -LiteralPath $gatePath -PathType Leaf)) { throw "QWEN_GATE_MISSING:$profile" }
        try { $gate = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 32 -ErrorAction Stop }
        catch { throw "QWEN_GATE_INVALID:$profile" }
        if (
            $gate.schema -ne "tda_qwen_physical_gate_v2" -or
            [string]$gate.profile_id -ne $profile -or
            $gate.contains_audio -ne $false -or
            $gate.contains_transcript -ne $false
        ) { throw "QWEN_GATE_INVALID:$profile" }
        $qwenGates[$profile] = $gate
    }
}

$runtimeAcceptanceReceipts = [ordered]@{}
if ($sealRuntimeReceipts) {
    $rawRoot = Join-Path $output ".runtime-evidence"
    New-Item -ItemType Directory -Force -Path $rawRoot | Out-Null
    $whisperReceiptPaths = [Collections.Generic.List[string]]::new()
    foreach ($profile in @("whisper-turbo", "whisper-detailed")) {
        $path = Join-Path $rawRoot "$profile.json"
        Write-JsonEvidence $path $results[$profile]
        $whisperReceiptPaths.Add($path)
    }

    Write-Host "Sealing Whisper runtime promotion receipt from this same physical run..."
    $runtimeAcceptanceReceipts.whisper = Invoke-RuntimePhysicalSeal -CompanionExecutable $runtimeSealCompanion -RuntimeCandidate $whisperRuntimeCandidate -WhisperReceipts $whisperReceiptPaths.ToArray()

    Write-Host "Sealing Qwen runtime promotion receipt from this same physical run..."
    $runtimeAcceptanceReceipts.qwen = Invoke-RuntimePhysicalSeal -CompanionExecutable $runtimeSealCompanion -RuntimeCandidate $qwenRuntimeCandidate -QwenStateRoot $state
}

$first = $results[$Profiles[0]]
$qwenHardware = $results["qwen-fast"]
$devices = @($qwenHardware.cuda.devices)
if ($devices.Count -lt 1) { throw "PHYSICAL_ACCEPTANCE_GPU_INVALID" }
$device = $devices[0]
$driverVersion = [string]$qwenHardware.cuda.driver_version
$gpuName = [string]$device.name
$computeCapability = [string]$device.compute_capability
if (-not $driverVersion -or -not $gpuName -or $computeCapability -notmatch '^[0-9]+\.[0-9]+$') {
    throw "PHYSICAL_ACCEPTANCE_GPU_INVALID"
}
if ($RequireGpuName -and -not $gpuName.ToLowerInvariant().Contains($RequireGpuName.ToLowerInvariant())) {
    throw "PHYSICAL_ACCEPTANCE_GPU_INVALID"
}
$suite = [ordered]@{
    schema = "tda_physical_acceptance_suite_v2"
    pass = $true
    accepted_at = [DateTimeOffset]::UtcNow.ToString("o")
    candidate = [ordered]@{
        rc_tag = [string]$candidate.tag
        version = [string]$candidate.version
        source_sha = [string]$candidate.source_sha
        source_tree_sha = [string]$candidate.source_tree_sha
        msi_sha256 = $actualMsiSha
        payload_manifest_sha256 = $actualPayloadSha
    }
    required_gpu_name = $RequireGpuName
    audio_sha256 = [string]$first.audio_sha256
    profiles = @($requiredProfiles)
    runtimes = [ordered]@{
        whisper = [ordered]@{
            version = $whisper.Version
            worker_sha256 = $whisper.Sha256
            archive_sha256 = $whisper.ArchiveSha256
        }
        qwen = [ordered]@{
            version = $qwen.Version
            worker_sha256 = $qwen.Sha256
            archive_sha256 = $qwen.ArchiveSha256
        }
    }
    hardware = [ordered]@{
        gpu_name = $gpuName
        driver_version = $driverVersion
        compute_capability = $computeCapability
    }
    probes = $probes
    results = $results
    qwen_gates = $qwenGates
    transcripts_written = [bool]$WriteTranscripts
    contains_audio = $false
    contains_transcript = $false
    contains_token = $false
    contains_paths = $false
}
$receiptPath = Join-Path $output "physical-acceptance-suite.json"
$temporary = "$receiptPath.partial"
$suite | ConvertTo-Json -Depth 32 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
Move-Item -LiteralPath $temporary -Destination $receiptPath -Force

Write-Host "Physical acceptance suite: PASS"
Write-Host "Sanitized receipt: $receiptPath"
if ($sealRuntimeReceipts) {
    Write-Host "Runtime acceptance receipts:" -ForegroundColor Cyan
    Write-Host "  Whisper: $($runtimeAcceptanceReceipts.whisper)"
    Write-Host "  Qwen: $($runtimeAcceptanceReceipts.qwen)"
}
if ($WriteTranscripts) { Write-Host "Local transcripts were explicitly requested and written under: $output" }

    ) {
        throw "RUNTIME_ACCEPTANCE_CANDIDATE_INVALID:$ExpectedFamily"
    }
    return [pscustomobject]@{
        Path = $resolved
        Family = $ExpectedFamily
        Tag = [string]$value.candidate_tag
    }
}

function Write-JsonEvidence([string]$Path, [object]$Value) {
    $temporary = "$Path.partial"
    $Value | ConvertTo-Json -Depth 32 -Compress |
        Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Invoke-RuntimePhysicalSeal(
    [string]$CompanionExecutable,
    [object]$RuntimeCandidate,
    [string[]]$WhisperReceipts = @(),
    [string]$QwenStateRoot = ""
) {
    $destination = Join-Path $runtimeAcceptanceOutput "$($RuntimeCandidate.Tag).json"
    $arguments = [Collections.Generic.List[string]]::new()
    foreach ($value in @(
        "--seal-runtime-physical",
        "--runtime-candidate-manifest", [string]$RuntimeCandidate.Path,
        "--runtime-root", $runtime,
        "--runtime-acceptance-result", $destination
    )) {
        $arguments.Add([string]$value)
    }
    foreach ($receipt in $WhisperReceipts) {
        $arguments.Add("--runtime-whisper-receipt")
        $arguments.Add($receipt)
    }
    if ($QwenStateRoot) {
        $arguments.Add("--runtime-qwen-state-root")
        $arguments.Add($QwenStateRoot)
    }

    & $CompanionExecutable @($arguments.ToArray())
    if ($LASTEXITCODE -ne 0) {
        throw "RUNTIME_ACCEPTANCE_SEAL_FAILED:$($RuntimeCandidate.Family):$LASTEXITCODE"
    }
    try {
        $sealed = Get-Content -LiteralPath $destination -Raw -Encoding UTF8 |
            ConvertFrom-Json -Depth 32 -ErrorAction Stop
    } catch {
        throw "RUNTIME_ACCEPTANCE_RECEIPT_INVALID:$($RuntimeCandidate.Family)"
    }
    if (
        [string]$sealed.schema -ne "tda_runtime_physical_acceptance_v1" -or
        $sealed.pass -ne $true -or
        [string]$sealed.family -ne [string]$RuntimeCandidate.Family -or
        [string]$sealed.candidate_tag -ne [string]$RuntimeCandidate.Tag -or
        $sealed.contains_audio -ne $false -or
        $sealed.contains_transcript -ne $false -or
        $sealed.contains_local_paths -ne $false
    ) {
        throw "RUNTIME_ACCEPTANCE_RECEIPT_INVALID:$($RuntimeCandidate.Family)"
    }
    return $destination
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
$qwenGates = [ordered]@{}
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
    if ($isQwen) {
        $gatePath = Join-Path (Join-Path $state "qwen-physical-gates") "$profile.json"
        if (-not (Test-Path -LiteralPath $gatePath -PathType Leaf)) { throw "QWEN_GATE_MISSING:$profile" }
        try { $gate = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 32 -ErrorAction Stop }
        catch { throw "QWEN_GATE_INVALID:$profile" }
        if (
            $gate.schema -ne "tda_qwen_physical_gate_v2" -or
            [string]$gate.profile_id -ne $profile -or
            $gate.contains_audio -ne $false -or
            $gate.contains_transcript -ne $false
        ) { throw "QWEN_GATE_INVALID:$profile" }
        $qwenGates[$profile] = $gate
    }
}

$first = $results[$Profiles[0]]
$qwenHardware = $results["qwen-fast"]
$devices = @($qwenHardware.cuda.devices)
if ($devices.Count -lt 1) { throw "PHYSICAL_ACCEPTANCE_GPU_INVALID" }
$device = $devices[0]
$driverVersion = [string]$qwenHardware.cuda.driver_version
$gpuName = [string]$device.name
$computeCapability = [string]$device.compute_capability
if (-not $driverVersion -or -not $gpuName -or $computeCapability -notmatch '^[0-9]+\.[0-9]+$') {
    throw "PHYSICAL_ACCEPTANCE_GPU_INVALID"
}
if ($RequireGpuName -and -not $gpuName.ToLowerInvariant().Contains($RequireGpuName.ToLowerInvariant())) {
    throw "PHYSICAL_ACCEPTANCE_GPU_INVALID"
}
$suite = [ordered]@{
    schema = "tda_physical_acceptance_suite_v2"
    pass = $true
    accepted_at = [DateTimeOffset]::UtcNow.ToString("o")
    candidate = [ordered]@{
        rc_tag = [string]$candidate.tag
        version = [string]$candidate.version
        source_sha = [string]$candidate.source_sha
        source_tree_sha = [string]$candidate.source_tree_sha
        msi_sha256 = $actualMsiSha
        payload_manifest_sha256 = $actualPayloadSha
    }
    required_gpu_name = $RequireGpuName
    audio_sha256 = [string]$first.audio_sha256
    profiles = @($requiredProfiles)
    runtimes = [ordered]@{
        whisper = [ordered]@{
            version = $whisper.Version
            worker_sha256 = $whisper.Sha256
            archive_sha256 = $whisper.ArchiveSha256
        }
        qwen = [ordered]@{
            version = $qwen.Version
            worker_sha256 = $qwen.Sha256
            archive_sha256 = $qwen.ArchiveSha256
        }
    }
    hardware = [ordered]@{
        gpu_name = $gpuName
        driver_version = $driverVersion
        compute_capability = $computeCapability
    }
    probes = $probes
    results = $results
    qwen_gates = $qwenGates
    transcripts_written = [bool]$WriteTranscripts
    contains_audio = $false
    contains_transcript = $false
    contains_token = $false
    contains_paths = $false
}
$receiptPath = Join-Path $output "physical-acceptance-suite.json"
$temporary = "$receiptPath.partial"
$suite | ConvertTo-Json -Depth 32 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
Move-Item -LiteralPath $temporary -Destination $receiptPath -Force

Write-Host "Physical acceptance suite: PASS"
Write-Host "Sanitized receipt: $receiptPath"
if ($WriteTranscripts) { Write-Host "Local transcripts were explicitly requested and written under: $output" }
