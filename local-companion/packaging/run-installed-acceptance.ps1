param(
    [Parameter(Mandatory = $true)]
    [string]$CandidateMsi,
    [Parameter(Mandatory = $true)]
    [string]$PayloadManifest,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{40}$')]
    [string]$SourceSha,
    [Parameter(Mandatory = $true)]
    [string]$CraigZip,
    [string]$ReceiptPath = (Join-Path $env:LOCALAPPDATA "TDA\State\acceptance\installed-journey.json"),
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765,
    [switch]$Automated,
    [switch]$AllowLegacyTrayEquivalent,
    [string]$BitsProbeUrl = "https://github.com/Faysk/tda/releases/download/companion-qwen-runtime-rc-v1.0.7-018e109530ba/TDAQwenRuntime-1.0.7-windows-x64.zip.part002"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$script:ExpectedVersion = $null

function Resolve-RequiredFile([string]$Value, [string]$Code) {
    try { return (Resolve-Path -LiteralPath $Value -ErrorAction Stop).Path } catch { throw $Code }
}

function Confirm-Observation([string]$Name, [string]$Instructions) {
    Write-Host ""
    Write-Host "[$Name]" -ForegroundColor Cyan
    Write-Host $Instructions
    $answer = Read-Host "Digite PASS somente se você observou exatamente esse comportamento"
    return $answer.Trim().ToUpperInvariant() -eq "PASS"
}

function Get-AgentHealth {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    try {
        $response = $client.GetAsync("http://127.0.0.1:$Port/api/v1/health").GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne 200) { return $null }
        $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $value = $raw | ConvertFrom-Json -ErrorAction Stop
        if ([string]$value.product_id -ne "tda-companion") { return $null }
        if ([string]$value.api_version -ne "1") { return $null }
        if ([int]$value.port -ne $Port -or [int]$value.pid -le 0) { return $null }
        if ($null -ne $script:ExpectedVersion -and [string]$value.service_version -ne $script:ExpectedVersion) { return $null }
        return $value
    } catch {
        return $null
    } finally {
        $client.Dispose()
    }
}

function Wait-AgentReplacement([int]$PreviousPid, [int]$TimeoutSeconds = 60) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $health = Get-AgentHealth
        if (
            $null -ne $health -and
            [int]$health.pid -ne $PreviousPid -and
            [string]$health.lifecycle -eq "ready"
        ) {
            return $health
        }
        Start-Sleep -Milliseconds 300
    }
    return $null
}


Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TdaAcceptanceWindow {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public static IntPtr FindAnyWindow(int pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint owner; GetWindowThreadProcessId(hWnd, out owner);
            if (owner == (uint)pid) { result = hWnd; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
    public static IntPtr FindVisibleWindow(int pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint owner; GetWindowThreadProcessId(hWnd, out owner);
            if (owner == (uint)pid && IsWindowVisible(hWnd)) { result = hWnd; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
    public static bool Close(IntPtr hWnd) { return PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero); }
    public static bool Show(IntPtr hWnd) { return ShowWindow(hWnd, 5); }
}
"@

function Get-PairingToken {
    $path = Join-Path $env:LOCALAPPDATA "TDA\State\pairing-token.txt"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "PAIRING_TOKEN_FILE_MISSING" }
    $value = (Get-Content -LiteralPath $path -Raw -Encoding UTF8).Trim()
    if ($value.Length -lt 43) { throw "PAIRING_TOKEN_INVALID" }
    return $value
}

function Invoke-AgentJson([string]$Method, [string]$Path) {
    $token = Get-PairingToken
    $headers = @{ Authorization = "Bearer $token"; Accept = "application/json"; Origin = "https://dnd.faysk.dev" }
    return Invoke-RestMethod -NoProxy -Method $Method -Uri "http://127.0.0.1:$Port/api/v1$Path" -Headers $headers -TimeoutSec 30
}

function Upload-CraigFixture([string]$Path) {
    $token = Get-PairingToken
    $headers = @{ Authorization = "Bearer $token"; Accept = "application/json"; Origin = "https://dnd.faysk.dev" }
    $response = Invoke-WebRequest -NoProxy -Method Post -Uri "http://127.0.0.1:$Port/api/v1/sources/craig" -Headers $headers -ContentType "application/zip" -InFile $Path -TimeoutSec 900
    return $response.Content | ConvertFrom-Json
}

function Get-UiProcesses {
    $health = Get-AgentHealth
    $agentPid = if ($null -ne $health) { [int]$health.pid } else { -1 }
    return @(Get-CimInstance Win32_Process -Filter "Name='TDACompanion.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $commandLine = [string]$_.CommandLine
            [int]$_.ProcessId -ne $agentPid -and
            $commandLine -notmatch '(?i)(?:^|\s)--(?:agent|worker|install-rc-runtime|installed-acceptance)(?:\s|$)'
        } | Sort-Object CreationDate -Descending)
}

function Stop-UiProcesses {
    $uis = @(Get-UiProcesses)
    foreach ($ui in $uis) {
        try { Stop-Process -Id ([int]$ui.ProcessId) -Force -ErrorAction Stop } catch {}
    }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and @(Get-UiProcesses).Count -gt 0) {
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq (Get-AgentHealth)) { throw "AGENT_DIED_WHILE_CLEANING_UI_PROCESSES" }
    return $uis.Count
}

