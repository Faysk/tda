from __future__ import annotations

from typing import Any

LABELS = {
    "core": "Núcleo local",
    "network": "Rede e canal online",
    "maintenance": "Atualização e manutenção",
    "whisper": "Transcrição Whisper",
    "qwen": "Transcrição Qwen",
}


def _status(checks: dict[str, dict[str, Any]], code: str) -> str:
    value = checks.get(code)
    return str(value.get("status") or "unavailable") if value else "unavailable"


def _not_pass(checks: dict[str, dict[str, Any]], codes: tuple[str, ...]) -> list[str]:
    return [code for code in codes if _status(checks, code) != "pass"]


def _summary(
    capability_id: str,
    blockers: list[str],
    degraded: list[str] | None = None,
) -> dict[str, Any]:
    blockers = list(dict.fromkeys(blockers))
    degraded = [
        code for code in dict.fromkeys(degraded or []) if code not in blockers
    ]
    if blockers:
        status = "blocked"
        severity = "blocker"
        message = "Bloqueado por " + ", ".join(blockers[:4])
    elif degraded:
        status = "degraded"
        severity = "degraded"
        message = "Disponível com limitação em " + ", ".join(degraded[:4])
    else:
        status = "ready"
        severity = "info"
        message = "Pronto para uso"
    return {
        "id": capability_id,
        "label": LABELS[capability_id],
        "status": status,
        "severity": severity,
        "message": message,
        "blockers": blockers,
        "degraded": degraded,
    }


def build_capabilities(checks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    values = {
        str(check.get("code")): check
        for check in checks
        if isinstance(check, dict) and isinstance(check.get("code"), str)
    }

    core_blockers = _not_pass(values, ("agent", "state", "data"))
    if _status(values, "sqlite") == "fail":
        core_blockers.append("sqlite")
    core_degraded = ["disk"] if _status(values, "disk") == "warning" else []
    core = _summary("core", core_blockers, core_degraded)

    network_codes = (
        "network_dns",
        "network_https",
        "network_manifest",
        "network_asset",
    )
    network = _summary("network", _not_pass(values, network_codes))

    maintenance_codes = (
        "maintenance_metadata",
        "maintenance_helper",
        "maintenance_update_channel",
    )
    maintenance = _summary("maintenance", _not_pass(values, maintenance_codes))

    whisper_models = ("whisper_model_turbo", "whisper_model_detailed")
    whisper_blockers: list[str] = []
    if _status(values, "whisper_runtime") != "pass":
        whisper_blockers.append("whisper_runtime")
    ready_whisper = [code for code in whisper_models if _status(values, code) == "pass"]
    whisper_degraded: list[str] = []
    if not ready_whisper:
        whisper_blockers.extend(_not_pass(values, whisper_models))
    elif len(ready_whisper) < len(whisper_models):
        whisper_degraded.extend(_not_pass(values, whisper_models))
    whisper = _summary("whisper", whisper_blockers, whisper_degraded)

    qwen_blockers: list[str] = []
    if _status(values, "qwen_runtime") != "pass":
        qwen_blockers.append("qwen_runtime")
    if _status(values, "qwen_aligner") != "pass":
        qwen_blockers.append("qwen_aligner")
    qwen_profiles = (
        ("qwen_model_fast", "qwen_gate_fast"),
        ("qwen_model_quality", "qwen_gate_quality"),
    )
    ready_qwen = [
        pair
        for pair in qwen_profiles
        if all(_status(values, code) == "pass" for code in pair)
    ]
    qwen_degraded: list[str] = []
    if not ready_qwen:
        for pair in qwen_profiles:
            qwen_blockers.extend(_not_pass(values, pair))
    elif len(ready_qwen) < len(qwen_profiles):
        for pair in qwen_profiles:
            if pair not in ready_qwen:
                qwen_degraded.extend(_not_pass(values, pair))
    qwen = _summary("qwen", qwen_blockers, qwen_degraded)

    return [core, network, maintenance, whisper, qwen]


def overall_status(capabilities: list[dict[str, Any]]) -> str:
    values = {
        str(capability.get("id")): str(capability.get("status"))
        for capability in capabilities
    }
    if values.get("core") == "blocked":
        return "fail"
    if values.get("whisper") == "blocked" and values.get("qwen") == "blocked":
        return "fail"
    if any(status != "ready" for status in values.values()):
        return "warning"
    return "pass"


def capability_rows(capabilities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    status_map = {"ready": "pass", "degraded": "warning", "blocked": "fail"}
    rows: list[dict[str, Any]] = []
    for capability in capabilities:
        status = str(capability.get("status") or "blocked")
        rows.append(
            {
                "code": f"capability.{capability.get('id')}",
                "status": status_map.get(status, "fail"),
                "message": str(capability.get("message") or "Estado indisponível"),
                "detail": str(capability.get("label") or "Capability"),
            }
        )
    return rows
