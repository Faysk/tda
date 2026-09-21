param(
    [string]$OutputRoot = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance\recovery-1585a932"),
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765,
    [switch]$Automated,
    [switch]$AllowLegacyTrayEquivalent
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RcTag = "companion-rc-v0.3.14-1585a93235ba"
$Version = "0.3.14"
$SourceSha = "1585a93235ba2fe7c2c093ef1683f0beca5d1605"
$CandidateSha256 = "344f4d8f7c8d353699a35bd182edd1c202585affe4d6f69d257d78793bee065e"
$MsiSha256 = "83c267ae14f10fda950413cab74394fc7b875225fa0e13f5123c8901f609f8c3"
$PayloadSha256 = "bc6ac20dbac3e0d9a31ff1cc3ff8a09e8e5b455cb644bcea00fe45f80bd34312"
$Origin = "https://dnd.faysk.dev"
$RequiredProfiles = @("whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality")

function Require-Windows {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "RECOVERY_WINDOWS_REQUIRED"
    }
    if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }
}

function Require-PowerShell7 {
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        throw "RECOVERY_POWERSHELL7_REQUIRED"
    }
    $command = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
    if ($null -eq $command) { $command = Get-Command "pwsh" -ErrorAction SilentlyContinue }
    if ($null -eq $command) { throw "RECOVERY_POWERSHELL7_REQUIRED" }
    return [string]$command.Source
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Download-ExactAsset(
    [string]$Name,
    [string]$ExpectedSha256,
    [string]$Destination
) {
    $url = "https://github.com/Faysk/tda/releases/download/$RcTag/$Name"
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        if ((Get-Sha256 $Destination) -eq $ExpectedSha256) { return }
        Remove-Item -LiteralPath $Destination -Force
    }
    Write-Host "Downloading $Name..." -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $Destination
    $actual = Get-Sha256 $Destination
    if ($actual -ne $ExpectedSha256) {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        throw "RECOVERY_DOWNLOAD_HASH_MISMATCH:$Name"
    }
}

function Read-Json([string]$Path, [string]$Code) {
    try {
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 |
            ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw $Code
    }
}

function Get-ExactAgentHealth([int]$AgentPort, [string]$ExpectedVersion) {
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$AgentPort/api/v1/health" -TimeoutSec 2
        if (
            [string]$health.product_id -ne "tda-companion" -or
            [string]$health.api_version -ne "1" -or
            [string]$health.service_version -ne $ExpectedVersion -or
            [int]$health.port -ne $AgentPort -or
            [int]$health.pid -le 0
        ) {
            return $null
        }
        return $health
    } catch {
        return $null
    }
}

function Wait-ExactAgent([int]$AgentPort, [string]$ExpectedVersion, [int]$TimeoutSeconds = 20) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $health = Get-ExactAgentHealth $AgentPort $ExpectedVersion
        if ($null -ne $health) { return $health }
        Start-Sleep -Milliseconds 250
    }
    return $null
}

function Test-ExactInstalledPayload([string]$PayloadManifestPath, [string]$ExpectedVersion) {
    $payload = Read-Json $PayloadManifestPath "RECOVERY_PAYLOAD_MANIFEST_INVALID"
    if (
        [string]$payload.schema -ne "tda_companion_payload_v1" -or
        [string]$payload.version -ne $ExpectedVersion -or
        [string]$payload.source_sha -ne $SourceSha
    ) {
        return $false
    }

    $appRoot = Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$ExpectedVersion"
    foreach ($name in @(
        "TDACompanion.exe",
        "TDACompanionMaintenance.exe",
        "run-physical-acceptance.ps1",
        "run-installed-acceptance.ps1",
        "install-rc-runtimes.ps1"
    )) {
        $row = $payload.files.PSObject.Properties[$name]
        if ($null -eq $row) { return $false }
        $path = Join-Path $appRoot $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
        if ((Get-Item -LiteralPath $path).Length -ne [int64]$row.Value.size) { return $false }
        if ((Get-Sha256 $path) -ne [string]$row.Value.sha256) { return $false }
    }
    return $true
}