function Ensure-AcceptanceUi([string]$Executable) {
    $existing = @(Get-UiProcesses) | Select-Object -First 1
    if ($null -ne $existing) {
        $window = [TdaAcceptanceWindow]::FindAnyWindow([int]$existing.ProcessId)
        if ($window -ne [IntPtr]::Zero) {
            [void][TdaAcceptanceWindow]::Show($window)
            return $existing
        }
    }
    Start-Process -FilePath $Executable -ArgumentList @("--ui", "--port", [string]$Port) | Out-Null
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $ui = @(Get-UiProcesses) | Select-Object -First 1
        if ($null -ne $ui) {
            $window = [TdaAcceptanceWindow]::FindVisibleWindow([int]$ui.ProcessId)
            if ($window -ne [IntPtr]::Zero) { return $ui }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "UI_WINDOW_NOT_READY"
}

function Get-ProcessDescendants([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $wanted = New-Object System.Collections.Generic.HashSet[int]
    [void]$wanted.Add($RootPid)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $all) {
            if ($wanted.Contains([int]$process.ParentProcessId) -and -not $wanted.Contains([int]$process.ProcessId)) {
                [void]$wanted.Add([int]$process.ProcessId)
                $changed = $true
            }
        }
    }
    return @($all | Where-Object { $wanted.Contains([int]$_.ProcessId) })
}

function Write-AcceptanceSettings([string]$SettingsPath, [string]$CloseBehavior, [bool]$ShowTray) {
    $value = @{ schema = 1; start_with_windows = $true; show_tray = $ShowTray; check_updates = $true; theme = "system"; close_behavior = $CloseBehavior }
    if (Test-Path -LiteralPath $SettingsPath -PathType Leaf) {
        try {
            $old = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($key in @("start_with_windows", "check_updates", "theme")) {
                if ($null -ne $old.$key) { $value[$key] = $old.$key }
            }
        } catch {}
    }
    $temporary = "$SettingsPath.acceptance"
    $value | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $SettingsPath -Force
}

function Wait-ProcessExit([int]$Pid, [int]$TimeoutSeconds = 20) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and $null -ne (Get-Process -Id $Pid -ErrorAction SilentlyContinue)) {
        Start-Sleep -Milliseconds 200
    }
    return $null -eq (Get-Process -Id $Pid -ErrorAction SilentlyContinue)
}

function Get-Sha256Text([string]$Value) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
    } finally {
        $sha.Dispose()
    }
}

function Get-TdaBitsJobs {
    try {
        Import-Module BitsTransfer -ErrorAction Stop
        $jobs = @(Get-BitsTransfer -ErrorAction SilentlyContinue)
    } catch {
        throw "BITS_EVIDENCE_UNAVAILABLE"
    }
    return @($jobs | Where-Object {
        ([string]$_.DisplayName).StartsWith("TDA Companion ", [StringComparison]::Ordinal) -and @($_.FileList).Count -eq 1
    })
}

function Get-TdaBitsSnapshot([object]$Job) {
    $files = @($Job.FileList)
    if ($files.Count -ne 1) { throw "BITS_EVIDENCE_FILELIST_INVALID" }
    $remote = [string]$files[0].RemoteName
    $local = [IO.Path]::GetFullPath([string]$files[0].LocalName)
    try { $uri = [Uri]$remote } catch { throw "BITS_EVIDENCE_REMOTE_INVALID" }
    if ($uri.Scheme -ne "https" -or $uri.Host -ne "github.com" -or -not $uri.AbsolutePath.StartsWith("/Faysk/tda/releases/download/", [StringComparison]::Ordinal)) {
        throw "BITS_EVIDENCE_REMOTE_INVALID"
    }
    $cacheRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "TDA\Cache"))
    $cachePrefix = $cacheRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $local.StartsWith($cachePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "BITS_EVIDENCE_DESTINATION_INVALID" }
    $jobId = [string]$Job.JobId
    if ($jobId -notmatch '^[0-9a-fA-F-]{36}$') { throw "BITS_EVIDENCE_JOB_ID_INVALID" }
    $transferredRaw = [uint64]$Job.BytesTransferred
    $totalRaw = [uint64]$Job.BytesTotal
    $unknownTotal = [UInt64]::MaxValue
    $int64Max = [uint64][Int64]::MaxValue

    if ($transferredRaw -gt $int64Max) { throw "BITS_EVIDENCE_BYTES_OUT_OF_RANGE" }
    $transferred = [int64]$transferredRaw
    $totalKnown = $totalRaw -ne $unknownTotal
    $total = $null
    if ($totalKnown) {
        if ($totalRaw -eq 0 -or $totalRaw -gt $int64Max) { throw "BITS_EVIDENCE_BYTES_OUT_OF_RANGE" }
        $total = [int64]$totalRaw
        if ($transferred -gt $total) { throw "BITS_EVIDENCE_BYTES_INVALID" }
    }

    return [pscustomobject]@{
        JobId = $jobId
        State = [string]$Job.JobState
        BytesTransferred = $transferred
        BytesTotal = $total
        BytesTotalKnown = $totalKnown
    }
}

