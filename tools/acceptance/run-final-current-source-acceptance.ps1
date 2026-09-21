param(
  [Parameter(Mandatory=$true)][string]$CompanionRcTag,
  [Parameter(Mandatory=$true)][string]$WhisperRuntimeRcTag,
  [Parameter(Mandatory=$true)][string]$QwenRuntimeRcTag,
  [string]$ResultsRoot = "",
  [string]$RequireGpuName = "RTX 4070",
  [ValidateRange(1024,65535)][int]$Port = 8765,
  [switch]$RequireAuthenticode,
  [string]$ExpectedSignerThumbprint = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$Origin = "https://dnd.faysk.dev"
$RequiredProfiles = @("whisper-turbo","whisper-detailed","qwen-fast","qwen-quality")

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-Json([string]$Path,[string]$Code) {
  try { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64 -ErrorAction Stop }
  catch { throw $Code }
}

function Write-Json([string]$Path,[object]$Value) {
  $Value | ConvertTo-Json -Depth 64 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-PowerShell7 {
  if ($PSVersionTable.PSVersion.Major -lt 7) { throw "POWERSHELL_7_REQUIRED" }
  $cmd = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { $cmd = Get-Command pwsh -ErrorAction SilentlyContinue }
  if ($null -eq $cmd) { throw "POWERSHELL_7_REQUIRED" }
  [string]$cmd.Source
}

function Get-Release([string]$Tag,[string]$Family) {
  if ($Tag -notmatch '^[A-Za-z0-9._-]{1,160}$') { throw "RELEASE_TAG_INVALID" }
  try {
    $value = Invoke-RestMethod -UseBasicParsing -Headers @{
      Accept = "application/vnd.github+json"
      "X-GitHub-Api-Version" = "2022-11-28"
    } -Uri ("https://api.github.com/repos/Faysk/tda/releases/tags/" + [Uri]::EscapeDataString($Tag)) -TimeoutSec 30
  } catch { throw ("RELEASE_LOOKUP_FAILED:" + $Family) }
  if (
    [string]$value.tag_name -ne $Tag -or
    $value.draft -ne $false -or
    $value.prerelease -ne $true -or
    [string]$value.target_commitish -notmatch '^[a-f0-9]{40}$'
  ) { throw ("RELEASE_IDENTITY_INVALID:" + $Family) }
  $value
}

function Get-ReleaseAsset([object]$Release,[string]$Name,[string]$Family) {
  $rows = @($Release.assets | Where-Object { [string]$_.name -eq $Name })
  if ($rows.Count -ne 1) { throw ("RELEASE_ASSET_COUNT_INVALID:" + $Family + ":" + $Name) }
  $asset = $rows[0]
  if ([string]$asset.digest -notmatch '^sha256:[a-f0-9]{64}$') { throw ("RELEASE_ASSET_DIGEST_INVALID:" + $Family) }
  if ([int64]$asset.size -le 0) { throw ("RELEASE_ASSET_SIZE_INVALID:" + $Family) }
  if ([string]$asset.browser_download_url -notmatch '^https://github\.com/Faysk/tda/releases/download/') {
    throw ("RELEASE_ASSET_URL_INVALID:" + $Family)
  }
  $asset
}

function Download-Asset([object]$Release,[string]$Name,[string]$Destination,[string]$Family,[string]$Expected="") {
  $asset = Get-ReleaseAsset $Release $Name $Family
  $sha = ([string]$asset.digest).Substring(7)
  if ($Expected -and $sha -ne $Expected) { throw ("RELEASE_ASSET_EXPECTED_DIGEST_MISMATCH:" + $Family) }
  if (Test-Path -LiteralPath $Destination -PathType Leaf) {
    if ((Get-Sha256 $Destination) -eq $sha -and (Get-Item -LiteralPath $Destination).Length -eq [int64]$asset.size) { return $sha }
    Remove-Item -LiteralPath $Destination -Force
  }
  Invoke-WebRequest -UseBasicParsing -Uri ([string]$asset.browser_download_url) -OutFile $Destination
  if ((Get-Item -LiteralPath $Destination).Length -ne [int64]$asset.size) { throw ("RELEASE_ASSET_SIZE_MISMATCH:" + $Family) }
  if ((Get-Sha256 $Destination) -ne $sha) { throw ("RELEASE_ASSET_HASH_MISMATCH:" + $Family) }
  $sha
}

function Assert-CompanionCandidate([object]$Candidate,[object]$Release,[string]$Tag) {
  if (
    [string]$Candidate.schema -ne "tda_companion_candidate_v2" -or
    [string]$Candidate.channel -ne "rc" -or
    [string]$Candidate.tag -ne $Tag -or
    [string]$Candidate.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
    [string]$Candidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$Candidate.source_tree_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$Release.target_commitish -ne [string]$Candidate.source_sha
  ) { throw "COMPANION_CANDIDATE_IDENTITY_INVALID" }
  if (-not $Tag.EndsWith(([string]$Candidate.source_sha).Substring(0,12))) { throw "COMPANION_CANDIDATE_TAG_INVALID" }
  if (
    [string]$Candidate.assets.msi.name -ne "TDACompanion-x64.msi" -or
    [string]$Candidate.assets.msi.sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$Candidate.assets.payload_manifest.name -ne "TDACompanion-payload-manifest.json" -or
    [string]$Candidate.assets.payload_manifest.sha256 -notmatch '^[a-f0-9]{64}$'
  ) { throw "COMPANION_CANDIDATE_ASSETS_INVALID" }
}

function Assert-RuntimeCandidate([object]$Candidate,[object]$Release,[string]$Tag,[string]$Family) {
  $runtimeId = if ($Family -eq "whisper") { "whisper-ctranslate2" } else { "qwen3-transformers" }
  if (
    [string]$Candidate.schema -ne "tda_runtime_candidate_v1" -or
    [string]$Candidate.family -ne $Family -or
    [string]$Candidate.runtime_id -ne $runtimeId -or
    [string]$Candidate.platform -ne "windows-x64" -or
    [string]$Candidate.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
    [string]$Candidate.source_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$Candidate.source_tree_sha -notmatch '^[a-f0-9]{40}$' -or
    [string]$Candidate.candidate_tag -ne $Tag -or
    [string]$Candidate.runtime_archive_sha256 -notmatch '^[a-f0-9]{64}$' -or
    [string]$Release.target_commitish -ne [string]$Candidate.source_sha
  ) { throw ("RUNTIME_CANDIDATE_IDENTITY_INVALID:" + $Family) }

  $assets = @($Candidate.assets)
  if ($assets.Count -lt 2 -or $assets.Count -gt 4) { throw ("RUNTIME_CANDIDATE_ASSET_COUNT_INVALID:" + $Family) }
  $seen = @{}
  foreach ($row in $assets) {
    $name = [string]$row.name
    $sha = [string]$row.sha256
    if (-not $name -or [IO.Path]::GetFileName($name) -ne $name -or $sha -notmatch '^[a-f0-9]{64}$' -or $seen.ContainsKey($name)) {
      throw ("RUNTIME_CANDIDATE_ASSET_INVALID:" + $Family)
    }
    $seen[$name] = $true
    $releaseAsset = Get-ReleaseAsset $Release $name $Family
    if (([string]$releaseAsset.digest).Substring(7) -ne $sha) { throw ("RUNTIME_CANDIDATE_RELEASE_DIGEST_MISMATCH:" + $Family) }
  }
  if ($Family -eq "whisper") {
    if (@($assets | Where-Object { [string]$_.name -match '\.zip$' }).Count -ne 1 -or
        @($assets | Where-Object { [string]$_.name -match '\.zip\.sha256$' }).Count -ne 1) {
      throw "RUNTIME_CANDIDATE_WHISPER_SHAPE_INVALID"
    }
  } else {
    if (@($assets | Where-Object { [string]$_.name -match '^TDAQwenRuntimeBundle-.*\.json$' }).Count -ne 1 -or
        @($assets | Where-Object { [string]$_.name -match '\.zip\.part[0-9]{3}$' }).Count -lt 2) {
      throw "RUNTIME_CANDIDATE_QWEN_SHAPE_INVALID"
    }
  }
}

function Get-AgentHealth {
  try {
    $h = Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
    if ([string]$h.product_id -ne "tda-companion" -or [string]$h.api_version -ne "1" -or [int]$h.port -ne $Port -or [int]$h.pid -le 0) { return $null }
    $h
  } catch { $null }
}

function Invoke-CurrentAgentJson([string]$Path) {
  $session = Invoke-RestMethod -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/session" -Headers @{
    Origin=$Origin; Accept="application/json"
  } -ContentType "application/json" -Body "{}" -TimeoutSec 10
  if (-not [string]$session.token) { throw "ACTIVE_WORK_PREFLIGHT_SESSION_INVALID" }
  Invoke-RestMethod -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1$Path" -Headers @{
    Origin=$Origin; Authorization=("Bearer " + [string]$session.token); Accept="application/json"
  } -TimeoutSec 10
}

