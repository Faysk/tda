param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentMsiPath,
    [Parameter(Mandatory = $true)]
    [string]$CurrentVersion
)

$ErrorActionPreference = "Stop"
$previousVersion = "0.2.0"
$previousUrl = "https://github.com/Faysk/tda/releases/download/companion-v0.2.0/TDACompanion-x64.msi"
$previousSha256 = "dd01d6334c66f4315b3542f2cdf20b3a6cce86484e4a74945aea80cbbeec3398"
$msi = (Resolve-Path $CurrentMsiPath).Path
if ($CurrentVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "INVALID_CURRENT_VERSION" }
if ([version]$CurrentVersion -le [version]$previousVersion) { throw "CURRENT_VERSION_NOT_NEWER" }
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$tdaRoot = Join-Path $env:LOCALAPPDATA "TDA"
$previousMsi = Join-Path $env:TEMP "TDACompanion-$previousVersion-baseline.msi"
$logsRoot = Join-Path $env:TEMP "tda-lifecycle"
New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null

function Invoke-Msi([string[]]$Arguments, [string]$LogName) {
    $log = Join-Path $logsRoot $LogName
    $result = Start-Process -FilePath "msiexec.exe" -ArgumentList @($Arguments + @("/norestart", "/L*v", "`"$log`"")) -Wait -PassThru
    if ($result.ExitCode -notin @(0, 3010)) {
        if (Test-Path $log) { Get-Content $log -Tail 160 | Write-Host }
        throw "MSI_EXIT_CODE:$($result.ExitCode):$LogName"
    }
}

function Assert-FileValue([string]$Path, [string]$Expected, [string]$Code) {
    if (-not (Test-Path $Path)) { throw "$Code`:MISSING" }
    if ((Get-Content $Path -Raw).Trim() -ne $Expected) { throw "$Code`:CHANGED" }
}

function Seed-PersistentRoots([string]$Value) {
    foreach ($name in @("State", "Data", "Logs", "Cache", "Models", "Runtime")) {
        $folder = Join-Path $tdaRoot $name
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        Set-Content -Path (Join-Path $folder "lifecycle-preserve.txt") -Value $Value -Encoding ascii -NoNewline
    }
}

function Assert-PersistentRoots([string]$Value) {
    foreach ($name in @("State", "Data", "Logs", "Cache", "Models", "Runtime")) {
        Assert-FileValue (Join-Path $tdaRoot "$name\lifecycle-preserve.txt") $Value "PERSIST_$name"
    }
}

function Current-MaintenanceExe {
    return Join-Path $tdaRoot "Companion\versions\$CurrentVersion\TDACompanionMaintenance.exe"
}

try {
    # The previous release is mutable on GitHub in theory, so never trust the URL alone.
    Invoke-WebRequest -Uri $previousUrl -OutFile $previousMsi -UseBasicParsing
    $downloadedSha = (Get-FileHash -Algorithm SHA256 $previousMsi).Hash.ToLowerInvariant()
    if ($downloadedSha -ne $previousSha256) { throw "PREVIOUS_RELEASE_HASH_MISMATCH" }

    Remove-Item $tdaRoot -Recurse -Force -ErrorAction SilentlyContinue

    Invoke-Msi @("/i", "`"$previousMsi`"", "/qn") "01-install-$previousVersion.log"
    $previousMarker = Join-Path $tdaRoot "Companion\current-version.txt"
    Assert-FileValue $previousMarker $previousVersion "PREVIOUS_VERSION_MARKER"
    Seed-PersistentRoots "keep-across-upgrade"
    $oldToken = Join-Path $tdaRoot "State\pairing-token.txt"
    if (-not (Test-Path $oldToken)) {
        Set-Content -Path $oldToken -Value ("p" * 43) -Encoding ascii -NoNewline
    }
    $tokenBefore = (Get-Content $oldToken -Raw).Trim()

    # Real WiX MajorUpgrade from the published 0.2.0 product to this candidate.
    Invoke-Msi @("/i", "`"$msi`"", "/qn") "02-upgrade-to-$CurrentVersion.log"
    $currentMarker = Join-Path $tdaRoot "Companion\current-version.txt"
    Assert-FileValue $currentMarker $CurrentVersion "CURRENT_VERSION_MARKER"
    if (-not (Test-Path (Join-Path $tdaRoot "Companion\versions\$CurrentVersion\TDACompanion.exe"))) {
        throw "CURRENT_EXECUTABLE_MISSING_AFTER_UPGRADE"
    }
    Assert-PersistentRoots "keep-across-upgrade"
    Assert-FileValue $oldToken $tokenBefore "PAIRING_TOKEN_UPGRADE"
    if (Test-Path (Join-Path $tdaRoot "Companion\versions\$previousVersion\TDACompanion.exe")) {
        throw "PREVIOUS_EXECUTABLE_LEFT_AFTER_MAJOR_UPGRADE"
    }

    # Normal uninstall must remove application integration and preserve all user roots.
    Invoke-Msi @("/x", "`"$msi`"", "/qn") "03-uninstall-preserve.log"
    if (Test-Path $currentMarker) { throw "VERSION_MARKER_LEFT_AFTER_PRESERVE_UNINSTALL" }
    Assert-PersistentRoots "keep-across-upgrade"
    Assert-FileValue $oldToken $tokenBefore "PAIRING_TOKEN_PRESERVE_UNINSTALL"

    # Reinstall and prove the product-owned maintenance executable can purge everything.
    Invoke-Msi @("/i", "`"$msi`"", "/qn") "04-reinstall-for-purge.log"
    Seed-PersistentRoots "remove-on-purge"
    $maintenance = Current-MaintenanceExe
    if (-not (Test-Path $maintenance)) { throw "MAINTENANCE_EXECUTABLE_MISSING" }
    $purge = Start-Process -FilePath $maintenance -ArgumentList @("--uninstall", "--purge", "--root", "`"$tdaRoot`"") -Wait -PassThru
    if ($purge.ExitCode -ne 0) { throw "PURGE_EXIT_CODE:$($purge.ExitCode)" }
    if (Test-Path $tdaRoot) {
        Get-ChildItem -Force -Recurse $tdaRoot -ErrorAction SilentlyContinue | Select-Object -First 80 | Format-Table | Out-String | Write-Host
        throw "PURGE_ROOT_LEFT_BEHIND"
    }

    Write-Host "TDA Companion lifecycle smoke: PASS ($previousVersion -> $CurrentVersion -> preserve uninstall -> purge)"
}
finally {
    Remove-Item $previousMsi -Force -ErrorAction SilentlyContinue
    # Best-effort cleanup only if the test failed before purge.
    if (Test-Path $tdaRoot) {
        $maintenance = Current-MaintenanceExe
        if (Test-Path $maintenance) {
            try { Start-Process -FilePath $maintenance -ArgumentList @("--uninstall", "--purge", "--root", "`"$tdaRoot`"") -Wait | Out-Null } catch { }
        }
    }
}
