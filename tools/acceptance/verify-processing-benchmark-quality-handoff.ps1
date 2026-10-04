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

function Assert-SanitizedBenchmarkDiagnostics([string]$Path, [string]$ProfileId) {
    $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($text)) {
        Fail ("BENCHMARK_DIAGNOSTICS_EMPTY:" + $ProfileId)
    }
    if ($text -match '(?i)(authorization|bearer\s+[A-Za-z0-9._-]+|cookie\s*[:=]|[A-Z]:\\Users\\|/home/|/Users/|\.flac\b|\.wav\b|\.mp3\b)') {
        Fail ("BENCHMARK_DIAGNOSTICS_PRIVATE_DATA:" + $ProfileId)
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
        $benchmarkId -notmatch '^(benchmark-[a-f0-9]{32}|benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5})$' -or
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

            foreach ($artifact in @("metrics", "events", "telemetry")) {
                $artifactPath = Join-Path $privateRoot ($profileId + "-" + $artifact + ".txt")
                Download-AgentEvidenceFile $Token ("/benchmarks/" + $benchmarkId + "/profiles/" + $profileId + "/" + $artifact) $artifactPath
                Assert-SanitizedBenchmarkDiagnostics $artifactPath $profileId
            }

            $verifiedProfiles.Add([ordered]@{
                profile_id = $profileId
                transcript_sha256 = $actualSha
                transcript_size_bytes = [int64](Get-Item -LiteralPath $transcriptPath).Length
                diagnostics_verified = $true
            })
        }

        $quality = Invoke-AgentJson $Token "GET" ("/benchmarks/" + $benchmarkId + "/quality")
        $qualityReceipt = [ordered]@{
            quality_measured = (Get-OptionalPropertyValue $quality "quality_measured") -eq $true
            reference_revision = $null
            profiles = @()
        }
        if ($ReferencePath) {
            $resolvedReference = (Resolve-Path -LiteralPath $ReferencePath -ErrorAction Stop).Path
            $referenceBody = Read-Json $resolvedReference "BENCHMARK_REFERENCE_INPUT_INVALID"
            $saved = Invoke-AgentJson $Token "POST" ("/benchmarks/" + $benchmarkId + "/reference") $referenceBody 60
            $quality = Invoke-AgentJson $Token "GET" ("/benchmarks/" + $benchmarkId + "/quality")
            if ((Get-OptionalPropertyValue $quality "quality_measured") -ne $true) {
                Fail "BENCHMARK_REFERENCE_QUALITY_NOT_MEASURED"
            }
            $qualityReceipt.quality_measured = $true
            $qualityReceipt.reference_revision = [int](Get-OptionalPropertyValue $saved "revision")
            $metrics = [Collections.Generic.List[object]]::new()
            foreach ($item in @((Get-OptionalPropertyValue $quality "profiles"))) {
                $overall = Get-OptionalPropertyValue $item "overall"
                $metrics.Add([ordered]@{
                    profile_id = [string](Get-OptionalPropertyValue $item "profile_id")
                    wer_normalized = Get-OptionalPropertyValue $overall "wer_normalized"
                    cer_normalized = Get-OptionalPropertyValue $overall "cer_normalized"
                })
            }
            $qualityReceipt.profiles = $metrics.ToArray()
        } elseif ((Get-OptionalPropertyValue $quality "quality_measured") -eq $true) {
            Fail "BENCHMARK_UNEXPECTED_PREEXISTING_REFERENCE"
        }

        $exportPath = Join-Path $Root ("TDA-Benchmark-" + $benchmarkId + "-PRIVATE.zip")
        Download-AgentEvidenceFile $Token ("/benchmarks/" + $benchmarkId + "/export") $exportPath 300
        $exportSha = (Get-FileHash -LiteralPath $exportPath -Algorithm SHA256).Hash.ToLowerInvariant()
        Assert-Sha256 $exportSha "BENCHMARK_EXPORT_SHA_INVALID"

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($exportPath)
        try {
            $entries = @($archive.Entries)
            if (@($entries | Where-Object { $_.FullName -match '(?i)\.(wav|flac|mp3|ogg|m4a|aac)$' }).Count -gt 0) {
                Fail "BENCHMARK_EXPORT_AUDIO_PRESENT"
            }
            foreach ($profileId in $RequiredProfiles) {
                if (@($entries | Where-Object {
                    $_.FullName -like "*/profiles/$profileId/transcript.json"
                }).Count -ne 1) {
                    Fail ("BENCHMARK_EXPORT_TRANSCRIPT_ENTRY_INVALID:" + $profileId)
                }
            }
        } finally {
            $archive.Dispose()
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
            contains_transcript = $false
            profiles = $verifiedProfiles.ToArray()
            quality = $qualityReceipt
        }
    } finally {
        Get-ChildItem -LiteralPath $privateRoot -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $privateRoot -Force -ErrorAction SilentlyContinue
    }
}
