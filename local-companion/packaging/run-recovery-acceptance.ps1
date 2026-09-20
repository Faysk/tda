param(
    [Parameter(Mandatory = $true)]
    [string]$CandidateManifest,
    [Parameter(Mandatory = $true)]
    [string]$CandidateMsi,
    [Parameter(Mandatory = $true)]
    [string]$PayloadManifest,
    [Parameter(Mandatory = $true)]
    [string]$CraigZip,
    [Parameter(Mandatory = $true)]
    [string]$Audio,
    [string]$OutputRoot = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance\recovery"),
    [string]$RequireGpuName = "RTX 4070",
    [string]$ContextFile,
    [string]$GlossaryFile,
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RequiredFile([string]$Value, [string]$Code) {
    try { return (Resolve-Path -LiteralPath $Value -ErrorAction Stop).Path }
    catch { throw $Code }
}

function Read-JsonObject([string]$Path, [string]$Code) {
    try {
        $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 32 -ErrorAction Stop
    } catch {
        throw $Code
    }
    if ($null -eq $value) { throw $Code }
    return $value
}

function Require-FalsePrivacyProofs([object]$Receipt, [string]$Prefix) {
    foreach ($name in @("contains_token", "contains_paths", "contains_transcript")) {
        $property = $Receipt.PSObject.Properties[$name]
        if ($null -eq $property -or $property.Value -ne $false) {
            throw "${Prefix}_PRIVACY_INVALID"
        }
    }
}

function Write-AtomicCopy([string]$Source, [string]$Destination) {
    $temporary = "$Destination.partial"
    Copy-Item -LiteralPath $Source -Destination $temporary -Force
    Move-Item -LiteralPath $temporary -Destination $Destination -Force
}

if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$candidateManifestPath = Resolve-RequiredFile $CandidateManifest "RECOVERY_CANDIDATE_MANIFEST_NOT_FOUND"
$candidateMsiPath = Resolve-RequiredFile $CandidateMsi "RECOVERY_CANDIDATE_MSI_NOT_FOUND"
$payloadManifestPath = Resolve-RequiredFile $PayloadManifest "RECOVERY_PAYLOAD_MANIFEST_NOT_FOUND"
$craigZipPath = Resolve-RequiredFile $CraigZip "RECOVERY_CRAIG_ZIP_NOT_FOUND"
$audioPath = Resolve-RequiredFile $Audio "RECOVERY_AUDIO_NOT_FOUND"

$candidate = Read-JsonObject $candidateManifestPath "RECOVERY_CANDIDATE_INVALID"
if (
    [string]$candidate.schema -ne "tda_companion_candidate_v2" -or
    [string]$candidate.channel -ne "rc" -or
    [string]$candidate.tag -notmatch '^companion-rc-v[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$' -or
    [string]$candidate.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
    [string]$candidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$candidate.source_tree_sha -notmatch '^[a-f0-9]{40}$'
) {
    throw "RECOVERY_CANDIDATE_INVALID"
}
if (-not ([string]$candidate.tag).EndsWith(([string]$candidate.source_sha).Substring(0, 12))) {
    throw "RECOVERY_CANDIDATE_INVALID"
}

$msiAsset = $candidate.assets.msi
$payloadAsset = $candidate.assets.payload_manifest
if (
    $null -eq $msiAsset -or
    $null -eq $payloadAsset -or
    [string]$msiAsset.name -ne "TDACompanion-x64.msi" -or
    [string]$payloadAsset.name -ne "TDACompanion-payload-manifest.json" -or
    [string]$msiAsset.sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$payloadAsset.sha256 -notmatch '^[a-f0-9]{64}$'
) {
    throw "RECOVERY_CANDIDATE_ASSETS_INVALID"
}

$actualMsiSha = (Get-FileHash -LiteralPath $candidateMsiPath -Algorithm SHA256).Hash.ToLowerInvariant()
$actualPayloadSha = (Get-FileHash -LiteralPath $payloadManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualMsiSha -ne [string]$msiAsset.sha256) { throw "RECOVERY_CANDIDATE_MSI_MISMATCH" }
if ($actualPayloadSha -ne [string]$payloadAsset.sha256) { throw "RECOVERY_PAYLOAD_MANIFEST_MISMATCH" }

$payload = Read-JsonObject $payloadManifestPath "RECOVERY_PAYLOAD_MANIFEST_INVALID"
if (
    [string]$payload.version -ne [string]$candidate.version -or
    [string]$payload.source_sha -ne [string]$candidate.source_sha -or
    [string]$payload.source_tree_sha -ne [string]$candidate.source_tree_sha
) {
    throw "RECOVERY_PAYLOAD_IDENTITY_MISMATCH"
}

$output = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$stage = Join-Path $output (".staging-" + [Guid]::NewGuid().ToString("N"))
$physicalStage = Join-Path $stage "physical"
New-Item -ItemType Directory -Force -Path $physicalStage | Out-Null

$installedStage = Join-Path $stage "installed.json"
$physicalStageReceipt = Join-Path $physicalStage "physical-acceptance-suite.json"
$tag = [string]$candidate.tag
$installedFinal = Join-Path $output "$tag.json"
$physicalFinal = Join-Path $output "$tag.physical.json"

$installedScript = Join-Path $PSScriptRoot "run-installed-acceptance.ps1"
$physicalScript = Join-Path $PSScriptRoot "run-physical-acceptance.ps1"
if (-not (Test-Path -LiteralPath $installedScript -PathType Leaf)) { throw "RECOVERY_INSTALLED_SCRIPT_MISSING" }
if (-not (Test-Path -LiteralPath $physicalScript -PathType Leaf)) { throw "RECOVERY_PHYSICAL_SCRIPT_MISSING" }

try {
    Write-Host "TDA Companion recovery acceptance" -ForegroundColor Yellow
    Write-Host "Candidate: $tag"
    Write-Host "Version: $([string]$candidate.version)"
    Write-Host "Source SHA: $([string]$candidate.source_sha)"
    Write-Host "MSI SHA-256: $actualMsiSha"
    Write-Host "Payload SHA-256: $actualPayloadSha"
    Write-Host ""
    Write-Host "Phase 1/2: installed journey" -ForegroundColor Cyan

    & $installedScript `
        -CandidateMsi $candidateMsiPath `
        -PayloadManifest $payloadManifestPath `
        -SourceSha ([string]$candidate.source_sha) `
        -CraigZip $craigZipPath `
        -ReceiptPath $installedStage `
        -Port $Port
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $installedStage -PathType Leaf)) {
        throw "RECOVERY_INSTALLED_ACCEPTANCE_FAILED"
    }

    $installed = Read-JsonObject $installedStage "RECOVERY_INSTALLED_RECEIPT_INVALID"
    if (
        [string]$installed.schema -ne "tda_installed_acceptance_v3" -or
        $installed.pass -ne $true -or
        [string]$installed.version -ne [string]$candidate.version -or
        [string]$installed.artifact.source_sha -ne [string]$candidate.source_sha -or
        [string]$installed.artifact.source_tree_sha -ne [string]$candidate.source_tree_sha -or
        [string]$installed.artifact.msi_sha256 -ne $actualMsiSha -or
        [string]$installed.artifact.payload_manifest_sha256 -ne $actualPayloadSha
    ) {
        throw "RECOVERY_INSTALLED_RECEIPT_MISMATCH"
    }
    Require-FalsePrivacyProofs $installed "RECOVERY_INSTALLED_RECEIPT"

    Write-Host ""
    Write-Host "Phase 2/2: ASR/GPU physical suite" -ForegroundColor Cyan
    $physicalArgs = @{
        Audio = $audioPath
        CandidateManifest = $candidateManifestPath
        CandidateMsi = $candidateMsiPath
        PayloadManifest = $payloadManifestPath
        OutputRoot = $physicalStage
        RequireGpuName = $RequireGpuName
    }
    if ($ContextFile) { $physicalArgs.ContextFile = $ContextFile }
    if ($GlossaryFile) { $physicalArgs.GlossaryFile = $GlossaryFile }

    & $physicalScript @physicalArgs
    if (-not (Test-Path -LiteralPath $physicalStageReceipt -PathType Leaf)) {
        throw "RECOVERY_PHYSICAL_ACCEPTANCE_FAILED"
    }

    $physical = Read-JsonObject $physicalStageReceipt "RECOVERY_PHYSICAL_RECEIPT_INVALID"
    if (
        [string]$physical.schema -ne "tda_physical_acceptance_suite_v2" -or
        $physical.pass -ne $true -or
        [string]$physical.candidate.rc_tag -ne $tag -or
        [string]$physical.candidate.version -ne [string]$candidate.version -or
        [string]$physical.candidate.source_sha -ne [string]$candidate.source_sha -or
        [string]$physical.candidate.source_tree_sha -ne [string]$candidate.source_tree_sha -or
        [string]$physical.candidate.msi_sha256 -ne $actualMsiSha -or
        [string]$physical.candidate.payload_manifest_sha256 -ne $actualPayloadSha
    ) {
        throw "RECOVERY_PHYSICAL_RECEIPT_MISMATCH"
    }
    Require-FalsePrivacyProofs $physical "RECOVERY_PHYSICAL_RECEIPT"
    $containsAudio = $physical.PSObject.Properties["contains_audio"]
    if ($null -eq $containsAudio -or $containsAudio.Value -ne $false) {
        throw "RECOVERY_PHYSICAL_RECEIPT_PRIVACY_INVALID"
    }
    if ($physical.transcripts_written -ne $false) {
        throw "RECOVERY_PHYSICAL_RECEIPT_TRANSCRIPT_INVALID"
    }

    Write-AtomicCopy $installedStage $installedFinal
    Write-AtomicCopy $physicalStageReceipt $physicalFinal

    Write-Host ""
    Write-Host "RECOVERY ACCEPTANCE: PASS" -ForegroundColor Green
    Write-Host "Installed receipt: $installedFinal"
    Write-Host "Physical receipt:  $physicalFinal"
    Write-Host "Commit only these sanitized receipts to docs/companion/acceptance before Stable promotion."
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
