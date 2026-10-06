param(
    [Parameter(Mandatory = $true)][string]$CandidateTag,
    [string]$ExpectedVersion = "1.1.10",
    [string]$RequireGpuName = "",
    [string]$RepoRoot = "",
    [string]$ModelsRoot = (Join-Path $env:LOCALAPPDATA "TDA\Models"),
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "TDA\Runtime"),
    [string]$WorkingRoot = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance\whisper-runtime")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "WHISPER_PHYSICAL_WINDOWS_REQUIRED"
}
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "WHISPER_PHYSICAL_POWERSHELL7_REQUIRED"
}
if (-not $env:LOCALAPPDATA) {
    throw "WHISPER_PHYSICAL_LOCALAPPDATA_REQUIRED"
}
if ($CandidateTag -notmatch '^companion-whisper-runtime-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$') {
    throw "WHISPER_PHYSICAL_CANDIDATE_TAG_INVALID"
}
if ($ExpectedVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw "WHISPER_PHYSICAL_VERSION_INVALID"
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-Directory([string]$Path, [string]$Code) {
    try {
        $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    } catch {
        throw $Code
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw $Code
    }
    return [IO.Path]::GetFullPath($resolved)
}

function Read-Json([string]$Path, [string]$Code) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
            ConvertFrom-Json -Depth 64 -ErrorAction Stop
    } catch {
        throw $Code
    }
}

function Write-Json([string]$Path, [object]$Value) {
    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $partial = "$Path.partial"
    try {
        $Value | ConvertTo-Json -Depth 64 -Compress |
            Set-Content -LiteralPath $partial -Encoding UTF8 -NoNewline
        Move-Item -LiteralPath $partial -Destination $Path -Force
    } finally {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
}

function Get-Release([string]$Tag) {
    try {
        $value = Invoke-RestMethod -UseBasicParsing -Headers @{
            Accept = "application/vnd.github+json"
            "X-GitHub-Api-Version" = "2022-11-28"
        } -Uri ("https://api.github.com/repos/Faysk/tda/releases/tags/" + [Uri]::EscapeDataString($Tag)) -TimeoutSec 30
    } catch {
        throw "WHISPER_PHYSICAL_RELEASE_LOOKUP_FAILED"
    }
    if (
        [string]$value.tag_name -ne $Tag -or
        $value.draft -ne $false -or
        $value.prerelease -ne $true -or
        [string]$value.target_commitish -notmatch '^[a-f0-9]{40}$'
    ) {
        throw "WHISPER_PHYSICAL_RELEASE_IDENTITY_INVALID"
    }
    return $value
}

function Get-ReleaseAsset([object]$Release, [string]$Name) {
    $rows = @($Release.assets | Where-Object { [string]$_.name -eq $Name })
    if ($rows.Count -ne 1) {
        throw "WHISPER_PHYSICAL_RELEASE_ASSET_COUNT_INVALID:$Name"
    }
    $asset = $rows[0]
    if (
        [string]$asset.digest -notmatch '^sha256:[a-f0-9]{64}$' -or
        [int64]$asset.size -le 0 -or
        [string]$asset.browser_download_url -notmatch '^https://github\.com/Faysk/tda/releases/download/'
    ) {
        throw "WHISPER_PHYSICAL_RELEASE_ASSET_INVALID:$Name"
    }
    return $asset
}

function Ensure-Asset([object]$Release, [string]$Name, [string]$Directory) {
    $asset = Get-ReleaseAsset $Release $Name
    $expectedSha = ([string]$asset.digest).Substring(7)
    $path = Join-Path $Directory $Name
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        if (
            (Get-Sha256 $path) -eq $expectedSha -and
            (Get-Item -LiteralPath $path).Length -eq [int64]$asset.size
        ) {
            Write-Host "Reusing verified asset: $Name"
            return [IO.Path]::GetFullPath($path)
        }
        Remove-Item -LiteralPath $path -Force
    }

    $partial = "$path.partial"
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    try {
        Write-Host "Downloading exact RC asset: $Name"
        Invoke-WebRequest -UseBasicParsing -Uri ([string]$asset.browser_download_url) -OutFile $partial -MaximumRedirection 10
        if ((Get-Item -LiteralPath $partial).Length -ne [int64]$asset.size) {
            throw "WHISPER_PHYSICAL_ASSET_SIZE_MISMATCH:$Name"
        }
        if ((Get-Sha256 $partial) -ne $expectedSha) {
            throw "WHISPER_PHYSICAL_ASSET_HASH_MISMATCH:$Name"
        }
        Move-Item -LiteralPath $partial -Destination $path -Force
    } finally {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }
    return [IO.Path]::GetFullPath($path)
}

function Get-PythonCommand {
    foreach ($name in @("python.exe", "python", "py.exe", "py")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return [pscustomobject]@{
                Path = [string]$command.Source
                Prefix = $(if ($command.Name -in @("py.exe", "py")) { @("-3") } else { @() })
            }
        }
    }
    throw "WHISPER_PHYSICAL_PYTHON_REQUIRED"
}

