param(
    [string]$Python = ".venv/Scripts/python.exe",
    [string]$Wix = ".wix/wix.exe",
    [string]$OutputRoot = "local-companion/out/windows",
    [ValidateSet("none", "certificate-store", "artifact-signing")]
    [string]$AuthenticodeProvider = "certificate-store",
    [string]$AuthenticodeThumbprint = "",
    [string]$AuthenticodeTimestampUrl = "",
    [string]$AuthenticodeExpectedSubject = "",
    [string]$AuthenticodeArtifactSigningDlib = "",
    [string]$AuthenticodeArtifactSigningMetadata = "",
    [string]$SignTool = "signtool.exe",
    [switch]$RequireAuthenticode
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$pythonPath = if ([IO.Path]::IsPathRooted($Python)) { $Python } else { Join-Path $repoRoot $Python }
$output = if ([IO.Path]::IsPathRooted($OutputRoot)) { $OutputRoot } else { Join-Path $repoRoot $OutputRoot }
$packageSource = Join-Path $repoRoot "local-companion"

$normalizedProvider = $AuthenticodeProvider.ToLowerInvariant()
$normalizedThumbprint = ($AuthenticodeThumbprint -replace '\s', '').ToUpperInvariant()
$certificateStoreEnabled = (
    $normalizedProvider -eq "certificate-store" -and
    -not [string]::IsNullOrWhiteSpace($normalizedThumbprint)
)
$artifactSigningEnabled = $normalizedProvider -eq "artifact-signing"
$signingEnabled = $certificateStoreEnabled -or $artifactSigningEnabled

if ($normalizedProvider -eq "none" -and (
    -not [string]::IsNullOrWhiteSpace($normalizedThumbprint) -or
    -not [string]::IsNullOrWhiteSpace($AuthenticodeArtifactSigningDlib) -or
    -not [string]::IsNullOrWhiteSpace($AuthenticodeArtifactSigningMetadata)
)) {
    throw "AUTHENTICODE_PROVIDER_ARGUMENT_CONFLICT"
}
if ($normalizedProvider -eq "certificate-store" -and (
    -not [string]::IsNullOrWhiteSpace($AuthenticodeArtifactSigningDlib) -or
    -not [string]::IsNullOrWhiteSpace($AuthenticodeArtifactSigningMetadata)
)) {
    throw "AUTHENTICODE_PROVIDER_ARGUMENT_CONFLICT"
}
if ($artifactSigningEnabled -and -not [string]::IsNullOrWhiteSpace($normalizedThumbprint)) {
    # Artifact Signing uses short-lived managed leaf certificates. A fixed
    # thumbprint is not a stable provider identity and must not be configured.
    throw "AUTHENTICODE_ARTIFACT_SIGNING_THUMBPRINT_UNSUPPORTED"
}
if ($RequireAuthenticode -and -not $signingEnabled) {
    throw "AUTHENTICODE_REQUIRED"
}
if (($RequireAuthenticode -or $artifactSigningEnabled) -and [string]::IsNullOrWhiteSpace($AuthenticodeTimestampUrl)) {
    throw "AUTHENTICODE_TIMESTAMP_REQUIRED"
}
if (($RequireAuthenticode -or $artifactSigningEnabled) -and [string]::IsNullOrWhiteSpace($AuthenticodeExpectedSubject)) {
    throw "AUTHENTICODE_EXPECTED_SUBJECT_REQUIRED"
}
if ($certificateStoreEnabled -and $normalizedThumbprint -notmatch '^[A-F0-9]{40}$') {
    throw "AUTHENTICODE_THUMBPRINT_INVALID"
}
if ($signingEnabled -and $AuthenticodeTimestampUrl) {
    try { $timestampUri = [Uri]$AuthenticodeTimestampUrl } catch { throw "AUTHENTICODE_TIMESTAMP_URL_INVALID" }
    if (-not $timestampUri.IsAbsoluteUri -or $timestampUri.Scheme -notin @("http", "https")) {
        throw "AUTHENTICODE_TIMESTAMP_URL_INVALID"
    }
}

$artifactSigningDlibPath = ""
$artifactSigningMetadataPath = ""

function Resolve-SignToolPath {
    if ([IO.Path]::IsPathRooted($SignTool)) {
        if (-not (Test-Path -LiteralPath $SignTool -PathType Leaf)) { throw "SIGNTOOL_NOT_FOUND" }
        return [IO.Path]::GetFullPath($SignTool)
    }
    try {
        return (Get-Command $SignTool -ErrorAction Stop).Source
    } catch {
        throw "SIGNTOOL_NOT_FOUND"
    }
}

function Resolve-AuthenticodeInputFile([string]$Value, [string]$MissingCode) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw $MissingCode }
    $candidate = if ([IO.Path]::IsPathRooted($Value)) {
        $Value
    } else {
        Join-Path $repoRoot $Value
    }
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw $MissingCode }
    return [IO.Path]::GetFullPath($candidate)
}

