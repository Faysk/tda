from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MODULE_PATH = Path(__file__).with_name("qwen_runtime_recovery.py")
SPEC = importlib.util.spec_from_file_location("qwen_runtime_recovery", MODULE_PATH)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


def maintenance(**changes: Any) -> dict[str, Any]:
    value = {
        "schema": "tda_qwen_runtime_maintenance_v1",
        "state": "completed",
        "active": False,
        "operation_id": "synthetic",
        "mode": "check",
        "stage": "complete",
        "installed_status": "ready",
        "installed_version": "1.0.11",
        "minimum_version": "1.0.12",
        "stable_status": "compatible",
        "stable_version": "1.0.12",
        "stable_tag": "companion-qwen-runtime-v1.0.12",
        "stable_size": 123,
        "stable_part_count": 1,
        "update_available": True,
        "can_update": True,
        "error_code": None,
    }
    value.update(changes)
    return value


def capabilities(*, ready: bool, runtime_version: str) -> dict[str, Any]:
    catalog = [
        {
            "id": "whisper-turbo",
            "engine": "whisper",
            "ready": True,
            "preparation_required": False,
            "reason": None,
        },
        {
            "id": "whisper-detailed",
            "engine": "whisper",
            "ready": True,
            "preparation_required": False,
            "reason": None,
        },
    ]
    for profile_id in ("qwen-fast", "qwen-quality"):
        catalog.append(
            {
                "id": profile_id,
                "engine": "qwen3",
                "ready": ready,
                "preparation_required": False,
                "reason": None if ready else "QWEN_RUNTIME_REQUIRED",
                "runtime_version": runtime_version,
            }
        )
    return {
        "capabilities": ["runtime.qwen.check", "runtime.qwen.update"],
        "transcription": {"profiles": [], "catalog": catalog},
    }


class FakeClient:
    def __init__(self, responses: dict[tuple[str, str], list[dict[str, Any]]]):
        self.responses = {key: list(values) for key, values in responses.items()}
        self.calls: list[tuple[str, str]] = []

    def request(self, method: str, path: str, body=None):
        self.calls.append((method, path))
        key = (method, path)
        values = self.responses.get(key)
        if not values:
            raise AssertionError(f"unexpected request: {key}")
        return values.pop(0)