function Capture-BitsResumeEvidence([string]$Destination) {
    Write-Host ""
    Write-Host "[background_download_resume - measured evidence]" -ForegroundColor Cyan
    Write-Host "Keep the Internet ON and start one LARGE download from Companion (prefer Qwen runtime/model)."
    Write-Host "The acceptance harness will not continue until it can see exactly one real TDA BITS job."

    $online = $null
    for ($attempt = 1; $attempt -le 3 -and $null -eq $online; $attempt++) {
        [void](Read-Host "After clicking prepare/install in Companion, press ENTER")
        $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
        while ([DateTimeOffset]::UtcNow -lt $deadline -and $null -eq $online) {
            $jobs = @(Get-TdaBitsJobs)
            if ($jobs.Count -gt 1) { throw "BITS_EVIDENCE_JOB_AMBIGUOUS" }
            if ($jobs.Count -eq 1) {
                $candidate = Get-TdaBitsSnapshot $jobs[0]
                if (
                    $candidate.BytesTotalKnown -and
                    $candidate.BytesTransferred -lt $candidate.BytesTotal
                ) {
                    $online = $candidate
                }
            }
            if ($null -eq $online) { Start-Sleep -Milliseconds 250 }
        }
        if ($null -eq $online -and $attempt -lt 3) {
            Write-Warning "No pending TDA BITS job was detected. Start a download that is not already cached, then try again."
        }
    }
    if ($null -eq $online) { throw "BITS_EVIDENCE_PENDING_JOB_NOT_FOUND" }

    Write-Host "BITS job detected: $($online.BytesTransferred)/$($online.BytesTotal) bytes, state $($online.State)." -ForegroundColor Green
    Write-Host "Now disconnect the Internet. Do not start another download."
    [void](Read-Host "When Windows is offline, press ENTER")

    $before = $null
    $stableBytes = -1L
    $stableCount = 0
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and $null -eq $before) {
        try {
            $job = Get-BitsTransfer -JobId ([Guid]$online.JobId) -ErrorAction Stop
            $candidate = Get-TdaBitsSnapshot $job
            if ($candidate.JobId -ne $online.JobId) { throw "BITS_EVIDENCE_JOB_CHANGED" }
            if (-not $candidate.BytesTotalKnown) {
                Start-Sleep -Milliseconds 250
                continue
            }
            if ($candidate.BytesTotal -ne $online.BytesTotal) { throw "BITS_EVIDENCE_TOTAL_CHANGED" }
            if ($candidate.BytesTransferred -ge $candidate.BytesTotal) {
                throw "BITS_EVIDENCE_DOWNLOAD_COMPLETED_TOO_EARLY"
            }

            if ($candidate.BytesTransferred -eq $stableBytes) {
                $stableCount += 1
            } else {
                $stableBytes = $candidate.BytesTransferred
                $stableCount = 0
            }

            if (
                $candidate.State -in @("Suspended", "TransientError", "Queued", "Connecting") -or
                $stableCount -ge 3
            ) {
                $before = $candidate
            }
        } catch {
            if ($_.Exception.Message -match '^BITS_EVIDENCE_') { throw }
        }
        if ($null -eq $before) { Start-Sleep -Seconds 1 }
    }
    if ($null -eq $before) { throw "BITS_EVIDENCE_OFFLINE_STATE_NOT_OBSERVED" }

    Write-Host "Offline state captured on the same job: $($before.BytesTransferred)/$($before.BytesTotal), $($before.State)." -ForegroundColor DarkYellow
    Write-Host "Reconnect the Internet. Do not click prepare/install again; BITS must resume the SAME job."
    [void](Read-Host "When the Internet is back, press ENTER")

    $after = $null
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(60)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and $null -eq $after) {
        try {
            $job = Get-BitsTransfer -JobId ([Guid]$before.JobId) -ErrorAction Stop
            $candidate = Get-TdaBitsSnapshot $job
            if ($candidate.JobId -ne $before.JobId) { throw "BITS_EVIDENCE_JOB_CHANGED" }
            if (-not $candidate.BytesTotalKnown) {
                Start-Sleep -Milliseconds 250
                continue
            }
            if ($candidate.BytesTotal -ne $before.BytesTotal) { throw "BITS_EVIDENCE_TOTAL_CHANGED" }
            if (
                $candidate.BytesTransferred -gt $before.BytesTransferred -and
                $candidate.State -in @("Connecting", "Transferring", "Transferred")
            ) {
                $after = $candidate
            }
        } catch {
            if ($_.Exception.Message -match '^BITS_EVIDENCE_') { throw }
        }
        if ($null -eq $after) { Start-Sleep -Milliseconds 250 }
    }
    if ($null -eq $after) { throw "BITS_EVIDENCE_SAME_JOB_PROGRESS_NOT_OBSERVED" }

    $evidence = [ordered]@{
        schema = "tda_bits_resume_evidence_v1"
        pass = $true
        job_id_sha256 = Get-Sha256Text (([string]$before.JobId).ToLowerInvariant())
        bytes_before = [int64]$before.BytesTransferred
        bytes_after = [int64]$after.BytesTransferred
        bytes_total = [int64]$before.BytesTotal
        state_before = [string]$before.State
        state_after = [string]$after.State
        same_job = $true
        reused_job = $true
        contains_paths = $false
        contains_url = $false
    }
    $parent = Split-Path -Parent $Destination
    if (-not $parent) { throw "BITS_EVIDENCE_DESTINATION_INVALID" }
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temporary = "$Destination.partial"
    $evidence | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
    Move-Item -LiteralPath $temporary -Destination $Destination -Force
    return $evidence
}


