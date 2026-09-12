from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from . import VERSION
from .agent import wait_until_ready
from .asr_runtime import inspect_whisper_runtime, install_whisper_runtime_archive
from .asr_runtime_updates import (
    download_whisper_runtime,
    fetch_whisper_runtime_manifest,
    whisper_runtime_update_available,
)
from .diagnostics import export_diagnostics, run_diagnostics
from .paths import CompanionPaths
from .qwen_runtime import inspect_qwen_runtime, install_qwen_runtime_archive
from .qwen_runtime_updates import (
    download_qwen_runtime,
    fetch_qwen_runtime_manifest,
    qwen_runtime_update_available,
)
from .settings import SettingsStore
from .startup import set_start_with_windows
from .updates import download_update, fetch_manifest, update_available

PRODUCTION_ORIGIN = "https://dnd.faysk.dev"
PROCESSING_URL = f"{PRODUCTION_ORIGIN}/edit/processamento"


class LocalAgentClient:
    def __init__(self, token: str, port: int):
        self.token = token
        self.port = port
        self.base = f"http://127.0.0.1:{port}/api/v1"

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "Cache-Control": "no-store",
        }
        if body is not None:
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
            headers["Origin"] = PRODUCTION_ORIGIN
        request = urllib.request.Request(
            self.base + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310 - fixed loopback URL
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise RuntimeError("LOCAL_RESPONSE_TOO_LARGE")
                return json.loads(raw.decode("utf-8")) if raw else None
        except urllib.error.HTTPError as exc:
            code = f"HTTP_{exc.code}"
            try:
                payload = json.loads(exc.read(8192).decode("utf-8"))
                code = str(payload.get("error", {}).get("code") or code)
            except Exception:
                pass
            raise RuntimeError(code) from None

    def get(self, path: str) -> Any:
        return self._request("GET", path)

    def post(self, path: str, body: dict[str, Any]) -> Any:
        return self._request("POST", path, body)


class DesktopBridge:
    """Small trusted bridge between local WebView UI and the loopback Agent."""

    def __init__(
        self,
        *,
        token: str,
        port: int,
        paths: CompanionPaths,
        settings: SettingsStore,
        executable: Path,
        start_agent: Callable[[], None],
    ):
        self.token = token
        self.port = port
        self.paths = paths
        self.settings = settings
        self.executable = executable
        self.start_agent = start_agent
        self.client = LocalAgentClient(token, port)
        self._close_desktop: Callable[[], None] | None = None

    def bind_close_desktop(self, callback: Callable[[], None]) -> None:
        self._close_desktop = callback

    @staticmethod
    def _job_counts(jobs: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "processing": sum(1 for job in jobs if job.get("status") == "running"),
            "queued": sum(1 for job in jobs if job.get("status") == "queued"),
            "completed": sum(1 for job in jobs if job.get("status") == "succeeded"),
            "attention": sum(1 for job in jobs if job.get("status") in {"failed", "interrupted"}),
        }

    def _jobs(self) -> list[dict[str, Any]]:
        value = self.client.get("/jobs")
        jobs = value.get("jobs", []) if isinstance(value, dict) else []
        return jobs if isinstance(jobs, list) else []

    def _has_running_job(self) -> bool:
        return any(job.get("status") == "running" for job in self._jobs())

    def snapshot(self) -> dict[str, Any]:
        agent = self.client.get("/agent")
        system = self.client.get("/system")
        jobs = self._jobs()
        try:
            usage = shutil.disk_usage(self.paths.data_root)
            storage = {"free_bytes": usage.free, "total_bytes": usage.total}
        except OSError:
            storage = {"free_bytes": None, "total_bytes": None}
        whisper_runtime = inspect_whisper_runtime(self.paths.runtime_root, verify_worker=False)
        qwen_runtime = inspect_qwen_runtime(self.paths.runtime_root, verify_worker=False)
        return {
            "version": VERSION,
            "agent": agent,
            "system": system,
            "storage": storage,
            "counts": self._job_counts(jobs),
            "jobs": jobs[:12],
            "settings": self.settings.snapshot(),
            "whisper_runtime": {
                "status": whisper_runtime.get("status"),
                "version": whisper_runtime.get("version"),
            },
            "qwen_runtime": {
                "status": qwen_runtime.get("status"),
                "version": qwen_runtime.get("version"),
            },
        }

    def logs(self, level: str | None = None, component: str | None = None, limit: int = 200) -> dict[str, Any]:
        query: dict[str, str] = {"limit": str(min(max(int(limit), 1), 500))}
        if level:
            query["level"] = level
        if component:
            query["component"] = component
        return self.client.get("/logs?" + urllib.parse.urlencode(query))

    def set_queue_paused(self, paused: bool) -> dict[str, Any]:
        return self.client.post("/lifecycle", {"action": "pause" if paused else "resume"})

    def open_tda(self) -> bool:
        return bool(webbrowser.open(PROCESSING_URL))

    def open_local_folder(self) -> bool:
        if os.name != "nt":
            return False
        os.startfile(self.paths.root)  # type: ignore[attr-defined]
        return True

    def open_logs_folder(self) -> bool:
        if os.name != "nt":
            return False
        self.paths.logs_root.mkdir(parents=True, exist_ok=True)
        os.startfile(self.paths.logs_root)  # type: ignore[attr-defined]
        return True

    def pairing_token(self) -> str:
        """Returned only after an explicit local UI action; never sent to cloud/logs."""
        return self.token

    def update_settings(self, changes: dict[str, Any]) -> dict[str, Any]:
        value = self.settings.update(changes)
        if "start_with_windows" in changes and os.name == "nt":
            set_start_with_windows(bool(value["start_with_windows"]), self.executable)
        return value

    def diagnostics(self) -> dict[str, Any]:
        return run_diagnostics(self.paths, self.port)

    def export_diagnostics(self) -> str:
        path = export_diagnostics(self.paths, self.port)
        if os.name == "nt":
            subprocess.run(["explorer.exe", "/select,", str(path)], check=False, timeout=5)
        return str(path)

    def check_update(self) -> dict[str, Any]:
        manifest = fetch_manifest()
        return {
            "current_version": VERSION,
            "available": update_available(VERSION, manifest),
            "version": manifest.version,
            "tag": manifest.tag,
            "size": manifest.size,
        }

    def download_update(self) -> dict[str, Any]:
        manifest = fetch_manifest()
        if not update_available(VERSION, manifest):
            return {"available": False, "version": manifest.version}
        path = download_update(manifest, self.paths.cache_root)
        return {
            "available": True,
            "version": manifest.version,
            "path": str(path),
            "sha256": manifest.sha256,
        }

    def check_whisper_runtime(self) -> dict[str, Any]:
        state = inspect_whisper_runtime(self.paths.runtime_root, verify_worker=True)
        manifest = fetch_whisper_runtime_manifest()
        current_version = state.get("version") if state.get("status") == "ready" else None
        return {
            "status": state.get("status"),
            "current_version": current_version,
            "available": whisper_runtime_update_available(
                current_version if isinstance(current_version, str) else None,
                manifest,
            ),
            "version": manifest.version,
            "tag": manifest.tag,
            "size": manifest.size,
        }

    def install_whisper_runtime(self) -> dict[str, Any]:
        if self._has_running_job():
            raise RuntimeError("RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB")
        state = inspect_whisper_runtime(self.paths.runtime_root, verify_worker=True)
        manifest = fetch_whisper_runtime_manifest()
        current_version = state.get("version") if state.get("status") == "ready" else None
        if not whisper_runtime_update_available(
            current_version if isinstance(current_version, str) else None,
            manifest,
        ):
            return {
                "accepted": False,
                "available": False,
                "status": state.get("status"),
                "version": manifest.version,
            }
        if state.get("status") == "corrupt" and state.get("version") == manifest.version:
            raise RuntimeError("WHISPER_RUNTIME_REPAIR_REQUIRED")
        archive = download_whisper_runtime(manifest, self.paths.cache_root)
        installed = install_whisper_runtime_archive(
            archive,
            self.paths.runtime_root,
            version=manifest.version,
            expected_sha256=manifest.sha256,
        )
        verified = inspect_whisper_runtime(self.paths.runtime_root, verify_worker=True)
        if verified.get("status") != "ready" or verified.get("version") != manifest.version:
            raise RuntimeError("WHISPER_RUNTIME_INSTALL_VERIFY_FAILED")
        return {
            "accepted": True,
            "available": True,
            "status": "ready",
            "version": manifest.version,
            "worker_sha256": installed["worker_sha256"],
        }

    def check_qwen_runtime(self) -> dict[str, Any]:
        state = inspect_qwen_runtime(self.paths.runtime_root, verify_worker=True)
        manifest = fetch_qwen_runtime_manifest()
        current_version = state.get("version") if state.get("status") == "ready" else None
        return {
            "status": state.get("status"),
            "current_version": current_version,
            "installed_version": state.get("version"),
            "available": qwen_runtime_update_available(
                current_version if isinstance(current_version, str) else None,
                manifest,
            ),
            "version": manifest.version,
            "tag": manifest.tag,
            "size": manifest.bundle.archive_size,
            "part_count": len(manifest.bundle.parts),
        }

    def install_qwen_runtime(self) -> dict[str, Any]:
        if self._has_running_job():
            raise RuntimeError("RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB")
        state = inspect_qwen_runtime(self.paths.runtime_root, verify_worker=True)
        manifest = fetch_qwen_runtime_manifest()
        current_version = state.get("version") if state.get("status") == "ready" else None
        if not qwen_runtime_update_available(
            current_version if isinstance(current_version, str) else None,
            manifest,
        ):
            return {
                "accepted": False,
                "available": False,
                "status": state.get("status"),
                "version": manifest.version,
            }
        repairing = state.get("status") == "corrupt" and state.get("version") == manifest.version
        archive = download_qwen_runtime(manifest, self.paths.cache_root)
        installed = install_qwen_runtime_archive(
            archive,
            self.paths.runtime_root,
            version=manifest.version,
            expected_sha256=manifest.bundle.archive_sha256,
            replace_corrupt=repairing,
        )
        verified = inspect_qwen_runtime(self.paths.runtime_root, verify_worker=True)
        if verified.get("status") != "ready" or verified.get("version") != manifest.version:
            raise RuntimeError("QWEN_RUNTIME_INSTALL_VERIFY_FAILED")
        return {
            "accepted": True,
            "available": True,
            "status": "ready",
            "version": manifest.version,
            "worker_sha256": installed["worker_sha256"],
            "repaired": repairing,
            "part_count": len(manifest.bundle.parts),
        }

    def _maintenance_helper(self) -> Path:
        source = self.executable.parent / "TDACompanionMaintenance.exe"
        if not source.is_file():
            raise RuntimeError("MAINTENANCE_HELPER_MISSING")
        staging = self.paths.cache_root / "maintenance"
        staging.mkdir(parents=True, exist_ok=True)
        target = staging / f"TDACompanionMaintenance-{uuid4().hex}.exe"
        shutil.copy2(source, target)
        return target

    @staticmethod
    def _maintenance_creationflags() -> int:
        if os.name != "nt":
            return 0
        return subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP

    def _launch_maintenance(self, arguments: list[str]) -> bool:
        helper = self._maintenance_helper()
        subprocess.Popen(
            [str(helper), *arguments],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=self._maintenance_creationflags(),
        )
        return True

    def install_update(self) -> dict[str, Any]:
        if self._has_running_job():
            raise RuntimeError("UPDATE_BLOCKED_BY_RUNNING_JOB")
        manifest = fetch_manifest()
        if not update_available(VERSION, manifest):
            return {"accepted": False, "available": False, "version": manifest.version}
        msi = download_update(manifest, self.paths.cache_root)
        self._launch_maintenance(
            [
                "--install-update",
                "--root",
                str(self.paths.root),
                "--msi",
                str(msi),
                "--sha256",
                manifest.sha256,
                "--version",
                manifest.version,
                "--parent-pid",
                str(os.getpid()),
                "--port",
                str(self.port),
            ]
        )
        return {"accepted": True, "available": True, "version": manifest.version}

    def uninstall(self, purge: bool = False) -> dict[str, Any]:
        arguments = [
            "--uninstall",
            "--root",
            str(self.paths.root),
            "--parent-pid",
            str(os.getpid()),
            "--port",
            str(self.port),
        ]
        if purge:
            arguments.append("--purge")
        self._launch_maintenance(arguments)
        return {"accepted": True, "purge": bool(purge)}

    def close_desktop(self) -> bool:
        if self._close_desktop is not None:
            self._close_desktop()
        return True

    def restart_agent(self) -> bool:
        self.client.post("/agent/control", {"action": "shutdown", "force": False})
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and wait_until_ready(self.port, timeout=0.2):
            time.sleep(0.1)
        if wait_until_ready(self.port, timeout=0.2):
            raise RuntimeError("AGENT_SHUTDOWN_TIMEOUT")
        self.start_agent()
        if not wait_until_ready(self.port, timeout=10):
            raise RuntimeError("AGENT_RESTART_FAILED")
        return True
