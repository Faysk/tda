from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import VERSION
from .agent import wait_until_ready
from .asr_runtime import inspect_whisper_runtime
from .paths import CompanionPaths
from .system_log import SystemLog
from .telemetry import SystemTelemetry


def _check(code: str, status: str, message: str, detail: str | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"code": code, "status": status, "message": message}
    if detail:
        value["detail"] = detail[:240]
    return value


def _writable_check(path: Path, code: str) -> dict[str, Any]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix="tda-check-", dir=path)
        os.close(fd)
        Path(temporary).unlink(missing_ok=True)
        return _check(code, "pass", "Diretório gravável")
    except OSError as exc:
        return _check(code, "fail", "Diretório não está gravável", type(exc).__name__)


def _sqlite_check(path: Path) -> dict[str, Any]:
    if not path.exists():
        return _check("sqlite", "unavailable", "Banco local ainda não foi criado")
    try:
        db = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=3)
        try:
            row = db.execute("PRAGMA integrity_check").fetchone()
        finally:
            db.close()
        if row and row[0] == "ok":
            return _check("sqlite", "pass", "Banco local íntegro")
        return _check("sqlite", "fail", "SQLite integrity_check encontrou problema")
    except sqlite3.Error as exc:
        return _check("sqlite", "fail", "Não foi possível validar o banco local", type(exc).__name__)


def _webview2_check() -> dict[str, Any]:
    if os.name != "nt":
        return _check("webview2", "unavailable", "WebView2 é específico do Windows")
    try:
        import winreg

        locations = [
            (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\EdgeUpdate\Clients"),
            (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\EdgeUpdate\Clients"),
        ]
        for hive, path in locations:
            try:
                with winreg.OpenKey(hive, path) as clients:
                    count = winreg.QueryInfoKey(clients)[0]
                    for index in range(count):
                        name = winreg.EnumKey(clients, index)
                        with winreg.OpenKey(clients, name) as child:
                            try:
                                product, _ = winreg.QueryValueEx(child, "name")
                            except FileNotFoundError:
                                product = ""
                            if "webview2" in str(product).lower():
                                try:
                                    version, _ = winreg.QueryValueEx(child, "pv")
                                except FileNotFoundError:
                                    version = "detectado"
                                return _check("webview2", "pass", "WebView2 Runtime disponível", str(version))
            except FileNotFoundError:
                continue
        return _check("webview2", "warning", "WebView2 Runtime não foi localizado no registro")
    except Exception as exc:
        return _check("webview2", "warning", "Não foi possível consultar WebView2", type(exc).__name__)


def _whisper_runtime_check(paths: CompanionPaths) -> dict[str, Any]:
    state = inspect_whisper_runtime(paths.runtime_root, verify_worker=True)
    status = state.get("status")
    version = state.get("version")
    if status == "missing":
        return _check("whisper_runtime", "unavailable", "Runtime Whisper ainda não está instalado")
    if status != "ready":
        return _check(
            "whisper_runtime",
            "fail",
            "Runtime Whisper falhou na verificação de integridade",
            f"versão {version}" if version else None,
        )
    worker = state.get("worker")
    if not isinstance(worker, str):
        return _check("whisper_runtime", "fail", "Executável do runtime Whisper não foi localizado")
    try:
        process = subprocess.run(
            [worker, "--probe"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
            timeout=12,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if process.returncode != 0 or len(process.stdout.encode("utf-8")) > 16 * 1024:
            return _check("whisper_runtime", "fail", "Probe do runtime Whisper falhou")
        value = json.loads(process.stdout)
        if not isinstance(value, dict) or value.get("schema") != "tda_whisper_runtime_probe_v1" or value.get("ready") is not True:
            return _check("whisper_runtime", "fail", "Probe do runtime Whisper retornou estado inválido")
        cuda_devices = value.get("cuda_device_count")
        detail = (
            f"v{version} · faster-whisper {value.get('faster_whisper', '—')} · "
            f"CTranslate2 {value.get('ctranslate2', '—')} · CUDA devices {cuda_devices}"
        )
        return _check("whisper_runtime", "pass", "Runtime Whisper íntegro e executável", detail)
    except (OSError, subprocess.TimeoutExpired, UnicodeError, json.JSONDecodeError) as exc:
        return _check("whisper_runtime", "fail", "Não foi possível executar o probe do runtime Whisper", type(exc).__name__)


def run_diagnostics(paths: CompanionPaths, port: int) -> dict[str, Any]:
    agent_ready = wait_until_ready(port, timeout=0.5)
    checks = [
        _check(
            "agent",
            "pass" if agent_ready else "fail",
            "Agent local respondendo" if agent_ready else "Agent local não respondeu",
        ),
        _writable_check(paths.state_root, "state"),
        _writable_check(paths.data_root, "data"),
        _sqlite_check(paths.data_root / "jobs.sqlite3"),
        _webview2_check(),
        _whisper_runtime_check(paths),
    ]

    try:
        usage = shutil.disk_usage(paths.data_root)
        free_gib = usage.free / (1024**3)
        checks.append(
            _check(
                "disk",
                "pass" if free_gib >= 10 else "warning",
                f"{free_gib:.1f} GiB livres no volume de dados",
            )
        )
    except OSError as exc:
        checks.append(_check("disk", "warning", "Espaço livre indisponível", type(exc).__name__))

    telemetry = SystemTelemetry().snapshot()
    gpus = telemetry.get("gpus") or []
    checks.append(
        _check(
            "nvidia",
            "pass" if gpus else "unavailable",
            "GPU NVIDIA detectada" if gpus else "GPU/NVML NVIDIA indisponível",
            str(gpus[0].get("name")) if gpus else None,
        )
    )

    overall = "pass"
    statuses = {row["status"] for row in checks}
    if "fail" in statuses:
        overall = "fail"
    elif "warning" in statuses:
        overall = "warning"
    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "version": VERSION,
        "overall": overall,
        "checks": checks,
        "system": telemetry,
    }


def export_diagnostics(paths: CompanionPaths, port: int, destination: Path | None = None) -> Path:
    report = run_diagnostics(paths, port)
    if destination is None:
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
        destination = paths.root / f"TDA-Diagnostico-{stamp}.zip"
    destination.parent.mkdir(parents=True, exist_ok=True)

    log = SystemLog(paths.logs_root)
    logs = log.tail(limit=500)
    manifest = {
        "schema": "tda_diagnostics_v1",
        "version": VERSION,
        "contains_audio": False,
        "contains_transcript": False,
        "contains_pairing_token": False,
    }

    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("diagnostics.json", json.dumps(report, ensure_ascii=False, indent=2))
        archive.writestr("logs.json", json.dumps(logs, ensure_ascii=False, indent=2))
    return destination
