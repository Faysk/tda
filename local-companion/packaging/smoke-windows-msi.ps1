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
$installedExe = Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$Version\TDACompanion.exe"
$currentVersion = Join-Path $env:LOCALAPPDATA "TDA\Companion\current-version.txt"
$smokeRoot = Join-Path $env:TEMP "tda-companion-msi-smoke"
$stateRoot = Join-Path $smokeRoot "state"
$dataRoot = Join-Path $smokeRoot "data"
$diagnostic = Join-Path $smokeRoot "diagnostic.txt"
$port = 18768
$process = $null

Remove-Item $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null

function Invoke-Msi([string[]]$Arguments, [string]$ExpectedLog) {
    $result = Start-Process -FilePath "msiexec.exe" -ArgumentList $Arguments -Wait -PassThru
    if ($result.ExitCode -notin @(0, 3010)) {
        if (Test-Path $ExpectedLog) { Get-Content $ExpectedLog -Tail 80 | Write-Host }
        throw "MSI_EXIT_CODE:$($result.ExitCode)"
    }
}

try {
    Invoke-Msi @("/i", "`"$msi`"", "/qn", "/norestart", "/L*v", "`"$installLog`"") $installLog

    if (-not (Test-Path $installedExe)) { throw "MSI_EXECUTABLE_NOT_INSTALLED" }
    if (-not (Test-Path $currentVersion)) { throw "MSI_VERSION_MARKER_NOT_INSTALLED" }
    if ((Get-Content $currentVersion -Raw).Trim() -ne $Version) { throw "MSI_VERSION_MARKER_MISMATCH" }

    $process = Start-Process -FilePath $installedExe -ArgumentList @(
        "--headless",
        "--state-root", $stateRoot,
        "--data-root", $dataRoot,
        "--origin", "http://127.0.0.1:3000",
        "--port", "$port",
        "--diagnostic-file", $diagnostic
    ) -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(12)
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

    Write-Host "Installed TDA Companion MSI smoke: PASS ($Version)"
}
finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(5000) | Out-Null
    }
    Invoke-Msi @("/x", "`"$msi`"", "/qn", "/norestart", "/L*v", "`"$uninstallLog`"") $uninstallLog
}

if (Test-Path $installedExe) { throw "MSI_EXECUTABLE_LEFT_AFTER_UNINSTALL" }
Write-Host "TDA Companion MSI uninstall smoke: PASS"
