param(
    [string]$RepositoryPath = "G:\Project\tda",
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PackVersion = "2.0.3"
$ExpectedHelperSha = "36c721687d78439670db62dc29b7d99c1da759c3"
$ExpectedRcTag = "companion-rc-v0.3.14-1585a93235ba"
$ExpectedSourceSha = "1585a93235ba2fe7c2c093ef1683f0beca5d1605"
$ExpectedMsiSha = "83c267ae14f10fda950413cab74394fc7b875225fa0e13f5123c8901f609f8c3"
$ExpectedPayloadSha = "bc6ac20dbac3e0d9a31ff1cc3ff8a09e8e5b455cb644bcea00fe45f80bd34312"

function Write-Section([string]$Title) {
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkGray
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkGray
}

function Save-Text([string]$Path, [object]$Value) {
    $Value | Out-String -Width 300 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Invoke-GitText([string[]]$GitArgs) {
    $output = & git.exe @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "GIT_COMMAND_FAILED: git $($GitArgs -join ' ')`n$($output -join "`n")"
    }
    return @($output)
}

function Copy-IfExists([string]$Source, [string]$DestinationDirectory) {
    if (Test-Path -LiteralPath $Source -PathType Leaf) {
        New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null
        Copy-Item -LiteralPath $Source -Destination $DestinationDirectory -Force
    }
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "PowerShell 7+ obrigatório. Execute com pwsh.exe, não powershell.exe."
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "Windows x64 obrigatório."
}
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw "git.exe não encontrado no PATH."
}
if (-not (Get-Command pwsh.exe -ErrorAction SilentlyContinue)) {
    throw "pwsh.exe não encontrado no PATH."
}

$repo = [IO.Path]::GetFullPath($RepositoryPath)
if (-not (Test-Path -LiteralPath (Join-Path $repo ".git"))) {
    throw "Repositório Git não encontrado em: $repo"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$resultsBase = Join-Path $repo "TDA-TEST-RESULTS"
$runRoot = Join-Path $resultsBase $timestamp
$shareRoot = Join-Path $runRoot "SEND-THIS"
$metaRoot = Join-Path $shareRoot "meta"
$receiptCopy = Join-Path $shareRoot "receipts"
$msiLogs = Join-Path $shareRoot "msi-logs"
$harnessRoot = Join-Path $runRoot "_harness"
$acceptanceRoot = Join-Path $runRoot "_acceptance-private"

New-Item -ItemType Directory -Force -Path `
    $runRoot, $shareRoot, $metaRoot, $receiptCopy, $msiLogs, $harnessRoot, $acceptanceRoot |
    Out-Null

$transcriptPath = Join-Path $shareRoot "terminal-transcript.txt"
$summaryPath = Join-Path $shareRoot "RESULT-SUMMARY.txt"
$zipPath = Join-Path $resultsBase ("TDA-ACCEPTANCE-RESULTS-{0}.zip" -f $timestamp)

$finalStatus = "FAILED"
$failureText = ""
$transcriptStarted = $false

try {
    Start-Transcript -LiteralPath $transcriptPath -Force | Out-Null
    $transcriptStarted = $true

    Write-Section "TDA — PHYSICAL RECOVERY ACCEPTANCE (pack $PackVersion)"
    Write-Host "Resultados completos locais: $runRoot"
    Write-Host "ZIP sanitizado para enviar: $zipPath"
    Write-Host ""
    Write-Host "IMPORTANTE:" -ForegroundColor Yellow
    Write-Host "- não fecha/edita .env;"
    Write-Host "- não usa áudio privado;"
    Write-Host "- não grava transcripts do ASR;"
    Write-Host "- pode instalar/remover RC 0.3.14 do Companion pelo MSI oficial;"
    Write-Host "- State/Data/Logs/Cache/Models/Runtime são preservados pelo fluxo normal do MSI."
    Write-Host ""
    [void](Read-Host "Pressione ENTER para começar")

    Write-Section "1/5 — INVENTÁRIO DA MÁQUINA"

    $os = Get-CimInstance Win32_OperatingSystem |
        Select-Object Caption, Version, BuildNumber, OSArchitecture, LastBootUpTime
    $computer = Get-CimInstance Win32_ComputerSystem |
        Select-Object Manufacturer, Model, @{n="TotalMemoryGiB";e={[math]::Round($_.TotalPhysicalMemory/1GB,2)}}
    $cpu = Get-CimInstance Win32_Processor |
        Select-Object Name, NumberOfCores, NumberOfLogicalProcessors

    @{
        pack_version = $PackVersion
        collected_at = [DateTimeOffset]::Now.ToString("o")
        powershell = $PSVersionTable.PSVersion.ToString()
        repository = $repo
        port = $Port
        expected_rc = $ExpectedRcTag
        expected_source_sha = $ExpectedSourceSha
        expected_helper_sha = $ExpectedHelperSha
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $metaRoot "run.json") -Encoding UTF8

    $os | Format-List | Out-String | Set-Content -LiteralPath (Join-Path $metaRoot "windows.txt") -Encoding UTF8
    $computer | Format-List | Out-String | Add-Content -LiteralPath (Join-Path $metaRoot "windows.txt") -Encoding UTF8
    $cpu | Format-List | Out-String | Add-Content -LiteralPath (Join-Path $metaRoot "windows.txt") -Encoding UTF8

    if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
        (& nvidia-smi.exe 2>&1) | Set-Content -LiteralPath (Join-Path $metaRoot "nvidia-smi.txt") -Encoding UTF8
        try {
            (& nvidia-smi.exe --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>&1) |
                Set-Content -LiteralPath (Join-Path $metaRoot "gpu-summary.txt") -Encoding UTF8
        } catch {}
    } else {
        "nvidia-smi.exe NOT FOUND" | Set-Content -LiteralPath (Join-Path $metaRoot "nvidia-smi.txt") -Encoding UTF8
        throw "NVIDIA driver/nvidia-smi não encontrado."
    }

    Write-Host "GPU:" -ForegroundColor Green
    Get-Content -LiteralPath (Join-Path $metaRoot "gpu-summary.txt") -ErrorAction SilentlyContinue | Write-Host

    Write-Section "2/5 — ESTADO DO REPOSITÓRIO (SEM MUDAR O WORKTREE)"

    $headLines = @(Invoke-GitText @("-C", $repo, "rev-parse", "HEAD"))
    if ($headLines.Count -lt 1) { throw "GIT_HEAD_EMPTY" }
    $head = ([string]$headLines[-1]).Trim()
    $branch = (@(Invoke-GitText @("-C", $repo, "branch", "--show-current")) -join "").Trim()
    $status = @(Invoke-GitText @("-C", $repo, "status", "--short"))
    $remoteRaw = (@(Invoke-GitText @("-C", $repo, "remote", "get-url", "origin")) -join "").Trim()
    $remoteSafe = $remoteRaw -replace '^(https?://)[^/@]+@', '$1***@'
    $remoteSafe = $remoteSafe -replace '^(ssh://)[^/@]+@', '$1***@'

    @(
        "HEAD=$head"
        "BRANCH=$branch"
        "ORIGIN_SANITIZED=$remoteSafe"
        ""
        "STATUS:"
        $status
    ) | Set-Content -LiteralPath (Join-Path $metaRoot "git-state.txt") -Encoding UTF8

    Write-Host "Seu checkout atual: $head"
    Write-Host "Não vou fazer checkout/reset/pull no seu branch." -ForegroundColor Green

    Write-Host "Buscando somente o ref operacional do PR #455..." -ForegroundColor Cyan
    $fetch = & git.exe -C $repo fetch --no-tags origin "+refs/pull/455/head:refs/tda-acceptance/pr455-head" 2>&1
    $fetch | Set-Content -LiteralPath (Join-Path $metaRoot "git-fetch-pr455.txt") -Encoding UTF8
    if ($LASTEXITCODE -ne 0) {
        throw "Não consegui buscar refs/pull/455/head do GitHub."
    }
    $helperShaLines = @(Invoke-GitText @("-C", $repo, "rev-parse", "refs/tda-acceptance/pr455-head"))
    if ($helperShaLines.Count -lt 1) { throw "GIT_HELPER_SHA_EMPTY" }
    $helperSha = ([string]$helperShaLines[-1]).Trim()
    if ($helperSha -ne $ExpectedHelperSha) {
        throw "PR455_HEAD_UNEXPECTED: esperado $ExpectedHelperSha, recebido $helperSha"
    }

    $paths = @(
        "tools/acceptance/run-recovery-candidate-1585a932.ps1",
        "tools/acceptance/generate-physical-acceptance-fixture.ps1",
        "local-companion/packaging/run-installed-acceptance.ps1",
        "local-companion/packaging/run-physical-acceptance.ps1"
    )
    foreach ($relative in $paths) {
        $destination = Join-Path $harnessRoot ($relative -replace "/", "\")
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        $content = & git.exe -C $repo show "$ExpectedHelperSha`:$relative" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Falha ao extrair $relative do helper fixado." }
        $content -join "`n" | Set-Content -LiteralPath $destination -Encoding UTF8 -NoNewline
    }

    $hashRows = foreach ($relative in $paths) {
        $p = Join-Path $harnessRoot ($relative -replace "/", "\")
        [pscustomobject]@{
            path = $relative
            sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    $hashRows | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $metaRoot "harness-hashes.json") -Encoding UTF8

    $launcher = Join-Path $harnessRoot "tools\acceptance\run-recovery-candidate-1585a932.ps1"
    $launcherOriginalSha = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
    $launcherText = Get-Content -LiteralPath $launcher -Raw -Encoding UTF8

    # Operational helper defect confirmed during the physical attempt:
    # the canonical helper over-escapes braces in the ProductCode regex.
    # Patch ONLY that validator in the isolated copy; never mutate the repo checkout.
    $brokenProductCodeGuard = @'
if ($productCode -notmatch '^\\{[0-9A-Fa-f-]{36}\\}$') {
'@
    $fixedProductCodeGuard = @'
if ($productCode -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
'@
    $patchMatches = ([regex]::Matches(
        $launcherText,
        [regex]::Escape($brokenProductCodeGuard)
    )).Count
    if ($patchMatches -ne 1) {
        throw "HARNESS_PRODUCT_CODE_PATCH_TARGET_INVALID:$patchMatches"
    }
    $launcherText = $launcherText.Replace($brokenProductCodeGuard, $fixedProductCodeGuard)
    $launcherText | Set-Content -LiteralPath $launcher -Encoding UTF8 -NoNewline
    $launcherPatchedSha = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()

    @"
TDA acceptance operational harness patch
========================================

Pack version: $PackVersion
Canonical helper head: $ExpectedHelperSha
File: tools/acceptance/run-recovery-candidate-1585a932.ps1
Original SHA-256: $launcherOriginalSha
Patched SHA-256:  $launcherPatchedSha

Reason:
The canonical helper writes/reads MSI ProductCode as a GUID with braces, but
validated it with an over-escaped .NET regex that required literal backslashes.

Original:
if (`$productCode -notmatch '^\\{[0-9A-Fa-f-]{36}\\}$') {

Patched isolated copy:
if (`$productCode -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {

Scope:
- one validator only;
- candidate tag/source/MSI/payload hashes unchanged;
- repository worktree unchanged;
- receipts remain produced by the exact candidate acceptance flow.
"@ | Set-Content -LiteralPath (Join-Path $metaRoot "OPERATIONAL-HARNESS-PATCH.txt") -Encoding UTF8

    # Reload after the isolated patch for all subsequent policy checks.
    $launcherText = Get-Content -LiteralPath $launcher -Raw -Encoding UTF8
    foreach ($required in @($ExpectedRcTag, $ExpectedSourceSha, $ExpectedMsiSha, $ExpectedPayloadSha)) {
        if (-not $launcherText.Contains($required)) {
            throw "HARNESS_IDENTITY_MISMATCH:$required"
        }
    }
    if ($launcherText.Contains("'^\\{[0-9A-Fa-f-]{36}\\}$'")) {
        throw "HARNESS_PRODUCT_CODE_REGEX_STILL_BROKEN"
    }
    if (-not $launcherText.Contains("'^\{[0-9A-Fa-f-]{36}\}$'")) {
        throw "HARNESS_PRODUCT_CODE_REGEX_FIX_MISSING"
    }
    if ($launcherText -match '(?i)-WriteTranscripts') {
        throw "HARNESS_TRANSCRIPT_MODE_FORBIDDEN"
    }

    Write-Host "Helper PR #455 validado no SHA exato: $helperSha" -ForegroundColor Green

    Write-Section "3/5 — ESTADO INICIAL DO COMPANION"

    try {
        $healthBefore = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        $healthBefore | ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath (Join-Path $metaRoot "agent-health-before.json") -Encoding UTF8
        Write-Host "Agent atual: $($healthBefore.service_version), PID $($healthBefore.pid)"
    } catch {
        "Agent não respondeu antes do teste: $($_.Exception.Message)" |
            Set-Content -LiteralPath (Join-Path $metaRoot "agent-health-before.txt") -Encoding UTF8
        Write-Host "Agent não respondeu antes do teste; o launcher fará a instalação/verificação." -ForegroundColor Yellow
    }

    try {
        $productKey = "HKCU:\Software\Faysk\TDA Companion"
        if (Test-Path -LiteralPath $productKey) {
            $reg = Get-ItemProperty -LiteralPath $productKey
            [pscustomobject]@{
                Version = [string]$reg.Version
                ProductCode = [string]$reg.ProductCode
            } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $metaRoot "companion-registry-before.json") -Encoding UTF8
        }
    } catch {}

    Write-Section "4/5 — ACEITE INSTALADO + RTX 4070 / 4 PERFIS"
    Write-Host "Agora entra a parte interativa." -ForegroundColor Yellow
    Write-Host "Siga EXATAMENTE os prompts na tela."
    Write-Host ""
    Write-Host "Quando chegar ao teste de conflito da porta 8765:"
    Write-Host "  1. finalize somente o Agent conforme o prompt;"
    Write-Host "  2. abra outro PowerShell 7;"
    Write-Host "  3. rode START-PORT-8765-BLOCKER.ps1 deste pack;"
    Write-Host "  4. observe o conflito na UI;"
    Write-Host "  5. volte ao blocker e pressione ENTER para liberar a porta."
    Write-Host ""
    Write-Host "No teste BITS você precisará iniciar um download TDA grande ainda não cacheado,"
    Write-Host "desligar a Internet quando solicitado e religar depois. NÃO inicie um segundo download."
    Write-Host ""
    [void](Read-Host "Pressione ENTER para iniciar o harness oficial")

    & $launcher -OutputRoot $acceptanceRoot -Port $Port
    if ($LASTEXITCODE -ne 0) {
        throw "HARNESS_EXIT_CODE:$LASTEXITCODE"
    }

    Write-Section "5/5 — COLETA FINAL"

    $receiptsSource = Join-Path $acceptanceRoot "receipts"
    if (Test-Path -LiteralPath $receiptsSource) {
        Get-ChildItem -LiteralPath $receiptsSource -File -Recurse |
            Where-Object { $_.Extension -eq ".json" } |
            ForEach-Object {
                Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $receiptCopy $_.Name) -Force
            }
    }

    try {
        $healthAfter = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
        $healthAfter | ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath (Join-Path $metaRoot "agent-health-after.json") -Encoding UTF8
    } catch {
        "Agent não respondeu após o teste: $($_.Exception.Message)" |
            Set-Content -LiteralPath (Join-Path $metaRoot "agent-health-after.txt") -Encoding UTF8
    }

    $finalReceipt = Join-Path $receiptCopy "$ExpectedRcTag.physical.json"
    $installedReceipt = Join-Path $receiptCopy "$ExpectedRcTag.json"
    if (-not (Test-Path -LiteralPath $finalReceipt -PathType Leaf)) {
        throw "PHYSICAL_RECEIPT_NOT_COLLECTED"
    }
    if (-not (Test-Path -LiteralPath $installedReceipt -PathType Leaf)) {
        throw "INSTALLED_RECEIPT_NOT_COLLECTED"
    }

    $physical = Get-Content -LiteralPath $finalReceipt -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64
    $installed = Get-Content -LiteralPath $installedReceipt -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 64
    if ($physical.pass -ne $true -or $installed.pass -ne $true) {
        throw "FINAL_RECEIPTS_NOT_PASS"
    }

    $finalStatus = "PASS"
}
catch {
    $failureText = $_ | Out-String
    Write-Host ""
    Write-Host "TESTE INTERROMPIDO / FALHOU" -ForegroundColor Red
    Write-Host $failureText -ForegroundColor Red
}
finally {
    # Coleta logs de MSI gerados pelo launcher, sem ler .env nem dados privados.
    foreach ($name in @(
        "tda-recovery-1585a932-msi-install.log",
        "tda-recovery-1585a932-superseded-uninstall.log"
    )) {
        Copy-IfExists (Join-Path $env:TEMP $name) $msiLogs
    }

    # Mesmo em falha, coleta os JSON sanitizados já produzidos.
    $receiptsSource = Join-Path $acceptanceRoot "receipts"
    if (Test-Path -LiteralPath $receiptsSource) {
        Get-ChildItem -LiteralPath $receiptsSource -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -eq ".json" } |
            ForEach-Object {
                try { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $receiptCopy $_.Name) -Force } catch {}
            }
    }

    @"
TDA PHYSICAL ACCEPTANCE RESULT
==============================

Status: $finalStatus
When:   $([DateTimeOffset]::Now.ToString("o"))

Expected RC:     $ExpectedRcTag
Expected source: $ExpectedSourceSha
Helper SHA:      $ExpectedHelperSha

Repository used only as Git object source:
$repo

IMPORTANT:
- SEND-THIS contains the evidence intended to be shared.
- _acceptance-private may contain downloaded MSI and synthetic audio; DO NOT send that folder.
- No .env file was collected.
- The official acceptance runs with transcript persistence disabled.

Failure, if any:
$failureText
"@ | Set-Content -LiteralPath $summaryPath -Encoding UTF8

    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
    }

    # Hashes dos artefatos de evidência compartilháveis.
    $manifest = Get-ChildItem -LiteralPath $shareRoot -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName |
        ForEach-Object {
            [pscustomobject]@{
                path = $_.FullName.Substring($shareRoot.Length + 1)
                bytes = $_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    $manifest | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath (Join-Path $shareRoot "EVIDENCE-MANIFEST.json") -Encoding UTF8

    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $shareRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal

    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkGray
    if ($finalStatus -eq "PASS") {
        Write-Host "TDA ACCEPTANCE: PASS" -ForegroundColor Green
    } else {
        Write-Host "TDA ACCEPTANCE: FALHOU / PAROU — O ZIP AINDA FOI GERADO" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "ME MANDE ESTE ARQUIVO:" -ForegroundColor Cyan
    Write-Host $zipPath -ForegroundColor White
    Write-Host ""
    Write-Host "Não envie a pasta _acceptance-private." -ForegroundColor Yellow
    Write-Host ("=" * 78) -ForegroundColor DarkGray
}

if ($finalStatus -ne "PASS") { exit 1 }
exit 0