function Test-MsiProductCode([string]$Value) {
    $parsed = [Guid]::Empty
    return [Guid]::TryParseExact($Value, "B", [ref]$parsed)
}

function Remove-SupersededSameVersionCandidate([string]$ExpectedVersion) {
    $productKey = "HKCU:\Software\Faysk\TDA Companion"
    if (-not (Test-Path -LiteralPath $productKey)) {
        throw "RECOVERY_SUPERSEDED_PRODUCT_REGISTRY_MISSING"
    }
    $metadata = Get-ItemProperty -LiteralPath $productKey -ErrorAction Stop
    $installedVersion = [string]$metadata.Version
    $productCode = [string]$metadata.ProductCode
    if ($installedVersion -ne $ExpectedVersion) {
        throw "RECOVERY_SUPERSEDED_VERSION_MISMATCH:$installedVersion"
    }
    if (-not (Test-MsiProductCode $productCode)) {
        throw "RECOVERY_SUPERSEDED_PRODUCT_CODE_INVALID"
    }

    Write-Host ""
    Write-Host "Removing superseded same-version RC before installing the exact candidate..." -ForegroundColor Cyan
    Write-Host "Installed version: $installedVersion"
    Write-Host "Windows Installer product: $productCode"
    Write-Host "TDA State/Data/Logs/Cache/Models/Runtime are preserved by the normal uninstall path."

    $uninstallLog = Join-Path $env:TEMP "tda-recovery-1585a932-superseded-uninstall.log"
    $arguments = @(
        "/x",
        $productCode,
        "/qn",
        "/norestart",
        "/L*v",
        ('"{0}"' -f $uninstallLog)
    )
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
    if ([int]$process.ExitCode -notin @(0, 3010)) {
        if (Test-Path -LiteralPath $uninstallLog -PathType Leaf) {
            Get-Content -LiteralPath $uninstallLog -Tail 120 | Write-Host
        }
        throw "RECOVERY_SUPERSEDED_UNINSTALL_FAILED:$($process.ExitCode)"
    }

    $marker = Join-Path $env:LOCALAPPDATA "TDA\Companion\current-version.txt"
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(20)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and (Test-Path -LiteralPath $marker)) {
        Start-Sleep -Milliseconds 250
    }
    if (Test-Path -LiteralPath $marker) {
        throw "RECOVERY_SUPERSEDED_UNINSTALL_INCOMPLETE"
    }
}

