param(
    [Parameter(Mandatory=$true)][string]$PackageRoot,
    [int]$Port = 18765
)

$ErrorActionPreference = "Stop"
$package = (Resolve-Path $PackageRoot).Path
$exe = Join-Path $package "app\TDACompanion.exe"
if (-not (Test-Path $exe)) { throw "PACKAGE_EXECUTABLE_NOT_FOUND" }

$root = Join-Path $env:RUNNER_TEMP ("tda-companion-smoke-" + [Guid]::NewGuid().ToString("N"))
$state = Join-Path $root "state"
$data = Join-Path $root "data"
$diagnostic = Join-Path $root "startup-status.txt"
New-Item -ItemType Directory -Force -Path $state, $data | Out-Null

$process = $null
try {
    $args = @(
        "--headless",
        "--state-root", $state,
        "--data-root", $data,
        "--origin", "https://dnd.faysk.dev",
        "--port", $Port,
        "--diagnostic-file", $diagnostic
    )
    $process = Start-Process -FilePath $exe -ArgumentList $args -PassThru -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(15)
    $health = $null
    $lastHttp = $null
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) {
            $stateText = if (Test-Path $diagnostic) { (Get-Content $diagnostic -Raw).Trim() } else { "NO_DIAGNOSTIC" }
            throw "PACKAGED_COMPANION_EXITED_EARLY:$($process.ExitCode):${stateText}"
        }
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/health" -Method Get -TimeoutSec 1 -SkipHttpErrorCheck
            $lastHttp = $response.StatusCode
            if ($response.StatusCode -eq 200) {
                $health = $response.Content | ConvertFrom-Json
                if ($health.api_version -eq "1" -and $health.lifecycle -in @("ready", "preparing", "paused")) { break }
            }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $health) {
        $stateText = if (Test-Path $diagnostic) { (Get-Content $diagnostic -Raw).Trim() } else { "NO_DIAGNOSTIC" }
        $httpText = if ($null -eq $lastHttp) { "NO_HTTP" } else { "HTTP_$lastHttp" }
        throw "PACKAGED_COMPANION_HEALTH_TIMEOUT:${stateText}:${httpText}"
    }

    $tokenFile = Join-Path $state "pairing-token.txt"
    if (-not (Test-Path $tokenFile)) { throw "PAIRING_TOKEN_NOT_CREATED" }
    $token = (Get-Content $tokenFile -Raw).Trim()
    if ($token -notmatch '^[A-Za-z0-9_-]{43,256}$') { throw "INVALID_PAIRING_TOKEN" }

    $headers = @{ Authorization = "Bearer $token" }
    $capabilities = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/capabilities" -Headers $headers -Method Get -TimeoutSec 3
    if ($capabilities.capabilities -notcontains "system.telemetry") { throw "TELEMETRY_CAPABILITY_MISSING" }
    if ($capabilities.capabilities -notcontains "job.events") { throw "EVENTS_CAPABILITY_MISSING" }

    $system = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/system" -Headers $headers -Method Get -TimeoutSec 3
    if (-not $system.sampled_at) { throw "SYSTEM_TELEMETRY_MISSING" }

    $stateText = if (Test-Path $diagnostic) { (Get-Content $diagnostic -Raw).Trim() } else { "NO_DIAGNOSTIC" }
    Write-Host "Packaged TDACompanion.exe smoke: PASS ($stateText)"
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(5000) | Out-Null
    }
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
