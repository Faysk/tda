param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
$msi = (Resolve-Path $MsiPath).Path
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "INVALID_VERSION" }
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$installLog = Join-Path $env:TEMP "tda-companion-msi-install.log"
$uninstallLog = Join-Path $env:TEMP "tda-companion-msi-uninstall.log"
$tdaRoot = Join-Path $env:LOCALAPPDATA "TDA"
$installedDir = Join-Path $tdaRoot "Companion\versions\$Version"
$installedExe = Join-Path $installedDir "TDACompanion.exe"
$maintenanceExe = Join-Path $installedDir "TDACompanionMaintenance.exe"
$currentVersion = Join-Path $tdaRoot "Companion\current-version.txt"
$dataRoot = Join-Path $tdaRoot "Data"
$keepMarker = Join-Path $dataRoot "msi-preserve-marker.txt"
$diagnostic = Join-Path $env:TEMP "tda-companion-msi-diagnostic.txt"
$startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\TDA\TDA Companion.lnk"
$productKey = "HKCU:\Software\Faysk\TDA Companion"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$port = 8765
$process = $null
$installed = $false
$uninstalled = $false

Remove-Item $diagnostic -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
Set-Content -Path $keepMarker -Value "preserve-me" -Encoding ascii -NoNewline

function Invoke-Msi([string[]]$Arguments, [string]$ExpectedLog) {
    $result = Start-Process -FilePath "msiexec.exe" -ArgumentList $Arguments -Wait -PassThru
    if ($result.ExitCode -notin @(0, 3010)) {
        if (Test-Path $ExpectedLog) { Get-Content $ExpectedLog -Tail 120 | Write-Host }
        throw "MSI_EXIT_CODE:$($result.ExitCode)"
    }
}

function Test-HealthDown {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -Method Get -TimeoutSec 1 | Out-Null
        return $false
    } catch {
        return $true
    }
}

try {
    Invoke-Msi @("/i", "`"$msi`"", "/qn", "/norestart", "/L*v", "`"$installLog`"") $installLog
    $installed = $true

    if (-not (Test-Path $installedExe)) { throw "MSI_EXECUTABLE_NOT_INSTALLED" }
    if (-not (Test-Path $maintenanceExe)) { throw "MSI_MAINTENANCE_NOT_INSTALLED" }
    if (-not (Test-Path $currentVersion)) { throw "MSI_VERSION_MARKER_NOT_INSTALLED" }
    if ((Get-Content $currentVersion -Raw).Trim() -ne $Version) { throw "MSI_VERSION_MARKER_MISMATCH" }
    if (-not (Test-Path $startMenuShortcut)) { throw "MSI_START_MENU_SHORTCUT_NOT_INSTALLED" }
    if (-not (Test-Path $productKey)) { throw "MSI_PRODUCT_REGISTRY_NOT_INSTALLED" }
    $metadata = Get-ItemProperty -Path $productKey
    if ($metadata.Version -ne $Version) { throw "MSI_REGISTRY_VERSION_MISMATCH" }
    if (-not $metadata.ProductCode) { throw "MSI_PRODUCT_CODE_NOT_REGISTERED" }
    $startup = (Get-ItemProperty -Path $runKey -Name "TDA Companion Agent" -ErrorAction Stop)."TDA Companion Agent"
    if ($startup -notlike "*$Version*TDACompanion.exe*--agent*--startup*") { throw "MSI_STARTUP_REGISTRATION_INVALID" }

    $process = Start-Process -FilePath $installedExe -ArgumentList @(
        "--agent",
        "--diagnostic-file", $diagnostic
    ) -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) { throw "MSI_INSTALLED_COMPANION_EXITED_EARLY:$($process.ExitCode)" }
        if (Test-Path $diagnostic) {
            $status = (Get-Content $diagnostic -Raw).Trim()
            if ($status -eq "READY") {
                $ready = $true
                break
            }
            if ($status.StartsWith("FAILED")) { throw "MSI_INSTALLED_COMPANION_$status" }
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw "MSI_INSTALLED_COMPANION_NOT_READY" }

    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -Method Get -TimeoutSec 3
    if ($health.api_version -ne "1" -or $health.service_version -ne $Version) {
        throw "MSI_INSTALLED_HEALTH_MISMATCH"
    }

    # Uninstall while the Agent is still running. The MSI maintenance action must
    # stop the installed runtime itself before RemoveFiles.
    Invoke-Msi @("/x", "`"$msi`"", "/qn", "/norestart", "/L*v", "`"$uninstallLog`"") $uninstallLog
    $uninstalled = $true

    $process.Refresh()
    $exitDeadline = [DateTime]::UtcNow.AddSeconds(8)
    while (-not $process.HasExited -and [DateTime]::UtcNow -lt $exitDeadline) {
        Start-Sleep -Milliseconds 200
        $process.Refresh()
    }
    if (-not $process.HasExited) { throw "MSI_AGENT_LEFT_RUNNING_AFTER_UNINSTALL" }
    if (-not (Test-HealthDown)) { throw "MSI_PORT_LEFT_OPEN_AFTER_UNINSTALL" }
    if (Test-Path $installedExe) { throw "MSI_EXECUTABLE_LEFT_AFTER_UNINSTALL" }
    if (Test-Path $maintenanceExe) { throw "MSI_MAINTENANCE_LEFT_AFTER_UNINSTALL" }
    if (Test-Path $currentVersion) { throw "MSI_VERSION_MARKER_LEFT_AFTER_UNINSTALL" }
    if (Test-Path $startMenuShortcut) { throw "MSI_SHORTCUT_LEFT_AFTER_UNINSTALL" }
    if (Test-Path $productKey) { throw "MSI_PRODUCT_REGISTRY_LEFT_AFTER_UNINSTALL" }
    try {
        Get-ItemProperty -Path $runKey -Name "TDA Companion Agent" -ErrorAction Stop | Out-Null
        throw "MSI_STARTUP_LEFT_AFTER_UNINSTALL"
    } catch [System.Management.Automation.PSArgumentException] {
        # Expected: exact value no longer exists.
    }
    if (-not (Test-Path $keepMarker)) { throw "MSI_UNINSTALL_REMOVED_USER_DATA" }
    if ((Get-Content $keepMarker -Raw).Trim() -ne "preserve-me") { throw "MSI_USER_DATA_CHANGED" }

    Write-Host "Installed TDA Companion MSI + active-Agent uninstall smoke: PASS ($Version)"
}
finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(5000) | Out-Null
    }
    if ($installed -and -not $uninstalled -and (Test-Path $installedExe)) {
        try { Invoke-Msi @("/x", "`"$msi`"", "/qn", "/norestart", "/L*v", "`"$uninstallLog`"") $uninstallLog } catch { }
    }
    Remove-Item $keepMarker -Force -ErrorAction SilentlyContinue
    Remove-Item $diagnostic -Force -ErrorAction SilentlyContinue
}

Write-Host "TDA Companion MSI uninstall smoke: PASS"
