param(
    [string]$Python = ".venv/Scripts/python.exe",
    [string]$OutputRoot = "local-companion/out/windows"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$pythonPath = if ([IO.Path]::IsPathRooted($Python)) { $Python } else { Join-Path $repoRoot $Python }
$output = if ([IO.Path]::IsPathRooted($OutputRoot)) { $OutputRoot } else { Join-Path $repoRoot $OutputRoot }
$packageSource = Join-Path $repoRoot "local-companion"

if (-not (Test-Path $pythonPath)) {
    throw "PYTHON_NOT_FOUND: $pythonPath"
}

$version = (& $pythonPath -c "import tda_companion; print(tda_companion.VERSION)").Trim()
if (-not $version) { throw "VERSION_NOT_FOUND" }

$work = Join-Path $output "work"
$dist = Join-Path $output "dist"
$packageRoot = Join-Path $output "TDACompanion-$version"
$appRoot = Join-Path $packageRoot "app"

Remove-Item $output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work, $dist, $packageRoot | Out-Null

& $pythonPath -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --windowed `
    --name TDACompanion `
    --paths $packageSource `
    --distpath $dist `
    --workpath $work `
    --specpath $work `
    --collect-submodules uvicorn `
    (Join-Path $PSScriptRoot "windows_entry.py")
if ($LASTEXITCODE -ne 0) { throw "PYINSTALLER_FAILED" }

Copy-Item (Join-Path $dist "TDACompanion") $appRoot -Recurse
Copy-Item (Join-Path $PSScriptRoot "install-windows.ps1") (Join-Path $packageRoot "install.ps1")
Copy-Item (Join-Path $PSScriptRoot "uninstall-windows.ps1") (Join-Path $packageRoot "uninstall.ps1")
Set-Content -Path (Join-Path $packageRoot "version.txt") -Value $version -Encoding ascii -NoNewline

$readme = @"
TDA Companion $version

1. Extraia o pacote para uma pasta local.
2. Execute install.ps1 no PowerShell.
3. Abra "TDA Companion" pelo Menu Iniciar.
4. Copie o token exibido pelo aplicativo.
5. Em https://dnd.faysk.dev/edit/processamento, cole o token e conecte.

Instalação por usuário, sem privilégios administrativos.
Diretório padrão do aplicativo: %LOCALAPPDATA%\TDA\Companion
Diretório padrão de dados:     %LOCALAPPDATA%\TDA\Data

Este aplicativo NÃO usa, inicia, modifica ou depende do antigo DnDScribeCompanion.exe.
"@
Set-Content -Path (Join-Path $packageRoot "README.txt") -Value $readme -Encoding utf8

$zip = Join-Path $output "TDACompanion-$version-windows-x64.zip"
Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zip -CompressionLevel Optimal

Write-Host "TDA Companion package: $packageRoot"
Write-Host "ZIP: $zip"
