$ErrorActionPreference = "Continue"
Import-Module BitsTransfer -ErrorAction SilentlyContinue
Write-Host "BITS jobs do usuário atual relacionados ao TDA:" -ForegroundColor Cyan
Get-BitsTransfer -ErrorAction SilentlyContinue |
    Where-Object {
        $_.DisplayName -match '(?i)TDA|Companion|Qwen|Whisper' -or
        $_.Description -match '(?i)TDA|Companion|Qwen|Whisper'
    } |
    Select-Object JobId, DisplayName, JobState, BytesTransferred, BytesTotal |
    Format-Table -AutoSize