function Ensure-ExactCandidateInstalled(
    [string]$CandidateMsi,
    [string]$PayloadManifestPath,
    [int]$AgentPort
) {
    $companionRoot = Join-Path $env:LOCALAPPDATA "TDA\Companion"
    $marker = Join-Path $companionRoot "current-version.txt"
    $currentVersion = $null
    if (Test-Path -LiteralPath $marker -PathType Leaf) {
        try { $currentVersion = (Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim() } catch { }
    }

    $exactPayload = $false
    if ($currentVersion -eq $Version) {
        $exactPayload = Test-ExactInstalledPayload $PayloadManifestPath $Version
        if (-not $exactPayload) {
            # Windows Installer does not treat a different MSI with the same
            # ProductVersion as a major upgrade by default. This machine can
            # legitimately have the superseded 0.3.14 RC installed, so remove
            # that registered product first through the preserve-data uninstall
            # path, then install and verify the exact candidate bytes.
            Remove-SupersededSameVersionCandidate $Version
            $currentVersion = $null
        }
    }

    if (-not $exactPayload) {
        Write-Host ""
        Write-Host "Installing the exact recovery candidate before physical acceptance..." -ForegroundColor Cyan
        if ($currentVersion) {
            Write-Host "Current installed version: $currentVersion"
        } else {
            Write-Host "Current installed version: none"
        }
        Write-Host "Target installed version:  $Version"
        Write-Host "The MSI major-upgrade guard owns process shutdown/restart and preserves TDA user data."
        [void](Read-Host "Press ENTER to install the exact RC MSI")

        $installLog = Join-Path $env:TEMP "tda-recovery-1585a932-msi-install.log"
        $arguments = @(
            "/i",
            ('"{0}"' -f $CandidateMsi),
            "/qn",
            "/norestart",
            "/L*v",
            ('"{0}"' -f $installLog)
        )
        $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
        if ([int]$process.ExitCode -notin @(0, 3010)) {
            if (Test-Path -LiteralPath $installLog -PathType Leaf) {
                Get-Content -LiteralPath $installLog -Tail 120 | Write-Host
            }
            throw "RECOVERY_CANDIDATE_MSI_INSTALL_FAILED:$($process.ExitCode)"
        }

        if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
            throw "RECOVERY_CANDIDATE_VERSION_MARKER_MISSING"
        }
        $installedVersion = (Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim()
        if ($installedVersion -ne $Version) {
            throw "RECOVERY_CANDIDATE_VERSION_MARKER_MISMATCH:$installedVersion"
        }
        if (-not (Test-ExactInstalledPayload $PayloadManifestPath $Version)) {
            throw "RECOVERY_CANDIDATE_INSTALLED_PAYLOAD_MISMATCH"
        }
    } else {
        Write-Host ""
        Write-Host "Exact $Version candidate payload is already installed; MSI reinstall is not required." -ForegroundColor Green
    }

    $health = Wait-ExactAgent $AgentPort $Version 20
    if ($null -eq $health) {
        throw "RECOVERY_CANDIDATE_AGENT_NOT_READY"
    }
    Write-Host "Exact Agent ready: PID $([int]$health.pid), version $([string]$health.service_version)" -ForegroundColor Green

    $installedExe = Join-Path $companionRoot "versions\$Version\TDACompanion.exe"
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
        throw "RECOVERY_CANDIDATE_EXECUTABLE_MISSING"
    }
    Start-Process -FilePath $installedExe -ArgumentList "--ui" | Out-Null
    Start-Sleep -Seconds 2
}

function Write-ImmutableCopy([string]$Source, [string]$Destination) {
    $sourceSha = Get-Sha256 $Source
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        if ((Get-Sha256 $Destination) -ne $sourceSha) {
            throw "RECOVERY_RECEIPT_EXISTS_MISMATCH"
        }
        return
    }
    Copy-Item -LiteralPath $Source -Destination $Destination
}

function Get-ReadyProfiles([int]$AgentPort) {
    $base = "http://127.0.0.1:$AgentPort/api/v1"
    try {
        $session = Invoke-RestMethod -Method Post -Uri "$base/session" -Headers @{
            Origin = $Origin
            Accept = "application/json"
        } -ContentType "application/json" -Body "{}" -TimeoutSec 10
        $token = [string]$session.token
        if (-not $token) { throw "SESSION_TOKEN_MISSING" }
        $capabilities = Invoke-RestMethod -Method Get -Uri "$base/capabilities" -Headers @{
            Origin = $Origin
            Authorization = "Bearer $token"
            Accept = "application/json"
        } -TimeoutSec 10
        return @($capabilities.transcription.profiles | ForEach-Object { [string]$_ })
    } catch {
        throw "RECOVERY_AGENT_CAPABILITIES_UNAVAILABLE"
    }
}

function Require-AllProfilesReady([int]$AgentPort) {
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $ready = @(Get-ReadyProfiles $AgentPort)
        $missing = @($RequiredProfiles | Where-Object { $_ -notin $ready })
        if ($missing.Count -eq 0) {
            Write-Host "All four ASR profiles are ready." -ForegroundColor Green
            return
        }

        Write-Host ""
        Write-Host "ASR preparation still required: $($missing -join ', ')" -ForegroundColor Yellow
        Write-Host "In the installed Companion/Web processing screen, prepare the missing profiles."
        Write-Host "This may download large Whisper/Qwen runtimes and models through BITS."
        [void](Read-Host "When the missing profiles report ready, press ENTER to re-check")
    }
    throw "RECOVERY_REQUIRED_PROFILES_NOT_READY"
}