function Assert-NoActiveUserWork {
  $db = Join-Path $env:LOCALAPPDATA "TDA\Data\jobs.sqlite3"
  if ($null -eq (Get-AgentHealth)) {
    if (Test-Path -LiteralPath $db -PathType Leaf) { throw "ACTIVE_WORK_PREFLIGHT_UNAVAILABLE" }
    return
  }
  try {
    $jobs = Invoke-CurrentAgentJson "/jobs"
    if (@($jobs.jobs | Where-Object { [string]$_.status -in @("queued","running") }).Count -gt 0) { throw "ACTIVE_USER_JOB_PRESENT_BEFORE_MUTATION" }
    $prep = Invoke-CurrentAgentJson "/preparation"
    if ($prep.active -eq $true) { throw "ACTIVE_USER_PREPARATION_PRESENT_BEFORE_MUTATION" }
  } catch {
    if ([string]$_.Exception.Message -like "ACTIVE_USER_*") { throw }
    throw "ACTIVE_WORK_PREFLIGHT_UNAVAILABLE"
  }
}

function Wait-ExactAgent([string]$Version,[int]$Seconds=30) {
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
  while([DateTimeOffset]::UtcNow -lt $deadline) {
    $h=Get-AgentHealth
    if ($null -ne $h -and [string]$h.service_version -eq $Version -and [string]$h.lifecycle -eq "ready") { return $h }
    Start-Sleep -Milliseconds 250
  }
  $null
}