function Assert-ArtifactSigningMetadata([string]$Path) {
    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    } catch {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_INVALID"
    }
    if ($item.Length -le 0 -or $item.Length -gt 65536) {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_INVALID"
    }
    try {
        $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    } catch {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_INVALID"
    }
    if ($value -isnot [Collections.IDictionary]) {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_INVALID"
    }

    $allowedKeys = @(
        "Endpoint",
        "CodeSigningAccountName",
        "CertificateProfileName",
        "CorrelationId",
        "ExcludeCredentials"
    )
    foreach ($key in $value.Keys) {
        if ([string]$key -notin $allowedKeys) {
            throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_KEY_INVALID"
        }
    }
    foreach ($required in @("Endpoint", "CodeSigningAccountName", "CertificateProfileName")) {
        if (-not $value.Contains($required) -or [string]::IsNullOrWhiteSpace([string]$value[$required])) {
            throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_INVALID"
        }
    }

    try { $endpoint = [Uri][string]$value["Endpoint"] } catch {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_INVALID"
    }
    if (
        -not $endpoint.IsAbsoluteUri -or
        $endpoint.Scheme -ne "https" -or
        $endpoint.Port -ne 443 -or
        $endpoint.UserInfo -or
        $endpoint.Host -notmatch '^[a-z0-9-]+\.codesigning\.azure\.net$' -or
        $endpoint.AbsolutePath -notin @("", "/") -or
        $endpoint.Query -or
        $endpoint.Fragment
    ) {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_ENDPOINT_INVALID"
    }

    $accountName = [string]$value["CodeSigningAccountName"]
    if (
        $accountName.Length -lt 3 -or
        $accountName.Length -gt 24 -or
        $accountName -notmatch '^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$' -or
        $accountName.Contains("--")
    ) {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_ACCOUNT_INVALID"
    }

    $profileName = [string]$value["CertificateProfileName"]
    if (
        $profileName.Length -lt 5 -or
        $profileName.Length -gt 100 -or
        $profileName -notmatch '^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$' -or
        $profileName.Contains("--")
    ) {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_PROFILE_INVALID"
    }

    if ($value.Contains("CorrelationId")) {
        $correlationId = [string]$value["CorrelationId"]
        if ($correlationId.Length -gt 256 -or $correlationId -match '[\r\n]') {
            throw "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_INVALID"
        }
    }

    if ($value.Contains("ExcludeCredentials")) {
        $allowedCredentials = @(
            "EnvironmentCredential",
            "ManagedIdentityCredential",
            "WorkloadIdentityCredential",
            "SharedTokenCacheCredential",
            "VisualStudioCredential",
            "VisualStudioCodeCredential",
            "AzureCliCredential",
            "AzurePowerShellCredential",
            "AzureDeveloperCliCredential",
            "InteractiveBrowserCredential"
        )
        $rawExcluded = $value["ExcludeCredentials"]
        if (
            $rawExcluded -is [string] -or
            $rawExcluded -isnot [Collections.IEnumerable]
        ) {
            throw "AUTHENTICODE_ARTIFACT_SIGNING_EXCLUDE_CREDENTIALS_INVALID"
        }
        $excluded = @($rawExcluded)
        if ($excluded.Count -gt $allowedCredentials.Count) {
            throw "AUTHENTICODE_ARTIFACT_SIGNING_EXCLUDE_CREDENTIALS_INVALID"
        }
        $seen = @{}
        foreach ($credential in $excluded) {
            $credentialName = [string]$credential
            if ($credentialName -notin $allowedCredentials -or $seen.ContainsKey($credentialName)) {
                throw "AUTHENTICODE_ARTIFACT_SIGNING_EXCLUDE_CREDENTIALS_INVALID"
            }
            $seen[$credentialName] = $true
        }
    }
}

