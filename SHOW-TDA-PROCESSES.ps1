$ErrorActionPreference = "Continue"
Write-Host "Processos relacionados ao TDA/Companion:" -ForegroundColor Cyan
Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -match '(?i)TDA|Companion' -or
        $_.CommandLine -match '(?i)TDA|Companion'
    } |
    Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine |
    Format-List
