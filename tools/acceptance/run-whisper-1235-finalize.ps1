param(
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$SourceId,
    [string]$RepoRoot = "",
    [string]$ModelsRoot = (Join-Path $env:LOCALAPPDATA "TDA\Models"),
    [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "TDA\Runtime"),
    [string]$WorkingRoot = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance\whisper-1235-finalize"),
    [string]$RequireGpuName = "NVIDIA GeForce RTX 4070 Laptop GPU"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "WHISPER_1235_WINDOWS_REQUIRED"
}
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "WHISPER_1235_POWERSHELL7_REQUIRED"
}
if (-not $env:LOCALAPPDATA) {
    throw "WHISPER_1235_LOCALAPPDATA_REQUIRED"
}
if ($SourceId -notmatch '^[A-Za-z0-9_-]{1,128}$') {
    throw "WHISPER_1235_SOURCE_ID_INVALID"
}

$CandidateTag = "companion-whisper-runtime-rc-v1.1.8-ce9fdda3c35e"
$CandidateVersion = "1.1.8"
$CandidateSourceSha = "ce9fdda3c35e34ae3e2fc3fb3465355378b2891b"
$CandidateSourceTreeSha = "c96c924a50d43d0c5007a302e119400ae8ab67fc"
$CandidateManifestName = "TDARuntime-candidate.json"
$RuntimeArchiveName = "TDAWhisperRuntime-1.1.8-windows-x64.zip"
$RuntimeDigestName = "$RuntimeArchiveName.sha256"
$CandidateManifestSha256 = "48ea9080d0c9807f2adbff976474efbdf0e41f8a0ec96247b0a6c68f721eb950"
$RuntimeArchiveSha256 = "cdd1f165ac60ef300843a9ce2f7dd802c95a6c6c48b6108f642e8e28d3e71bd6"
$RuntimeDigestSha256 = "bd3677ba2efc74bcd40fcdf78010e0ada2e72b498d0e7a77802527e7ce1ec770"
$ReleaseBase = "https://github.com/Faysk/tda/releases/download/$CandidateTag"
$Profiles = @("whisper-turbo", "whisper-detailed")

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

function Ensure-Asset(
    [string]$Directory,
    [string]$Name,
    [string]$ExpectedSha256
) {
    if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') {
        throw "WHISPER_1235_ASSET_HASH_INVALID"
    }
    $path = Join-Path $Directory $Name
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        if ((Get-Sha256 $path) -eq $ExpectedSha256) {
            Write-Host "Reusing verified asset: $Name"
            return [IO.Path]::GetFullPath($path)
        }
        Remove-Item -LiteralPath $path -Force
    }

    $partial = "$path.partial"
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    try {
        Write-Host "Downloading exact RC asset: $Name"
        Invoke-WebRequest -Uri "$ReleaseBase/$Name" -OutFile $partial -MaximumRedirection 10
        if ((Get-Sha256 $partial) -ne $ExpectedSha256) {
            throw "WHISPER_1235_ASSET_HASH_MISMATCH:$Name"
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
            $prefix = if ($command.Name -like "py*") { @("-3") } else { @() }
            return [pscustomobject]@{
                Path = $command.Source
                Prefix = $prefix
            }
        }
    }
    throw "WHISPER_1235_PYTHON_REQUIRED"
}

function Invoke-Python(
    [object]$Python,
    [string[]]$Arguments,
    [string]$Code
) {
    $allArguments = @($Python.Prefix) + $Arguments
    & $Python.Path @allArguments
    if ($LASTEXITCODE -ne 0) {
        throw ($Code + ":" + $LASTEXITCODE)
    }
}

function Invoke-JsonProcess(
    [string]$Executable,
    [string[]]$Arguments,
    [string]$ErrorPrefix
) {
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

function Write-Json([string]$Path, [object]$Value) {
    $partial = "$Path.partial"
    $Value | ConvertTo-Json -Depth 64 -Compress |
        Set-Content -LiteralPath $partial -Encoding UTF8 -NoNewline
    Move-Item -LiteralPath $partial -Destination $Path -Force
}

function Publish-Evidence(
    [string]$Source,
    [string]$Destination
) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "WHISPER_1235_EVIDENCE_SOURCE_MISSING"
    }
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        if ((Get-Sha256 $Source) -ne (Get-Sha256 $Destination)) {
            throw "WHISPER_1235_EVIDENCE_CONFLICT"
        }
        Write-Host "Evidence already present with identical bytes: $Destination"
        return
    }
    $partial = "$Destination.partial"
    Copy-Item -LiteralPath $Source -Destination $partial -Force
    Move-Item -LiteralPath $partial -Destination $Destination -Force
}

