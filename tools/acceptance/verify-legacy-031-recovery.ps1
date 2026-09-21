param(
    [Parameter(Mandatory = $true)]
    [string]$Python,
    [Parameter(Mandatory = $true)]
    [string]$LegacySourceRoot,
    [Parameter(Mandatory = $true)]
    [string]$StableSourceRoot,
    [string]$OutputRoot = (Join-Path $env:RUNNER_TEMP "tda-031-recovery")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$LegacyTag = "companion-v0.3.1"
$LegacySourceSha = "d175c6d95c117e8324bb063292906b55e021b162"
$LegacyMsiSha256 = "52e847bb5fe569b85fd4bc9145ad18247dad6eacc7884474f859c41371d3a6bf"
$StableTag = "companion-v0.3.9"
$StableSourceSha = "872964981f05aaa864d660952fe2ec9435ecf267"
$StableMsiSha256 = "67abdb127ae2d1569f3f3200274bad8da2a0a79e8abc45eb6cafca291edfe39c"
$StablePayloadSha256 = "b32cc542137d8523a026b88522f124b569ebf3f67ed5473fb3689af600107616"

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Download-Checked(
    [string]$Url,
    [string]$Destination,
    [string]$ExpectedSha256
) {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
    $actual = Get-Sha256 $Destination
    if ($actual -ne $ExpectedSha256) {
        throw "LEGACY_RECOVERY_DOWNLOAD_HASH_MISMATCH:$actual"
    }
}

function Invoke-Msi(
    [string[]]$Arguments,
    [string]$LogPath,
    [string]$Code
) {
    $allArguments = @($Arguments + @("/norestart", "/L*v", ('"{0}"' -f $LogPath)))
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $allArguments -PassThru
    if (-not $process.WaitForExit(240000)) {
        try { $process.Kill($true) } catch {}
        try { $process.WaitForExit(5000) | Out-Null } catch {}
        if (Test-Path -LiteralPath $LogPath) {
            Get-Content -LiteralPath $LogPath -Tail 180 | Write-Host
        }
        throw "$($Code):TIMEOUT"
    }
    if ([int]$process.ExitCode -notin @(0, 3010)) {
        if (Test-Path -LiteralPath $LogPath) {
            Get-Content -LiteralPath $LogPath -Tail 180 | Write-Host
        }
        throw "$($Code):$($process.ExitCode)"
    }
}

function Invoke-UpdaterProbe(
    [string]$SourceRoot,
    [string]$CacheRoot,
    [ValidateSet("legacy-failure", "fixed-success")]
    [string]$Expectation
) {
    $packageRoot = Join-Path $SourceRoot "local-companion"
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot "tda_companion\updates.py"))) {
        throw "UPDATER_SOURCE_MISSING"
    }

    $previousPythonPath = $env:PYTHONPATH
    $previousCache = $env:TDA_LEGACY_RECOVERY_CACHE
    try {
        $env:PYTHONPATH = $packageRoot
        $env:TDA_LEGACY_RECOVERY_CACHE = $CacheRoot
        if ($Expectation -eq "legacy-failure") {
            $code = @'
import os
from pathlib import Path
from tda_companion.updates import UpdateManifest, download_update

# Reconstruct the exact manifest shape accepted by 0.3.1 before release-lock
# query parameters were introduced. The MSI identity comes from the immutable
# published companion-v0.3.9 release; only the legacy Web route shape is
# reconstructed so this probe exercises the historical redirect defect instead
# of failing earlier on today's stricter manifest URL.
manifest = UpdateManifest(
    version="0.3.9",
    tag="companion-v0.3.9",
    minimum_api="1",
    url="https://dnd.faysk.dev/api/downloads/companion/windows",
    sha256="67abdb127ae2d1569f3f3200274bad8da2a0a79e8abc45eb6cafca291edfe39c",
    size=42830876,
)

try:
    download_update(
        manifest,
        Path(os.environ["TDA_LEGACY_RECOVERY_CACHE"]),
        timeout=120.0,
    )
except RuntimeError as exc:
    if str(exc) != "UPDATE_REDIRECT_REJECTED":
        raise
    print("LEGACY_UPDATE_REDIRECT_REJECTED_CONFIRMED")
else:
    raise SystemExit("LEGACY_UPDATER_UNEXPECTEDLY_ACCEPTED_CURRENT_REDIRECT")
'@
        } else {
            $code = @'
import hashlib
import os
from pathlib import Path
from tda_companion.updates import fetch_manifest, download_update

manifest = fetch_manifest()
if manifest.version != "0.3.9" or manifest.tag != "companion-v0.3.9":
    raise SystemExit(f"FIXED_MANIFEST_IDENTITY_UNEXPECTED:{manifest.version}:{manifest.tag}")

path = download_update(
    manifest,
    Path(os.environ["TDA_LEGACY_RECOVERY_CACHE"]),
    timeout=120.0,
    prefer_bits=False,
)
digest = hashlib.sha256(path.read_bytes()).hexdigest()
expected = "67abdb127ae2d1569f3f3200274bad8da2a0a79e8abc45eb6cafca291edfe39c"
if digest != expected:
    raise SystemExit(f"FIXED_UPDATER_HASH_MISMATCH:{digest}")
print("FIXED_UPDATER_REDIRECT_AND_HASH_CONFIRMED")
'@
        }

        $probePath = Join-Path $CacheRoot ("updater-probe-{0}.py" -f $Expectation)
        New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
        [IO.File]::WriteAllText(
            $probePath,
            $code,
            [Text.UTF8Encoding]::new($false)
        )
        & $Python $probePath
        $probeExitCode = $LASTEXITCODE
        Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
        if ($probeExitCode -ne 0) {
            throw "UPDATER_PROBE_FAILED:$($Expectation):$probeExitCode"
        }
    } finally {
        $env:PYTHONPATH = $previousPythonPath
        $env:TDA_LEGACY_RECOVERY_CACHE = $previousCache
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "LEGACY_RECOVERY_WINDOWS_REQUIRED"
}
if (-not $env:LOCALAPPDATA) {
    throw "LOCALAPPDATA_NOT_FOUND"
}

