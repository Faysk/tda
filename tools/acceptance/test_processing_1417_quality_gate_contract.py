from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class ProcessingBenchmarkQualityGateContractTests(unittest.TestCase):
    def test_physical_handoff_is_current_and_metadata_only(self):
        runner = (ROOT / "tools/acceptance/run-processing-benchmark-physical-gate.ps1").read_text(
            encoding="utf-8"
        )
        verifier = (
            ROOT / "tools/acceptance/verify-processing-benchmark-quality-handoff.ps1"
        ).read_text(encoding="utf-8")

        self.assertIn("HumanReferenceJson", runner)
        self.assertIn("Assert-BenchmarkEvidence", runner)
        self.assertIn("evidence = $evidence", runner)
        self.assertIn("prepared_artifacts_fresh_worker_per_profile+async_telemetry_v2", runner)

        self.assertIn("/export.zip", verifier)
        self.assertIn("/references", verifier)
        self.assertIn("/quality", verifier)
        self.assertIn('contract = "issue-1417"', verifier)
        self.assertIn("contains_transcript = $false", verifier)
        self.assertIn("contains_reference_text = $false", verifier)
        self.assertIn("contains_token = $false", verifier)
        self.assertIn("contains_local_paths = $false", verifier)
        self.assertNotIn("transcript_text =", verifier)
        self.assertNotIn("reference_text =", verifier)

    def test_required_ci_owns_the_benchmark_quality_gate(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        config = (ROOT / "playwright.benchmark-quality.config.ts").read_text(
            encoding="utf-8"
        )

        self.assertIn("benchmark-quality-gate:", workflow)
        self.assertIn("- benchmark-quality-gate", workflow)
        self.assertIn("BENCHMARK_QUALITY_RESULT:", workflow)
        self.assertIn("needs.benchmark-quality-gate.result", workflow)
        self.assertIn("test_benchmark_quality.py", workflow)
        self.assertIn("test_benchmark_quality_api.py", workflow)
        self.assertIn("benchmark-quality-protocol.test.ts", workflow)
        self.assertIn("playwright.benchmark-quality.config.ts", workflow)
        self.assertIn('name: "mobile-390"', config)
        self.assertIn('name: "desktop-1366"', config)
        self.assertIn('name: "desktop-1920"', config)


if __name__ == "__main__":
    unittest.main()