function Assert-InstalledReceipt([object]$Value) {
    if (
        [string]$Value.schema -ne "tda_installed_acceptance_v3" -or
        $Value.pass -ne $true -or
        [string]$Value.version -ne $Version -or
        [string]$Value.artifact.source_sha -ne $SourceSha -or
        [string]$Value.artifact.msi_sha256 -ne $MsiSha256 -or
        [string]$Value.artifact.payload_manifest_sha256 -ne $PayloadSha256 -or
        $Value.contains_token -ne $false -or
        $Value.contains_paths -ne $false -or
        $Value.contains_transcript -ne $false
    ) {
        throw "RECOVERY_INSTALLED_RECEIPT_INVALID"
    }
}

function Assert-PhysicalReceipt([object]$Value) {
    if (
        [string]$Value.schema -ne "tda_physical_acceptance_suite_v2" -or
        $Value.pass -ne $true -or
        [string]$Value.candidate.rc_tag -ne $RcTag -or
        [string]$Value.candidate.version -ne $Version -or
        [string]$Value.candidate.source_sha -ne $SourceSha -or
        [string]$Value.candidate.msi_sha256 -ne $MsiSha256 -or
        [string]$Value.candidate.payload_manifest_sha256 -ne $PayloadSha256 -or
        $Value.transcripts_written -ne $false -or
        $Value.contains_audio -ne $false -or
        $Value.contains_transcript -ne $false -or
        $Value.contains_token -ne $false -or
        $Value.contains_paths -ne $false
    ) {
        throw "RECOVERY_PHYSICAL_RECEIPT_INVALID"
    }
    $profiles = @($Value.profiles | ForEach-Object { [string]$_ })
    foreach ($profile in $RequiredProfiles) {
        if ($profile -notin $profiles) { throw "RECOVERY_PHYSICAL_PROFILE_MISSING:$profile" }
    }
    if ([string]$Value.hardware.gpu_name -notmatch "(?i)RTX 4070") {
        throw "RECOVERY_PHYSICAL_GPU_INVALID"
    }
}

Require-Windows
$pwshPath = Require-PowerShell7
Write-Host "PowerShell runtime: $($PSVersionTable.PSVersion) - $pwshPath" -ForegroundColor Green

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$generator = Join-Path $PSScriptRoot "generate-physical-acceptance-fixture.ps1"
$installedScript = Join-Path $repoRoot "local-companion\packaging\run-installed-acceptance.ps1"
$physicalScript = Join-Path $repoRoot "local-companion\packaging\run-physical-acceptance.ps1"
foreach ($path in @($generator, $installedScript, $physicalScript)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "RECOVERY_REQUIRED_SCRIPT_MISSING"
    }
}

$output = [IO.Path]::GetFullPath($OutputRoot)
$downloads = Join-Path $output "downloads"
$fixtureRoot = Join-Path $output "fixture"
$receipts = Join-Path $output "receipts"
$physicalStage = Join-Path $receipts ".physical"
New-Item -ItemType Directory -Force -Path $downloads, $fixtureRoot, $receipts, $physicalStage | Out-Null

$candidatePath = Join-Path $downloads "TDACompanion-candidate.json"
$msiPath = Join-Path $downloads "TDACompanion-x64.msi"
$payloadPath = Join-Path $downloads "TDACompanion-payload-manifest.json"

Download-ExactAsset "TDACompanion-candidate.json" $CandidateSha256 $candidatePath
Download-ExactAsset "TDACompanion-x64.msi" $MsiSha256 $msiPath
Download-ExactAsset "TDACompanion-payload-manifest.json" $PayloadSha256 $payloadPath

$candidate = Read-Json $candidatePath "RECOVERY_CANDIDATE_INVALID"
if (
    [string]$candidate.schema -ne "tda_companion_candidate_v2" -or
    [string]$candidate.tag -ne $RcTag -or
    [string]$candidate.version -ne $Version -or
    [string]$candidate.source_sha -ne $SourceSha -or
    [string]$candidate.assets.msi.sha256 -ne $MsiSha256 -or
    [string]$candidate.assets.payload_manifest.sha256 -ne $PayloadSha256
) {
    throw "RECOVERY_CANDIDATE_IDENTITY_MISMATCH"
}

