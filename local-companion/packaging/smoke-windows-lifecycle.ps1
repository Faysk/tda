param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentMsiPath,
    [Parameter(Mandatory = $true)]
    [string]$RollbackProbeMsiPath,
    [Parameter(Mandatory = $true)]
    [string]$CurrentVersion
)

$ErrorActionPreference = "Stop"
$previousVersion = "0.2.0"
$previousUrl = "https://github.com/Faysk/tda/releases/download/companion-v0.2.0/TDACompanion-x64.msi"
$previousSha256 = "dd01d6334c66f4315b3542f2cdf20b3a6cce86484e4a74945aea80cbbeec3398"
$msi = (Resolve-Path $CurrentMsiPath).Path
$rollbackProbeMsi = (Resolve-Path $RollbackProbeMsiPath).Path
if ($CurrentVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "INVALID_CURRENT_VERSION" }
if ([version]$CurrentVersion -le [version]$previousVersion) { throw "CURRENT_VERSION_NOT_NEWER" }
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$tdaRoot = Join-Path $env:LOCALAPPDATA "TDA"
$previousMsi = Join-Path $env:TEMP "TDACompanion-$previousVersion-baseline.msi"
$logsRoot = Join-Path $env:TEMP "tda-lifecycle"
New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null
$productKey = "HKCU:\Software\Faysk\TDA Companion"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\TDA\TDA Companion.lnk"

