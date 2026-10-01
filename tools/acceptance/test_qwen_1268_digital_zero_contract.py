from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "acceptance" / "run-qwen-1268-digital-zero.ps1"


class Qwen1268DigitalZeroContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SCRIPT.read_text(encoding="utf-8")

    def test_probe_is_locked_to_exact_post_fix_runtime(self):
        for value in (
            '$RequiredRuntimeVersion = "1.0.14"',
            '$RequiredSourceSha = "d3db290b66beb16c5b01637fddb4f9a3ed9de4a7"',
            '$RequiredRuntimeId = "qwen3-transformers"',
            '$ExpectedCandidateTag = "companion-qwen-runtime-rc-v1.0.14-d3db290b66be"',
            '[string]$candidate.source_sha -ne $RequiredSourceSha',
            '[string]$marker.archive_sha256 -ne [string]$candidate.runtime_archive_sha256',
            '[string]$marker.worker_sha256 -ne $workerSha',
        ):
            self.assertIn(value, self.text)

    def test_probe_materializes_deterministic_zero_pcm_and_repeats_lengths(self):
        for value in (
            '[int[]]$DurationsSeconds = @(10, 30)',
            '[ValidateRange(2, 5)][int]$Repeats = 2',
            '$SampleRate = 16000',
            '$writer.Write([int16]1)',
            '$writer.Write([int16]$bitsPerSample)',
            '$zeroChunk = [byte[]]::new(65536)',
            '$writer.Write($zeroChunk, 0, $count)',
            '[void]$start.ArgumentList.Add("--acceptance")',
            '[void]$start.ArgumentList.Add("qwen-fast")',
            '[void]$start.ArgumentList.Add("--require-gpu-name")',
            'QWEN_1268_NONDETERMINISTIC_REPRODUCTION',
            'QWEN_1268_HALLUCINATION_NOT_REPRODUCED',
        ):
            self.assertIn(value, self.text)

    def test_receipt_is_sanitized_and_never_requests_raw_transcript_output(self):
        for value in (
            'schema = "tda_qwen_1268_digital_zero_v1"',
            'contains_audio = $false',
            'contains_transcript = $false',
            'candidate_manifest_sha256 = Get-Sha256 $candidatePath',
            'runtime_archive_sha256 = [string]$candidate.runtime_archive_sha256',
            'worker_sha256 = $workerSha',
            'transcript_sha256 = $transcriptSha',
            'aligned_word_count = $wordCount',
        ):
            self.assertIn(value, self.text)
        self.assertNotIn("--transcript-out", self.text)
        self.assertNotIn("Write-Json $receiptPath $stdout", self.text)
        self.assertNotIn("Write-Json $receiptPath $stderr", self.text)


if __name__ == "__main__":
    unittest.main()
