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
        if ($detail -match '"code"\\s*:\\s*"([A-Z0-9_]+)"') {
            Fail ("BENCHMARK_AGENT_API_" + $Matches[1])
        }
        Fail "BENCHMARK_AGENT_FILE_DOWNLOAD_FAILED"
    }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        Fail "BENCHMARK_AGENT_FILE_MISSING"
    }
}

function Assert-SanitizedBenchmarkDiagnosticText(
    [string]$Text,
    [string]$ProfileId,
    [string]$Artifact
) {
    if ([string]::IsNullOrWhiteSpace($Text)) {
        Fail ("BENCHMARK_DIAGNOSTICS_EMPTY:" + $ProfileId + ":" + $Artifact)
    }
    if ($Text -match '(?i)(authorization|bearer\\s+[A-Za-z0-9._-]+|cookie\\s*[:=]|[A-Z]:\\\\Users\\\\|/home/|/Users/|\\.(flac|wav|mp3|ogg|m4a|aac)\\b)') {
        Fail ("BENCHMARK_DIAGNOSTICS_PRIVATE_DATA:" + $ProfileId + ":" + $Artifact)
    }
}

function Read-ZipEntryText([IO.Compression.ZipArchiveEntry]$Entry) {
    $stream = $Entry.Open()
    try {
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
        try { return $reader.ReadToEnd() }
        finally { $reader.Dispose() }
    } finally {
        $stream.Dispose()
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
        [double](Get-OptionalPropertyValue $manifest "sample_seconds") -ne 300.0
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

    $privateRoot = Join-Path $Root "private-benchmark-evidence"
    New-Item -ItemType Directory -Force -Path $privateRoot | Out-Null
    $verifiedProfiles = [Collections.Generic.List[object]]::new()
    try {
        $resultProfiles = @((Get-OptionalPropertyValue $Result "profiles"))
        foreach ($profileId in $RequiredProfiles) {
            $matches = @($resultProfiles | Where-Object {
                [string](Get-OptionalPropertyValue $_ "profile_id") -eq $profileId
            })
            if ($matches.Count -ne 1) {
                Fail ("BENCHMARK_EVIDENCE_PROFILE_MISSING:" + $profileId)
            }
            $expectedSha = [string](Get-OptionalPropertyValue $matches[0] "transcript_sha256")
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
            })
        }

        $exportPath = Join-Path $Root ("TDA-Benchmark-" + $benchmarkId + "-PRIVATE.zip")
        Download-AgentEvidenceFile $Token ("/benchmarks/" + $benchmarkId + "/export.zip") $exportPath 300
        $exportSha = (Get-FileHash -LiteralPath $exportPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Assert-Sha256 $exportSha "BENCHMARK_EXPORT_SHA_INVALID"

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($exportPath)
        try {
            $entries = @($archive.Entries)
            if (@($entries | Where-Object { $_.FullName -match '(?i)\\.(wav|flac|mp3|ogg|m4a|aac)$' }).Count -gt 0) {
                Fail "BENCHMARK_EXPORT_AUDIO_PRESENT"
            }
            $prefix = "TDA-Benchmark-" + $benchmarkId + "/"
            $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            [void]$allowed.Add($prefix + "benchmark.json")
            foreach ($profileId in $RequiredProfiles) {
                foreach ($name in @(
                    "profile.json",
                    "transcript.json",
                    "transcript.txt",
                    "transcript.vtt",
                    "transcript.srt",
                    "metrics.json",
                    "events.jsonl",
                    "telemetry.jsonl"
                )) {
                    [void]$allowed.Add($prefix + "profiles/" + $profileId + "/" + $name)
                }
            }
            foreach ($entry in $entries) {
                if (-not $allowed.Contains($entry.FullName)) {
                    Fail "BENCHMARK_EXPORT_UNEXPECTED_ENTRY"
                }
            }
            foreach ($profileId in $RequiredProfiles) {
                foreach ($requiredName in @("transcript.json", "metrics.json", "events.jsonl")) {
                    $entryName = $prefix + "profiles/" + $profileId + "/" + $requiredName
                    $entry = @($entries | Where-Object { $_.FullName -eq $entryName })
                    if ($entry.Count -ne 1) {
                        Fail ("BENCHMARK_EXPORT_REQUIRED_ENTRY_MISSING:" + $profileId + ":" + $requiredName)
                    }
                }
                foreach ($diagnosticName in @("metrics.json", "events.jsonl", "telemetry.jsonl")) {
                    $entryName = $prefix + "profiles/" + $profileId + "/" + $diagnosticName
                    $entry = @($entries | Where-Object { $_.FullName -eq $entryName })
                    if ($entry.Count -eq 1) {
                        Assert-SanitizedBenchmarkDiagnosticText (Read-ZipEntryText $entry[0]) $profileId $diagnosticName
                    }
                }
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
            $referenceState = Invoke-AgentJson $Token "GET" ("/benchmarks/" + $benchmarkId + "/reference")
            $status = Get-OptionalPropertyValue $referenceState "status"
            $latestRevision = [int](Get-OptionalPropertyValue $status "latest_revision")
            $referenceBody | Add-Member -NotePropertyName expected_revision -NotePropertyValue $latestRevision -Force
            $referenceBody | Add-Member -NotePropertyName activate -NotePropertyValue $true -Force
            $saved = Invoke-AgentJson $Token "POST" ("/benchmarks/" + $benchmarkId + "/references") $referenceBody 60
            $quality = Get-OptionalPropertyValue $saved "quality"
            if ($null -eq $quality -or (Get-OptionalPropertyValue $quality "quality_measured") -ne $true) {
                Fail "BENCHMARK_REFERENCE_QUALITY_NOT_MEASURED"
            }
            $savedReference = Get-OptionalPropertyValue $saved "reference"
            $qualityReceipt.quality_measured = $true
            $qualityReceipt.reference_revision = [int](Get-OptionalPropertyValue $savedReference "revision")
            $metrics = [Collections.Generic.List[object]]::new()
            foreach ($item in @((Get-OptionalPropertyValue $quality "profiles"))) {
                $metricRoot = Get-OptionalPropertyValue $item "metrics"
                $micro = Get-OptionalPropertyValue $metricRoot "micro"
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
            export_contains_transcript = $true
            private_export_kept_local = $true
            receipt_contains_transcript = $false
            profiles = $verifiedProfiles.ToArray()
            quality = $qualityReceipt
        }
    } finally {
        Get-ChildItem -LiteralPath $privateRoot -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $privateRoot -Force -ErrorAction SilentlyContinue
    }
}
