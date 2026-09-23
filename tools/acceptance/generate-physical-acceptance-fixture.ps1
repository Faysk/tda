param(
    [string]$OutputRoot = (Join-Path $env:TEMP "tda-physical-acceptance-fixture"),
    [ValidateRange(65, 180)]
    [int]$TargetSeconds = 80
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

public static class TdaSyntheticFlacEncoder
{
    private static ushort ReadU16LE(BinaryReader reader)
    {
        return reader.ReadUInt16();
    }

    private static uint ReadU32LE(BinaryReader reader)
    {
        return reader.ReadUInt32();
    }

    private static void WriteU16BE(BinaryWriter writer, int value)
    {
        writer.Write((byte)((value >> 8) & 0xff));
        writer.Write((byte)(value & 0xff));
    }

    private static void WriteU64BE(BinaryWriter writer, ulong value)
    {
        for (int shift = 56; shift >= 0; shift -= 8)
            writer.Write((byte)((value >> shift) & 0xff));
    }

    private static byte Crc8(byte[] bytes)
    {
        int crc = 0;
        foreach (byte value in bytes)
        {
            crc ^= value;
            for (int bit = 0; bit < 8; bit++)
                crc = (crc & 0x80) != 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
        }
        return (byte)crc;
    }

    private static ushort Crc16(byte[] bytes)
    {
        int crc = 0;
        foreach (byte value in bytes)
        {
            crc ^= value << 8;
            for (int bit = 0; bit < 8; bit++)
                crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
        }
        return (ushort)crc;
    }

    private static byte[] EncodeFrameNumber(int value)
    {
        if (value < 0 || value > 0xffff)
            throw new InvalidDataException("FIXTURE_FLAC_FRAME_NUMBER_INVALID");
        if (value <= 0x7f)
            return new byte[] { (byte)value };
        if (value <= 0x7ff)
            return new byte[] {
                (byte)(0xc0 | ((value >> 6) & 0x1f)),
                (byte)(0x80 | (value & 0x3f))
            };
        return new byte[] {
            (byte)(0xe0 | ((value >> 12) & 0x0f)),
            (byte)(0x80 | ((value >> 6) & 0x3f)),
            (byte)(0x80 | (value & 0x3f))
        };
    }

    public static double EncodeMonoPcm16Wave(string sourcePath, string destinationPath)
    {
        byte[] pcm = null;
        int sampleRate = 0;
        int channels = 0;
        int bitsPerSample = 0;
        int audioFormat = 0;

        using (FileStream stream = File.OpenRead(sourcePath))
        using (BinaryReader reader = new BinaryReader(stream, Encoding.ASCII))
        {
            if (Encoding.ASCII.GetString(reader.ReadBytes(4)) != "RIFF")
                throw new InvalidDataException("FIXTURE_WAV_RIFF_INVALID");
            ReadU32LE(reader);
            if (Encoding.ASCII.GetString(reader.ReadBytes(4)) != "WAVE")
                throw new InvalidDataException("FIXTURE_WAV_WAVE_INVALID");

            long dataOffset = -1;
            int dataLength = 0;
            while (stream.Position + 8 <= stream.Length)
            {
                string chunk = Encoding.ASCII.GetString(reader.ReadBytes(4));
                uint size = ReadU32LE(reader);
                long start = stream.Position;
                if (chunk == "fmt ")
                {
                    if (size < 16)
                        throw new InvalidDataException("FIXTURE_WAV_FMT_INVALID");
                    audioFormat = ReadU16LE(reader);
                    channels = ReadU16LE(reader);
                    sampleRate = checked((int)ReadU32LE(reader));
                    ReadU32LE(reader);
                    ReadU16LE(reader);
                    bitsPerSample = ReadU16LE(reader);
                }
                else if (chunk == "data")
                {
                    dataOffset = start;
                    dataLength = checked((int)size);
                }
                long next = checked(start + size + (size & 1));
                if (next > stream.Length)
                    throw new InvalidDataException("FIXTURE_WAV_CHUNK_INVALID");
                stream.Position = next;
            }

            if (audioFormat != 1 || channels != 1 || bitsPerSample != 16)
                throw new InvalidDataException("FIXTURE_WAV_PCM16_MONO_REQUIRED");
            if (sampleRate <= 0 || sampleRate > 65535)
                throw new InvalidDataException("FIXTURE_WAV_SAMPLE_RATE_INVALID");
            if (dataOffset < 0 || dataLength <= 0 || (dataLength & 1) != 0)
                throw new InvalidDataException("FIXTURE_WAV_DATA_INVALID");

            stream.Position = dataOffset;
            pcm = reader.ReadBytes(dataLength);
            if (pcm.Length != dataLength)
                throw new InvalidDataException("FIXTURE_WAV_DATA_INVALID");
        }

        long totalSamplesLong = pcm.LongLength / 2;
        if (totalSamplesLong <= 0 || totalSamplesLong > 0xfffffffffL)
            throw new InvalidDataException("FIXTURE_FLAC_SAMPLE_COUNT_INVALID");
        int totalSamples = checked((int)totalSamplesLong);

        int blockSize = 4096;
        while (blockSize > 16)
        {
            int remainder = totalSamples % blockSize;
            if (remainder == 0 || remainder >= 16)
                break;
            blockSize--;
        }
        if (blockSize < 16)
            throw new InvalidDataException("FIXTURE_FLAC_BLOCK_SIZE_INVALID");

        byte[] md5;
        using (MD5 hasher = MD5.Create())
            md5 = hasher.ComputeHash(pcm);

        using (FileStream output = new FileStream(destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (BinaryWriter writer = new BinaryWriter(output, Encoding.ASCII))
        {
            writer.Write(Encoding.ASCII.GetBytes("fLaC"));
            writer.Write((byte)0x80);
            writer.Write(new byte[] { 0x00, 0x00, 0x22 });
            WriteU16BE(writer, blockSize);
            WriteU16BE(writer, blockSize);
            writer.Write(new byte[] { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });

            ulong streamInfo =
                ((ulong)sampleRate << 44) |
                ((ulong)15 << 36) |
                (ulong)totalSamplesLong;
            WriteU64BE(writer, streamInfo);
            writer.Write(md5);

            int frameNumber = 0;
            int sampleOffset = 0;
            while (sampleOffset < totalSamples)
            {
                int sampleCount = Math.Min(blockSize, totalSamples - sampleOffset);

                byte[] headerWithoutCrc;
                using (MemoryStream headerStream = new MemoryStream())
                using (BinaryWriter header = new BinaryWriter(headerStream, Encoding.ASCII))
                {
                    header.Write((byte)0xff);
                    header.Write((byte)0xf8);
                    header.Write((byte)0x7d);
                    header.Write((byte)0x08);
                    header.Write(EncodeFrameNumber(frameNumber));
                    WriteU16BE(header, sampleCount - 1);
                    WriteU16BE(header, sampleRate);
                    header.Flush();
                    headerWithoutCrc = headerStream.ToArray();
                }

                byte[] frameWithoutFooter;
                using (MemoryStream frameStream = new MemoryStream())
                using (BinaryWriter frame = new BinaryWriter(frameStream, Encoding.ASCII))
                {
                    frame.Write(headerWithoutCrc);
                    frame.Write(Crc8(headerWithoutCrc));
                    frame.Write((byte)0x02);
                    int byteOffset = sampleOffset * 2;
                    for (int index = 0; index < sampleCount; index++)
                    {
                        byte low = pcm[byteOffset + (index * 2)];
                        byte high = pcm[byteOffset + (index * 2) + 1];
                        frame.Write(high);
                        frame.Write(low);
                    }
                    frame.Flush();
                    frameWithoutFooter = frameStream.ToArray();
                }

                writer.Write(frameWithoutFooter);
                WriteU16BE(writer, Crc16(frameWithoutFooter));
                sampleOffset += sampleCount;
                frameNumber++;
            }

            writer.Flush();
            output.Flush(true);
        }

        return (double)totalSamplesLong / (double)sampleRate;
    }
}
"@

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

function New-CraigFixture([string]$ZipPath, [string]$SpeechWavPath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $flacPath = Join-Path ([IO.Path]::GetDirectoryName($ZipPath)) ("tda-craig-synthetic-" + [Guid]::NewGuid().ToString("N") + ".flac")
    try {
        $duration = [TdaSyntheticFlacEncoder]::EncodeMonoPcm16Wave($SpeechWavPath, $flacPath)
        if ($duration -lt 60 -or $duration -gt 180) {
            throw "FIXTURE_CRAIG_FLAC_DURATION_INVALID"
        }
        $flacSha = Get-Sha256 $flacPath

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
            $inputStream = $null
            try {
                $inputStream = [IO.File]::OpenRead($flacPath)
                $inputStream.CopyTo($entryStream)
            } finally {
                if ($null -ne $inputStream) { $inputStream.Dispose() }
                $entryStream.Dispose()
            }
        } finally {
            if ($null -ne $archive) { $archive.Dispose() }
            $file.Dispose()
        }

        return @{
            flac_sha256 = $flacSha
            duration_seconds = [Math]::Round($duration, 3)
        }
    } finally {
        Remove-Item -LiteralPath $flacPath -Force -ErrorAction SilentlyContinue
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
$craigFixture = New-CraigFixture $craig $audio

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
        embedded_flac_sha256 = $craigFixture.flac_sha256
        track_duration_seconds = $craigFixture.duration_seconds
        track_codec = "flac"
    }
}
$value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadata -Encoding UTF8

Write-Host "Synthetic acceptance fixture: PASS" -ForegroundColor Green
Write-Host "Audio: $audio"
Write-Host "Craig: $craig"
Write-Host "Metadata: $metadata"
Write-Host "Duration: $($speech.duration_seconds)s"
Write-Host "Craig track duration: $($craigFixture.duration_seconds)s"
Write-Host "Voice: $($speech.voice)"