function Capture-AutomatedBitsResumeEvidence([string]$Destination) {
    try { $uri = [Uri]$BitsProbeUrl } catch { throw "BITS_PROBE_URL_INVALID" }
    if ($uri.Scheme -ne "https" -or $uri.Host -ne "github.com" -or -not $uri.AbsolutePath.StartsWith("/Faysk/tda/releases/download/", [StringComparison]::Ordinal)) {
        throw "BITS_PROBE_URL_INVALID"
    }

    Import-Module BitsTransfer -ErrorAction Stop
    $probeRoot = Join-Path $env:LOCALAPPDATA "TDA\Cache\acceptance"
    New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
    $probePath = Join-Path $probeRoot ("bits-probe-" + [Guid]::NewGuid().ToString("N") + ".bin")
    $job = $null

    try {
        $job = Start-BitsTransfer -Source $BitsProbeUrl -Destination $probePath -DisplayName ("TDA Companion Acceptance " + [Guid]::NewGuid().ToString("N")) -Description "TDA automated installed acceptance BITS probe" -Priority High -Asynchronous -ErrorAction Stop
        Suspend-BitsTransfer -BitsJob $job -ErrorAction Stop | Out-Null

        $before = $null
        $suspendDeadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
        while ([DateTimeOffset]::UtcNow -lt $suspendDeadline -and $null -eq $before) {
            $beforeJob = Get-BitsTransfer -JobId $job.JobId -ErrorAction Stop
            $candidateBefore = Get-TdaBitsSnapshot $beforeJob
            if ($candidateBefore.JobId -ne [string]$job.JobId) { throw "BITS_EVIDENCE_JOB_CHANGED" }
            if ($candidateBefore.State -eq "Suspended") {
                $before = $candidateBefore
                break
            }
            if ($candidateBefore.State -in @("Error", "Cancelled", "Transferred")) {
                throw "BITS_EVIDENCE_SUSPEND_NOT_OBSERVED"
            }
            Start-Sleep -Milliseconds 100
        }
        if ($null -eq $before) { throw "BITS_EVIDENCE_SUSPEND_NOT_OBSERVED" }

        $beforeJob = Get-BitsTransfer -JobId ([Guid]$before.JobId) -ErrorAction Stop
        Resume-BitsTransfer -BitsJob $beforeJob -Asynchronous -ErrorAction Stop | Out-Null
        $after = $null
        $deadline = [DateTimeOffset]::UtcNow.AddSeconds(90)
        while ([DateTimeOffset]::UtcNow -lt $deadline -and $null -eq $after) {
            $candidateJob = Get-BitsTransfer -JobId $job.JobId -ErrorAction Stop
            $candidate = Get-TdaBitsSnapshot $candidateJob
            if ($candidate.JobId -ne $before.JobId) { throw "BITS_EVIDENCE_JOB_CHANGED" }
            if ($candidate.BytesTotalKnown -and $candidate.BytesTransferred -gt $before.BytesTransferred -and $candidate.BytesTransferred -le $candidate.BytesTotal -and $candidate.State -in @("Connecting", "Transferring", "Transferred")) {
                $after = $candidate
            } else {
                Start-Sleep -Milliseconds 100
            }
        }
        if ($null -eq $after) { throw "BITS_EVIDENCE_SAME_JOB_PROGRESS_NOT_OBSERVED" }

        $evidence = [ordered]@{
            schema = "tda_bits_resume_evidence_v1"
            pass = $true
            job_id_sha256 = Get-Sha256Text (([string]$before.JobId).ToLowerInvariant())
            bytes_before = [int64]$before.BytesTransferred
            bytes_after = [int64]$after.BytesTransferred
            bytes_total = [int64]$after.BytesTotal
            state_before = [string]$before.State
            state_after = [string]$after.State
            same_job = $true
            reused_job = $true
            contains_paths = $false
            contains_url = $false
        }
        $parent = Split-Path -Parent $Destination
        if (-not $parent) { throw "BITS_EVIDENCE_DESTINATION_INVALID" }
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        $temporary = "$Destination.partial"
        $evidence | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8 -NoNewline
        Move-Item -LiteralPath $temporary -Destination $Destination -Force
        return $evidence
    } finally {
        if ($null -ne $job) {
            try {
                $remaining = Get-BitsTransfer -JobId $job.JobId -ErrorAction SilentlyContinue
                if ($null -ne $remaining) { Remove-BitsTransfer -BitsJob $remaining -Confirm:$false -ErrorAction SilentlyContinue }
            } catch {}
        }
        Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }
}