$repo = if ($RepoRoot) {
    Resolve-Directory $RepoRoot "WHISPER_1235_REPO_ROOT_INVALID"
} else {
    Resolve-Directory (Join-Path $PSScriptRoot "..\..") "WHISPER_1235_REPO_ROOT_INVALID"
}
$data = Resolve-Directory $DataRoot "WHISPER_1235_DATA_ROOT_INVALID"
$models = Resolve-Directory $ModelsRoot "WHISPER_1235_MODELS_ROOT_INVALID"

$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
$working = [IO.Path]::GetFullPath($WorkingRoot)
New-Item -ItemType Directory -Force -Path $runtime, $working | Out-Null

$packageRoot = Join-Path (Join-Path $data "staging") $SourceId
if (-not (Test-Path -LiteralPath $packageRoot -PathType Container)) {
    throw "WHISPER_1235_SOURCE_NOT_STAGED"
}
$packageManifest = Join-Path $packageRoot "manifest.json"
if (-not (Test-Path -LiteralPath $packageManifest -PathType Leaf)) {
    throw "WHISPER_1235_SOURCE_MANIFEST_MISSING"
}

$assetRoot = Join-Path $working "rc-assets"
$fixtureRoot = Join-Path $working "synthetic-fixture"
$genericRawRoot = Join-Path $working ".runtime-evidence"
$craigOutput = Join-Path $working "craig"
$validatedRoot = Join-Path $working "validated"
New-Item -ItemType Directory -Force -Path $assetRoot, $genericRawRoot, $craigOutput, $validatedRoot | Out-Null

$candidatePath = Ensure-Asset $assetRoot $CandidateManifestName $CandidateManifestSha256
$archivePath = Ensure-Asset $assetRoot $RuntimeArchiveName $RuntimeArchiveSha256
$digestPath = Ensure-Asset $assetRoot $RuntimeDigestName $RuntimeDigestSha256
$null = $archivePath
$null = $digestPath

