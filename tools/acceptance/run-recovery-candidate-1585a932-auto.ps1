param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765,
    [string]$ResultsRoot = "",
    [switch]$AllowLegacyTrayEquivalent
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RcTag = "companion-rc-v0.3.14-1585a93235ba"
$SourceSha = "1585a93235ba2fe7c2c093ef1683f0beca5d1605"
$MsiSha256 = "83c267ae14f10fda950413cab74394fc7b875225fa0e13f5123c8901f609f8c3"
$PayloadSha256 = "bc6ac20dbac3e0d9a31ff1cc3ff8a09e8e5b455cb644bcea00fe45f80bd34312"

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-PowerShell7 {
    $command = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
    if ($null -eq $command) { $command = Get-Command "pwsh" -ErrorAction SilentlyContinue }
    if ($null -eq $command) { throw "POWERSHELL_7_REQUIRED" }
    return [string]$command.Source
}

function Copy-SanitizedReceipt([string]$Source, [string]$Destination) {
    try {
        $value = Get-Content -LiteralPath $Source -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64
    } catch {
        return
    }

    foreach ($field in @("contains_token", "contains_paths", "contains_transcript")) {
        $property = $value.PSObject.Properties[$field]
        if ($null -ne $property -and $property.Value -ne $false) { return }
    }
    $audio = $value.PSObject.Properties["contains_audio"]
    if ($null -ne $audio -and $audio.Value -ne $false) { return }

    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "WINDOWS_REQUIRED" }
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$pwsh = Get-PowerShell7
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$launcher = Join-Path $PSScriptRoot "run-recovery-candidate-1585a932.ps1"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "RECOVERY_LAUNCHER_MISSING" }

if (-not $ResultsRoot) { $ResultsRoot = Join-Path $repoRoot "TDA-TEST-RESULTS" }
$results = [IO.Path]::GetFullPath($ResultsRoot)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runRoot = Join-Path $results "AUTO-$timestamp"
$innerRoot = Join-Path $runRoot "_private"
$shareRoot = Join-Path $runRoot "SEND-THIS"
$receiptsOut = Join-Path $shareRoot "receipts"
$rawLog = Join-Path $innerRoot "terminal.raw.txt"
$zipPath = Join-Path $results "TDA-AUTO-ACCEPTANCE-RESULTS-$timestamp.zip"

New-Item -ItemType Directory -Force -Path $results, $runRoot, $innerRoot, $shareRoot, $receiptsOut | Out-Null

