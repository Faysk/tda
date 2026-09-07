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
# Deliberately no execute/install switch. A future installer must implement this plan.
[ordered]@{
    schema_version = 'tda_install_plan_v1'
    mode = 'dry-run-only'
    version = '0.1.0'
    install_root = $install
    data_root = $data
    privileges = 'current-user'
    runtime = 'Python 3.12.13 (existing isolated runtime; no download)'
    operations = @('Verify package SHA256', 'Create versioned environment', 'Provision user-only token ACL', 'Run synthetic health and lifecycle checks', 'Select version explicitly')
    automatic_startup = $false
    registry_changes = $false
    service_installation = $false
    legacy_process_changes = $false
    rollback = 'Stop only this instance gracefully; select prior version and its compatible data snapshot; preserve current data and legacy roots'
} | ConvertTo-Json -Depth 5
