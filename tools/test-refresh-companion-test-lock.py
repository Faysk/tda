#!/usr/bin/env python3
"""Synthetic regression tests; no registry, GPU, private audio or network."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parent / "refresh-companion-test-lock.py"
SPEC = importlib.util.spec_from_file_location("refresh_companion_test_lock", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

PROJECT = """[project]
dependencies = ["fastapi==0.143.0", "uvicorn==0.54.0"]
[project.optional-dependencies]
test = ["httpx==0.28.1"]
packaging = ["pyinstaller==6.22.3"]
desktop = ["pywebview==6.2.1"]
asr = ["faster-whisper==1.2.1"]
[build-system]
requires = ["setuptools==84.0.0"]
"""


class CompanionDirectLockTests(unittest.TestCase):
    def pins(self, content: str = PROJECT) -> dict[str, tuple[str, str]]:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "pyproject.toml"
            path.write_text(content, encoding="utf-8")
            return MODULE.direct_pins(path)

    def test_direct_extras_and_build_only(self) -> None:
        pins = self.pins()
        self.assertIn("fastapi", pins)
        self.assertIn("pywebview", pins)
        self.assertIn("setuptools", pins)
        self.assertNotIn("faster-whisper", pins)  # isolated ASR runtime

    def test_reconciles_direct_pin_preserving_transitives(self) -> None:
        text = "fastapi==0.142.4\nstarlette==1.6.0\nuvicorn==0.54.0\n"
        result, changes = MODULE.reconcile(text, self.pins())
        self.assertIn("fastapi==0.143.0\n", result)
        self.assertIn("starlette==1.6.0\n", result)
        self.assertIn("fastapi: 0.142.4 -> 0.143.0", changes)
        self.assertEqual(MODULE.reconcile(result, self.pins()), (result, []))

    def test_missing_direct_pin_is_added(self) -> None:
        result, changes = MODULE.reconcile("starlette==1.6.0\n", self.pins())
        self.assertIn("setuptools==84.0.0", result)
        self.assertIn("setuptools: missing -> 84.0.0", changes)

    def test_matching_lock_is_stable(self) -> None:
        pins = {"fastapi": ("fastapi", "0.143.0")}
        text = "# stable\nfastapi==0.143.0\n"
        self.assertEqual(MODULE.reconcile(text, pins), (text, []))

    def test_case_and_separator_canonicalization(self) -> None:
        pins = {"nvidia-ml-py": ("nvidia-ml-py", "13.615.71")}
        result, changes = MODULE.reconcile("NVIDIA_ml.py==13.0.0\n", pins)
        self.assertEqual(result, "NVIDIA_ml.py==13.615.71\n")
        self.assertEqual(changes, ["nvidia-ml-py: 13.0.0 -> 13.615.71"])

    def test_lock_duplicate_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "COMPANION_TEST_LOCK_DUPLICATE"):
            MODULE.reconcile("fastapi==0.142.4\nFastAPI==0.143.0\n", self.pins())

    def test_bad_lock_spec_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "COMPANION_TEST_LOCK_INVALID"):
            MODULE.reconcile("fastapi>=0.143.0\n", self.pins())

    def test_nonexact_direct_dependency_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "COMPANION_DIRECT_PIN_NOT_EXACT"):
            self.pins(PROJECT.replace("fastapi==0.143.0", "fastapi>=0.143.0"))

    def test_missing_expected_extra_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "COMPANION_LOCK_EXTRA_MISSING"):
            self.pins(PROJECT.replace("packaging = [", "other = ["))

    def test_conflicting_direct_pins_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "COMPANION_DIRECT_PIN_CONFLICT"):
            self.pins(PROJECT.replace("uvicorn==0.54.0", "fastapi==0.142.4"))


if __name__ == "__main__":
    unittest.main()