class QwenRuntimeRecoveryAcceptanceTests(unittest.TestCase):
    def test_semver_is_numeric_not_lexicographic(self):
        self.assertTrue(module.version_at_least("1.0.10", "1.0.9"))
        self.assertFalse(module.version_at_least("1.0.9", "1.0.10"))

    def test_happy_path_proves_stale_to_stable_and_four_of_four(self):
        client = FakeClient(
            {
                ("GET", "/health"): [
                    {
                        "product_id": "tda-companion",
                        "api_version": "1",
                        "service_version": "0.3.17",
                    }
                ],
                ("GET", "/capabilities"): [
                    capabilities(ready=False, runtime_version="1.0.11"),
                    capabilities(ready=True, runtime_version="1.0.12"),
                ],
                ("GET", "/qwen-runtime"): [
                    maintenance(state="idle", mode=None, stage="idle"),
                    maintenance(
                        mode="check",
                        state="completed",
                        active=False,
                    ),
                    maintenance(
                        mode="update",
                        state="completed",
                        active=False,
                        installed_version="1.0.12",
                        update_available=False,
                        can_update=False,
                        accepted=True,
                    ),
                ],
                ("POST", "/qwen-runtime/check"): [
                    maintenance(state="running", active=True, mode="check")
                ],
                ("POST", "/qwen-runtime/update"): [
                    maintenance(
                        state="running",
                        active=True,
                        mode="update",
                        stage="downloading",
                        can_update=False,
                    )
                ],
            }
        )

        receipt = module.run_acceptance(
            client,
            expected_companion_version="0.3.17",
            production_fetcher=lambda origin: {
                "commit": "8cab4f31a008f929078fd92fe85420a86779244d",
                "release": "prod-8cab4f31a008",
            },
            sleep=lambda _: None,
            now=lambda: datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc),
        )

        self.assertTrue(receipt["pass"])
        self.assertEqual(receipt["before"]["runtime"]["installed_version"], "1.0.11")
        self.assertEqual(receipt["after"]["runtime"]["installed_version"], "1.0.12")
        self.assertTrue(all(profile["ready"] for profile in receipt["after"]["profiles"]))
        self.assertEqual(
            client.calls.count(("POST", "/qwen-runtime/update")),
            1,
        )
        serialized = json.dumps(receipt).lower()
        self.assertNotIn("bearer ", serialized)
        self.assertNotIn("pairing-token", serialized)
        self.assertFalse(receipt["privacy"]["contains_token"])
        self.assertFalse(receipt["privacy"]["contains_paths"])
        self.assertFalse(receipt["privacy"]["contains_audio"])
        self.assertFalse(receipt["privacy"]["contains_transcript"])

    def test_stable_below_minimum_fails_closed(self):
        checked = maintenance(
            stable_status="below_minimum",
            stable_version="1.0.11",
            update_available=False,
            can_update=False,
        )
        with self.assertRaisesRegex(
            module.RecoveryAcceptanceError,
            "QWEN_RECOVERY_STABLE_BELOW_MINIMUM",
        ):
            module._require_check_contract(
                checked,
                minimum="1.0.12",
                expected_stable=None,
            )

    def test_manifest_unavailable_does_not_promise_update(self):
        checked = maintenance(
            stable_status="unavailable",
            stable_version=None,
            update_available=None,
            can_update=False,
            error_code="NETWORK_UNAVAILABLE",
        )
        with self.assertRaisesRegex(
            module.RecoveryAcceptanceError,
            "QWEN_RECOVERY_STABLE_UNAVAILABLE",
        ):
            module._require_check_contract(
                checked,
                minimum="1.0.12",
                expected_stable=None,
            )

    def test_unknown_installed_version_accepts_only_explicit_runtime_blocker(self):
        profiles = module._catalog_profiles(
            capabilities(ready=False, runtime_version="")
        )
        for profile in profiles.values():
            profile["runtime_version"] = None
            profile["reason"] = "QWEN_RUNTIME_REQUIRED"

        module._require_initial_block(
            profiles,
            maintenance(installed_version=None, installed_status="unknown"),
            "1.0.12",
        )

        for profile in profiles.values():
            profile["reason"] = "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED"
        with self.assertRaisesRegex(
            module.RecoveryAcceptanceError,
            "QWEN_RECOVERY_INITIAL_BLOCK_NOT_REPRODUCED",
        ):
            module._require_initial_block(
                profiles,
                maintenance(installed_version=None, installed_status="unknown"),
                "1.0.12",
            )

    def test_same_version_repairable_runtime_is_valid_initial_recovery(self):
        profiles = module._catalog_profiles(
            capabilities(ready=False, runtime_version="1.0.12")
        )
        checked = maintenance(
            installed_status="corrupt",
            installed_version="1.0.12",
            update_available=True,
            can_update=True,
        )
        module._require_initial_block(profiles, checked, "1.0.12")
        module._require_check_contract(
            checked,
            minimum="1.0.12",
            expected_stable="1.0.12",
        )

    def test_production_preflight_fails_before_runtime_mutation(self):
        client = FakeClient(
            {
                ("GET", "/health"): [
                    {
                        "product_id": "tda-companion",
                        "api_version": "1",
                        "service_version": "0.3.17",
                    }
                ],
            }
        )

        def fail_production(_: str):
            raise module.RecoveryAcceptanceError(
                "QWEN_RECOVERY_PRODUCTION_VERSION_UNAVAILABLE"
            )

        with self.assertRaisesRegex(
            module.RecoveryAcceptanceError,
            "QWEN_RECOVERY_PRODUCTION_VERSION_UNAVAILABLE",
        ):
            module.run_acceptance(
                client,
                expected_companion_version="0.3.17",
                production_fetcher=fail_production,
                sleep=lambda _: None,
            )
        self.assertEqual(client.calls, [("GET", "/health")])

    def test_initial_ready_qwen_cannot_fake_recovery_evidence(self):
        profiles = module._catalog_profiles(
            capabilities(ready=True, runtime_version="1.0.12")
        )
        with self.assertRaisesRegex(
            module.RecoveryAcceptanceError,
            "QWEN_RECOVERY_INITIAL_BLOCK_NOT_REPRODUCED",
        ):
            module._require_initial_block(
                profiles,
                maintenance(installed_version="1.0.11"),
                "1.0.12",
            )

    def test_final_readiness_requires_both_qwen_profiles(self):
        profiles = module._catalog_profiles(
            capabilities(ready=False, runtime_version="1.0.12")
        )
        with self.assertRaisesRegex(
            module.RecoveryAcceptanceError,
            "QWEN_RECOVERY_FINAL_QWEN_NOT_READY",
        ):
            module._require_final_readiness(profiles)

    def test_receipt_privacy_rejects_path_or_token_markers(self):
        for value in (
            {"token_hint": "Bearer secret"},
            {"path": "C:\\Users\\someone\\AppData"},
            {"transcript": "private"},
        ):
            with self.subTest(value=value), self.assertRaisesRegex(
                module.RecoveryAcceptanceError,
                "QWEN_RECOVERY_RECEIPT_PRIVACY_INVALID",
            ):
                module._assert_receipt_privacy(value)


if __name__ == "__main__":
    unittest.main()