$output = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $output | Out-Null

$legacyMsi = Join-Path $output "TDACompanion-0.3.1.msi"
$stableMsi = Join-Path $output "TDACompanion-0.3.9.msi"
$stablePayload = Join-Path $output "TDACompanion-0.3.9-payload.json"
$legacyLog = Join-Path $output "01-install-031.log"
$upgradeLog = Join-Path $output "02-upgrade-039.log"
$uninstallLog = Join-Path $output "03-uninstall-039.log"
$legacyCache = Join-Path $output "legacy-updater-cache"
$fixedCache = Join-Path $output "fixed-updater-cache"

Download-Checked "https://github.com/Faysk/tda/releases/download/$LegacyTag/TDACompanion-x64.msi" $legacyMsi $LegacyMsiSha256
Download-Checked "https://github.com/Faysk/tda/releases/download/$StableTag/TDACompanion-x64.msi" $stableMsi $StableMsiSha256
Download-Checked "https://github.com/Faysk/tda/releases/download/$StableTag/TDACompanion-payload-manifest.json" $stablePayload $StablePayloadSha256

$legacyHead = (& git -C $LegacySourceRoot rev-parse HEAD).Trim()
$stableHead = (& git -C $StableSourceRoot rev-parse HEAD).Trim()
if ($legacyHead -ne $LegacySourceSha) {
    throw "LEGACY_SOURCE_MISMATCH:$legacyHead"
}
if ($stableHead -ne $StableSourceSha) {
    throw "STABLE_SOURCE_MISMATCH:$stableHead"
}

$tdaRoot = Join-Path $env:LOCALAPPDATA "TDA"
$marker = Join-Path $tdaRoot "Data\legacy-031-recovery-marker.txt"
$currentVersion = Join-Path $tdaRoot "Companion\current-version.txt"
$productKey = "HKCU:\Software\Faysk\TDA Companion"

