param(
  [Parameter(Mandatory=$true)][string]$HarnessRef,
  [string]$OutputDirectory = (Join-Path (Get-Location) "TDA-final-acceptance-handoff")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RequiredFiles = @(
  "tools/acceptance/run-processing-final-acceptance.ps1",
  "tools/acceptance/run-final-current-source-acceptance.ps1",
  "tools/acceptance/run-qwen-recovery-physical-gate.ps1",
  "tools/acceptance/generate-physical-acceptance-fixture.ps1",
  "tools/acceptance/RUN-processing-final-acceptance.cmd",
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
  $blob = Invoke-Git @("-C", $repoRoot, "rev-parse", "$resolvedRef`:$relative") "HANDOFF_SOURCE_FILE_MISSING"
  if ($blob -notmatch '^[a-f0-9]{40}$') { throw "HANDOFF_SOURCE_BLOB_INVALID" }
  $expected[$relative] = $blob
}

$parent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputDirectory))
if (-not $parent) { $parent = [IO.Path]::GetTempPath() }

if (Test-Path -LiteralPath $OutputDirectory) {
  throw "HANDOFF_OUTPUT_ALREADY_EXISTS"
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

try {
  foreach ($relative in $RequiredFiles) {
    $materialized = Join-Path $OutputDirectory ($relative -replace '/', [IO.Path]::DirectorySeparatorChar)
    $materializedParent = Split-Path -Parent $materialized
    New-Item -ItemType Directory -Force -Path $materializedParent | Out-Null

    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = "git"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    [void]$psi.ArgumentList.Add("-C")
    [void]$psi.ArgumentList.Add($repoRoot)
    [void]$psi.ArgumentList.Add("cat-file")
    [void]$psi.ArgumentList.Add("blob")
    [void]$psi.ArgumentList.Add([string]$expected[$relative])

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $psi
    try {
      if (-not $process.Start()) { throw "HANDOFF_CAT_FILE_START_FAILED:$relative" }
      $stream = [IO.File]::Open($materialized, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $process.StandardOutput.BaseStream.CopyTo($stream)
      } finally {
        $stream.Dispose()
      }
      $stderr = $process.StandardError.ReadToEnd()
      $process.WaitForExit()
      if ($process.ExitCode -ne 0) {
        if ($stderr) { Write-Verbose $stderr }
        throw "HANDOFF_CAT_FILE_FAILED:$relative"
      }
    } finally {
      $process.Dispose()
    }

    $actual = Invoke-Git @("-C", $repoRoot, "hash-object", "--no-filters", $materialized) "HANDOFF_HASH_OBJECT_FAILED"
    if ($actual -ne $expected[$relative]) {
      throw "HANDOFF_BLOB_MISMATCH:$relative expected=$($expected[$relative]) actual=$actual"
    }
  }

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
} catch {
  if (Test-Path -LiteralPath $OutputDirectory) {
    Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  throw
}