function Invoke-Msi([string[]]$Arguments, [string]$LogName) {
    $log = Join-Path $logsRoot $LogName
    $result = Start-Process -FilePath "msiexec.exe" -ArgumentList @($Arguments + @("/norestart", "/L*v", "`"$log`"")) -Wait -PassThru
    if ($result.ExitCode -notin @(0, 3010)) {
        if (Test-Path $log) { Get-Content $log -Tail 160 | Write-Host }
        throw "MSI_EXIT_CODE:$($result.ExitCode):$LogName"
    }
}

function Invoke-RollbackProbe([string]$ProbeMsi, [string]$LogName) {
    $log = Join-Path $logsRoot $LogName
    $result = Start-Process -FilePath "msiexec.exe" -ArgumentList @(
        "/i", "`"$ProbeMsi`"", "/qn", "/norestart", "/L*v", "`"$log`""
    ) -Wait -PassThru
    if ($result.ExitCode -in @(0, 3010)) {
        throw "ROLLBACK_PROBE_UNEXPECTED_SUCCESS:$($result.ExitCode)"
    }
    if (-not (Test-Path $log)) { throw "ROLLBACK_PROBE_LOG_MISSING" }
    $probeMarker = Select-String -Path $log -SimpleMatch "TDA Companion rollback probe: forced upgrade failure." -Quiet
    if (-not $probeMarker) {
        Get-Content $log -Tail 200 | Write-Host
        throw "ROLLBACK_PROBE_DID_NOT_REACH_FORCED_FAILURE:$($result.ExitCode)"
    }
    Write-Host "Rollback probe failed intentionally with MSI exit $($result.ExitCode)."
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
    $previousExe = Join-Path $tdaRoot "Companion\versions\$previousVersion\TDACompanion.exe"
    $candidateExe = Join-Path $tdaRoot "Companion\versions\$CurrentVersion\TDACompanion.exe"
    Assert-FileValue $previousMarker $previousVersion "PREVIOUS_VERSION_MARKER"
    if (-not (Test-Path $previousExe)) { throw "PREVIOUS_EXECUTABLE_MISSING" }
    if (-not (Test-Path $productKey)) { throw "PREVIOUS_PRODUCT_REGISTRY_MISSING" }
    $previousMetadata = Get-ItemProperty -Path $productKey
    $previousProductCode = [string]$previousMetadata.ProductCode
    if ($previousMetadata.Version -ne $previousVersion -or -not $previousProductCode) {
        throw "PREVIOUS_PRODUCT_REGISTRY_INVALID"
    }
    $previousStartup = (Get-ItemProperty -Path $runKey -Name "TDA Companion Agent" -ErrorAction Stop)."TDA Companion Agent"
    if ($previousStartup -notlike "*$previousVersion*TDACompanion.exe*--agent*--startup*") {
        throw "PREVIOUS_STARTUP_INVALID"
    }
    if (-not (Test-Path $shortcut)) { throw "PREVIOUS_SHORTCUT_MISSING" }

    Seed-PersistentRoots "keep-across-upgrade"
    $oldToken = Join-Path $tdaRoot "State\pairing-token.txt"
    if (-not (Test-Path $oldToken)) {
        Set-Content -Path $oldToken -Value ("p" * 43) -Encoding ascii -NoNewline
    }
    $tokenBefore = (Get-Content $oldToken -Raw).Trim()

    # C-07: fail after RemoveExistingProducts. With Schedule=afterInstallInitialize,
    # this happens inside the MSI transaction and must restore the previous product.
    Invoke-RollbackProbe $rollbackProbeMsi "02-rollback-probe-$CurrentVersion.log"

    Assert-FileValue $previousMarker $previousVersion "ROLLBACK_VERSION_MARKER"
    if (-not (Test-Path $previousExe)) { throw "ROLLBACK_PREVIOUS_EXECUTABLE_NOT_RESTORED" }
    if (Test-Path $candidateExe) { throw "ROLLBACK_CANDIDATE_EXECUTABLE_LEFT_BEHIND" }
    Assert-PersistentRoots "keep-across-upgrade"
    Assert-FileValue $oldToken $tokenBefore "PAIRING_TOKEN_ROLLBACK"
    if (-not (Test-Path $productKey)) { throw "ROLLBACK_PRODUCT_REGISTRY_MISSING" }
    $rolledBackMetadata = Get-ItemProperty -Path $productKey
    if ($rolledBackMetadata.Version -ne $previousVersion) { throw "ROLLBACK_REGISTRY_VERSION_NOT_RESTORED" }
    if ([string]$rolledBackMetadata.ProductCode -ne $previousProductCode) { throw "ROLLBACK_PRODUCT_CODE_NOT_RESTORED" }
    $rolledBackStartup = (Get-ItemProperty -Path $runKey -Name "TDA Companion Agent" -ErrorAction Stop)."TDA Companion Agent"
    if ($rolledBackStartup -notlike "*$previousVersion*TDACompanion.exe*--agent*--startup*") {
        throw "ROLLBACK_STARTUP_NOT_RESTORED"
    }
    if (-not (Test-Path $shortcut)) { throw "ROLLBACK_SHORTCUT_NOT_RESTORED" }

    # Real successful WiX MajorUpgrade after rollback proof.
    Invoke-Msi @("/i", "`"$msi`"", "/qn") "03-upgrade-to-$CurrentVersion.log"
    $currentMarker = Join-Path $tdaRoot "Companion\current-version.txt"
    Assert-FileValue $currentMarker $CurrentVersion "CURRENT_VERSION_MARKER"
    if (-not (Test-Path $candidateExe)) {
        throw "CURRENT_EXECUTABLE_MISSING_AFTER_UPGRADE"
    }
    Assert-PersistentRoots "keep-across-upgrade"
    Assert-FileValue $oldToken $tokenBefore "PAIRING_TOKEN_UPGRADE"
    if (Test-Path $previousExe) {
        throw "PREVIOUS_EXECUTABLE_LEFT_AFTER_MAJOR_UPGRADE"
    }

    # Normal uninstall must remove application integration and preserve all user roots.
    Invoke-Msi @("/x", "`"$msi`"", "/qn") "04-uninstall-preserve.log"
    if (Test-Path $currentMarker) { throw "VERSION_MARKER_LEFT_AFTER_PRESERVE_UNINSTALL" }
    Assert-PersistentRoots "keep-across-upgrade"
    Assert-FileValue $oldToken $tokenBefore "PAIRING_TOKEN_PRESERVE_UNINSTALL"

    # Reinstall and prove the product-owned maintenance executable can purge everything.
    Invoke-Msi @("/i", "`"$msi`"", "/qn") "05-reinstall-for-purge.log"
    Seed-PersistentRoots "remove-on-purge"
    $maintenance = Current-MaintenanceExe
    if (-not (Test-Path $maintenance)) { throw "MAINTENANCE_EXECUTABLE_MISSING" }
    $purge = Start-Process -FilePath $maintenance -ArgumentList @("--uninstall", "--purge", "--root", "`"$tdaRoot`"") -Wait -PassThru
    if ($purge.ExitCode -ne 0) { throw "PURGE_EXIT_CODE:$($purge.ExitCode)" }
    if (Test-Path $tdaRoot) {
        Get-ChildItem -Force -Recurse $tdaRoot -ErrorAction SilentlyContinue | Select-Object -First 80 | Format-Table | Out-String | Write-Host
        throw "PURGE_ROOT_LEFT_BEHIND"
    }

    Write-Host "TDA Companion lifecycle smoke: PASS ($previousVersion -> forced rollback -> $CurrentVersion -> preserve uninstall -> purge)"
}
finally {
    Remove-Item $previousMsi -Force -ErrorAction SilentlyContinue
    # Best-effort cleanup only if the test failed before purge.
    if (Test-Path $tdaRoot) {
        $maintenance = Current-MaintenanceExe
        if (Test-Path $maintenance) {
            try { Start-Process -FilePath $maintenance -ArgumentList @("--uninstall", "--purge", "--root", "`"$tdaRoot`"") -Wait | Out-Null } catch { }
        } elseif (Test-Path $productKey) {
            try {
                $productCode = [string](Get-ItemProperty -Path $productKey).ProductCode
                if ($productCode) {
                    Start-Process -FilePath "msiexec.exe" -ArgumentList @("/x", $productCode, "/qn", "/norestart") -Wait | Out-Null
                }
            } catch { }
        }
    }
}
