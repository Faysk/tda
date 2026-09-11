param(
    [switch]$RemoveData,
    [switch]$RemoveDesktopShortcut
)

$ErrorActionPreference = "Stop"
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA_NOT_FOUND" }

$running = Get-Process -Name "TDACompanion" -ErrorAction SilentlyContinue
if ($running) {
    throw "TDA_COMPANION_RUNNING: feche o TDA Companion antes de desinstalar."
}

$tdaRoot = Join-Path $env:LOCALAPPDATA "TDA"
$installRoot = Join-Path $tdaRoot "Companion"
$dataRoot = Join-Path $tdaRoot "Data"
$startShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\TDA Companion.lnk"

Remove-Item $startShortcut -Force -ErrorAction SilentlyContinue
if ($RemoveDesktopShortcut) {
    $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "TDA Companion.lnk"
    Remove-Item $desktopShortcut -Force -ErrorAction SilentlyContinue
}
Remove-Item $installRoot -Recurse -Force -ErrorAction SilentlyContinue

if ($RemoveData) {
    Remove-Item $dataRoot -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $tdaRoot) {
        $remaining = Get-ChildItem $tdaRoot -Force -ErrorAction SilentlyContinue
        if (-not $remaining) { Remove-Item $tdaRoot -Force -ErrorAction SilentlyContinue }
    }
    Write-Host "TDA Companion removido, incluindo os dados locais."
} else {
    Write-Host "TDA Companion removido. Dados preservados em: $dataRoot"
}

Write-Host "Nenhum diretório DnDScribe foi consultado ou modificado."
