param(
    [Parameter(Mandatory = $true)]
    [string]$WhisperArtifact,
    [Parameter(Mandatory = $true)]
    [string]$WhisperArtifactSha256,
    [Parameter(Mandatory = $true)]
    [string]$QwenArtifact,
    [Parameter(Mandatory = $true)]
    [string]$QwenArtifactSha256
)

$ErrorActionPreference = "Stop"
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$tdaRoot = Join-Path $env:LOCALAPPDATA "TDA"
$currentVersionFile = Join-Path $tdaRoot "Companion\current-version.txt"
if (-not (Test-Path $currentVersionFile)) { throw "TDA_COMPANION_NOT_INSTALLED" }
$version = (Get-Content $currentVersionFile -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "TDA_COMPANION_VERSION_INVALID" }
$appRoot = Join-Path $tdaRoot "Companion\versions\$version"
$companion = Join-Path $appRoot "TDACompanion.exe"
if (-not (Test-Path $companion)) { throw "TDA_COMPANION_EXECUTABLE_NOT_FOUND" }

$receiptRoot = Join-Path $tdaRoot "Cache\physical-setup\receipts"
New-Item -ItemType Directory -Force -Path $receiptRoot | Out-Null

function Install-RcRuntime(
    [string]$Family,
    [string]$Artifact,
    [string]$ExpectedSha256,
    [string]$ResultName
) {
    $artifactPath = (Resolve-Path $Artifact -ErrorAction Stop).Path
    $expected = $ExpectedSha256.Trim().ToLowerInvariant()
    if ($expected -notmatch '^[a-f0-9]{64}$') { throw "RC_RUNTIME_ARTIFACT_HASH_INVALID:${Family}" }
    $actual = (Get-FileHash -Algorithm SHA256 $artifactPath).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "RC_RUNTIME_ARTIFACT_HASH_MISMATCH:${Family}" }

    $resultPath = Join-Path $receiptRoot $ResultName
    Remove-Item $resultPath -Force -ErrorAction SilentlyContinue
    Remove-Item "$resultPath.partial" -Force -ErrorAction SilentlyContinue

    $arguments = "--install-rc-runtime $Family --rc-artifact `"$artifactPath`" --rc-artifact-sha256 $expected --rc-result-file `"$resultPath`""
    $process = Start-Process -FilePath $companion -ArgumentList $arguments -Wait -PassThru
    if (-not (Test-Path $resultPath)) {
        throw "RC_RUNTIME_RESULT_MISSING:${Family}:$($process.ExitCode)"
    }
    try {
        $result = Get-Content $resultPath -Raw | ConvertFrom-Json
    } catch {
        throw "RC_RUNTIME_RESULT_INVALID:${Family}"
    }
    if ($result.schema -ne "tda_rc_runtime_install_v1") {
        throw "RC_RUNTIME_RESULT_SCHEMA_INVALID:${Family}"
    }
    if ($process.ExitCode -ne 0 -or $result.ok -ne $true) {
        $code = if ($result.error) { [string]$result.error } else { "RC_RUNTIME_INSTALL_FAILED" }
        throw "${code}:${Family}"
    }
    if ($result.runtime -ne $Family -or $result.status -ne "ready") {
        throw "RC_RUNTIME_NOT_READY:${Family}"
    }
    Write-Host "$Family runtime ready: version=$($result.version) reused=$($result.reused)"
    return $result
}

$whisper = Install-RcRuntime "whisper" $WhisperArtifact $WhisperArtifactSha256 "rc-whisper-runtime.json"
$qwen = Install-RcRuntime "qwen" $QwenArtifact $QwenArtifactSha256 "rc-qwen-runtime.json"

$acceptance = Join-Path $appRoot "run-physical-acceptance.ps1"
if (-not (Test-Path $acceptance)) { throw "PHYSICAL_ACCEPTANCE_HARNESS_NOT_FOUND" }

Write-Host "RC runtimes preparados e verificados."
Write-Host "Whisper: $($whisper.version)"
Write-Host "Qwen: $($qwen.version)"
Write-Host "Gate físico (executar somente quando for testar):"
Write-Host "  & `"$acceptance`" -Audio `"C:\caminho\amostra.flac`""
