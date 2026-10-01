#!/usr/bin/env python3
"""Physical acceptance for #1210: stale Qwen Runtime -> official Stable -> 4/4 readiness.

This tool is intentionally outside local-companion/packaging so it can evolve as
external acceptance tooling without changing or invalidating immutable Companion
RC package inputs.

It talks only to the installed loopback Agent and the canonical Production
version endpoint. It never reads audio/transcripts, never prints the pairing
token, and writes a sanitized receipt.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

DEFAULT_ORIGIN = "https://dnd.faysk.dev"
DEFAULT_PORT = 8765
DEFAULT_MINIMUM = "1.0.12"
DEFAULT_STABLE = "1.0.12"
REQUIRED_QWEN_PROFILES = ("qwen-fast", "qwen-quality")
RUNTIME_BLOCK_REASONS = frozenset(
    {"QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED", "QWEN_RUNTIME_REQUIRED", "QWEN_GATE_RUNTIME_NOT_READY"}
)
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


class RecoveryAcceptanceError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def version_tuple(value: str) -> tuple[int, int, int]:
    match = SEMVER.fullmatch(value)
    if not match:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_VERSION_INVALID")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def version_at_least(value: str, minimum: str) -> bool:
    return version_tuple(value) >= version_tuple(minimum)


def _record(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RecoveryAcceptanceError(code)
    return value


def _nullable_text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _maintenance_snapshot(value: Any) -> dict[str, Any]:
    row = _record(value, "QWEN_RECOVERY_MAINTENANCE_INVALID")
    if row.get("schema") != "tda_qwen_runtime_maintenance_v1":
        raise RecoveryAcceptanceError("QWEN_RECOVERY_MAINTENANCE_INVALID")
    state = row.get("state")
    if state not in {"idle", "running", "completed", "failed"}:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_MAINTENANCE_INVALID")
    return row


def _catalog_profiles(value: Any) -> dict[str, dict[str, Any]]:
    root = _record(value, "QWEN_RECOVERY_CAPABILITIES_INVALID")
    transcription = _record(
        root.get("transcription"), "QWEN_RECOVERY_CAPABILITIES_INVALID"
    )
    catalog = transcription.get("catalog")
    if not isinstance(catalog, list):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_CAPABILITIES_INVALID")
    result: dict[str, dict[str, Any]] = {}
    for raw in catalog:
        if not isinstance(raw, dict):
            continue
        profile_id = raw.get("id")
        if profile_id in REQUIRED_QWEN_PROFILES:
            result[str(profile_id)] = raw
    if set(result) != set(REQUIRED_QWEN_PROFILES):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_QWEN_PROFILES_MISSING")
    return result


def _profile_receipt(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(profile.get("id") or ""),
        "ready": profile.get("ready") is True,
        "preparation_required": profile.get("preparation_required") is True,
        "reason": _nullable_text(profile.get("reason")),
        "runtime_version": _nullable_text(profile.get("runtime_version")),
    }


def _runtime_receipt(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "state": str(row.get("state") or ""),
        "mode": _nullable_text(row.get("mode")),
        "stage": str(row.get("stage") or ""),
        "installed_status": str(row.get("installed_status") or "unknown"),
        "installed_version": _nullable_text(row.get("installed_version")),
        "minimum_version": _nullable_text(row.get("minimum_version")),
        "stable_status": str(row.get("stable_status") or "unknown"),
        "stable_version": _nullable_text(row.get("stable_version")),
        "stable_tag": _nullable_text(row.get("stable_tag")),
        "update_available": row.get("update_available")
        if isinstance(row.get("update_available"), bool)
        else None,
        "can_update": row.get("can_update") is True,
        "accepted": row.get("accepted") is True,
        "error_code": _nullable_text(row.get("error_code")),
    }


def _error_code_from_http(exc: urllib.error.HTTPError) -> str:
    try:
        raw = exc.read(8192)
        value = json.loads(raw.decode("utf-8")) if raw else {}
        if isinstance(value, dict):
            error = value.get("error")
            if isinstance(error, dict):
                code = error.get("code")
                if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,96}", code):
                    return code
    except Exception:
        pass
    return f"HTTP_{exc.code}"


@dataclass
class AgentClient:
    token: str
    port: int = DEFAULT_PORT
    origin: str = DEFAULT_ORIGIN
    timeout_seconds: float = 30.0

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}/api/v1"

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
            "Cache-Control": "no-store",
            "Origin": self.origin,
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = response.read(1024 * 1024)
        except urllib.error.HTTPError as exc:
            raise RecoveryAcceptanceError(_error_code_from_http(exc)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise RecoveryAcceptanceError("QWEN_RECOVERY_AGENT_UNAVAILABLE") from None
        try:
            value = json.loads(payload.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            raise RecoveryAcceptanceError("QWEN_RECOVERY_AGENT_RESPONSE_INVALID") from None
        return _record(value, "QWEN_RECOVERY_AGENT_RESPONSE_INVALID")


def poll_maintenance(
    client: AgentClient,
    initial: dict[str, Any],
    *,
    timeout_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    observed = _maintenance_snapshot(initial)
    deadline = time.monotonic() + timeout_seconds
    while observed.get("active") is True:
        if time.monotonic() >= deadline:
            raise RecoveryAcceptanceError("QWEN_RECOVERY_MAINTENANCE_TIMEOUT")
        sleep(min(2.0, max(0.05, deadline - time.monotonic())))
        observed = _maintenance_snapshot(client.request("GET", "/qwen-runtime"))
    return observed


def _require_initial_block(
    profiles: dict[str, dict[str, Any]],
    checked: dict[str, Any],
    minimum: str,
) -> None:
    if any(profile.get("ready") is True for profile in profiles.values()):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_INITIAL_BLOCK_NOT_REPRODUCED")

    reasons = {_nullable_text(profile.get("reason")) for profile in profiles.values()}
    if (
        None in reasons
        or not reasons
        or not reasons.issubset(RUNTIME_BLOCK_REASONS)
    ):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_INITIAL_BLOCK_NOT_REPRODUCED")

    # The issue explicitly forbids assuming a particular stale version. A real
    # recovery may start from an unknown version or from a same-version install
    # that the Companion can safely repair. The subsequent check contract is
    # authoritative for whether an official compatible operation is available.
    installed = _nullable_text(checked.get("installed_version"))
    if installed is not None:
        version_tuple(installed)
    version_tuple(minimum)

def _require_check_contract(
    checked: dict[str, Any],
    *,
    minimum: str,
    expected_stable: str | None,
) -> None:
    if checked.get("state") != "completed" or checked.get("active") is True:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_CHECK_NOT_COMPLETED")
    if _nullable_text(checked.get("minimum_version")) != minimum:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_MINIMUM_MISMATCH")
    if checked.get("stable_status") != "compatible":
        if checked.get("stable_status") == "below_minimum":
            raise RecoveryAcceptanceError("QWEN_RECOVERY_STABLE_BELOW_MINIMUM")
        raise RecoveryAcceptanceError("QWEN_RECOVERY_STABLE_UNAVAILABLE")
    stable = _nullable_text(checked.get("stable_version"))
    if stable is None or not version_at_least(stable, minimum):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_STABLE_BELOW_MINIMUM")
    if expected_stable is not None and stable != expected_stable:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_STABLE_VERSION_MISMATCH")
    if checked.get("can_update") is not True or checked.get("update_available") is not True:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_UPDATE_NOT_OFFERED")


def _require_update_contract(
    updated: dict[str, Any],
    *,
    minimum: str,
    expected_stable: str | None,
) -> None:
    if updated.get("state") != "completed" or updated.get("active") is True:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_UPDATE_NOT_COMPLETED")
    if updated.get("mode") != "update":
        raise RecoveryAcceptanceError("QWEN_RECOVERY_UPDATE_MODE_INVALID")
    if updated.get("accepted") is not True:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_UPDATE_NOT_ACCEPTED")
    installed = _nullable_text(updated.get("installed_version"))
    if installed is None or not version_at_least(installed, minimum):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_INSTALLED_VERSION_INVALID")
    if expected_stable is not None and installed != expected_stable:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_INSTALLED_VERSION_MISMATCH")
    if updated.get("error_code") not in (None, ""):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_UPDATE_FAILED")


def _require_final_readiness(profiles: dict[str, dict[str, Any]]) -> None:
    if not all(profile.get("ready") is True for profile in profiles.values()):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_FINAL_QWEN_NOT_READY")


def fetch_production_version(origin: str, timeout_seconds: float = 20.0) -> dict[str, str]:
    request = urllib.request.Request(
        f"{origin.rstrip('/')}/api/version",
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "User-Agent": "tda-qwen-recovery-acceptance/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(128 * 1024)
        value = json.loads(raw.decode("utf-8"))
    except Exception:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_PRODUCTION_VERSION_UNAVAILABLE") from None
    row = _record(value, "QWEN_RECOVERY_PRODUCTION_VERSION_INVALID")
    commit = _nullable_text(row.get("commit"))
    release = _nullable_text(row.get("release"))
    if commit is None or not re.fullmatch(r"[a-f0-9]{40}", commit) or release is None:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_PRODUCTION_VERSION_INVALID")
    return {"commit": commit, "release": release}


def _assert_receipt_privacy(value: Any) -> None:
    forbidden_keys = {
        "authorization",
        "token",
        "pairing_token",
        "pairing-token",
        "path",
        "local_path",
        "audio",
        "audio_sha",
        "audio_sha256",
        "transcript",
        "transcription_text",
    }

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                normalized = str(key).strip().lower()
                if normalized in forbidden_keys:
                    raise RecoveryAcceptanceError(
                        "QWEN_RECOVERY_RECEIPT_PRIVACY_INVALID"
                    )
                visit(child)
            return
        if isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True).lower()
    forbidden_markers = (
        "pairing-token",
        "authorization:",
        "bearer ",
        "localappdata",
        "\\users\\",
        "/users/",
    )
    if any(marker in serialized for marker in forbidden_markers):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_RECEIPT_PRIVACY_INVALID")


def run_acceptance(
    client: AgentClient,
    *,
    expected_companion_version: str,
    minimum_version: str = DEFAULT_MINIMUM,
    expected_stable_version: str | None = DEFAULT_STABLE,
    production_origin: str = DEFAULT_ORIGIN,
    production_fetcher: Callable[[str], dict[str, str]] = fetch_production_version,
    poll_timeout_seconds: float = 2 * 60 * 60,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> dict[str, Any]:
    health = client.request("GET", "/health")
    if health.get("product_id") != "tda-companion" or health.get("api_version") != "1":
        raise RecoveryAcceptanceError("QWEN_RECOVERY_COMPANION_IDENTITY_INVALID")
    service_version = _nullable_text(health.get("service_version"))
    if service_version != expected_companion_version:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_COMPANION_VERSION_MISMATCH")

    # Anchor the evidence to canonical Production before any state-changing
    # local maintenance call. If Production cannot be identified, fail closed.
    production = production_fetcher(production_origin)

    before_capabilities = client.request("GET", "/capabilities")
    before_profiles = _catalog_profiles(before_capabilities)

    existing = _maintenance_snapshot(client.request("GET", "/qwen-runtime"))
    if existing.get("active") is True:
        existing = poll_maintenance(
            client,
            existing,
            timeout_seconds=poll_timeout_seconds,
            sleep=sleep,
        )
    if existing.get("mode") == "update" and existing.get("state") == "completed":
        raise RecoveryAcceptanceError("QWEN_RECOVERY_INITIAL_BLOCK_NOT_REPRODUCED")

    checked = poll_maintenance(
        client,
        client.request("POST", "/qwen-runtime/check", {}),
        timeout_seconds=poll_timeout_seconds,
        sleep=sleep,
    )
    _require_initial_block(before_profiles, checked, minimum_version)
    _require_check_contract(
        checked,
        minimum=minimum_version,
        expected_stable=expected_stable_version,
    )

    updated = poll_maintenance(
        client,
        client.request("POST", "/qwen-runtime/update", {}),
        timeout_seconds=poll_timeout_seconds,
        sleep=sleep,
    )
    _require_update_contract(
        updated,
        minimum=minimum_version,
        expected_stable=expected_stable_version,
    )

    after_capabilities = client.request("GET", "/capabilities")
    after_profiles = _catalog_profiles(after_capabilities)
    _require_final_readiness(after_profiles)

    receipt = {
        "schema": "tda_qwen_runtime_recovery_acceptance_v1",
        "pass": True,
        "accepted_at": now().astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "production": production,
        "companion": {
            "version": service_version,
            "api_version": "1",
        },
        "contract": {
            "minimum_version": minimum_version,
            "expected_stable_version": expected_stable_version,
        },
        "before": {
            "profiles": [_profile_receipt(before_profiles[key]) for key in REQUIRED_QWEN_PROFILES],
            "runtime": _runtime_receipt(checked),
        },
        "after": {
            "profiles": [_profile_receipt(after_profiles[key]) for key in REQUIRED_QWEN_PROFILES],
            "runtime": _runtime_receipt(updated),
        },
        "privacy": {
            "contains_token": False,
            "contains_paths": False,
            "contains_audio": False,
            "contains_transcript": False,
        },
    }
    _assert_receipt_privacy(receipt)
    return receipt


def _default_token_file() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise RecoveryAcceptanceError("LOCALAPPDATA_NOT_FOUND")
    return Path(local) / "TDA" / "State" / "pairing-token.txt"


def _default_output() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise RecoveryAcceptanceError("LOCALAPPDATA_NOT_FOUND")
    root = Path(local) / "TDA" / "State" / "acceptance" / "qwen-runtime-recovery"
    return root / "qwen-runtime-recovery.json"


def _read_token(path: Path) -> str:
    try:
        token = path.read_text(encoding="utf-8").strip()
    except OSError:
        raise RecoveryAcceptanceError("QWEN_RECOVERY_PAIRING_TOKEN_NOT_FOUND") from None
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,256}", token):
        raise RecoveryAcceptanceError("QWEN_RECOVERY_PAIRING_TOKEN_INVALID")
    return token


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            raise RecoveryAcceptanceError("QWEN_RECOVERY_RECEIPT_EXISTS_INVALID") from None
        if existing != receipt:
            raise RecoveryAcceptanceError("QWEN_RECOVERY_RECEIPT_EXISTS_MISMATCH")
        return
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(encoded, encoding="utf-8")
    os.replace(temporary, path)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate #1210 on a real installed Companion without audio/transcript data."
    )
    parser.add_argument("--confirm", required=True, choices=["UPDATE"])
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--origin", default=DEFAULT_ORIGIN)
    parser.add_argument("--expected-companion-version", default="0.3.17")
    parser.add_argument("--minimum-version", default=DEFAULT_MINIMUM)
    parser.add_argument("--expected-stable-version", default=DEFAULT_STABLE)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--poll-timeout-seconds", type=float, default=2 * 60 * 60)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(list(sys.argv[1:] if argv is None else argv))
        if not 1024 <= args.port <= 65535:
            raise RecoveryAcceptanceError("QWEN_RECOVERY_PORT_INVALID")
        if not re.fullmatch(r"https://[^/]+", args.origin):
            raise RecoveryAcceptanceError("QWEN_RECOVERY_ORIGIN_INVALID")
        version_tuple(args.expected_companion_version)
        version_tuple(args.minimum_version)
        if args.expected_stable_version:
            version_tuple(args.expected_stable_version)

        token_file = args.token_file or _default_token_file()
        output = args.output or _default_output()
        token = _read_token(token_file)

        print("TDA #1210 Qwen Runtime recovery acceptance")
        print(f"Companion esperado: {args.expected_companion_version}")
        print(
            f"Contrato Qwen: runtime incompatível/reparável -> Stable "
            f"{args.expected_stable_version} -> qwen-fast/qwen-quality prontos"
        )
        print("Ação explícita autorizada: atualizar o Qwen Runtime pelo Companion local.")

        receipt = run_acceptance(
            AgentClient(token=token, port=args.port, origin=args.origin),
            expected_companion_version=args.expected_companion_version,
            minimum_version=args.minimum_version,
            expected_stable_version=args.expected_stable_version,
            production_origin=args.origin,
            poll_timeout_seconds=args.poll_timeout_seconds,
        )
        _write_receipt(output, receipt)
        print("QWEN RUNTIME RECOVERY ACCEPTANCE: PASS")
        print(f"Production commit: {receipt['production']['commit']}")
        print(f"Production release: {receipt['production']['release']}")
        print(f"Installed runtime: {receipt['after']['runtime']['installed_version']}")
        print("Receipt sanitizado gravado no diretório local de aceite.")
        return 0
    except RecoveryAcceptanceError as exc:
        print(f"QWEN RUNTIME RECOVERY ACCEPTANCE: FAIL {exc.code}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