function Assert-ArtifactSigningSignTool([string]$Path) {
    try {
        $versionText = [string](Get-Item -LiteralPath $Path -ErrorAction Stop).VersionInfo.FileVersion
        $match = [regex]::Match($versionText, '\d+\.\d+\.\d+\.\d+')
        if (-not $match.Success) { throw "version" }
        $actual = [Version]$match.Value
    } catch {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_SIGNTOOL_VERSION_INVALID"
    }
    if ($actual -lt [Version]"10.0.2261.755") {
        throw "AUTHENTICODE_ARTIFACT_SIGNING_SIGNTOOL_TOO_OLD"
    }
}

if ($artifactSigningEnabled) {
    $artifactSigningDlibPath = Resolve-AuthenticodeInputFile $AuthenticodeArtifactSigningDlib "AUTHENTICODE_ARTIFACT_SIGNING_DLIB_REQUIRED"
    $artifactSigningMetadataPath = Resolve-AuthenticodeInputFile $AuthenticodeArtifactSigningMetadata "AUTHENTICODE_ARTIFACT_SIGNING_METADATA_REQUIRED"
    [void](Assert-ArtifactSigningMetadata $artifactSigningMetadataPath)
    $artifactSignTool = Resolve-SignToolPath
    [void](Assert-ArtifactSigningSignTool $artifactSignTool)
}

function Assert-AuthenticodeIdentity([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ([string]$signature.Status -ne "Valid" -or $null -eq $signature.SignerCertificate) {
        throw "AUTHENTICODE_SIGNATURE_INVALID:$([IO.Path]::GetFileName($Path)):$($signature.Status)"
    }
    $actualThumbprint = ([string]$signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
    if ($certificateStoreEnabled -and $actualThumbprint -ne $normalizedThumbprint) {
        throw "AUTHENTICODE_SIGNER_THUMBPRINT_MISMATCH:$([IO.Path]::GetFileName($Path))"
    }
    if (
        $AuthenticodeExpectedSubject -and
        [string]$signature.SignerCertificate.Subject -ne $AuthenticodeExpectedSubject
    ) {
        throw "AUTHENTICODE_SIGNER_SUBJECT_MISMATCH:$([IO.Path]::GetFileName($Path))"
    }
    if ($AuthenticodeTimestampUrl -and $null -eq $signature.TimeStamperCertificate) {
        throw "AUTHENTICODE_TIMESTAMP_MISSING:$([IO.Path]::GetFileName($Path))"
    }

    $signToolPath = Resolve-SignToolPath
    & $signToolPath verify /pa /all /v $Path
    if ($LASTEXITCODE -ne 0) {
        throw "AUTHENTICODE_TRUST_VERIFY_FAILED:$([IO.Path]::GetFileName($Path))"
    }
    return $signature
}

function Invoke-AuthenticodeSign([string]$Path) {
    if (-not $signingEnabled) { return }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "AUTHENTICODE_TARGET_MISSING:$([IO.Path]::GetFileName($Path))"
    }

    $signToolPath = Resolve-SignToolPath
    if ($certificateStoreEnabled) {
        $arguments = @("sign", "/sha1", $normalizedThumbprint, "/fd", "SHA256")
        if ($AuthenticodeTimestampUrl) {
            $arguments += @("/tr", $AuthenticodeTimestampUrl, "/td", "SHA256")
        }
        $arguments += @("/v", $Path)
    } elseif ($artifactSigningEnabled) {
        $arguments = @(
            "sign",
            "/fd", "SHA256",
            "/tr", $AuthenticodeTimestampUrl,
            "/td", "SHA256",
            "/dlib", $artifactSigningDlibPath,
            "/dmdf", $artifactSigningMetadataPath,
            "/v",
            "/debug",
            $Path
        )
    } else {
        throw "AUTHENTICODE_PROVIDER_INVALID"
    }

    & $signToolPath @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "AUTHENTICODE_SIGN_FAILED:$([IO.Path]::GetFileName($Path))"
    }
    [void](Assert-AuthenticodeIdentity $Path)
}

if (-not (Test-Path $pythonPath)) {
    throw "PYTHON_NOT_FOUND: $pythonPath"
}

$wixPath = if ([IO.Path]::IsPathRooted($Wix)) {
    $Wix
} elseif (Test-Path (Join-Path $repoRoot $Wix)) {
    Join-Path $repoRoot $Wix
} else {
    (Get-Command $Wix -ErrorAction Stop).Source
}
if (-not (Test-Path $wixPath)) {
    throw "WIX_NOT_FOUND: $wixPath"
}

