$ErrorActionPreference = "Stop"

$Repo = "Faysk/tda"

Write-Host "`n=== ATUALIZANDO REPOSITÓRIO ===" -ForegroundColor Cyan

git fetch origin --prune '+refs/heads/*:refs/remotes/origin/*'

# Branches que NUNCA serão apagadas
$Protected = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)

[void]$Protected.Add("main")
[void]$Protected.Add("Preview")

# Protege heads e bases de TODAS as PRs abertas agora
$OpenPRs = gh pr list `
    --repo $Repo `
    --state open `
    --limit 200 `
    --json number,headRefName,baseRefName |
    ConvertFrom-Json

foreach ($pr in $OpenPRs) {
    if ($pr.headRefName) { [void]$Protected.Add($pr.headRefName) }
    if ($pr.baseRefName) { [void]$Protected.Add($pr.baseRefName) }
}

Write-Host "`n=== PROTEGIDAS ===" -ForegroundColor Green

$Protected | Sort-Object | ForEach-Object {
    Write-Host "KEEP   $_"
}

$Branches = git for-each-ref `
    --format='%(refname:short)' `
    refs/remotes/origin |
    ForEach-Object { $_ -replace '^origin/', '' } |
    Where-Object { $_ -and $_ -ne "HEAD" } |
    Sort-Object -Unique

$Deleted = @()
$Skipped = @()

Write-Host "`n=== INICIANDO LIMPEZA ===" -ForegroundColor Yellow

foreach ($Branch in $Branches) {

    if ($Protected.Contains($Branch)) {
        continue
    }

    $MergedInto = $null

    # Está completamente contida em main?
    git merge-base --is-ancestor `
        "refs/remotes/origin/$Branch" `
        "refs/remotes/origin/main" 2>$null

    if ($LASTEXITCODE -eq 0) {
        $MergedInto = "main"
    }
    else {
        # Ou completamente contida em Preview?
        git merge-base --is-ancestor `
            "refs/remotes/origin/$Branch" `
            "refs/remotes/origin/Preview" 2>$null

        if ($LASTEXITCODE -eq 0) {
            $MergedInto = "Preview"
        }
    }

    if (-not $MergedInto) {
        $Skipped += $Branch
        continue
    }

    # SHA exato que auditamos
    $ExpectedSha = (
        git rev-parse "refs/remotes/origin/$Branch"
    ).Trim()

    Write-Host "DELETE  $Branch  [$MergedInto]" -ForegroundColor Red

    # Só apaga se a branch remota AINDA estiver exatamente nesse SHA.
    # Se alguém tiver enviado commit novo enquanto rodamos,
    # o --force-with-lease bloqueia a deleção.
    git push `
        --force-with-lease="refs/heads/${Branch}:$ExpectedSha" `
        origin `
        ":refs/heads/$Branch"

    if ($LASTEXITCODE -eq 0) {
        $Deleted += $Branch
    }
    else {
        Write-Warning "Não apagada: $Branch"
        $Skipped += $Branch
    }
}

Write-Host "`n=== PRUNE FINAL ===" -ForegroundColor Cyan

git fetch origin --prune

Write-Host "`n=== RESULTADO ===" -ForegroundColor Cyan
Write-Host "Apagadas: $($Deleted.Count)" -ForegroundColor Green
Write-Host "Mantidas/não absorvidas: $($Skipped.Count)" -ForegroundColor Yellow

Write-Host "`n=== BRANCHES REMOTAS QUE SOBRARAM ===" -ForegroundColor Cyan

git for-each-ref `
    --format='%(refname:short)' `
    refs/remotes/origin |
    ForEach-Object { $_ -replace '^origin/', '' } |
    Where-Object { $_ -and $_ -ne "HEAD" } |
    Sort-Object