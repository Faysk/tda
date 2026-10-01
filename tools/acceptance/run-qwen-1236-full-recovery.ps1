[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CraigZip,
    [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repository = "Faysk/tda"
$CompanionSourceSha = "d3db290b66beb16c5b01637fddb4f9a3ed9de4a7"
$QwenSourceSha = "d3db290b66beb16c5b01637fddb4f9a3ed9de4a7"
$CompanionVersion = "0.3.18"
$CompanionTag = "companion-rc-v0.3.18-d3db290b66be"
$CompanionPayloadSha256 = "513339dc0c7328e007ee1f3257e118f6ed862b2277489ea1c7bd102175386516"
$QwenRuntimeVersion = "1.0.14"
$QwenTag = "companion-qwen-runtime-rc-v1.0.14-d3db290b66be"
$QwenCandidateManifestSha256 = "9c29b165fddfa212e61cf0c8679444e9cdad1220963ce1fa01bbdb9e61d2deb8"
$CraigSha256 = "b2ac78347d88b2761e51be38a60aa266933e3b00f30e72c50626fbe599849b1e"

function Fail-Blocked([string]$Code) {
    throw [InvalidOperationException]::new("BLOCKED:$Code")
}

function Fail-Harness([string]$Code) {
    throw [InvalidOperationException]::new("HARNESS_FAILED:$Code")
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-Json([string]$Path, [string]$Code) {
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64 }
    catch { Fail-Harness $Code }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { Fail-Blocked "WINDOWS_REQUIRED" }
if (-not $env:LOCALAPPDATA) { Fail-Blocked "LOCALAPPDATA_NOT_FOUND" }
if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) { Fail-Blocked "GH_CLI_REQUIRED" }
if ($null -eq (Get-Command uv -ErrorAction SilentlyContinue)) { Fail-Blocked "UV_REQUIRED" }

& gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { Fail-Blocked "GH_AUTH_REQUIRED" }

try {
    $CraigResolved = (Resolve-Path -LiteralPath $CraigZip -ErrorAction Stop).Path
} catch {
    Fail-Blocked "CRAIG_ZIP_NOT_FOUND"
}
if ([IO.Path]::GetExtension($CraigResolved).ToLowerInvariant() -ne ".zip") { Fail-Blocked "CRAIG_ZIP_REQUIRED" }
if ((Get-Sha256 $CraigResolved) -ne $CraigSha256) { Fail-Blocked "CRAIG_SHA256_MISMATCH" }

$CompanionExe = Join-Path $env:LOCALAPPDATA ("TDA\Companion\versions\{0}\TDACompanion.exe" -f $CompanionVersion)
$QwenRuntimeRoot = Join-Path $env:LOCALAPPDATA ("TDA\Runtime\qwen\{0}" -f $QwenRuntimeVersion)
if (-not (Test-Path -LiteralPath $CompanionExe -PathType Leaf)) {
    Fail-Blocked "QWEN_1236_COMPANION_0_3_18_NOT_INSTALLED"
}
if (-not (Test-Path -LiteralPath $QwenRuntimeRoot -PathType Container)) {
    Fail-Blocked "QWEN_1236_RUNTIME_1_0_14_NOT_INSTALLED"
}

$GateScript = Join-Path $PSScriptRoot "run-qwen-recovery-physical-gate.ps1"
if (-not (Test-Path -LiteralPath $GateScript -PathType Leaf)) { Fail-Harness "QWEN_RECOVERY_GATE_MISSING" }

$Scratch = Join-Path $env:TEMP ("TDA-QWEN-1236-MANIFESTS-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
try {
    $CompanionManifest = Join-Path $Scratch "TDACompanion-payload-manifest.json"
    $QwenCandidateManifest = Join-Path $Scratch "TDARuntime-candidate.json"

    & gh release download $CompanionTag --repo $Repository --pattern "TDACompanion-payload-manifest.json" --dir $Scratch
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $CompanionManifest -PathType Leaf)) {
        Fail-Blocked "QWEN_1236_COMPANION_MANIFEST_DOWNLOAD_FAILED"
    }
    if ((Get-Sha256 $CompanionManifest) -ne $CompanionPayloadSha256) {
        Fail-Harness "QWEN_1236_COMPANION_MANIFEST_HASH_MISMATCH"
    }

    $QwenScratch = Join-Path $Scratch "qwen"
    New-Item -ItemType Directory -Force -Path $QwenScratch | Out-Null
    & gh release download $QwenTag --repo $Repository --pattern "TDARuntime-candidate.json" --dir $QwenScratch
    $QwenCandidateDownloaded = Join-Path $QwenScratch "TDARuntime-candidate.json"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $QwenCandidateDownloaded -PathType Leaf)) {
        Fail-Blocked "QWEN_1236_QWEN_MANIFEST_DOWNLOAD_FAILED"
    }
    if ((Get-Sha256 $QwenCandidateDownloaded) -ne $QwenCandidateManifestSha256) {
        Fail-Harness "QWEN_1236_QWEN_MANIFEST_HASH_MISMATCH"
    }
    Copy-Item -LiteralPath $QwenCandidateDownloaded -Destination $QwenCandidateManifest -Force

    $payload = Read-Json $CompanionManifest "QWEN_1236_COMPANION_MANIFEST_INVALID"
    if (
        [string]$payload.schema -ne "tda_companion_payload_v1" -or
        [string]$payload.version -ne $CompanionVersion -or
        [string]$payload.source_sha -ne $CompanionSourceSha -or
        [string]$payload.source_tree_sha -notmatch '^[a-f0-9]{40}$'
    ) {
        Fail-Harness "QWEN_1236_COMPANION_IDENTITY_MISMATCH"
    }

    $candidate = Read-Json $QwenCandidateManifest "QWEN_1236_QWEN_MANIFEST_INVALID"
    if (
        [string]$candidate.schema -ne "tda_runtime_candidate_v1" -or
        [string]$candidate.family -ne "qwen" -or
        [string]$candidate.runtime_id -ne "qwen3-transformers" -or
        [string]$candidate.version -ne $QwenRuntimeVersion -or
        [string]$candidate.source_sha -ne $QwenSourceSha -or
        [string]$candidate.candidate_tag -ne $QwenTag
    ) {
        Fail-Harness "QWEN_1236_QWEN_IDENTITY_MISMATCH"
    }

    $gateArgs = @{
        CraigZip = $CraigResolved
        CompanionExePath = $CompanionExe
        CompanionPayloadManifest = $CompanionManifest
        QwenRuntimeCandidateManifest = $QwenCandidateManifest
        QwenInstalledRuntimeRoot = $QwenRuntimeRoot
        RequiredCompanionVersion = $CompanionVersion
        RequiredQwenRuntimeVersion = $QwenRuntimeVersion
        ExpectedCraigSha256 = $CraigSha256
        RequireGpuName = "RTX 4070"
    }
    if ($OutputRoot) { $gateArgs.OutputRoot = $OutputRoot }

    Write-Host "TDA #1236 FULL RECOVERY ACCEPTANCE" -ForegroundColor Cyan
    Write-Host "Candidate: Companion $CompanionVersion @ $($CompanionSourceSha.Substring(0,12)) + Qwen $QwenRuntimeVersion @ $($QwenSourceSha.Substring(0,12))" -ForegroundColor DarkCyan
    Write-Host "Input stays local; evidence is sanitized." -ForegroundColor DarkCyan

    & $GateScript @gateArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "QWEN #1236 FULL RECOVERY ACCEPTANCE: PASS" -ForegroundColor Green
    exit 0
} finally {
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}