function Invoke-Python([object]$Python, [string[]]$Arguments, [string]$Code) {
    $allArguments = @($Python.Prefix) + $Arguments
    & $Python.Path @allArguments
    if ($LASTEXITCODE -ne 0) {
        throw ($Code + ":" + $LASTEXITCODE)
    }
}

function Invoke-JsonProcess([string]$Executable, [string[]]$Arguments, [string]$ErrorPrefix) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) {
        $null = $start.ArgumentList.Add([string]$argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) {
        throw ($ErrorPrefix + "_START_FAILED")
    }
    try {
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $null = $stderrTask.GetAwaiter().GetResult()
        $lines = @($stdout -split "\r?\n" | Where-Object { $_.Trim().Length -gt 0 })
        if ($lines.Count -eq 0) {
            throw ($ErrorPrefix + "_NO_JSON")
        }
        try {
            $value = $lines[-1] | ConvertFrom-Json -Depth 64 -ErrorAction Stop
        } catch {
            throw ($ErrorPrefix + "_INVALID_JSON")
        }
        if ($process.ExitCode -ne 0) {
            $code = if ($value.error) { [string]$value.error } else { "EXIT_$($process.ExitCode)" }
            throw ($ErrorPrefix + "_" + $code)
        }
        return $value
    } finally {
        $process.Dispose()
    }
}

$repo = if ($RepoRoot) {
    Resolve-Directory $RepoRoot "WHISPER_PHYSICAL_REPO_ROOT_INVALID"
} else {
    Resolve-Directory (Join-Path $PSScriptRoot "..\..") "WHISPER_PHYSICAL_REPO_ROOT_INVALID"
}

$models = [IO.Path]::GetFullPath($ModelsRoot)
$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
$working = Join-Path ([IO.Path]::GetFullPath($WorkingRoot)) $CandidateTag
$assetRoot = Join-Path $working "rc-assets"
$fixtureRoot = Join-Path $working "synthetic-fixture"
$rawRoot = Join-Path $working ".runtime-evidence"
$validatedRoot = Join-Path $working "validated"
New-Item -ItemType Directory -Force -Path $models, $runtime, $assetRoot, $fixtureRoot, $rawRoot, $validatedRoot | Out-Null

$release = Get-Release $CandidateTag
$candidatePath = Ensure-Asset $release "TDARuntime-candidate.json" $assetRoot
$candidate = Read-Json $candidatePath "WHISPER_PHYSICAL_CANDIDATE_INVALID"

if (
    [string]$candidate.schema -ne "tda_runtime_candidate_v1" -or
    [string]$candidate.family -ne "whisper" -or
    [string]$candidate.runtime_id -ne "whisper-ctranslate2" -or
    [string]$candidate.platform -ne "windows-x64" -or
    [string]$candidate.version -ne $ExpectedVersion -or
    [string]$candidate.candidate_tag -ne $CandidateTag -or
    [string]$candidate.source_sha -ne [string]$release.target_commitish -or
    [string]$candidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$candidate.source_tree_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$candidate.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}$'
) {
    throw "WHISPER_PHYSICAL_CANDIDATE_IDENTITY_MISMATCH"
}
if (-not $CandidateTag.EndsWith(([string]$candidate.source_sha).Substring(0, 12))) {
    throw "WHISPER_PHYSICAL_CANDIDATE_TAG_SOURCE_MISMATCH"
}

foreach ($asset in @($candidate.assets)) {
    $name = [string]$asset.name
    $sha = [string]$asset.sha256
    if (
        -not $name -or
        [IO.Path]::GetFileName($name) -ne $name -or
        $sha -notmatch '^[a-f0-9]{64}$'
    ) {
        throw "WHISPER_PHYSICAL_CANDIDATE_ASSET_INVALID"
    }
    $releaseAsset = Get-ReleaseAsset $release $name
    if (([string]$releaseAsset.digest).Substring(7) -ne $sha) {
        throw "WHISPER_PHYSICAL_CANDIDATE_RELEASE_DIGEST_MISMATCH:$name"
    }
    $null = Ensure-Asset $release $name $assetRoot
}