$exitCode = 1
$failure = $null
try {
    $arguments = @(
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $launcher,
        "-OutputRoot", $innerRoot,
        "-Port", [string]$Port,
        "-Automated"
    )
    if ($AllowLegacyTrayEquivalent) { $arguments += "-AllowLegacyTrayEquivalent" }

    Write-Host "TDA automated recovery acceptance" -ForegroundColor Cyan
    Write-Host "Candidate: $RcTag"
    Write-Host "Evidence ZIP: $zipPath"
    Write-Host "Zero PASS prompts; zero Task Manager; zero manual port/network steps." -ForegroundColor Green

    & $pwsh @arguments *>&1 | Tee-Object -FilePath $rawLog
    $exitCode = [int]$LASTEXITCODE
    if ($exitCode -ne 0) { $failure = "RECOVERY_ACCEPTANCE_FAILED:$exitCode" }
} catch {
    $failure = "AUTO_ACCEPTANCE_WRAPPER_FAILED:" + $_.Exception.GetType().Name
    $exitCode = 1
} finally {
    $innerReceipts = Join-Path $innerRoot "receipts"
    if (Test-Path -LiteralPath $innerReceipts -PathType Container) {
        foreach ($file in Get-ChildItem -LiteralPath $innerReceipts -File -Filter "*.json" -ErrorAction SilentlyContinue) {
            Copy-SanitizedReceipt $file.FullName (Join-Path $receiptsOut $file.Name)
        }
    }

    if ($exitCode -eq 0) {
        $requiredReceipts = @(
            (Join-Path $receiptsOut "$RcTag.json"),
            (Join-Path $receiptsOut "$RcTag.physical.json")
        )
        $missingReceipts = @($requiredReceipts | Where-Object {
            -not (Test-Path -LiteralPath $_ -PathType Leaf)
        })
        if ($missingReceipts.Count -gt 0) {
            $failure = "AUTO_ACCEPTANCE_REQUIRED_RECEIPTS_MISSING"
            $exitCode = 1
        }
    }

    try {
        if (Test-Path -LiteralPath $rawLog -PathType Leaf) {
            $log = Get-Content -LiteralPath $rawLog -Raw -Encoding UTF8
            foreach ($pair in @(
                @($env:USERPROFILE, "%USERPROFILE%"),
                @($env:LOCALAPPDATA, "%LOCALAPPDATA%"),
                @($repoRoot, "%REPO%"),
                @($runRoot, "%RUN%")
            )) {
                if ($pair[0]) { $log = $log -replace [regex]::Escape([string]$pair[0]), [string]$pair[1] }
            }
            $log | Set-Content -LiteralPath (Join-Path $shareRoot "terminal.txt") -Encoding UTF8
        }
    } catch {}

    $head = ""
    try { $head = ((& git.exe -C $repoRoot rev-parse HEAD 2>$null) -join "").Trim() } catch {}

    function Write-ShareMetadata {
        $summary = [ordered]@{
            schema = "tda_auto_recovery_acceptance_v1"
            pass = ($exitCode -eq 0)
            accepted_at = [DateTimeOffset]::UtcNow.ToString("o")
            candidate = [ordered]@{
                tag = $RcTag
                source_sha = $SourceSha
                msi_sha256 = $MsiSha256
                payload_manifest_sha256 = $PayloadSha256
            }
            harness_source_sha = $head
            exact_tray_required = (-not $AllowLegacyTrayEquivalent)
            legacy_tray_equivalent_allowed = [bool]$AllowLegacyTrayEquivalent
            failure = $failure
            contains_token = $false
            contains_env = $false
            contains_audio = $false
            contains_transcript = $false
            contains_paths = $false
        }
        $summary | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath (Join-Path $shareRoot "AUTO-RESULT.json") -Encoding UTF8

        @"
TDA AUTOMATED RECOVERY ACCEPTANCE
=================================
Status: $(if ($exitCode -eq 0) { "PASS" } else { "FAILED" })
Candidate: $RcTag
Source: $SourceSha

The shareable ZIP contains only the sanitized summary, terminal log and receipts that explicitly prove private fields are absent.
Synthetic audio, Craig fixture, MSI downloads, models, runtime caches, tokens and .env files stay outside SEND-THIS.

Exact tray automation is required by default.
Historical RC 1585a932 predates that hook; use -AllowLegacyTrayEquivalent only when deliberately reproducing its already-recorded physical evidence.

Failure: $failure
"@ | Set-Content -LiteralPath (Join-Path $shareRoot "READ-ME-FIRST.txt") -Encoding UTF8

        Remove-Item -LiteralPath (Join-Path $shareRoot "EVIDENCE-MANIFEST.json") -Force -ErrorAction SilentlyContinue
        $manifest = @(Get-ChildItem -LiteralPath $shareRoot -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName |
            ForEach-Object {
                [ordered]@{
                    path = $_.FullName.Substring($shareRoot.Length + 1)
                    bytes = [int64]$_.Length
                    sha256 = Get-Sha256 $_.FullName
                }
            })
        $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $shareRoot "EVIDENCE-MANIFEST.json") -Encoding UTF8
    }

    Write-ShareMetadata

    $zipCreated = $false
    for ($attempt = 1; $attempt -le 2 -and -not $zipCreated; $attempt++) {
        $temporaryZip = "$zipPath.partial.zip"
        try {
            Remove-Item -LiteralPath $temporaryZip -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
            Compress-Archive -Path (Join-Path $shareRoot "*") -DestinationPath $temporaryZip -CompressionLevel Optimal -ErrorAction Stop
            if (-not (Test-Path -LiteralPath $temporaryZip -PathType Leaf) -or (Get-Item -LiteralPath $temporaryZip).Length -le 0) {
                throw "EVIDENCE_ZIP_EMPTY"
            }
            Move-Item -LiteralPath $temporaryZip -Destination $zipPath -Force
            $zipCreated = $true
        } catch {
            Remove-Item -LiteralPath $temporaryZip -Force -ErrorAction SilentlyContinue
            $failure = "AUTO_ACCEPTANCE_EVIDENCE_ZIP_FAILED"
            $exitCode = 1
            Write-ShareMetadata
            if ($attempt -lt 2) { Start-Sleep -Milliseconds 250 }
        }
    }

    if (-not $zipCreated) {
        Write-Warning "AUTO_ACCEPTANCE_EVIDENCE_ZIP_FAILED"
    } else {
        Write-Host ""
        Write-Host "Evidence bundle: $zipPath" -ForegroundColor Cyan
    }
}

if ($exitCode -eq 0) { exit 0 }
exit 1