$version = (& $pythonPath -c "import tda_companion; print(tda_companion.VERSION)").Trim()
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "VERSION_NOT_FOUND" }
$runtimeVersions = (& $pythonPath -c "from tda_companion.rc_runtime_artifacts import RC_WHISPER_VERSION, RC_QWEN_VERSION; print(f'{RC_WHISPER_VERSION}|{RC_QWEN_VERSION}')").Trim().Split('|')
if ($runtimeVersions.Count -ne 2) { throw "RC_RUNTIME_VERSIONS_NOT_FOUND" }
$whisperRuntimeVersion = $runtimeVersions[0]
$qwenRuntimeVersion = $runtimeVersions[1]
foreach ($runtimeVersion in @($whisperRuntimeVersion, $qwenRuntimeVersion)) {
    if ($runtimeVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "RC_RUNTIME_VERSION_INVALID" }
}

$work = Join-Path $output "work"
$dist = Join-Path $output "dist"
$maintenanceDist = Join-Path $output "maintenance-dist"
$packageRoot = Join-Path $output "TDACompanion-$version"
$appRoot = Join-Path $packageRoot "app"
$metadataRoot = Join-Path $output "metadata"

Remove-Item $output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work, $dist, $maintenanceDist, $packageRoot, $metadataRoot | Out-Null

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
    --collect-data tda_companion `
    --collect-all webview `
    --collect-submodules pystray `
    (Join-Path $PSScriptRoot "windows_entry.py")
if ($LASTEXITCODE -ne 0) { throw "PYINSTALLER_FAILED" }

Copy-Item (Join-Path $dist "TDACompanion") $appRoot -Recurse

& $pythonPath -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --windowed `
    --name TDACompanionMaintenance `
    --distpath $maintenanceDist `
    --workpath (Join-Path $work "maintenance") `
    --specpath (Join-Path $work "maintenance") `
    (Join-Path $PSScriptRoot "maintenance_secure_entry.py")
if ($LASTEXITCODE -ne 0) { throw "MAINTENANCE_PYINSTALLER_FAILED" }
$maintenanceExe = Join-Path $maintenanceDist "TDACompanionMaintenance.exe"
if (-not (Test-Path $maintenanceExe)) { throw "MAINTENANCE_EXE_NOT_CREATED" }
Copy-Item $maintenanceExe (Join-Path $appRoot "TDACompanionMaintenance.exe")
Copy-Item (Join-Path $PSScriptRoot "run-physical-acceptance.ps1") (Join-Path $appRoot "run-physical-acceptance.ps1")
Copy-Item (Join-Path $PSScriptRoot "run-installed-acceptance.ps1") (Join-Path $appRoot "run-installed-acceptance.ps1")
Copy-Item (Join-Path $PSScriptRoot "install-rc-runtimes.ps1") (Join-Path $appRoot "install-rc-runtimes.ps1")

# Sign executable payload bytes before ZIP/MSI construction so every later hash,
# manifest and physical receipt refers to the signed binaries.
Invoke-AuthenticodeSign (Join-Path $appRoot "TDACompanion.exe")
Invoke-AuthenticodeSign (Join-Path $appRoot "TDACompanionMaintenance.exe")

Copy-Item (Join-Path $PSScriptRoot "install-windows.ps1") (Join-Path $packageRoot "install.ps1")
Copy-Item (Join-Path $PSScriptRoot "uninstall-windows.ps1") (Join-Path $packageRoot "uninstall.ps1")
Set-Content -Path (Join-Path $packageRoot "version.txt") -Value $version -Encoding ascii -NoNewline
Set-Content -Path (Join-Path $metadataRoot "current-version.txt") -Value $version -Encoding ascii -NoNewline

$readme = @"
TDA Companion $version

Instalação recomendada: execute TDACompanion-x64.msi.

Alternativa portátil/manual:
1. Extraia este pacote para uma pasta local.
2. Execute install.ps1 no PowerShell.
3. Abra "TDA Companion" pelo Menu Iniciar.
4. A interface Desktop usa WebView2 e mantém o Agent em segundo plano.
5. Em https://dnd.faysk.dev/edit/processamento, conecte o Companion quando necessário.

Instalação por usuário, sem privilégios administrativos.
Diretório do aplicativo: %LOCALAPPDATA%\TDA\Companion\versions\$version
Diretório de dados:      %LOCALAPPDATA%\TDA\Data

Preparação de runtimes para teste RC sem publicar releases stable:
1. Baixe os artifacts validados `TDAWhisperRuntime-windows-x64` e `TDAQwenRuntimeBundle-windows-x64` do GitHub Actions.
2. Obtenha o digest SHA-256 informado pelo GitHub para cada artifact e use apenas os 64 caracteres hexadecimais, sem o prefixo `sha256:`.
3. Execute o helper instalado, por exemplo:

& app\install-rc-runtimes.ps1 `
  -WhisperArtifact "C:\artifacts\TDAWhisperRuntime-windows-x64.zip" `
  -WhisperArtifactSha256 "<sha256-do-artifact-whisper>" `
  -QwenArtifact "C:\artifacts\TDAQwenRuntimeBundle-windows-x64.zip" `
  -QwenArtifactSha256 "<sha256-do-artifact-qwen>"

O helper verifica primeiro o SHA-256 externo do artifact e, em seguida, os hashes/tamanhos internos do runtime antes da instalação. Este build aceita exatamente Whisper $whisperRuntimeVersion e Qwen $qwenRuntimeVersion no fluxo RC. Python, CUDA Toolkit e PATH globais não são modificados.

Depois, app\run-physical-acceptance.ps1 executa o gate físico local dos perfis ASR sem enviar áudio ao cloud. Os modelos pinados são materializados separadamente em Models na primeira execução. Por padrão o gate grava somente receipts sanitizados; transcrições exigem -WriteTranscripts explícito.

Para o aceite da jornada Desktop instalada, use app\run-installed-acceptance.ps1 com o MSI candidato, o source SHA do candidato e um Craig ZIP real. O roteiro não executa ações destrutivas automaticamente: recovery do Agent, conflito da porta, X/tray e preservação da sessão Craig exigem observação física explícita antes de o próprio EXE instalado emitir o receipt sanitizado.

O token, a fila e os dados locais não são removidos durante atualização do aplicativo.
Este aplicativo NÃO usa, inicia, modifica ou depende do antigo DnDScribeCompanion.exe.
"@
Set-Content -Path (Join-Path $packageRoot "README.txt") -Value $readme -Encoding utf8

$zip = Join-Path $output "TDACompanion-$version-windows-x64.zip"
Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zip -CompressionLevel Optimal

$wxs = Join-Path $PSScriptRoot "TDACompanion.wxs"
$msi = Join-Path $output "TDACompanion-x64.msi"
& $wixPath build `
    $wxs `
    -arch x64 `
    -d "Version=$version" `
    -d "RollbackProbe=0" `
    -bindpath "App=$appRoot" `
    -bindpath "Metadata=$metadataRoot" `
    -pdbtype none `
    -o $msi
if ($LASTEXITCODE -ne 0) { throw "WIX_BUILD_FAILED" }
if (-not (Test-Path $msi)) { throw "MSI_NOT_CREATED" }

# Test-only MSI: identical payload/version, but with a Type 19 failure scheduled
# immediately after RemoveExistingProducts. It is never uploaded or published.
$rollbackProbeMsi = Join-Path $output "TDACompanion-rollback-probe-x64.msi"
& $wixPath build `
    $wxs `
    -arch x64 `
    -d "Version=$version" `
    -d "RollbackProbe=1" `
    -bindpath "App=$appRoot" `
    -bindpath "Metadata=$metadataRoot" `
    -pdbtype none `
    -o $rollbackProbeMsi
if ($LASTEXITCODE -ne 0) { throw "WIX_ROLLBACK_PROBE_BUILD_FAILED" }
if (-not (Test-Path $rollbackProbeMsi)) { throw "ROLLBACK_PROBE_MSI_NOT_CREATED" }

# Rollback-probe MSI is test-only and never published. Sign only the real MSI,
# then hash it so candidate metadata binds to the final signed bytes.
Invoke-AuthenticodeSign $msi

$msiHash = (Get-FileHash -Algorithm SHA256 $msi).Hash.ToLowerInvariant()
Set-Content -Path (Join-Path $output "TDACompanion-x64.msi.sha256") -Value "$msiHash  TDACompanion-x64.msi" -Encoding ascii -NoNewline

Write-Host "TDA Companion package: $packageRoot"
Write-Host "ZIP: $zip"
Write-Host "MSI: $msi"
Write-Host "Rollback probe MSI (test-only): $rollbackProbeMsi"
Write-Host "MSI SHA256: $msiHash"
Write-Host "Authenticode: $($signingEnabled ? "signed + verified" : "not configured")"
Write-Host "Authenticode provider: $($signingEnabled ? $normalizedProvider : "none")"
if ($certificateStoreEnabled) {
    Write-Host "Configured signer thumbprint: $normalizedThumbprint"
}