$python = Get-PythonCommand
$previousPythonPath = $env:PYTHONPATH
try {
    $localCompanion = Join-Path $repo "local-companion"
    $env:PYTHONPATH = if ($previousPythonPath) {
        "$localCompanion$([IO.Path]::PathSeparator)$previousPythonPath"
    } else {
        $localCompanion
    }

    Write-Host "Installing/verifying exact Whisper Runtime $ExpectedVersion..."
    Invoke-Python $python @(
        "-m", "tda_companion.rc_runtime_artifacts", "install-candidate",
        "--candidate-manifest", $candidatePath,
        "--assets-root", $assetRoot,
        "--runtime-root", $runtime,
        "--cache-root", (Join-Path $working "install-cache"),
        "--expected-version", $ExpectedVersion
    ) "WHISPER_PHYSICAL_RUNTIME_INSTALL_FAILED"

    $worker = Join-Path (Join-Path (Join-Path $runtime "whisper") $ExpectedVersion) "TDAWhisperWorker.exe"
    if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) {
        throw "WHISPER_PHYSICAL_WORKER_MISSING"
    }

    Write-Host "Running packaged runtime probe..."
    $probe = Invoke-JsonProcess -Executable $worker -Arguments @("--probe") -ErrorPrefix "WHISPER_PHYSICAL_PROBE"
    if ($probe.ready -ne $true -or [int]$probe.cuda_device_count -lt 1) {
        throw "WHISPER_PHYSICAL_PROBE_NOT_READY"
    }

    Write-Host "Running packaged decoder smoke..."
    $decode = Invoke-JsonProcess -Executable $worker -Arguments @("--decode-smoke") -ErrorPrefix "WHISPER_PHYSICAL_DECODE"
    if ($decode.ready -ne $true) {
        throw "WHISPER_PHYSICAL_DECODE_NOT_READY"
    }

    Write-Host "Generating non-private physical acceptance audio..."
    $fixtureScript = Join-Path $repo "tools\acceptance\generate-physical-acceptance-fixture.ps1"
    & $fixtureScript -OutputRoot $fixtureRoot -TargetSeconds 80 -CraigTrackCount 1
    if ($LASTEXITCODE -ne 0) {
        throw "WHISPER_PHYSICAL_FIXTURE_GENERATION_FAILED"
    }
    $syntheticAudio = Join-Path $fixtureRoot "tda-physical-acceptance-synthetic.wav"
    if (-not (Test-Path -LiteralPath $syntheticAudio -PathType Leaf)) {
        throw "WHISPER_PHYSICAL_FIXTURE_AUDIO_MISSING"
    }

    $receipts = [Collections.Generic.List[string]]::new()
    foreach ($profileId in @("whisper-turbo", "whisper-detailed")) {
        Write-Host "[$profileId] Running physical GPU acceptance..."
        $arguments = @(
            "--acceptance",
            "--audio", $syntheticAudio,
            "--models-root", $models,
            "--profile", $profileId
        )
        if (-not [string]::IsNullOrWhiteSpace($RequireGpuName)) {
            $arguments += @("--require-gpu-name", $RequireGpuName)
        }
        $receipt = Invoke-JsonProcess -Executable $worker -Arguments $arguments -ErrorPrefix ("WHISPER_PHYSICAL_" + $profileId.Replace("-", "_").ToUpperInvariant())
        if (
            [string]$receipt.schema -ne "tda_whisper_gpu_acceptance_v1" -or
            $receipt.pass -ne $true -or
            [string]$receipt.profile_id -ne $profileId -or
            $null -eq $receipt.gpu -or
            $receipt.gpu.required_name_match -ne $true -or
            $null -eq $receipt.inference -or
            [string]$receipt.inference.device -ne "cuda"
        ) {
            throw "WHISPER_PHYSICAL_RECEIPT_INVALID:$profileId"
        }
        $path = Join-Path $rawRoot "$profileId.json"
        Write-Json $path $receipt
        $receipts.Add($path)
    }

    $sealed = Join-Path $validatedRoot "$CandidateTag.json"
    Write-Host "Sealing sanitized physical acceptance receipt..."
    Invoke-Python $python @(
        "-m", "tda_companion.runtime_release_evidence", "seal-physical",
        "--candidate-manifest", $candidatePath,
        "--runtime-root", $runtime,
        "--whisper-receipt", $receipts[0],
        "--whisper-receipt", $receipts[1],
        "--output", $sealed
    ) "WHISPER_PHYSICAL_SEAL_FAILED"

    $promotionPreview = Join-Path $validatedRoot "TDARuntime-promotion.preview.json"
    Invoke-Python $python @(
        "-m", "tda_companion.runtime_release_evidence", "verify-promotion",
        "--candidate-manifest", $candidatePath,
        "--acceptance-receipt", $sealed,
        "--assets-root", $assetRoot,
        "--output", $promotionPreview
    ) "WHISPER_PHYSICAL_PROMOTION_VERIFY_FAILED"

    Write-Host ""
    Write-Host "WHISPER RUNTIME PHYSICAL ACCEPTANCE: PASS" -ForegroundColor Green
    Write-Host "Exact RC: $CandidateTag"
    Write-Host "Runtime version: $ExpectedVersion"
    Write-Host "GPU: $([string]$probe.cuda_device_count) CUDA device(s); required match '$RequireGpuName'"
    Write-Host "Sanitized promotion receipt: $sealed"
    Write-Host "Promotion preview: $promotionPreview"
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
