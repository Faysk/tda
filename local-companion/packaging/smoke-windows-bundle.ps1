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
New-Item -ItemType Directory -Force -Path $state, $data | Out-Null

$process = $null
try {
    $args = @(
        "--headless",
        "--state-root", $state,
        "--data-root", $data,
        "--origin", "https://dnd.faysk.dev",
        "--port", $Port
    )
    $process = Start-Process -FilePath $exe -ArgumentList $args -PassThru -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(15)
    $health = $null
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) { throw "PACKAGED_COMPANION_EXITED_EARLY: $($process.ExitCode)" }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -Method Get -TimeoutSec 1
            if ($health.api_version -eq "1" -and $health.lifecycle -in @("ready", "preparing", "paused")) { break }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $health) { throw "PACKAGED_COMPANION_HEALTH_TIMEOUT" }

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

    Write-Host "Packaged TDACompanion.exe smoke: PASS"
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(5000) | Out-Null
    }
    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
