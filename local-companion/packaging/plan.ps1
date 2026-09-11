param(
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][string]$DataRoot
)
$ErrorActionPreference = 'Stop'
$install = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\','/')
$data = [IO.Path]::GetFullPath($DataRoot).TrimEnd('\','/')
if ($install -eq $data -or $data.StartsWith($install + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $install.StartsWith($data + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'INSTALL_AND_DATA_MUST_BE_SEPARATE'
}
[ordered]@{
    schema_version = 'tda_install_plan_v1'
    mode = 'per-user-versioned-bundle'
    version = '0.2.0'
    install_root = $install
    data_root = $data
    privileges = 'current-user'
    runtime = 'Self-contained PyInstaller onedir bundle built with Python 3.12.13'
    operations = @('Verify package layout', 'Install versioned bundle', 'Create Start Menu shortcut', 'Generate user-only pairing token on first launch', 'Run loopback HTTP supervisor')
    automatic_startup = $false
    registry_changes = $false
    service_installation = $false
    legacy_dependency = $false
    legacy_process_changes = $false
    rollback = 'Close this instance; select/reinstall a prior TDA Companion bundle; preserve TDA data root unless removal is explicit'
} | ConvertTo-Json -Depth 5