$candidate = Read-Json $candidatePath "WHISPER_1235_CANDIDATE_INVALID"
if (
    [string]$candidate.schema -ne "tda_runtime_candidate_v1" -or
    [string]$candidate.family -ne "whisper" -or
    [string]$candidate.runtime_id -ne "whisper-ctranslate2" -or
    [string]$candidate.version -ne $CandidateVersion -or
    [string]$candidate.candidate_tag -ne $CandidateTag -or
    [string]$candidate.stable_tag -ne "companion-whisper-runtime-v1.1.8" -or
    [string]$candidate.source_sha -ne $CandidateSourceSha -or
    [string]$candidate.source_tree_sha -ne $CandidateSourceTreeSha -or
    [string]$candidate.runtime_archive_sha256 -ne $RuntimeArchiveSha256
) {
    throw "WHISPER_1235_CANDIDATE_IDENTITY_MISMATCH"
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

    Write-Host "Installing/verifying exact Whisper Runtime $CandidateVersion..."
    Invoke-Python $python @(
        "-m", "tda_companion.rc_runtime_artifacts", "install-candidate",
        "--candidate-manifest", $candidatePath,
        "--assets-root", $assetRoot,
        "--runtime-root", $runtime,
        "--cache-root", (Join-Path $working "install-cache")
    ) "WHISPER_1235_RUNTIME_INSTALL_FAILED"

    $worker = Join-Path (Join-Path (Join-Path $runtime "whisper") $CandidateVersion) "TDAWhisperWorker.exe"
    if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) {
        throw "WHISPER_1235_RUNTIME_WORKER_MISSING"
    }

    Write-Host "Generating non-private physical acceptance audio..."
    $fixtureScript = Join-Path $repo "tools\acceptance\generate-physical-acceptance-fixture.ps1"
    & $fixtureScript -OutputRoot $fixtureRoot -TargetSeconds 80 -CraigTrackCount 1
    $syntheticAudio = Join-Path $fixtureRoot "tda-physical-acceptance-synthetic.wav"
    if (-not (Test-Path -LiteralPath $syntheticAudio -PathType Leaf)) {
        throw "WHISPER_1235_FIXTURE_AUDIO_MISSING"
    }

    $genericReceipts = [Collections.Generic.List[string]]::new()
    foreach ($profile in $Profiles) {
        Write-Host "[$profile] Generic runtime GPU acceptance..."
        $receipt = Invoke-JsonProcess -Executable $worker -Arguments @(
            "--acceptance",
            "--audio", $syntheticAudio,
            "--models-root", $models,
            "--profile", $profile,
            "--require-gpu-name", $RequireGpuName
        ) -ErrorPrefix ("WHISPER_1235_GENERIC_" + $profile.Replace("-", "_").ToUpperInvariant())

        if (
            [string]$receipt.schema -ne "tda_whisper_gpu_acceptance_v1" -or
            $receipt.pass -ne $true -or
            [string]$receipt.profile_id -ne $profile -or
            $null -eq $receipt.gpu -or
            $receipt.gpu.required_name_match -ne $true -or
            $null -eq $receipt.inference -or
            [string]$receipt.inference.device -ne "cuda"
        ) {
            throw "WHISPER_1235_GENERIC_RECEIPT_INVALID:$profile"
        }
        $path = Join-Path $genericRawRoot "$profile.json"
        Write-Json $path $receipt
        $genericReceipts.Add($path)
    }

    $genericValidated = Join-Path $validatedRoot "$CandidateTag.json"
    Write-Host "Sealing generic immutable runtime acceptance receipt..."
    Invoke-Python $python @(
        "-m", "tda_companion.runtime_release_evidence", "seal-physical",
        "--candidate-manifest", $candidatePath,
        "--runtime-root", $runtime,
        "--whisper-receipt", $genericReceipts[0],
        "--whisper-receipt", $genericReceipts[1],
        "--output", $genericValidated
    ) "WHISPER_1235_GENERIC_SEAL_FAILED"

    $promotionPreview = Join-Path $validatedRoot "TDARuntime-promotion.preview.json"
    Invoke-Python $python @(
        "-m", "tda_companion.runtime_release_evidence", "verify-promotion",
        "--candidate-manifest", $candidatePath,
        "--acceptance-receipt", $genericValidated,
        "--assets-root", $assetRoot,
        "--output", $promotionPreview
    ) "WHISPER_1235_GENERIC_PROMOTION_VERIFY_FAILED"

    Write-Host "Running the real Craig #1235 sample + full gate for both Whisper profiles..."
    $craigHarness = Join-Path $repo "local-companion\packaging\run-whisper-craig-containment-acceptance.ps1"
    $craigArguments = @{
        DataRoot = $data
        SourceId = $SourceId
        RuntimeCandidateManifest = $candidatePath
        RuntimeRoot = $runtime
        ModelsRoot = $models
        OutputRoot = $craigOutput
        RequireGpuName = $RequireGpuName
    }
    & $craigHarness @craigArguments

    $specificValidated = Join-Path $validatedRoot "$CandidateTag.whisper-1235.json"
    Write-Host "Validating sanitized #1235 receipt..."
    Invoke-Python $python @(
        (Join-Path $repo "tools\acceptance\whisper_1235_receipt.py"),
        "--candidate-manifest", $candidatePath,
        "--evidence-root", $craigOutput,
        "--retained-output", $specificValidated
    ) "WHISPER_1235_SPECIFIC_RECEIPT_INVALID"

    $docsRoot = Join-Path $repo "docs\companion\runtime-acceptance"
    New-Item -ItemType Directory -Force -Path $docsRoot | Out-Null
    $genericDestination = Join-Path $docsRoot "$CandidateTag.json"
    $specificDestination = Join-Path $docsRoot "$CandidateTag.whisper-1235.json"
    Publish-Evidence $genericValidated $genericDestination
    Publish-Evidence $specificValidated $specificDestination

    Write-Host ""
    Write-Host "Whisper #1235 physical acceptance: PASS" -ForegroundColor Green
    Write-Host "Exact RC: $CandidateTag"
    Write-Host "Generic promotion receipt: $genericDestination"
    Write-Host "Craig containment receipt: $specificDestination"
    Write-Host "Both files are sanitized and ready to commit; Stable promotion must reuse the same RC release object."
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
