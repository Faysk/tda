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
            '$CompanionSourceSha = "bb9b0a96fc30dde1837d9f9d6b5c49467362f9c1"',
            text,
        )
        self.assertIn(
            '$QwenSourceSha = "bb9b0a96fc30dde1837d9f9d6b5c49467362f9c1"',
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
            'bb9b0a96fc30dde1837d9f9d6b5c49467362f9c1',
            'companion-rc-v0.3.18-bb9b0a96fc30',
            'companion-qwen-runtime-rc-v1.0.13-bb9b0a96fc30',
            '1a22b3fed54518edd046d5ea49cffb14c7530c9038845dcef9bc1dda98c4df0e',
            '06ec1a99f64cbe11ef3ba3a07a37f4996e01ba28394467ee3029143d16607a16',
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


if __name__ == "__main__":
    unittest.main()
