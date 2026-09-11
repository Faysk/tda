param(
    [string]$PackageRoot = $PSScriptRoot,
    [switch]$DesktopShortcut
)

$ErrorActionPreference = "Stop"

if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$package = (Resolve-Path $PackageRoot).Path
$versionFile = Join-Path $package "version.txt"
$appSource = Join-Path $package "app"
if (-not (Test-Path $versionFile)) { throw "PACKAGE_VERSION_NOT_FOUND" }
if (-not (Test-Path (Join-Path $appSource "TDACompanion.exe"))) { throw "PACKAGE_EXECUTABLE_NOT_FOUND" }

$version = (Get-Content $versionFile -Raw).Trim()
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "INVALID_PACKAGE_VERSION" }

$running = Get-Process -Name "TDACompanion" -ErrorAction SilentlyContinue
if ($running) {
    throw "TDA_COMPANION_RUNNING: feche o TDA Companion antes de instalar ou atualizar."
}

$tdaRoot = Join-Path $env:LOCALAPPDATA "TDA"
$installRoot = Join-Path $tdaRoot "Companion"
$versionsRoot = Join-Path $installRoot "versions"
$target = Join-Path $versionsRoot $version
$dataRoot = Join-Path $tdaRoot "Data"

New-Item -ItemType Directory -Force -Path $versionsRoot, $dataRoot | Out-Null

$tempTarget = "$target.installing"
Remove-Item $tempTarget -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tempTarget | Out-Null
Copy-Item (Join-Path $appSource "*") $tempTarget -Recurse -Force

if (-not (Test-Path (Join-Path $tempTarget "TDACompanion.exe"))) {
    Remove-Item $tempTarget -Recurse -Force -ErrorAction SilentlyContinue
    throw "INSTALL_COPY_FAILED"
}

Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
Move-Item $tempTarget $target
Set-Content -Path (Join-Path $installRoot "current-version.txt") -Value $version -Encoding ascii -NoNewline

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$startShortcut = Join-Path $startMenu "TDA Companion.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startShortcut)
$shortcut.TargetPath = Join-Path $target "TDACompanion.exe"
$shortcut.WorkingDirectory = $target
$shortcut.Description = "TDA Companion — processamento local"
$shortcut.Save()

if ($DesktopShortcut) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $desktopShortcutPath = Join-Path $desktop "TDA Companion.lnk"
    $desktopLink = $shell.CreateShortcut($desktopShortcutPath)
    $desktopLink.TargetPath = Join-Path $target "TDACompanion.exe"
    $desktopLink.WorkingDirectory = $target
    $desktopLink.Description = "TDA Companion — processamento local"
    $desktopLink.Save()
}

Write-Host "TDA Companion $version instalado com sucesso."
Write-Host "Aplicativo: $target"
Write-Host "Dados:      $dataRoot"
Write-Host "Abra pelo Menu Iniciar: TDA Companion"
Write-Host "O antigo DnDScribeCompanion.exe não foi consultado nem modificado."