if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }
$candidate = Resolve-RequiredFile $CandidateMsi "CANDIDATE_MSI_NOT_FOUND"
$payload = Resolve-RequiredFile $PayloadManifest "PAYLOAD_MANIFEST_NOT_FOUND"
$craig = Resolve-RequiredFile $CraigZip "CRAIG_ZIP_NOT_FOUND"
if ([IO.Path]::GetExtension($candidate).ToLowerInvariant() -ne ".msi") { throw "CANDIDATE_MSI_REQUIRED" }
if ([IO.Path]::GetExtension($payload).ToLowerInvariant() -ne ".json") { throw "PAYLOAD_MANIFEST_REQUIRED" }
if ([IO.Path]::GetExtension($craig).ToLowerInvariant() -ne ".zip") { throw "CRAIG_ZIP_REQUIRED" }
if ($candidate.Contains('"') -or $payload.Contains('"') -or $craig.Contains('"') -or $ReceiptPath.Contains('"')) { throw "UNSUPPORTED_QUOTE_IN_PATH" }

$receiptDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($ReceiptPath))
$bitsEvidencePath = Join-Path $receiptDirectory "bits-resume-evidence.json"
Remove-Item -LiteralPath $bitsEvidencePath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$bitsEvidencePath.partial" -Force -ErrorAction SilentlyContinue

$companionRoot = Join-Path $env:LOCALAPPDATA "TDA\Companion"
$marker = Join-Path $companionRoot "current-version.txt"
if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw "INSTALLED_VERSION_MARKER_MISSING" }
$version = (Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim()
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "INSTALLED_VERSION_INVALID" }
$script:ExpectedVersion = $version
$executable = Join-Path (Join-Path (Join-Path $companionRoot "versions") $version) "TDACompanion.exe"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "INSTALLED_EXECUTABLE_MISSING" }

Write-Host "TDA Companion installed acceptance" -ForegroundColor Yellow
Write-Host "Versão instalada: $version"
Write-Host "Source SHA candidato: $($SourceSha.ToLowerInvariant())"
Write-Host "MSI SHA256: $((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant())"
Write-Host "Payload manifest SHA256: $((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant())"
Write-Host ""
Write-Host ($(if ($Automated) { "Modo automatizado: nenhuma confirmação PASS, Task Manager, file picker ou alternância manual de rede." } else { "As observações humanas são atestações; recovery, identidade do Agent e retomada BITS exigem prova medida." })) -ForegroundColor DarkYellow

$observations = New-Object System.Collections.Generic.List[string]

