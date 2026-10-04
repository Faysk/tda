Set-StrictMode -Version Latest

function Download-AgentEvidenceFile(
    [string]$Token,
    [string]$Path,
    [string]$Destination,
    [int]$TimeoutSec = 120
) {
    $parent = Split-Path -Parent $Destination
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    try {
        Invoke-WebRequest -NoProxy -Method Get -Uri "http://127.0.0.1:$Port/api/v1$Path" -Headers @{
            Origin = $Origin
            Authorization = "Bearer $Token"
            Accept = "*/*"
        } -TimeoutSec $TimeoutSec -OutFile $Destination | Out-Null
    } catch {
        $detail = Get-ErrorDetailMessage $_
        if ($detail -match '"code"\s*:\s*"([A-Z0-9_]+)"') {
            Fail ("BENCHMARK_AGENT_API_" + $Matches[1])
        }
        Fail "BENCHMARK_AGENT_FILE_DOWNLOAD_FAILED"
    }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        Fail "BENCHMARK_AGENT_FILE_MISSING"
    }
}

function Get-BytesSha256([byte[]]$Bytes) {
    $digest = [Security.Cryptography.SHA256]::HashData($Bytes)
    return ([Convert]::ToHexString($digest)).ToLowerInvariant()
}

function Read-ZipEntryBytes(
    [System.IO.Compression.ZipArchive]$Archive,
    [string]$Name,
    [string]$ErrorCode
) {
    $entry = $Archive.GetEntry($Name)
    if ($null -eq $entry) { Fail $ErrorCode }
    $stream = $entry.Open()
    try {
        $memory = [IO.MemoryStream]::new()
        try {
            $stream.CopyTo($memory)
            return $memory.ToArray()
        } finally {
            $memory.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Assert-SanitizedDiagnosticBytes(
    [byte[]]$Bytes,
    [string]$ProfileId,
    [string]$Kind
) {
    if ($Bytes.Length -le 0) {
        Fail ("BENCHMARK_DIAGNOSTICS_EMPTY:" + $ProfileId + ":" + $Kind)
    }
    $text = [Text.Encoding]::UTF8.GetString($Bytes)
    if ($text -match '(?i)(authorization|bearer\s+[A-Za-z0-9._-]+|cookie\s*[:=]|[A-Z]:\\Users\\|/home/|/Users/|\.flac\b|\.wav\b|\.mp3\b)') {
        Fail ("BENCHMARK_DIAGNOSTICS_PRIVATE_DATA:" + $ProfileId + ":" + $Kind)
    }
}

function Assert-ArtifactDescriptor(
    [object]$Descriptor,
    [string]$ExpectedArtifact,
    [byte[]]$Bytes,
    [string]$ErrorCode
) {
    if ($null -eq $Descriptor) { Fail $ErrorCode }
    $artifact = [string](Get-OptionalPropertyValue $Descriptor "artifact")
    $sha = [string](Get-OptionalPropertyValue $Descriptor "sha256")
    $size = Get-OptionalPropertyValue $Descriptor "size_bytes"
    Assert-Sha256 $sha ($ErrorCode + "_SHA")
    if (
        $artifact -ne $ExpectedArtifact -or
        $null -eq $size -or
        [int64]$size -ne [int64]$Bytes.Length -or
        (Get-BytesSha256 $Bytes) -ne $sha
    ) {
        Fail $ErrorCode
    }
}

function Assert-BenchmarkEvidence(
    [string]$Token,
    [object]$Result,
    [string]$Root,
    [string]$ReferencePath = ""
) {
    $benchmarkId = [string](Get-OptionalPropertyValue $Result "benchmark_id")
    $bundleSha = [string](Get-OptionalPropertyValue $Result "bundle_manifest_sha256")
    $bundleSize = Get-OptionalPropertyValue $Result "bundle_size_bytes"
    if (
        $benchmarkId -notmatch '^benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5}$' -or
        $null -eq $bundleSize -or
        [int64]$bundleSize -le 0
    ) {
        Fail "BENCHMARK_EVIDENCE_RECEIPT_INVALID"
    }
    Assert-Sha256 $bundleSha "BENCHMARK_EVIDENCE_BUNDLE_SHA_INVALID"

    $manifest = Invoke-AgentJson $Token "GET" ("/benchmarks/" + $benchmarkId)
    if (
        [string](Get-OptionalPropertyValue $manifest "status") -ne "completed" -or
        [double](Get-OptionalPropertyValue $manifest "sample_seconds") -ne 300.0 -or
        [string](Get-OptionalPropertyValue $manifest "bundle_manifest_sha256") -ne $bundleSha
    ) {
        Fail "BENCHMARK_EVIDENCE_MANIFEST_INVALID"
    }
    $profileOrder = @((Get-OptionalPropertyValue $manifest "profile_order"))
    if ($profileOrder.Count -ne $RequiredProfiles.Count) {
        Fail "BENCHMARK_EVIDENCE_PROFILE_ORDER_INVALID"
    }
    for ($index = 0; $index -lt $RequiredProfiles.Count; $index++) {
        if ([string]$profileOrder[$index] -ne $RequiredProfiles[$index]) {
            Fail "BENCHMARK_EVIDENCE_PROFILE_ORDER_INVALID"
        }
    }

    $privateRoot = Join-Path $Root "private-benchmark-verification"
    New-Item -ItemType Directory -Force -Path $privateRoot | Out-Null
    $verifiedProfiles = [Collections.Generic.List[object]]::new()
    $exportPath = Join-Path $Root ("TDA-Benchmark-" + $benchmarkId + "-PRIVATE.zip")
    try {
        $resultProfiles = @((Get-OptionalPropertyValue $Result "profiles"))
        foreach ($profileId in $RequiredProfiles) {
            $matches = @($resultProfiles | Where-Object {
                [string](Get-OptionalPropertyValue $_ "profile_id") -eq $profileId
            })
            if ($matches.Count -ne 1) {
                Fail ("BENCHMARK_EVIDENCE_PROFILE_MISSING:" + $profileId)
            }
            $row = $matches[0]
            $expectedSha = [string](Get-OptionalPropertyValue $row "transcript_sha256")
            Assert-Sha256 $expectedSha ("BENCHMARK_EVIDENCE_TRANSCRIPT_SHA_INVALID:" + $profileId)

            $transcriptPath = Join-Path $privateRoot ($profileId + "-transcript.json")
            Download-AgentEvidenceFile $Token ("/benchmarks/" + $benchmarkId + "/profiles/" + $profileId + "/transcript") $transcriptPath
            $actualSha = (Get-FileHash -LiteralPath $transcriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualSha -ne $expectedSha) {
                Fail ("BENCHMARK_EVIDENCE_TRANSCRIPT_HASH_MISMATCH:" + $profileId)
            }
            $transcript = Read-Json $transcriptPath ("BENCHMARK_EVIDENCE_TRANSCRIPT_INVALID:" + $profileId)
            $engine = Get-OptionalPropertyValue $transcript "engine"
            if ([string](Get-OptionalPropertyValue $engine "profile") -ne $profileId) {
                Fail ("BENCHMARK_EVIDENCE_TRANSCRIPT_PROFILE_MISMATCH:" + $profileId)
            }

            $verifiedProfiles.Add([ordered]@{
                profile_id = $profileId
                transcript_sha256 = $actualSha
                transcript_size_bytes = [int64](Get-Item -LiteralPath $transcriptPath).Length
                diagnostics_verified = $false
            })
        }

        Download-AgentEvidenceFile $Token ("/benchmarks/" + $benchmarkId + "/export.zip") $exportPath 300
        $exportSha = (Get-FileHash -LiteralPath $exportPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Assert-Sha256 $exportSha "BENCHMARK_EXPORT_SHA_INVALID"

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($exportPath)
        try {
            $entries = @($archive.Entries)
            if (@($entries | Where-Object { $_.FullName -match '(?i)\.(wav|flac|mp3|ogg|m4a|aac)$' }).Count -gt 0) {
                Fail "BENCHMARK_EXPORT_AUDIO_PRESENT"
            }
            $manifestProfiles = @((Get-OptionalPropertyValue $manifest "profiles"))
            $prefix = "TDA-Benchmark-" + $benchmarkId
            for ($profileIndex = 0; $profileIndex -lt $RequiredProfiles.Count; $profileIndex++) {
                $profileId = $RequiredProfiles[$profileIndex]
                $manifestMatches = @($manifestProfiles | Where-Object {
                    [string](Get-OptionalPropertyValue $_ "profile_id") -eq $profileId
                })
                if ($manifestMatches.Count -ne 1) {
                    Fail ("BENCHMARK_EXPORT_PROFILE_MANIFEST_INVALID:" + $profileId)
                }
                $manifestProfile = $manifestMatches[0]
                $diagnostics = Get-OptionalPropertyValue $manifestProfile "diagnostics"
                if ($null -eq $diagnostics) {
                    Fail ("BENCHMARK_EXPORT_DIAGNOSTICS_MISSING:" + $profileId)
                }

                $transcriptEntry = "$prefix/profiles/$profileId/transcript.json"
                $transcriptBytes = Read-ZipEntryBytes $archive $transcriptEntry ("BENCHMARK_EXPORT_TRANSCRIPT_ENTRY_INVALID:" + $profileId)
                if ((Get-BytesSha256 $transcriptBytes) -ne $verifiedProfiles[$profileIndex].transcript_sha256) {
                    Fail ("BENCHMARK_EXPORT_TRANSCRIPT_HASH_MISMATCH:" + $profileId)
                }

                foreach ($kind in @("metrics", "events")) {
                    $filename = if ($kind -eq "metrics") { "metrics.json" } else { "events.jsonl" }
                    $entryName = "$prefix/profiles/$profileId/$filename"
                    $bytes = Read-ZipEntryBytes $archive $entryName ("BENCHMARK_EXPORT_DIAGNOSTIC_ENTRY_MISSING:" + $profileId + ":" + $kind)
                    Assert-SanitizedDiagnosticBytes $bytes $profileId $kind
                    $descriptor = Get-OptionalPropertyValue $diagnostics $kind
                    Assert-ArtifactDescriptor $descriptor ("profiles/$profileId/$filename") $bytes ("BENCHMARK_EXPORT_DIAGNOSTIC_MISMATCH:" + $profileId + ":" + $kind)
                }

                $telemetryDescriptor = Get-OptionalPropertyValue $diagnostics "telemetry"
                if ($null -ne $telemetryDescriptor) {
                    $entryName = "$prefix/profiles/$profileId/telemetry.jsonl"
                    $bytes = Read-ZipEntryBytes $archive $entryName ("BENCHMARK_EXPORT_TELEMETRY_ENTRY_MISSING:" + $profileId)
                    Assert-SanitizedDiagnosticBytes $bytes $profileId "telemetry"
                    Assert-ArtifactDescriptor $telemetryDescriptor ("profiles/$profileId/telemetry.jsonl") $bytes ("BENCHMARK_EXPORT_TELEMETRY_MISMATCH:" + $profileId)
                }
                $verifiedProfiles[$profileIndex].diagnostics_verified = $true
            }
        } finally {
            $archive.Dispose()
        }

        $qualityReceipt = [ordered]@{
            quality_measured = $false
            reference_revision = $null
            profiles = @()
        }
        if ($ReferencePath) {
            $resolvedReference = (Resolve-Path -LiteralPath $ReferencePath -ErrorAction Stop).Path
            $referenceBody = Read-Json $resolvedReference "BENCHMARK_REFERENCE_INPUT_INVALID"
            $saved = Invoke-AgentJson $Token "POST" ("/benchmarks/" + $benchmarkId + "/references") $referenceBody 60
            $quality = Invoke-AgentJson $Token "GET" ("/benchmarks/" + $benchmarkId + "/quality")
            if ((Get-OptionalPropertyValue $quality "quality_measured") -ne $true) {
                Fail "BENCHMARK_REFERENCE_QUALITY_NOT_MEASURED"
            }
            $savedReference = Get-OptionalPropertyValue $saved "reference"
            $qualityReceipt.quality_measured = $true
            $qualityReceipt.reference_revision = [int](Get-OptionalPropertyValue $savedReference "revision")
            $metrics = [Collections.Generic.List[object]]::new()
            foreach ($item in @((Get-OptionalPropertyValue $quality "profiles"))) {
                $metricPayload = Get-OptionalPropertyValue $item "metrics"
                $micro = Get-OptionalPropertyValue $metricPayload "micro"
                $metrics.Add([ordered]@{
                    profile_id = [string](Get-OptionalPropertyValue $item "profile_id")
                    wer_normalized = Get-OptionalPropertyValue $micro "wer_normalized"
                    cer_normalized = Get-OptionalPropertyValue $micro "cer_normalized"
                })
            }
            $qualityReceipt.profiles = $metrics.ToArray()
        }

        return [ordered]@{
            contract = "issue-1417"
            benchmark_id = $benchmarkId
            bundle_manifest_sha256 = $bundleSha
            bundle_size_bytes = [int64]$bundleSize
            export_sha256 = $exportSha
            export_size_bytes = [int64](Get-Item -LiteralPath $exportPath).Length
            export_contains_audio = $false
            private_export_kept_local = $true
            # This flag describes the sanitized receipt, not the private ZIP kept on the operator machine.
            contains_transcript = $false
            contains_reference_text = $false
            contains_token = $false
            contains_local_paths = $false
            profiles = $verifiedProfiles.ToArray()
            quality = $qualityReceipt
        }
    } finally {
        Get-ChildItem -LiteralPath $privateRoot -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $privateRoot -Force -ErrorAction SilentlyContinue
    }
}
