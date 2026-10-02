from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "acceptance" / "run-processing-final-acceptance.ps1"


class ProcessingFinalAcceptanceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SCRIPT.read_text(encoding="utf-8")

    def test_uses_post_fix_companion_and_qwen_candidates(self):
        self.assertIn(
            '$CompanionRcTag = "companion-rc-v0.3.18-d3db290b66be"',
            self.text,
        )
        self.assertIn(
            '$QwenRuntimeRcTag = "companion-qwen-runtime-rc-v1.0.14-d3db290b66be"',
            self.text,
        )
        self.assertNotIn(
            '$CompanionRcTag = "companion-rc-v0.3.18-bb9b0a96fc30"',
            self.text,
        )
        self.assertNotIn(
            '$QwenRuntimeRcTag = "companion-qwen-runtime-rc-v1.0.13-bb9b0a96fc30"',
            self.text,
        )

    def test_exact_rc_recovery_receives_companion_and_qwen_versions(self):
        self.assertIn(
            "RequiredCompanionVersion = [string]$companionPayload.version",
            self.text,
        )
        self.assertIn(
            "RequiredQwenRuntimeVersion = [string]$qwenCandidate.version",
            self.text,
        )

    def test_real_craig_is_handed_to_crash_retry_gate_when_requested(self):
        self.assertIn("$CraigSha256 = Get-Sha256 $CraigResolved", self.text)
        self.assertIn("$recoveryArgs.CraigZip = $CraigZip", self.text)
        self.assertIn(
            "$recoveryArgs.ExpectedCraigSha256 = $CraigSha256",
            self.text,
        )
        self.assertIn(
            '& $benchmarkScript -CraigZip $CraigZip',
            self.text,
        )


if __name__ == "__main__":
    unittest.main()
