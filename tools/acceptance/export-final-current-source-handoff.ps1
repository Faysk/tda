param(
  [Parameter(Mandatory=$true)][string]$HarnessRef,
  [string]$OutputDirectory = (Join-Path (Get-Location) "TDA-final-acceptance-handoff")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RequiredFiles = @(
  "tools/acceptance/run-final-current-source-acceptance.ps1",
  "tools/acceptance/generate-physical-acceptance-fixture.ps1",
  "tools/acceptance/RUN-final-current-source-acceptance.cmd"
)

function Invoke-Git([string[]]$Arguments, [string]$Code) {
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "git"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($argument in $Arguments) {
    [void]$psi.ArgumentList.Add($argument)
  }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  try {
    if (-not $process.Start()) { throw $Code }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      if ($stderr) { Write-Verbose $stderr }
      throw $Code
    }
    $stdout.Trim()
  } finally {
    $process.Dispose()
  }
}

$repoRoot = Invoke-Git @("rev-parse", "--show-toplevel") "HANDOFF_REPOSITORY_NOT_FOUND"
if (-not $repoRoot) { throw "HANDOFF_REPOSITORY_NOT_FOUND" }

$resolvedRef = Invoke-Git @("-C", $repoRoot, "rev-parse", "--verify", "$HarnessRef^{commit}") "HANDOFF_REF_INVALID"
if ($resolvedRef -notmatch '^[a-f0-9]{40}$') { throw "HANDOFF_REF_INVALID" }

$expected = @{}
foreach ($relative in $RequiredFiles) {
  $blob = Invoke-Git @("-C", $repoRoot, "rev-parse", "$resolvedRef\`:$relative") "HANDOFF_SOURCE_FILE_MISSING"
  if ($blob -notmatch '^[a-f0-9]{40}$') { throw "HANDOFF_SOURCE_BLOB_INVALID" }
  $expected[$relative] = $blob
}

$parent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputDirectory))
if (-not $parent) { $parent = [IO.Path]::GetTempPath() }
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$tempRoot = Join-Path $parent (".tda-handoff-" + [Guid]::NewGuid().ToString("N"))
$archive = Join-Path $tempRoot "handoff.zip"
$staging = Join-Path $tempRoot "expanded"

try {
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

  $archiveArgs = @("-C", $repoRoot, "archive", "--format=zip", "--output=$archive", $resolvedRef, "--")
  $archiveArgs += $RequiredFiles
  [void](Invoke-Git $archiveArgs "HANDOFF_GIT_ARCHIVE_FAILED")

  Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force

  foreach ($relative in $RequiredFiles) {
    $materialized = Join-Path $staging ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $materialized -PathType Leaf)) {
      throw "HANDOFF_EXTRACTED_FILE_MISSING:$relative"
    }
    $actual = Invoke-Git @("-C", $repoRoot, "hash-object", "--no-filters", $materialized) "HANDOFF_HASH_OBJECT_FAILED"
    if ($actual -ne $expected[$relative]) {
      throw "HANDOFF_BLOB_MISMATCH:$relative"
    }
  }

  if (Test-Path -LiteralPath $OutputDirectory) {
    throw "HANDOFF_OUTPUT_ALREADY_EXISTS"
  }

  Move-Item -LiteralPath $staging -Destination $OutputDirectory

  $manifest = [ordered]@{
    schema = "tda_acceptance_handoff_v1"
    source_ref = $HarnessRef
    source_sha = $resolvedRef
    exported_at = [DateTimeOffset]::UtcNow.ToString("o")
    files = @(
      foreach ($relative in $RequiredFiles) {
        [ordered]@{
          path = $relative
          git_blob_sha1 = $expected[$relative]
        }
      }
    )
  }
  $manifestPath = Join-Path $OutputDirectory "HANDOFF-MANIFEST.json"
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

  Write-Host "Exact acceptance handoff exported."
  Write-Host "Source: $resolvedRef"
  Write-Host "Output: $OutputDirectory"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
