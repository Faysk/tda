param(
    [string]$OutputRoot = (Join-Path $env:TEMP "tda-physical-acceptance-fixture"),
    [ValidateRange(65, 180)]
    [int]$TargetSeconds = 80
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$FlacFixtureBase64 = "ZkxhQwAAACIEgASAAAALAAANA+gA8AAAD6BYEBJJx2tzW9dM5TArAJMXhAAALAwAAABMYXZmNjEuNy4xMDMBAAAAFAAAAGVuY29kZXI9TGF2ZjYxLjcuMTAz//g1CAADAAAAakT/+DUIAQQAAAAGPP/4NQgCDQAAALK0//h1CAMCHz0AAAC/ig=="
$FlacFixtureSha256 = "de19f01df8995d8841b27397dcaa034a03936a45779886a66b3330781ecf48f1"

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Release-ComObject([object]$Value) {
    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
    }
}

function Get-WavDurationSeconds([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        $ascii = [Text.Encoding]::ASCII
        if ($ascii.GetString($reader.ReadBytes(4)) -ne "RIFF") { throw "FIXTURE_WAV_RIFF_INVALID" }
        [void]$reader.ReadUInt32()
        if ($ascii.GetString($reader.ReadBytes(4)) -ne "WAVE") { throw "FIXTURE_WAV_WAVE_INVALID" }

        [uint32]$byteRate = 0
        [uint32]$dataSize = 0
        while ($stream.Position + 8 -le $stream.Length) {
            $chunkId = $ascii.GetString($reader.ReadBytes(4))
            $chunkSize = $reader.ReadUInt32()
            $chunkStart = $stream.Position
            if ($chunkId -eq "fmt ") {
                if ($chunkSize -lt 16) { throw "FIXTURE_WAV_FMT_INVALID" }
                [void]$reader.ReadUInt16()
                [void]$reader.ReadUInt16()
                [void]$reader.ReadUInt32()
                $byteRate = $reader.ReadUInt32()
            } elseif ($chunkId -eq "data") {
                $dataSize = $chunkSize
            }
            $next = $chunkStart + $chunkSize + ($chunkSize % 2)
            if ($next -gt $stream.Length) { throw "FIXTURE_WAV_CHUNK_INVALID" }
            $stream.Position = $next
        }
        if ($byteRate -le 0 -or $dataSize -le 0) { throw "FIXTURE_WAV_DURATION_INVALID" }
        return [double]$dataSize / [double]$byteRate
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Select-PortugueseVoice([object]$Voice) {
    $tokens = $null
    try {
        $tokens = $Voice.GetVoices()
        for ($index = 0; $index -lt $tokens.Count; $index++) {
            $token = $tokens.Item($index)
            try {
                $description = [string]$token.GetDescription()
                $language = [string]$token.GetAttribute("Language")
                if (
                    $description -match "(?i)portugu" -or
                    $language -match "(?i)(416|816|pt-BR|pt-PT)"
                ) {
                    $Voice.Voice = $token
                    return $description
                }
            } finally {
                Release-ComObject $token
            }
        }
        return [string]$Voice.Voice.GetDescription()
    } finally {
        Release-ComObject $tokens
    }
}

function Write-SyntheticSpeech([string]$Path, [int]$RepeatCount) {
    $voice = $null
    $fileStream = $null
    try {
        $voice = New-Object -ComObject SAPI.SpVoice
        $selectedVoice = Select-PortugueseVoice $voice
        $voice.Rate = 0
        $voice.Volume = 100

        $sentence = @(
            "Esta é uma gravação sintética para o teste físico do TDA Companion.",
            "A sessão contém fala contínua, palavras simples e frases em português.",
            "O objetivo é verificar transcrição, alinhamento, GPU e integridade sem usar áudio privado.",
            "Alice explora uma antiga biblioteca enquanto Bruno observa a porta e prepara uma tocha.",
            "O grupo encontra um mapa, uma chave de prata e uma mensagem escrita na parede."
        ) -join " "
        $text = (($sentence + " ") * $RepeatCount).Trim()

        $fileStream = New-Object -ComObject SAPI.SpFileStream
        # SSFMCreateForWrite = 3. The SAPI stream writes a normal RIFF/WAVE file
        # in the selected voice's native PCM format.
        $fileStream.Open($Path, 3, $false)
        $voice.AudioOutputStream = $fileStream
        [void]$voice.Speak($text, 0)
        $fileStream.Close()
        return $selectedVoice
    } finally {
        if ($null -ne $fileStream) {
            try { $fileStream.Close() } catch {}
        }
        Release-ComObject $fileStream
        Release-ComObject $voice
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function New-SyntheticSpeechFixture([string]$Path, [int]$DesiredSeconds) {
    $repeat = 8
    $voiceName = $null
    for ($attempt = 1; $attempt -le 4; $attempt++) {
        if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
        $voiceName = Write-SyntheticSpeech $Path $repeat
        $duration = Get-WavDurationSeconds $Path
        if ($duration -ge 65 -and $duration -le 180) {
            return @{
                duration_seconds = [Math]::Round($duration, 3)
                repeat_count = $repeat
                voice = $voiceName
            }
        }
        if ($duration -le 0) { throw "FIXTURE_AUDIO_DURATION_INVALID" }
        $scaled = [Math]::Ceiling($repeat * ($DesiredSeconds / $duration))
        $repeat = [Math]::Max(2, [Math]::Min(80, [int]$scaled))
    }
    throw "FIXTURE_AUDIO_DURATION_OUT_OF_RANGE"
}

function New-CraigFixture([string]$ZipPath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $flacBytes = [Convert]::FromBase64String($FlacFixtureBase64)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha256.ComputeHash($flacBytes)
    } finally {
        $sha256.Dispose()
    }
    $actual = ([BitConverter]::ToString($digest) -replace "-", "").ToLowerInvariant()
    if ($actual -ne $FlacFixtureSha256) { throw "FIXTURE_FLAC_EMBEDDED_HASH_MISMATCH" }

    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    $file = [IO.File]::Open($ZipPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $archive = $null
    try {
        $archive = [IO.Compression.ZipArchive]::new(
            $file,
            [IO.Compression.ZipArchiveMode]::Create,
            $false
        )
        $entry = $archive.CreateEntry(
            "1-Synthetic.flac",
            [IO.Compression.CompressionLevel]::NoCompression
        )
        $entryStream = $entry.Open()
        try {
            $entryStream.Write($flacBytes, 0, $flacBytes.Length)
        } finally {
            $entryStream.Dispose()
        }
    } finally {
        if ($null -ne $archive) { $archive.Dispose() }
        $file.Dispose()
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "FIXTURE_WINDOWS_REQUIRED"
}

$output = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $output | Out-Null

$audio = Join-Path $output "tda-physical-acceptance-synthetic.wav"
$craig = Join-Path $output "tda-installed-acceptance-craig.zip"
$metadata = Join-Path $output "fixture.json"

$speech = New-SyntheticSpeechFixture $audio $TargetSeconds
New-CraigFixture $craig

$value = [ordered]@{
    schema = "tda_physical_acceptance_fixture_v1"
    generated_at = [DateTimeOffset]::UtcNow.ToString("o")
    synthetic = $true
    audio = [ordered]@{
        file = [IO.Path]::GetFileName($audio)
        sha256 = Get-Sha256 $audio
        duration_seconds = $speech.duration_seconds
        voice = $speech.voice
        repeat_count = $speech.repeat_count
    }
    craig = [ordered]@{
        file = [IO.Path]::GetFileName($craig)
        sha256 = Get-Sha256 $craig
        track_count = 1
        embedded_flac_sha256 = $FlacFixtureSha256
    }
}
$value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadata -Encoding UTF8

Write-Host "Synthetic acceptance fixture: PASS" -ForegroundColor Green
Write-Host "Audio: $audio"
Write-Host "Craig: $craig"
Write-Host "Metadata: $metadata"
Write-Host "Duration: $($speech.duration_seconds)s"
Write-Host "Voice: $($speech.voice)"