try {
    Remove-Item -LiteralPath $tdaRoot -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "Installing exact published Companion 0.3.1 MSI..." -ForegroundColor Cyan
    Invoke-Msi @("/i", ('"{0}"' -f $legacyMsi), "/qn") $legacyLog "LEGACY_031_INSTALL_FAILED"

    if (-not (Test-Path -LiteralPath $currentVersion -PathType Leaf)) {
        throw "LEGACY_031_VERSION_MARKER_MISSING"
    }
    if ((Get-Content -LiteralPath $currentVersion -Raw).Trim() -ne "0.3.1") {
        throw "LEGACY_031_VERSION_MARKER_INVALID"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $marker -Parent) | Out-Null
    Set-Content -LiteralPath $marker -Value "preserve-through-manual-upgrade" -Encoding ascii -NoNewline

    # The published 0.3.1 MSI is installed above. This executes the updater
    # implementation from the exact source SHA that produced that release,
    # isolating the redirect defect without requiring WebView automation.
    Invoke-UpdaterProbe $LegacySourceRoot $legacyCache "legacy-failure"

    Write-Host "Manual recovery: upgrading exact 0.3.1 installation to official Stable 0.3.9..." -ForegroundColor Cyan
    Invoke-Msi @("/i", ('"{0}"' -f $stableMsi), "/qn") $upgradeLog "MANUAL_039_UPGRADE_FAILED"

    if ((Get-Content -LiteralPath $currentVersion -Raw).Trim() -ne "0.3.9") {
        throw "MANUAL_039_VERSION_MARKER_INVALID"
    }
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
        throw "MANUAL_UPGRADE_REMOVED_LOCAL_DATA"
    }
    if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne "preserve-through-manual-upgrade") {
        throw "MANUAL_UPGRADE_CHANGED_LOCAL_DATA"
    }

    $payload = Get-Content -LiteralPath $stablePayload -Raw -Encoding UTF8 | ConvertFrom-Json
    if (
        [string]$payload.schema -ne "tda_companion_payload_v1" -or
        [string]$payload.version -ne "0.3.9" -or
        [string]$payload.source_sha -ne $StableSourceSha
    ) {
        throw "STABLE_PAYLOAD_IDENTITY_INVALID"
    }
    $installedRoot = Join-Path $tdaRoot "Companion\versions\0.3.9"
    foreach ($property in $payload.files.PSObject.Properties) {
        $path = Join-Path $installedRoot $property.Name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "STABLE_PAYLOAD_FILE_MISSING:$($property.Name)"
        }
        if ((Get-Item -LiteralPath $path).Length -ne [int64]$property.Value.size) {
            throw "STABLE_PAYLOAD_SIZE_MISMATCH:$($property.Name)"
        }
        if ((Get-Sha256 $path) -ne [string]$property.Value.sha256) {
            throw "STABLE_PAYLOAD_HASH_MISMATCH:$($property.Name)"
        }
    }

    # The fixed updater follows the same live Stable route while keeping exact
    # size/hash verification, rather than weakening redirect policy.
    Invoke-UpdaterProbe $StableSourceRoot $fixedCache "fixed-success"

    $metadata = Get-ItemProperty -LiteralPath $productKey -ErrorAction Stop
    if ([string]$metadata.Version -ne "0.3.9") {
        throw "STABLE_REGISTRY_VERSION_INVALID"
    }
    $productCode = [string]$metadata.ProductCode
    if ($productCode -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
        throw "STABLE_PRODUCT_CODE_INVALID"
    }

    Invoke-Msi @("/x", $productCode, "/qn") $uninstallLog "STABLE_UNINSTALL_FAILED"
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
        throw "UNINSTALL_REMOVED_PRESERVED_DATA"
    }

    Write-Host "LEGACY 0.3.1 RECOVERY ACCEPTANCE: PASS" -ForegroundColor Green
    Write-Host "Old updater: UPDATE_REDIRECT_REJECTED reproduced from exact release source."
    Write-Host "Manual MSI upgrade: 0.3.1 -> 0.3.9 passed."
    Write-Host "Local data preservation: passed through upgrade and normal uninstall."
    Write-Host "Fixed updater: live Stable redirect + SHA-256 verification passed."
} finally {
    try {
        if (Test-Path -LiteralPath $productKey) {
            $metadata = Get-ItemProperty -LiteralPath $productKey -ErrorAction SilentlyContinue
            $productCode = [string]$metadata.ProductCode
            if ($productCode -match '^\{[0-9A-Fa-f-]{36}\}$') {
                Start-Process -FilePath "msiexec.exe" -ArgumentList @("/x", $productCode, "/qn", "/norestart") -Wait -PassThru | Out-Null
            }
        }
    } catch {
        Write-Warning "Cleanup MSI uninstall failed: $($_.Exception.Message)"
    }
}