function Test-InstalledPayload([object]$Candidate,[string]$PayloadPath) {
  try {
    $payload=Read-Json $PayloadPath "PAYLOAD_INVALID"
    if ([string]$payload.schema -ne "tda_companion_payload_v1" -or
        [string]$payload.version -ne [string]$Candidate.version -or
        [string]$payload.source_sha -ne [string]$Candidate.source_sha -or
        [string]$payload.source_tree_sha -ne [string]$Candidate.source_tree_sha) { return $false }
    $root=Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$([string]$Candidate.version)"
    foreach($p in $payload.files.PSObject.Properties) {
      $name=[string]$p.Name
      if([IO.Path]::GetFileName($name) -ne $name) { return $false }
      $file=Join-Path $root $name
      if(-not(Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
      if((Get-Item $file).Length -ne [int64]$p.Value.size) { return $false }
      if((Get-Sha256 $file) -ne [string]$p.Value.sha256) { return $false }
    }
    $true
  } catch { $false }
}

function Test-MsiProductCode([string]$Value) {
  $g=[Guid]::Empty
  [Guid]::TryParseExact($Value,"B",[ref]$g)
}

function Assert-Authenticode([string]$Path) {
  if(-not $RequireAuthenticode) { return }
  $expected=($ExpectedSignerThumbprint -replace '\s','').ToUpperInvariant()
  if($expected -notmatch '^[A-F0-9]{40}$') { throw "AUTHENTICODE_EXPECTED_THUMBPRINT_REQUIRED" }
  $sig=Get-AuthenticodeSignature -LiteralPath $Path
  if([string]$sig.Status -ne "Valid" -or $null -eq $sig.SignerCertificate) { throw "AUTHENTICODE_SIGNATURE_INVALID" }
  $actual=([string]$sig.SignerCertificate.Thumbprint -replace '\s','').ToUpperInvariant()
  if($actual -ne $expected) { throw "AUTHENTICODE_SIGNER_MISMATCH" }
}

function Ensure-Companion([object]$Candidate,[string]$Msi,[string]$Payload) {
  Assert-Authenticode $Msi
  $version=[string]$Candidate.version
  $marker=Join-Path $env:LOCALAPPDATA "TDA\Companion\current-version.txt"
  $current=""
  if(Test-Path -LiteralPath $marker -PathType Leaf) { try{$current=(Get-Content $marker -Raw -Encoding UTF8).Trim()}catch{} }
  $exact=($current -eq $version -and (Test-InstalledPayload $Candidate $Payload))
  if($current -eq $version -and -not $exact) {
    $key="HKCU:\Software\Faysk\TDA Companion"
    if(-not(Test-Path $key)) { throw "SUPERSEDED_PRODUCT_REGISTRY_MISSING" }
    $meta=Get-ItemProperty $key
    $product=[string]$meta.ProductCode
    if(-not(Test-MsiProductCode $product)) { throw "SUPERSEDED_PRODUCT_CODE_INVALID" }
    $uninstall=Start-Process msiexec.exe -ArgumentList @("/x",$product,"/qn","/norestart") -Wait -PassThru
    if([int]$uninstall.ExitCode -notin @(0,3010)) { throw "SUPERSEDED_UNINSTALL_FAILED" }
    $exact=$false
  }
  if(-not $exact) {
    $install=Start-Process msiexec.exe -ArgumentList @("/i",('"{0}"' -f $Msi),"/qn","/norestart") -Wait -PassThru
    if([int]$install.ExitCode -notin @(0,3010)) { throw "CANDIDATE_MSI_INSTALL_FAILED" }
  }
  if(-not(Test-InstalledPayload $Candidate $Payload)) { throw "CANDIDATE_INSTALLED_PAYLOAD_MISMATCH" }
  $exe=Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$version\TDACompanion.exe"
  Assert-Authenticode $exe
  $health=Wait-ExactAgent $version 20
  if($null -eq $health) {
    Start-Process $exe -ArgumentList @("--agent","--startup","--port",[string]$Port) | Out-Null
    $health=Wait-ExactAgent $version 30
  }
  if($null -eq $health) { throw "CANDIDATE_AGENT_NOT_READY" }
  $exe
}

function Test-Runtime([object]$Candidate) {
  $family=[string]$Candidate.family
  $worker=if($family -eq "whisper"){"TDAWhisperWorker.exe"}else{"TDAQwenWorker.exe"}
  try {
    $root=Join-Path $env:LOCALAPPDATA "TDA\Runtime\$family"
    $current=Read-Json (Join-Path $root "current.json") "RUNTIME_CURRENT_INVALID"
    if([string]$current.runtime_id -ne [string]$Candidate.runtime_id -or [string]$current.version -ne [string]$Candidate.version){return $false}
    $versionRoot=Join-Path $root ([string]$Candidate.version)
    $marker=Read-Json (Join-Path $versionRoot ".tda-runtime.json") "RUNTIME_MARKER_INVALID"
    $workerPath=Join-Path $versionRoot $worker
    if([string]$marker.runtime_id -ne [string]$Candidate.runtime_id -or
       [string]$marker.version -ne [string]$Candidate.version -or
       [string]$marker.worker -ne $worker -or
       [string]$marker.archive_sha256 -ne [string]$Candidate.runtime_archive_sha256 -or
       [string]$marker.worker_sha256 -notmatch '^[a-f0-9]{64}$' -or
       -not(Test-Path $workerPath)){return $false}
    (Get-Sha256 $workerPath) -eq [string]$marker.worker_sha256
  } catch { $false }
}

function New-OuterZip([string]$Root,[string]$Destination,[string[]]$Names) {
  Add-Type -AssemblyName System.IO.Compression
  if(Test-Path $Destination){Remove-Item $Destination -Force}
  $stream=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try {
    $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
    try {
      foreach($name in $Names){
        $file=Join-Path $Root $name
        if(-not(Test-Path $file)){throw "RUNTIME_OUTER_MEMBER_MISSING"}
        $entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::NoCompression)
        $output=$entry.Open()
        try{$input=[IO.File]::OpenRead($file);try{$input.CopyTo($output)}finally{$input.Dispose()}}finally{$output.Dispose()}
      }
    } finally {$zip.Dispose()}
  } finally {$stream.Dispose()}
}

function Install-Runtime([string]$Exe,[object]$Candidate,[object]$Release,[string]$Root) {
  $family=[string]$Candidate.family
  if(Test-Runtime $Candidate){Write-Host "$family exact runtime already ready." -ForegroundColor Green;return}
  $assetsRoot=Join-Path $Root $family
  New-Item -ItemType Directory -Force -Path $assetsRoot | Out-Null
  $names=New-Object System.Collections.Generic.List[string]
  foreach($row in @($Candidate.assets)){
    $name=[string]$row.name
    [void]$names.Add($name)
    [void](Download-Asset $Release $name (Join-Path $assetsRoot $name) $family ([string]$row.sha256))
  }
  $outer=Join-Path $Root "$family-actions-artifact.zip"
  New-OuterZip $assetsRoot $outer $names.ToArray()

  $runtimeRoot=Join-Path $env:LOCALAPPDATA "TDA\Runtime\$family"
  $target=Join-Path $runtimeRoot ([string]$Candidate.version)
  $current=Join-Path $runtimeRoot "current.json"
  $backupTarget="";$backupCurrent=""
  try {
    if(Test-Path $target){
      $suffix=[Guid]::NewGuid().ToString("N")
      $backupTarget=Join-Path $runtimeRoot (".$([string]$Candidate.version)-acceptance-$suffix.backup")
      Move-Item $target $backupTarget
      if(Test-Path $current){$backupCurrent=Join-Path $runtimeRoot (".current-$suffix.backup.json");Move-Item $current $backupCurrent}
    }
    $result=Join-Path $Root "$family-install.json"
    $proc=Start-Process $Exe -ArgumentList @("--install-rc-runtime",$family,"--rc-artifact",('"{0}"' -f $outer),"--rc-artifact-sha256",(Get-Sha256 $outer),"--rc-result-file",('"{0}"' -f $result)) -Wait -PassThru
    if([int]$proc.ExitCode -ne 0 -or -not(Test-Path $result)){throw ("RUNTIME_INSTALL_FAILED:"+$family)}
    $value=Read-Json $result "RUNTIME_INSTALL_RESULT_INVALID"
    if($value.ok -ne $true -or [string]$value.runtime -ne $family -or [string]$value.status -ne "ready" -or -not(Test-Runtime $Candidate)){throw ("RUNTIME_EXACT_IDENTITY_NOT_READY:"+$family)}
    if($backupTarget -and (Test-Path $backupTarget)){Remove-Item $backupTarget -Recurse -Force}
    if($backupCurrent -and (Test-Path $backupCurrent)){Remove-Item $backupCurrent -Force}
  } catch {
    if($backupTarget){
      try{
        if(Test-Path $target){Remove-Item $target -Recurse -Force}
        if(Test-Path $current){Remove-Item $current -Force}
        if(Test-Path $backupTarget){Move-Item $backupTarget $target}
        if($backupCurrent -and (Test-Path $backupCurrent)){Move-Item $backupCurrent $current}
      }catch{throw ("RUNTIME_ROLLBACK_FAILED:"+$family)}
    }
    throw
  }
}

function Copy-Safe([string]$Source,[string]$Destination) {
  $v=Read-Json $Source "RECEIPT_INVALID"
  foreach($field in @("contains_token","contains_paths","contains_transcript","contains_audio","contains_local_paths")){
    $p=$v.PSObject.Properties[$field]
    if($null -ne $p -and $p.Value -ne $false){throw "RECEIPT_PRIVACY_INVALID"}
  }
  Copy-Item $Source $Destination -Force
}

function Failure-Code([object]$Record) {
  $v=[string]$Record.Exception.Message
  if($v -match '^[A-Z0-9_.:-]{1,180}$'){return $v}
  "AUTO_ACCEPTANCE_FAILED"
}

if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw "WINDOWS_REQUIRED"}
if(-not $env:LOCALAPPDATA){throw "LOCALAPPDATA_NOT_FOUND"}
$pwsh=Get-PowerShell7
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$generator=Join-Path $PSScriptRoot "generate-physical-acceptance-fixture.ps1"
if(-not(Test-Path $generator)){throw "FIXTURE_GENERATOR_MISSING"}
if(-not $ResultsRoot){$ResultsRoot=Join-Path $repo "TDA-TEST-RESULTS"}

$stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$results=[IO.Path]::GetFullPath($ResultsRoot)
$runRoot=Join-Path $results "FINAL-$stamp"
$private=Join-Path $runRoot "_private"
$downloads=Join-Path $private "downloads"
$fixtures=Join-Path $private "fixture"
$runtime=Join-Path $private "runtime"
$physical=Join-Path $private "physical"
$runtimeReceipts=Join-Path $physical "runtime-acceptance"
$share=Join-Path $runRoot "SEND-THIS"
$shareReceipts=Join-Path $share "receipts"
$zip=Join-Path $results "TDA-FINAL-ACCEPTANCE-RESULTS-$stamp.zip"
New-Item -ItemType Directory -Force -Path $results,$runRoot,$private,$downloads,$fixtures,$runtime,$physical,$runtimeReceipts,$share,$shareReceipts | Out-Null

$phase="bootstrap";$failure=$null;$passed=$false;$summary=[ordered]@{}
try{
  Write-Host "TDA FINAL CURRENT-SOURCE ACCEPTANCE - ZERO PROMPTS" -ForegroundColor Cyan
  $phase="release_identity"
  $cr=Get-Release $CompanionRcTag "companion";$wr=Get-Release $WhisperRuntimeRcTag "whisper";$qr=Get-Release $QwenRuntimeRcTag "qwen"

  $cmPath=Join-Path $downloads "TDACompanion-candidate.json";[void](Download-Asset $cr "TDACompanion-candidate.json" $cmPath "companion")
  $cm=Read-Json $cmPath "COMPANION_CANDIDATE_INVALID";Assert-CompanionCandidate $cm $cr $CompanionRcTag
  $msi=Join-Path $downloads "TDACompanion-x64.msi";$payload=Join-Path $downloads "TDACompanion-payload-manifest.json"
  [void](Download-Asset $cr "TDACompanion-x64.msi" $msi "companion" ([string]$cm.assets.msi.sha256))
  [void](Download-Asset $cr "TDACompanion-payload-manifest.json" $payload "companion" ([string]$cm.assets.payload_manifest.sha256))

  $wmPath=Join-Path $downloads "whisper-runtime-candidate.json";$qmPath=Join-Path $downloads "qwen-runtime-candidate.json"
  [void](Download-Asset $wr "TDARuntime-candidate.json" $wmPath "whisper");[void](Download-Asset $qr "TDARuntime-candidate.json" $qmPath "qwen")
  $wm=Read-Json $wmPath "RUNTIME_CANDIDATE_INVALID";$qm=Read-Json $qmPath "RUNTIME_CANDIDATE_INVALID"
  Assert-RuntimeCandidate $wm $wr $WhisperRuntimeRcTag "whisper";Assert-RuntimeCandidate $qm $qr $QwenRuntimeRcTag "qwen"

  $phase="active_work_preflight";Assert-NoActiveUserWork
  $phase="companion_install";$exe=Ensure-Companion $cm $msi $payload
  $phase="runtime_install";Install-Runtime $exe $wm $wr $runtime;Install-Runtime $exe $qm $qr $runtime

  $phase="fixtures";& $pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File $generator -OutputRoot $fixtures -TargetSeconds 80
  if($LASTEXITCODE -ne 0){throw "FIXTURE_GENERATION_FAILED"}
  $audio=Join-Path $fixtures "tda-physical-acceptance-synthetic.wav";$craig=Join-Path $fixtures "tda-installed-acceptance-craig.zip"
  if(-not(Test-Path $audio)-or -not(Test-Path $craig)){throw "FIXTURE_OUTPUT_MISSING"}

  $app=Join-Path $env:LOCALAPPDATA "TDA\Companion\versions\$([string]$cm.version)"
  $installedScript=Join-Path $app "run-installed-acceptance.ps1";$physicalScript=Join-Path $app "run-physical-acceptance.ps1"
  if(-not(Test-Path $installedScript)-or -not(Test-Path $physicalScript)){throw "CANDIDATE_ACCEPTANCE_SCRIPT_MISSING"}

  $phase="installed_acceptance";$installedReceipt=Join-Path $private "$CompanionRcTag.json"
  $installedArgs=@("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-File",$installedScript,"-CandidateMsi",$msi,"-PayloadManifest",$payload,"-SourceSha",[string]$cm.source_sha,"-CraigZip",$craig,"-ReceiptPath",$installedReceipt,"-Port",[string]$Port,"-Automated")
  & $pwsh @installedArgs
  if($LASTEXITCODE -ne 0 -or -not(Test-Path $installedReceipt)){throw "INSTALLED_ACCEPTANCE_FAILED"}
  $ir=Read-Json $installedReceipt "INSTALLED_RECEIPT_INVALID"
  if([string]$ir.schema -ne "tda_installed_acceptance_v3" -or $ir.pass -ne $true -or [string]$ir.artifact.source_sha -ne [string]$cm.source_sha){throw "INSTALLED_RECEIPT_IDENTITY_INVALID"}

  $phase="physical_acceptance"
  $physicalArgs=@("-NoLogo","-NoProfile","-ExecutionPolicy","Bypass","-File",$physicalScript,"-Audio",$audio,"-CandidateManifest",$cmPath,"-CandidateMsi",$msi,"-PayloadManifest",$payload,"-OutputRoot",$physical,"-RequireGpuName",$RequireGpuName,"-WhisperRuntimeCandidateManifest",$wmPath,"-QwenRuntimeCandidateManifest",$qmPath,"-RuntimeAcceptanceOutputRoot",$runtimeReceipts)
  & $pwsh @physicalArgs
  if($LASTEXITCODE -ne 0){throw "PHYSICAL_ACCEPTANCE_FAILED"}
  $prPath=Join-Path $physical "physical-acceptance-suite.json"
  $pr=Read-Json $prPath "PHYSICAL_RECEIPT_INVALID"
  if([string]$pr.schema -ne "tda_physical_acceptance_suite_v2" -or $pr.pass -ne $true -or [string]$pr.candidate.rc_tag -ne $CompanionRcTag){throw "PHYSICAL_RECEIPT_IDENTITY_INVALID"}
  foreach($p in $RequiredProfiles){if($p -notin @($pr.profiles)){throw ("PHYSICAL_PROFILE_MISSING:"+$p)}}

  $rr=@(Get-ChildItem $runtimeReceipts -File -Filter "*.json")
  if($rr.Count -ne 2){throw "RUNTIME_RECEIPTS_INCOMPLETE"}
  $byFamily=@{}
  foreach($file in $rr){
    $v=Read-Json $file.FullName "RUNTIME_RECEIPT_INVALID"
    if([string]$v.schema -ne "tda_runtime_physical_acceptance_v1" -or $v.pass -ne $true -or [string]$v.family -notin @("whisper","qwen") -or $v.contains_audio -ne $false -or $v.contains_transcript -ne $false -or $v.contains_local_paths -ne $false){throw "RUNTIME_RECEIPT_INVALID"}
    $family=[string]$v.family;$expected=if($family -eq "whisper"){$WhisperRuntimeRcTag}else{$QwenRuntimeRcTag}
    if([string]$v.candidate_tag -ne $expected){throw ("RUNTIME_RECEIPT_TAG_INVALID:"+$family)}
    $byFamily[$family]=$file.FullName
  }
  if(-not $byFamily.whisper -or -not $byFamily.qwen){throw "RUNTIME_RECEIPTS_INCOMPLETE"}

  $phase="share_bundle"
  Copy-Safe $installedReceipt (Join-Path $shareReceipts "$CompanionRcTag.json")
  Copy-Safe $prPath (Join-Path $shareReceipts "$CompanionRcTag.physical.json")
  Copy-Safe $byFamily.whisper (Join-Path $shareReceipts "$WhisperRuntimeRcTag.json")
  Copy-Safe $byFamily.qwen (Join-Path $shareReceipts "$QwenRuntimeRcTag.json")

  $summary=[ordered]@{
    schema="tda_final_current_source_acceptance_v1";pass=$true;accepted_at=[DateTimeOffset]::UtcNow.ToString("o")
    companion=[ordered]@{tag=$CompanionRcTag;source_sha=[string]$cm.source_sha;source_tree_sha=[string]$cm.source_tree_sha;msi_sha256=[string]$cm.assets.msi.sha256;payload_manifest_sha256=[string]$cm.assets.payload_manifest.sha256}
    runtimes=[ordered]@{
      whisper=[ordered]@{tag=$WhisperRuntimeRcTag;source_sha=[string]$wm.source_sha;runtime_archive_sha256=[string]$wm.runtime_archive_sha256}
      qwen=[ordered]@{tag=$QwenRuntimeRcTag;source_sha=[string]$qm.source_sha;runtime_archive_sha256=[string]$qm.runtime_archive_sha256}
    }
    gpu_requirement=$RequireGpuName;authenticode_required=[bool]$RequireAuthenticode
    contains_token=$false;contains_env=$false;contains_audio=$false;contains_transcript=$false;contains_paths=$false
    failure_phase=$null;failure_code=$null
  }
  $passed=$true
}catch{
  $failure=Failure-Code $_
  $summary=[ordered]@{
    schema="tda_final_current_source_acceptance_v1";pass=$false;accepted_at=[DateTimeOffset]::UtcNow.ToString("o")
    companion_tag=$CompanionRcTag;whisper_runtime_tag=$WhisperRuntimeRcTag;qwen_runtime_tag=$QwenRuntimeRcTag
    gpu_requirement=$RequireGpuName;authenticode_required=[bool]$RequireAuthenticode
    contains_token=$false;contains_env=$false;contains_audio=$false;contains_transcript=$false;contains_paths=$false
    failure_phase=$phase;failure_code=$failure
  }
  Write-Host "FINAL ACCEPTANCE FAILED phase=$phase code=$failure" -ForegroundColor Red
}finally{
  Write-Json (Join-Path $share "AUTO-RESULT.json") $summary
  $readme=@(
    "TDA FINAL CURRENT-SOURCE ACCEPTANCE",
    "===================================",
    ("Status: "+$(if($passed){"PASS"}else{"FAILED"})),
    ("Companion RC: "+$CompanionRcTag),
    ("Whisper runtime RC: "+$WhisperRuntimeRcTag),
    ("Qwen runtime RC: "+$QwenRuntimeRcTag),
    "",
    "The share bundle contains only sanitized receipts and identity/status metadata.",
    "Synthetic fixtures, release assets, tokens, caches, paths and transcripts remain private.",
    ("Failure phase: "+$(if($failure){$phase}else{""})),
    ("Failure code: "+$(if($failure){$failure}else{""}))
  )
  $readme | Set-Content -LiteralPath (Join-Path $share "READ-ME-FIRST.txt") -Encoding UTF8
  $manifestPath=Join-Path $share "EVIDENCE-MANIFEST.json"
  Remove-Item $manifestPath -Force -ErrorAction SilentlyContinue
  $manifest=@(Get-ChildItem $share -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{path=$_.FullName.Substring($share.Length+1);bytes=[int64]$_.Length;sha256=Get-Sha256 $_.FullName}
  })
  Write-Json $manifestPath $manifest
  try{
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path (Join-Path $share "*") -DestinationPath $zip -CompressionLevel Optimal
    Write-Host "Evidence bundle: $zip" -ForegroundColor Cyan
  }catch{$passed=$false;Write-Warning "EVIDENCE_ZIP_FAILED"}
}
if($passed){exit 0}
exit 1
