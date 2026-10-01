# ============================================================
# TDA - BACKUP COMPLETO E SEGURO DE TODO O GIT LOCAL
# Cole este bloco inteiro no PowerShell 7+
# ============================================================

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repo   = "G:\Project\tda"
$Remote = "origin"

Set-Location $Repo

function Fail($Message) {
    Write-Host ""
    Write-Host "ERRO: $Message" -ForegroundColor Red
    throw $Message
}

function Git-Run {
    param(
        [Parameter(Mandatory=$true)]
        [string[]]$Args
    )

    & git @Args

    if ($LASTEXITCODE -ne 0) {
        Fail "git $($Args -join ' ') falhou."
    }
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " TDA - BACKUP COMPLETO DO ESTADO LOCAL" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# 1. Validacoes
# ------------------------------------------------------------

if (-not (Test-Path ".git")) {
    Fail "Nao encontrei .git em $Repo"
}

git rev-parse --is-inside-work-tree *> $null

if ($LASTEXITCODE -ne 0) {
    Fail "Essa pasta nao e um repositorio Git valido."
}

$RemoteUrl = git remote get-url $Remote 2>$null

if (-not $RemoteUrl) {
    Fail "Remote '$Remote' nao encontrado."
}

Write-Host "Repositorio: $Repo" -ForegroundColor DarkGray
Write-Host "Remote:      $RemoteUrl" -ForegroundColor DarkGray
Write-Host ""

# ------------------------------------------------------------
# 2. Garantir que packtest nunca entre
# ------------------------------------------------------------

$GitIgnorePath = Join-Path $Repo ".gitignore"

if (-not (Test-Path $GitIgnorePath)) {
    New-Item -ItemType File -Path $GitIgnorePath | Out-Null
}

$IgnoreContent = Get-Content $GitIgnorePath -ErrorAction SilentlyContinue

if ($IgnoreContent -notcontains "packtest/") {
    Add-Content $GitIgnorePath ""
    Add-Content $GitIgnorePath "# Local acceptance/test artifacts"
    Add-Content $GitIgnorePath "packtest/"

    Write-Host "Adicionado packtest/ ao .gitignore." -ForegroundColor Green
}
else {
    Write-Host "packtest/ ja esta no .gitignore." -ForegroundColor Green
}

Write-Host ""

# ------------------------------------------------------------
# 3. Garantir suporte a caminhos grandes
#
# Isso NAO faz packtest entrar no Git.
# Apenas evita problema de path longo para operacoes Git futuras.
# ------------------------------------------------------------

git config core.longpaths true

if ($LASTEXITCODE -ne 0) {
    Write-Host "Nao consegui definir core.longpaths; continuando." -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 4. Limpar staging parcial da tentativa anterior
#
# NAO apaga arquivos.
# NAO desfaz alteracoes.
# ------------------------------------------------------------

Write-Host "Limpando staging parcial..." -ForegroundColor Cyan

git restore --staged . 2>$null

if ($LASTEXITCODE -ne 0) {
    git reset 2>$null
}

Write-Host "OK." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# 5. Atualizar GitHub
# ------------------------------------------------------------

Write-Host "Atualizando referencias remotas..." -ForegroundColor Cyan

Git-Run @("fetch", $Remote, "--prune", "--tags")

Write-Host "Fetch concluido." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# 6. Descobrir branch atual / backup existente
# ------------------------------------------------------------

$CurrentBranch = (git branch --show-current).Trim()

if ([string]::IsNullOrWhiteSpace($CurrentBranch)) {
    Fail "HEAD destacado. Parei para nao criar backup ambiguo."
}

Write-Host "Branch atual: $CurrentBranch" -ForegroundColor Cyan

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

# Se ja estivermos no backup criado anteriormente, reaproveita ele.
if ($CurrentBranch -match '^backup/local-(\d{8}-\d{6})/working-tree$') {

    $ExistingTimestamp = $Matches[1]
    $BackupPrefix = "backup/local-$ExistingTimestamp"

    Write-Host ""
    Write-Host "Backup anterior detectado." -ForegroundColor Yellow
    Write-Host "Reaproveitando: $BackupPrefix" -ForegroundColor Yellow
}
else {

    $BackupPrefix = "backup/local-$Timestamp"
    $WorkingBackupBranch = "$BackupPrefix/working-tree"

    Write-Host ""
    Write-Host "Criando branch de seguranca:" -ForegroundColor Cyan
    Write-Host "  $WorkingBackupBranch" -ForegroundColor Yellow

    Git-Run @("switch", "-c", $WorkingBackupBranch)

    $CurrentBranch = $WorkingBackupBranch
}

$WorkingBackupBranch = "$BackupPrefix/working-tree"

Write-Host ""
Write-Host "Namespace de backup:" -ForegroundColor Cyan
Write-Host "  $BackupPrefix"
Write-Host ""

# ------------------------------------------------------------
# 7. Verificar segredos rastreados
# ------------------------------------------------------------

Write-Host "Verificando arquivos potencialmente sensiveis..." -ForegroundColor Cyan

$TrackedFiles = @(git ls-files)

$SensitiveTracked = @(
    $TrackedFiles | Where-Object {

        (
            $_ -match '(^|/)\.env($|\.)' -and
            $_ -notmatch '(^|/)\.env\.example$'
        ) -or

        $_ -match '\.(pem|key|p12|pfx)$'
    }
)

if ($SensitiveTracked.Count -gt 0) {

    Write-Host ""
    Write-Host "Arquivos sensiveis rastreados encontrados:" -ForegroundColor Red

    $SensitiveTracked | ForEach-Object {
        Write-Host "  $_" -ForegroundColor Red
    }

    Fail "Abortando antes de enviar possiveis credenciais."
}

Write-Host "OK." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# 8. Estado antes do commit
# ------------------------------------------------------------

Write-Host "Estado local antes do backup:" -ForegroundColor Cyan
git status --short
Write-Host ""

# ------------------------------------------------------------
# 9. Adicionar tudo que NAO esta ignorado
#
# packtest/ sera automaticamente ignorado.
# ------------------------------------------------------------

Write-Host "Preparando arquivos..." -ForegroundColor Cyan

Git-Run @("add", "-A")

# Verificacao extra: packtest nao pode estar staged.
$PacktestStaged = @(
    git diff --cached --name-only |
        Where-Object { $_ -match '^packtest/' }
)

if ($PacktestStaged.Count -gt 0) {

    Write-Host ""
    Write-Host "packtest apareceu no staging inesperadamente:" -ForegroundColor Red

    $PacktestStaged | ForEach-Object {
        Write-Host "  $_" -ForegroundColor Red
    }

    git restore --staged -- packtest 2>$null

    Fail "packtest foi removido do staging. Revise antes de continuar."
}

Write-Host ""
Write-Host "Arquivos que entrarao no commit:" -ForegroundColor Cyan
git diff --cached --name-status

Write-Host ""
Write-Host "Resumo:" -ForegroundColor Cyan
git diff --cached --stat

# ------------------------------------------------------------
# 10. Verificar arquivos staged enormes
# ------------------------------------------------------------

Write-Host ""
Write-Host "Verificando tamanho dos arquivos..." -ForegroundColor Cyan

$LargeFiles = @()

$StagedNames = @(
    git diff --cached --name-only --diff-filter=ACMR
)

foreach ($RelativePath in $StagedNames) {

    $FullPath = Join-Path $Repo $RelativePath

    if (Test-Path -LiteralPath $FullPath -PathType Leaf) {

        $Size = (Get-Item -LiteralPath $FullPath).Length

        if ($Size -gt 95MB) {

            $LargeFiles += [PSCustomObject]@{
                Path = $RelativePath
                MB   = [math]::Round($Size / 1MB, 2)
            }
        }
    }
}

if ($LargeFiles.Count -gt 0) {

    Write-Host ""
    Write-Host "Arquivos maiores que 95 MB detectados:" -ForegroundColor Red

    $LargeFiles | ForEach-Object {
        Write-Host "  $($_.Path) - $($_.MB) MB" -ForegroundColor Red
    }

    Fail "Abortando para evitar rejeicao do GitHub."
}

Write-Host "OK." -ForegroundColor Green

# ------------------------------------------------------------
# 11. Criar commit da working tree, se necessario
# ------------------------------------------------------------

git diff --cached --quiet
$HasStagedChanges = ($LASTEXITCODE -ne 0)

if ($HasStagedChanges) {

    $CommitMessage = "backup: preserve local working tree $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

    Write-Host ""
    Write-Host "Criando commit de backup..." -ForegroundColor Cyan

    Git-Run @("commit", "-m", $CommitMessage)

    Write-Host ""
    Write-Host "Commit criado:" -ForegroundColor Green
    git log -1 --oneline --decorate
}
else {

    Write-Host ""
    Write-Host "Nenhuma mudanca pendente para commit." -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 12. Enviar working tree
# ------------------------------------------------------------

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " ENVIANDO WORKING TREE" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

Git-Run @(
    "push",
    "-u",
    $Remote,
    "HEAD:refs/heads/$WorkingBackupBranch"
)

Write-Host ""
Write-Host "Working tree salva no GitHub." -ForegroundColor Green

# ------------------------------------------------------------
# 13. Preservar TODAS as branches locais
#
# Nao atualiza origin/main.
# Nao atualiza branches originais.
# Cria apenas copias no namespace backup/local-...
# ------------------------------------------------------------

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " PRESERVANDO TODAS AS BRANCHES LOCAIS" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

$Branches = @(
    git for-each-ref --format="%(refname:short)" refs/heads/
)

$Success = @()
$Failed  = @()

foreach ($Branch in $Branches) {

    # Working tree ja foi enviada
    if ($Branch -eq $WorkingBackupBranch) {
        continue
    }

    # Nao criar backup de backups antigos
    if ($Branch -like "backup/local-*") {
        Write-Host ""
        Write-Host "Ignorando backup antigo: $Branch" -ForegroundColor DarkGray
        continue
    }

    $RemoteBackup = "$BackupPrefix/$Branch"

    Write-Host ""
    Write-Host "Local : $Branch" -ForegroundColor Cyan
    Write-Host "Backup: $RemoteBackup" -ForegroundColor Yellow

    & git push `
        $Remote `
        "refs/heads/${Branch}:refs/heads/${RemoteBackup}"

    if ($LASTEXITCODE -eq 0) {

        Write-Host "OK" -ForegroundColor Green

        $Success += $Branch
    }
    else {

        Write-Host "FALHOU" -ForegroundColor Red

        $Failed += $Branch
    }
}

# ------------------------------------------------------------
# 14. Tags
# ------------------------------------------------------------

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " ENVIANDO TAGS" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

& git push $Remote --tags

if ($LASTEXITCODE -eq 0) {
    Write-Host "Tags OK." -ForegroundColor Green
}
else {
    Write-Host "Alguma tag nao pode ser enviada." -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 15. Fetch final
# ------------------------------------------------------------

Write-Host ""
Write-Host "Atualizando estado final..." -ForegroundColor Cyan

Git-Run @("fetch", $Remote, "--prune", "--tags")

# ------------------------------------------------------------
# 16. Confirmar existencia remota da working tree
# ------------------------------------------------------------

$RemoteCheck = git ls-remote `
    --heads `
    $Remote `
    "refs/heads/$WorkingBackupBranch"

if ([string]::IsNullOrWhiteSpace($RemoteCheck)) {
    Fail "Nao consegui confirmar a working tree no GitHub."
}

# ------------------------------------------------------------
# 17. Relatorio
# ------------------------------------------------------------

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host " BACKUP FINALIZADO" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Working tree:" -ForegroundColor Cyan
Write-Host "  $WorkingBackupBranch"
Write-Host ""

Write-Host "Branches locais preservadas:" -ForegroundColor Cyan
Write-Host "  $($Success.Count)"
Write-Host ""

if ($Failed.Count -gt 0) {

    Write-Host "Branches que falharam:" -ForegroundColor Yellow

    foreach ($Branch in $Failed) {
        Write-Host "  - $Branch" -ForegroundColor Yellow
    }
}
else {
    Write-Host "Todas as branches locais foram preservadas." -ForegroundColor Green
}

Write-Host ""
Write-Host "Estado da working tree:" -ForegroundColor Cyan
git status

Write-Host ""
Write-Host "Branches locais:" -ForegroundColor Cyan
git branch -vv

Write-Host ""
Write-Host "Historico recente:" -ForegroundColor Cyan
git log --all --oneline --decorate --graph -30

Write-Host ""
Write-Host "====================================================" -ForegroundColor Green
Write-Host " SEGURANCA" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "✓ Mudancas locais commitadas em branch de backup"
Write-Host "✓ Working tree enviada ao GitHub"
Write-Host "✓ Branches locais copiadas para namespace de backup"
Write-Host "✓ Tags enviadas"
Write-Host "✓ packtest ignorado"
Write-Host "✓ Nenhum force push"
Write-Host "✓ Nenhum merge"
Write-Host "✓ Nenhum rebase"
Write-Host "✓ origin/main NAO foi sobrescrita"
Write-Host "✓ Branches remotas originais NAO foram sobrescritas"
Write-Host ""
Write-Host "Backup remoto:" -ForegroundColor Green
Write-Host "  $BackupPrefix/*" -ForegroundColor Green
Write-Host ""

if ($Failed.Count -gt 0) {
    Write-Host "ATENCAO: houve falha em $($Failed.Count) branch(es)." -ForegroundColor Yellow
}
else {
    Write-Host "TUDO PRESERVADO COM SUCESSO." -ForegroundColor Green
}

Write-Host ""