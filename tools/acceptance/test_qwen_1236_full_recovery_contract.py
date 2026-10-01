from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WRAPPER = ROOT / "tools" / "acceptance" / "run-qwen-1236-full-recovery.ps1"
GENERIC = ROOT / "tools" / "acceptance" / "run-qwen-recovery-physical-gate.ps1"


class Qwen1236FullRecoveryContractTests(unittest.TestCase):
    def test_wrapper_is_locked_to_exact_candidate_and_private_source_hash(self):
        text = WRAPPER.read_text(encoding="utf-8")
        self.assertIn(
            '$CompanionSourceSha = "d3db290b66beb16c5b01637fddb4f9a3ed9de4a7"',
            text,
        )
        self.assertIn(
            '$QwenSourceSha = "d3db290b66beb16c5b01637fddb4f9a3ed9de4a7"',
            text,
        )
        self.assertNotIn("$CandidateSourceSha", text)
        self.assertIn(
            "[string]$payload.source_sha -ne $CompanionSourceSha",
            text,
        )
        self.assertIn(
            "[string]$candidate.source_sha -ne $QwenSourceSha",
            text,
        )
        for value in (
            'd3db290b66beb16c5b01637fddb4f9a3ed9de4a7',
            'companion-rc-v0.3.18-d3db290b66be',
            'companion-qwen-runtime-rc-v1.0.14-d3db290b66be',
            '513339dc0c7328e007ee1f3257e118f6ed862b2277489ea1c7bd102175386516',
            '9c29b165fddfa212e61cf0c8679444e9cdad1220963ce1fa01bbdb9e61d2deb8',
            'b2ac78347d88b2761e51be38a60aa266933e3b00f30e72c50626fbe599849b1e',
            'RequiredCompanionVersion = $CompanionVersion',
            'RequiredQwenRuntimeVersion = $QwenRuntimeVersion',
            'ExpectedCraigSha256 = $CraigSha256',
        ):
            self.assertIn(value, text)
        self.assertNotIn('install-rc-runtime', text.casefold())

    def test_generic_gate_keeps_legacy_defaults_but_accepts_explicit_contract(self):
        text = GENERIC.read_text(encoding="utf-8")
        self.assertIn('[string]$RequiredCompanionVersion = "0.3.16"', text)
        self.assertIn('[string]$RequiredQwenRuntimeVersion = "1.0.12"', text)
        self.assertIn('[string]$ExpectedCraigSha256 = ""', text)
        self.assertIn('CRAIG_SHA256_MISMATCH', text)
        self.assertIn('CRAIG_SOURCE_ID_MISMATCH', text)
        self.assertIn('qwen_full_run_structure.py', text)
        self.assertIn('QWEN_1236_FULL_RUN_STRUCTURE_INVALID', text)
        self.assertIn('Normal qwen-fast worker + bounded cancel', text)
        self.assertIn('qwen-quality checkpoint -> hard Agent crash -> retry', text)
        self.assertIn('--profile-id "qwen-quality"', text)
        self.assertIn('qwen-quality-full-run-structure.json', text)


if __name__ == "__main__":
    unittest.main()
