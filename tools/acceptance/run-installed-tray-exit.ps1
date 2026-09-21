param(
    [string]$ResultPath = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance\tray-exit.json"),
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765,
    [ValidateRange(5, 120)]
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-AgentHealth {
    try {
        $value = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        if (
            [string]$value.product_id -ne "tda-companion" -or
            [string]$value.api_version -ne "1" -or
            [int]$value.port -ne $Port -or
            [int]$value.pid -le 0
        ) {
            return $null
        }
        return $value
    } catch {
        return $null
    }
}

function Write-Receipt([bool]$Passed, [string]$Stage, [hashtable]$Checks, [string]$ErrorCode = "") {
    $value = [ordered]@{
        schema = "tda_tray_exit_acceptance_v1"
        pass = $Passed
        stage = $Stage
        checks = $Checks
        error_code = if ($ErrorCode) { $ErrorCode } else { $null }
        contains_token = $false
        contains_paths = $false
        contains_transcript = $false
    }
    $target = [IO.Path]::GetFullPath($ResultPath)
    $parent = Split-Path -Parent $target
    if (-not $parent) { throw "ACCEPTANCE_TRAY_RESULT_PATH_INVALID" }
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temporary = "$target.partial"
    $value | ConvertTo-Json -Depth 16 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
    Move-Item -LiteralPath $temporary -Destination $target -Force
    return $value
}

$checks = @{}
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "ACCEPTANCE_TRAY_WINDOWS_REQUIRED"
    }
    if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

    $companionRoot = Join-Path $env:LOCALAPPDATA "TDA\Companion"
    $versionMarker = Join-Path $companionRoot "current-version.txt"
    if (-not (Test-Path -LiteralPath $versionMarker -PathType Leaf)) {
        throw "ACCEPTANCE_TRAY_VERSION_MARKER_MISSING"
    }
    $version = (Get-Content -LiteralPath $versionMarker -Raw -Encoding UTF8).Trim()
    if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
        throw "ACCEPTANCE_TRAY_VERSION_INVALID"
    }
    $executable = Join-Path $companionRoot "versions\$version\TDACompanion.exe"
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "ACCEPTANCE_TRAY_EXECUTABLE_MISSING"
    }

    $before = Get-AgentHealth
    if ($null -eq $before -or [string]$before.service_version -ne $version) {
        throw "ACCEPTANCE_TRAY_AGENT_PRECONDITION_FAILED"
    }

    $existingUi = @(Get-CimInstance Win32_Process -Filter "Name='TDACompanion.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            [int]$_.ProcessId -ne [int]$before.pid -and
            [string]$_.CommandLine -match '(?i)(?:^|\s)--ui(?:\s|$)'
        })
    if ($existingUi.Count -gt 0) {
        throw "ACCEPTANCE_TRAY_UI_ALREADY_RUNNING"
    }

    $checks.version = $version
    $checks.agent_pid_before = [int]$before.pid

    $process = Start-Process -FilePath $executable -ArgumentList @("--ui", "--acceptance-tray-exit", "--port", [string]$Port) -PassThru

    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
        throw "ACCEPTANCE_TRAY_EXIT_TIMEOUT"
    }
    if ([int]$process.ExitCode -ne 0) {
        throw "ACCEPTANCE_TRAY_UI_EXIT_FAILED:$($process.ExitCode)"
    }

    $after = Get-AgentHealth
    if ($null -eq $after) {
        throw "ACCEPTANCE_TRAY_AGENT_NOT_READY_AFTER_EXIT"
    }
    if ([int]$after.pid -ne [int]$before.pid) {
        throw "ACCEPTANCE_TRAY_AGENT_IDENTITY_CHANGED"
    }
    if ([string]$after.service_version -ne $version) {
        throw "ACCEPTANCE_TRAY_AGENT_VERSION_CHANGED"
    }

    $checks.ui_exit_code = [int]$process.ExitCode
    $checks.agent_pid_after = [int]$after.pid
    $checks.same_agent = $true
    $checks.lifecycle = [string]$after.lifecycle
    [void](Write-Receipt $true "completed" $checks)
    Write-Host "Exact tray exit acceptance: PASS" -ForegroundColor Green
    exit 0
} catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^[A-Z0-9_.:-]+$') { $code = "ACCEPTANCE_TRAY_EXECUTION_FAILED" }
    [void](Write-Receipt $false "failed" $checks $code)
    Write-Error $code
    exit 1
}