if ($Automated) {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "AUTOMATED_ACCEPTANCE_WINDOWS_REQUIRED" }
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw "AUTOMATED_ACCEPTANCE_POWERSHELL_7_REQUIRED" }

    $jobsValue = Invoke-AgentJson "GET" "/jobs"
    $jobRows = @($jobsValue.jobs)
    $activeJobs = @($jobRows | Where-Object { [string]$_.status -in @("queued", "running") })
    if ($activeJobs.Count -gt 0) { throw "ACTIVE_USER_JOB_PRESENT" }

    $preparationValue = Invoke-AgentJson "GET" "/preparation"
    if ($preparationValue.active -eq $true) { throw "ACTIVE_USER_PREPARATION_PRESENT" }

    $initialReady = Get-AgentHealth
    if ($null -eq $initialReady -or [string]$initialReady.lifecycle -ne "ready") {
        throw "AGENT_INITIAL_READY_REQUIRED"
    }

    $settingsPath = Join-Path $env:LOCALAPPDATA "TDA\State\settings.json"
    $settingsExisted = Test-Path -LiteralPath $settingsPath -PathType Leaf
    $settingsOriginal = if ($settingsExisted) { Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 } else { $null }
    $initialUiCount = @(Get-UiProcesses).Count

    try {
        [void](Stop-UiProcesses)
        Write-AcceptanceSettings $settingsPath "hide" $true
        $ui = Ensure-AcceptanceUi $executable
        Start-Sleep -Seconds 2

        Write-Host "[agent_recovery - automated]" -ForegroundColor Cyan
        $initialHealth = Get-AgentHealth
        if ($null -eq $initialHealth) { throw "AGENT_INITIAL_IDENTITY_REQUIRED" }
        $initialPid = [int]$initialHealth.pid
        Stop-Process -Id $initialPid -Force
        $replacementHealth = Wait-AgentReplacement $initialPid 90
        if ($null -eq $replacementHealth) { throw "AGENT_RECOVERY_PID_NOT_REPLACED" }
        $observations.Add("agent_recovery")

        Write-Host "[port_conflict - automated]" -ForegroundColor Cyan
        $portHealth = Get-AgentHealth
        if ($null -eq $portHealth) { throw "PORT_CONFLICT_INITIAL_IDENTITY_REQUIRED" }
        $portPid = [int]$portHealth.pid
        Stop-Process -Id $portPid -Force
        $listener = $null
        $bindDeadline = [DateTimeOffset]::UtcNow.AddSeconds(8)
        while ($null -eq $listener -and [DateTimeOffset]::UtcNow -lt $bindDeadline) {
            $candidateListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
            try {
                $candidateListener.Start()
                $listener = $candidateListener
            } catch {
                try { $candidateListener.Stop() } catch {}
                Start-Sleep -Milliseconds 50
            }
        }
        if ($null -eq $listener) { throw "PORT_CONFLICT_LISTENER_BIND_FAILED" }
        try {
            Start-Sleep -Seconds 4
            if ($null -ne (Get-AgentHealth)) { throw "FOREIGN_LISTENER_ACCEPTED_AS_AGENT" }
        } finally {
            try { $listener.Stop() } catch {}
        }
        if ($null -eq (Wait-AgentReplacement $portPid 90)) { throw "PORT_CONFLICT_RECOVERY_FAILED" }
        $observations.Add("port_conflict")

        Write-Host "[diagnostics_ui - automated]" -ForegroundColor Cyan
        $ui = Ensure-AcceptanceUi $executable
        Start-Sleep -Seconds 1
        $descendants = Get-ProcessDescendants ([int]$ui.ProcessId)
        $webviews = @($descendants | Where-Object { [string]$_.Name -ieq "msedgewebview2.exe" })
        if ($webviews.Count -lt 1) { throw "WEBVIEW2_RENDERER_NOT_OBSERVED" }
        $capabilities = Invoke-AgentJson "GET" "/capabilities"
        if (-not (@($capabilities.capabilities) -contains "system.telemetry")) { throw "CAPABILITIES_INVALID" }
        $observations.Add("diagnostics_ui")

        Write-Host "[background_download_resume - automated]" -ForegroundColor Cyan
        $bitsEvidence = Capture-AutomatedBitsResumeEvidence $bitsEvidencePath
        if ($bitsEvidence.pass -ne $true -or $bitsEvidence.same_job -ne $true -or $bitsEvidence.bytes_after -le $bitsEvidence.bytes_before) {
            throw "BITS_EVIDENCE_INVALID"
        }
        $observations.Add("background_download_resume")

        Write-Host "[close_hides_ui - automated]" -ForegroundColor Cyan
        Write-AcceptanceSettings $settingsPath "hide" $true
        $ui = Ensure-AcceptanceUi $executable
        $window = [TdaAcceptanceWindow]::FindVisibleWindow([int]$ui.ProcessId)
        if ($window -eq [IntPtr]::Zero) { throw "UI_VISIBLE_WINDOW_NOT_FOUND" }
        [void][TdaAcceptanceWindow]::Close($window)
        Start-Sleep -Seconds 2
        if ($null -eq (Get-Process -Id ([int]$ui.ProcessId) -ErrorAction SilentlyContinue)) { throw "UI_CLOSE_DID_NOT_HIDE" }
        $hiddenWindow = [TdaAcceptanceWindow]::FindAnyWindow([int]$ui.ProcessId)
        if ($hiddenWindow -eq [IntPtr]::Zero -or [TdaAcceptanceWindow]::IsWindowVisible($hiddenWindow)) { throw "UI_CLOSE_WINDOW_STILL_VISIBLE" }
        if ($null -eq (Get-AgentHealth)) { throw "AGENT_DIED_WHEN_UI_HIDDEN" }
        $observations.Add("close_hides_ui")
        [void][TdaAcceptanceWindow]::Show($hiddenWindow)

        Write-Host "[tray_exit - automated]" -ForegroundColor Cyan
        [void](Stop-UiProcesses)
        $agentBeforeTrayExit = Get-AgentHealth
        if ($null -eq $agentBeforeTrayExit) { throw "TRAY_EXIT_AGENT_PRECONDITION_FAILED" }

        $trayProcess = Start-Process -FilePath $executable -ArgumentList @("--ui", "--acceptance-tray-exit", "--port", [string]$Port) -PassThru
        $trayExact = $trayProcess.WaitForExit(30000) -and [int]$trayProcess.ExitCode -eq 0

        if (-not $trayExact) {
            try {
                if (-not $trayProcess.HasExited) { Stop-Process -Id $trayProcess.Id -Force -ErrorAction SilentlyContinue }
            } catch {}
            if (-not $AllowLegacyTrayEquivalent) { throw "EXACT_TRAY_EXIT_ACCEPTANCE_UNSUPPORTED" }

            Write-Warning "Installed candidate predates exact tray automation; using the explicit legacy close_ui equivalent."
            Write-AcceptanceSettings $settingsPath "close_ui" $false
            $legacyUi = Ensure-AcceptanceUi $executable
            $legacyWindow = [TdaAcceptanceWindow]::FindVisibleWindow([int]$legacyUi.ProcessId)
            if ($legacyWindow -eq [IntPtr]::Zero) { throw "LEGACY_TRAY_EQUIVALENT_WINDOW_NOT_FOUND" }
            [void][TdaAcceptanceWindow]::Close($legacyWindow)
            if (-not (Wait-ProcessExit ([int]$legacyUi.ProcessId) 20)) { throw "LEGACY_TRAY_EQUIVALENT_UI_STILL_ALIVE" }
        }

        $agentAfterTrayExit = Get-AgentHealth
        if ($null -eq $agentAfterTrayExit) { throw "AGENT_DIED_WITH_TRAY_EXIT" }
        if ($trayExact -and [int]$agentAfterTrayExit.pid -ne [int]$agentBeforeTrayExit.pid) { throw "TRAY_EXIT_AGENT_IDENTITY_CHANGED" }
        $observations.Add("tray_exit")

        Write-AcceptanceSettings $settingsPath "hide" $true
        $ui = Ensure-AcceptanceUi $executable

        Write-Host "[craig_selected / craig_survives_agent_loss - automated]" -ForegroundColor Cyan
        $craigFirst = Upload-CraigFixture $craig
        if ([string]$craigFirst.source_id -notmatch '^craig-[a-f0-9]{64}$' -or [int]$craigFirst.track_count -lt 1) {
            throw "CRAIG_INGEST_INVALID"
        }
        $observations.Add("craig_selected")

        $craigHealth = Get-AgentHealth
        if ($null -eq $craigHealth) { throw "CRAIG_AGENT_INITIAL_IDENTITY_REQUIRED" }
        $craigPid = [int]$craigHealth.pid
        Stop-Process -Id $craigPid -Force
        if ($null -eq (Wait-AgentReplacement $craigPid 90)) { throw "CRAIG_RECOVERY_PID_NOT_REPLACED" }

        $craigSecond = Upload-CraigFixture $craig
        if ([string]$craigSecond.source_id -ne [string]$craigFirst.source_id -or $craigSecond.reused -ne $true) {
            throw "CRAIG_DID_NOT_SURVIVE_AGENT_LOSS"
        }
        $observations.Add("craig_survives_agent_loss")
    } finally {
        try {
            if ($settingsExisted) {
                $settingsOriginal | Set-Content -LiteralPath $settingsPath -Encoding UTF8 -NoNewline
            } else {
                Remove-Item -LiteralPath $settingsPath -Force -ErrorAction SilentlyContinue
            }
        } catch {}
        try { [void](Stop-UiProcesses) } catch {}
        if ($initialUiCount -gt 0) {
            try { [void](Ensure-AcceptanceUi $executable) } catch {}
        }
    }
} else {
    $initialHealth = Get-AgentHealth
    if ($null -eq $initialHealth) { throw "AGENT_INITIAL_IDENTITY_REQUIRED" }
    $initialPid = [int]$initialHealth.pid
    Write-Host "Agent inicial exato: PID $initialPid, versão $([string]$initialHealth.service_version)"
    $recoveryPrompt = @"
Com a UI do Companion aberta, finalize manualmente SOMENTE o processo Agent no Gerenciador de Tarefas.
A interface deve mostrar recovery/reconexão e voltar a Ready sem abrir uma segunda UI, sem loop de erro e sem você reiniciar o aplicativo.
"@
    $recoveryObserved = Confirm-Observation "agent_recovery" $recoveryPrompt
    if (-not $recoveryObserved) { throw "AGENT_RECOVERY_OBSERVATION_NOT_CONFIRMED" }
    $replacementHealth = Wait-AgentReplacement $initialPid
    if ($null -eq $replacementHealth) { throw "AGENT_RECOVERY_PID_NOT_REPLACED" }
    $observations.Add("agent_recovery")

    $portPrompt = @"
Teste manualmente o conflito da porta 8765: com o Agent parado, ocupe 127.0.0.1:8765 com um listener que NÃO seja TDA, mantenha a UI aberta e tente/aguarde o recovery.
A UI deve indicar conflito de porta/processo incompatível e NÃO deve tratar esse listener como Agent. Depois libere a porta e confirme que o Agent consegue voltar.
"@
    if (Confirm-Observation "port_conflict" $portPrompt) { $observations.Add("port_conflict") }

    $diagnosticPrompt = @"
Abra Diagnóstico na UI instalada. Confirme que o resumo por capability aparece, que erros de rede são tipados/amigáveis e que WebView2 não aparece como ausente enquanto essa mesma UI WebView2 está aberta.
"@
    if (Confirm-Observation "diagnostics_ui" $diagnosticPrompt) { $observations.Add("diagnostics_ui") }

    $bitsEvidence = Capture-BitsResumeEvidence $bitsEvidencePath
    if ($bitsEvidence.pass -eq $true) { $observations.Add("background_download_resume") }

    $closePrompt = @"
Com a preferência 'Ao fechar: Ocultar a interface' e o tray ativo, clique no X. A janela deve desaparecer, o tray deve permanecer e o Agent deve continuar operacional.
"@
    if (Confirm-Observation "close_hides_ui" $closePrompt) { $observations.Add("close_hides_ui") }

    $trayPrompt = @"
Reabra a interface pelo tray e use 'Sair da interface'. A UI deve encerrar de verdade sem encerrar o Agent. Depois abra novamente o Companion para continuar o aceite.
"@
    if (Confirm-Observation "tray_exit" $trayPrompt) { $observations.Add("tray_exit") }

    $craigPrompt = @"
Na tela Processar sessão, selecione exatamente o Craig ZIP fornecido. Confirme que as faixas/speakers aparecem e que o ZIP não é rejeitado por uma falha posterior de Agent/perfis.
"@
    if (Confirm-Observation "craig_selected" $craigPrompt) { $observations.Add("craig_selected") }

    $craigHealth = Get-AgentHealth
    if ($null -eq $craigHealth) { throw "CRAIG_AGENT_INITIAL_IDENTITY_REQUIRED" }
    $craigPid = [int]$craigHealth.pid
    $craigRecoveryPrompt = @"
Sem remover a sessão Craig da tela, finalize manualmente SOMENTE o Agent. Após o recovery, a sessão Craig deve continuar selecionada e válida; a UI não pode dizer que o ZIP é inválido/rejeitado só porque o Agent caiu.
"@
    $craigRecoveryObserved = Confirm-Observation "craig_survives_agent_loss" $craigRecoveryPrompt
    if (-not $craigRecoveryObserved) { throw "CRAIG_RECOVERY_OBSERVATION_NOT_CONFIRMED" }
    if ($null -eq (Wait-AgentReplacement $craigPid)) { throw "CRAIG_RECOVERY_PID_NOT_REPLACED" }
    $observations.Add("craig_survives_agent_loss")
}