Write-Host ""
Write-Host "Generating synthetic acceptance fixtures..." -ForegroundColor Cyan
& $pwshPath -NoLogo -NoProfile -ExecutionPolicy Bypass -File $generator -OutputRoot $fixtureRoot -TargetSeconds 80
if ($LASTEXITCODE -ne 0) { throw "RECOVERY_FIXTURE_GENERATION_FAILED" }

$audioPath = Join-Path $fixtureRoot "tda-physical-acceptance-synthetic.wav"
$craigPath = Join-Path $fixtureRoot "tda-installed-acceptance-craig.zip"
if (
    -not (Test-Path -LiteralPath $audioPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $craigPath -PathType Leaf)
) {
    throw "RECOVERY_FIXTURE_OUTPUT_MISSING"
}

Ensure-ExactCandidateInstalled $msiPath $payloadPath $Port

$installedRaw = Join-Path $receipts "installed.raw.json"
Write-Host ""
Write-Host "PHASE 1/2 - Installed Windows acceptance" -ForegroundColor Cyan
$installedModeArgs = @()
if ($Automated) {
    Write-Host "Automated mode: zero PASS prompts, no Task Manager, no manual port blocker and no manual network toggle." -ForegroundColor Green
    $installedModeArgs += "-Automated"
    if ($AllowLegacyTrayEquivalent) { $installedModeArgs += "-AllowLegacyTrayEquivalent" }
} else {
    Write-Host "Interactive compatibility mode: operator observations are still available when explicitly requested."
}
& $pwshPath -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installedScript `
    -CandidateMsi $msiPath `
    -PayloadManifest $payloadPath `
    -SourceSha $SourceSha `
    -CraigZip $craigPath `
    -ReceiptPath $installedRaw `
    -Port $Port `
    @installedModeArgs
if ($LASTEXITCODE -ne 0) { throw "RECOVERY_INSTALLED_ACCEPTANCE_FAILED" }
if (-not (Test-Path -LiteralPath $installedRaw -PathType Leaf)) {
    throw "RECOVERY_INSTALLED_ACCEPTANCE_FAILED"
}
$installed = Read-Json $installedRaw "RECOVERY_INSTALLED_RECEIPT_INVALID"
Assert-InstalledReceipt $installed

Write-Host ""
Write-Host "Preparing ASR profiles for the physical suite..." -ForegroundColor Cyan
Require-AllProfilesReady $Port

Write-Host ""
Write-Host "PHASE 2/2 - Physical ASR/GPU acceptance" -ForegroundColor Cyan
& $pwshPath -NoLogo -NoProfile -ExecutionPolicy Bypass -File $physicalScript `
    -Audio $audioPath `
    -CandidateManifest $candidatePath `
    -CandidateMsi $msiPath `
    -PayloadManifest $payloadPath `
    -OutputRoot $physicalStage `
    -RequireGpuName "RTX 4070"
if ($LASTEXITCODE -ne 0) { throw "RECOVERY_PHYSICAL_ACCEPTANCE_FAILED" }

$physicalRaw = Join-Path $physicalStage "physical-acceptance-suite.json"
if (-not (Test-Path -LiteralPath $physicalRaw -PathType Leaf)) {
    throw "RECOVERY_PHYSICAL_RECEIPT_MISSING"
}
$physical = Read-Json $physicalRaw "RECOVERY_PHYSICAL_RECEIPT_INVALID"
Assert-PhysicalReceipt $physical

$installedFinal = Join-Path $receipts "$RcTag.json"
$physicalFinal = Join-Path $receipts "$RcTag.physical.json"
Write-ImmutableCopy $installedRaw $installedFinal
Write-ImmutableCopy $physicalRaw $physicalFinal

Write-Host ""
Write-Host "RECOVERY CANDIDATE ACCEPTANCE: PASS" -ForegroundColor Green
Write-Host "Candidate: $RcTag"
Write-Host "Source: $SourceSha"
Write-Host "MSI SHA-256: $MsiSha256"
Write-Host "Installed receipt: $installedFinal"
Write-Host "Physical receipt:  $physicalFinal"
Write-Host ""
Write-Host "Do not publish transcripts or audio. Only the two sanitized final receipts are promotion evidence."
