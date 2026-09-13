from __future__ import annotations

from tda_companion.diagnostic_capabilities import (
    build_capabilities,
    capability_rows,
    overall_status,
)


def _check(code: str, status: str = "pass") -> dict[str, str]:
    return {"code": code, "status": status, "message": code}


def _healthy_checks() -> list[dict[str, str]]:
    return [
        _check("agent"),
        _check("state"),
        _check("data"),
        _check("sqlite"),
        _check("disk"),
        _check("network_dns"),
        _check("network_https"),
        _check("network_manifest"),
        _check("network_asset"),
        _check("maintenance_metadata"),
        _check("maintenance_helper"),
        _check("maintenance_update_channel"),
        _check("whisper_runtime"),
        _check("whisper_model_turbo"),
        _check("whisper_model_detailed"),
        _check("qwen_runtime"),
        _check("qwen_aligner"),
        _check("qwen_model_fast"),
        _check("qwen_gate_fast"),
        _check("qwen_model_quality"),
        _check("qwen_gate_quality"),
    ]


def _by_id(capabilities):
    return {value["id"]: value for value in capabilities}


def test_all_capabilities_ready_is_global_pass():
    capabilities = build_capabilities(_healthy_checks())
    assert all(value["status"] == "ready" for value in capabilities)
    assert overall_status(capabilities) == "pass"
    rows = capability_rows(capabilities)
    assert [row["code"] for row in rows] == [
        "capability.core",
        "capability.network",
        "capability.maintenance",
        "capability.whisper",
        "capability.qwen",
    ]


def test_network_failure_does_not_kill_local_processing():
    checks = _healthy_checks()
    next(value for value in checks if value["code"] == "network_dns")["status"] = "fail"
    capabilities = _by_id(build_capabilities(checks))
    assert capabilities["network"]["status"] == "blocked"
    assert capabilities["core"]["status"] == "ready"
    assert capabilities["whisper"]["status"] == "ready"
    assert overall_status(list(capabilities.values())) == "warning"


def test_one_whisper_profile_keeps_capability_usable():
    checks = _healthy_checks()
    next(value for value in checks if value["code"] == "whisper_model_detailed")["status"] = "unavailable"
    capabilities = _by_id(build_capabilities(checks))
    assert capabilities["whisper"]["status"] == "degraded"
    assert capabilities["whisper"]["degraded"] == ["whisper_model_detailed"]


def test_qwen_requires_runtime_aligner_and_one_complete_gated_profile():
    checks = _healthy_checks()
    for code in ("qwen_model_fast", "qwen_gate_fast", "qwen_model_quality", "qwen_gate_quality"):
        next(value for value in checks if value["code"] == code)["status"] = "unavailable"
    capabilities = _by_id(build_capabilities(checks))
    assert capabilities["qwen"]["status"] == "blocked"
    assert "qwen_gate_fast" in capabilities["qwen"]["blockers"]


def test_core_failure_is_global_failure_even_when_asr_is_ready():
    checks = _healthy_checks()
    next(value for value in checks if value["code"] == "state")["status"] = "fail"
    capabilities = build_capabilities(checks)
    assert _by_id(capabilities)["core"]["status"] == "blocked"
    assert overall_status(capabilities) == "fail"


def test_both_asr_engines_blocked_is_global_failure():
    checks = _healthy_checks()
    next(value for value in checks if value["code"] == "whisper_runtime")["status"] = "fail"
    next(value for value in checks if value["code"] == "qwen_runtime")["status"] = "fail"
    capabilities = build_capabilities(checks)
    assert overall_status(capabilities) == "fail"