$arguments = @(
    "--installed-acceptance",
    "--acceptance-candidate-msi", "`"$candidate`"",
    "--acceptance-payload-manifest", "`"$payload`"",
    "--acceptance-source-sha", $SourceSha.ToLowerInvariant(),
    "--acceptance-craig-zip", "`"$craig`"",
    "--acceptance-bits-evidence", "`"$bitsEvidencePath`"",
    "--acceptance-result-file", "`"$ReceiptPath`"",
    "--port", [string]$Port
)
foreach ($observation in $observations) { $arguments += @("--acceptance-observation", $observation) }

$process = Start-Process -FilePath $executable -ArgumentList $arguments -Wait -PassThru
if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) { throw "ACCEPTANCE_RECEIPT_MISSING" }
$receipt = Get-Content -LiteralPath $ReceiptPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
if ([string]$receipt.schema -ne "tda_installed_acceptance_v3") { throw "ACCEPTANCE_RECEIPT_SCHEMA_INVALID" }
if ([int]$process.ExitCode -ne 0 -or $receipt.pass -ne $true) {
    $code = if ($receipt.error_code) { [string]$receipt.error_code } else { "ACCEPTANCE_NOT_PASSED" }
    Write-Error "Aceite instalado não passou: $code"
    exit 1
}

Write-Host ""
Write-Host "ACEITE INSTALADO: PASS" -ForegroundColor Green
Write-Host "Receipt sanitizado: $ReceiptPath"
Write-Host "BITS evidence sanitizada: $bitsEvidencePath"
exit 0
