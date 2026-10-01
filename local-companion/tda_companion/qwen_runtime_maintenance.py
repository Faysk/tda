from __future__ import annotations

import re
import threading
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from .network import NetworkError
from .qwen_runtime import inspect_qwen_runtime, install_qwen_runtime_archive
from .qwen_runtime_updates import (
    QwenRuntimeDownloadManifest,
    download_qwen_runtime,
    fetch_qwen_runtime_manifest,
    qwen_runtime_update_available,
)
from .runtime_compat import (
    MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
    qwen_runtime_version_compatible,
)
from .system_log import SystemLog

_SCHEMA = "tda_qwen_runtime_maintenance_v1"
_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,95}$")
_BACKGROUND_DOWNLOAD_CODE = "DOWNLOAD_CONTINUES_IN_BACKGROUND"
_OPERATION_TIMEOUT_SECONDS = 2 * 60 * 60


class QwenRuntimeMaintenanceError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _safe_error_code(exc: BaseException) -> str:
    code = getattr(exc, "code", None)
    if isinstance(code, str) and _ERROR_CODE.fullmatch(code):
        return code
    value = str(exc).strip()
    if _ERROR_CODE.fullmatch(value):
        return value
    return "QWEN_RUNTIME_UPDATE_FAILED"


class QwenRuntimeMaintenanceManager:
    """One-machine Qwen Stable maintenance operation shared with browser UX.

    The browser never receives paths or bytes. It only sees version/readiness
    facts and asks the local Companion to run the existing verified downloader
    and atomic installer.
    """

    def __init__(
        self,
        *,
        runtime_root: Path,
        cache_root: Path,
        system_log: SystemLog | None = None,
    ) -> None:
        self.runtime_root = runtime_root.resolve()
        self.cache_root = cache_root.resolve()
        self.system_log = system_log
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._operation_id: str | None = None
        self._state = "idle"
        self._error_code: str | None = None
        self._stable_status = "unknown"
        self._stable_version: str | None = None
        self._stable_compatible = False
        self._update_available = False
        self._manifest: QwenRuntimeDownloadManifest | None = None

    def _installed_state(self) -> dict[str, Any]:
        return inspect_qwen_runtime(self.runtime_root, verify_worker=False)

    def _set_manifest(
        self,
        manifest: QwenRuntimeDownloadManifest | None,
        *,
        stable_status: str,
    ) -> None:
        installed = self._installed_state()
        current = (
            installed.get("version")
            if installed.get("status") == "ready"
            and isinstance(installed.get("version"), str)
            else None
        )
        self._manifest = manifest
        self._stable_status = stable_status
        self._stable_version = manifest.version if manifest is not None else None
        self._stable_compatible = bool(
            manifest is not None and qwen_runtime_version_compatible(manifest.version)
        )
        self._update_available = bool(
            manifest is not None
            and self._stable_compatible
            and qwen_runtime_update_available(current, manifest)
        )

    def _refresh_manifest(self) -> None:
        try:
            manifest = fetch_qwen_runtime_manifest(timeout=5.0)
        except Exception:
            with self._lock:
                self._set_manifest(None, stable_status="unavailable")
            return
        with self._lock:
            self._set_manifest(manifest, stable_status="available")

    def snapshot(self, *, refresh_manifest: bool = False) -> dict[str, object]:
        if refresh_manifest and not self.active():
            self._refresh_manifest()
        installed = self._installed_state()
        installed_version = installed.get("version")
        if not isinstance(installed_version, str):
            installed_version = None
        with self._lock:
            return {
                "schema": _SCHEMA,
                "state": self._state,
                "active": self._state == "running",
                "operation_id": self._operation_id,
                "installed_status": str(installed.get("status") or "unknown"),
                "installed_version": installed_version,
                "minimum_version": MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
                "stable_status": self._stable_status,
                "stable_version": self._stable_version,
                "stable_compatible": self._stable_compatible,
                "update_available": self._update_available,
                "error_code": self._error_code,
            }

    def active(self) -> bool:
        with self._lock:
            return self._state == "running"

    def start(self) -> dict[str, object]:
        with self._lock:
            if self._state == "running":
                raise QwenRuntimeMaintenanceError(
                    "QWEN_RUNTIME_UPDATE_ALREADY_RUNNING"
                )

        self._refresh_manifest()
        with self._lock:
            manifest = self._manifest
            if manifest is None:
                raise QwenRuntimeMaintenanceError(
                    "QWEN_RUNTIME_MANIFEST_UNAVAILABLE"
                )
            if not self._stable_compatible:
                raise QwenRuntimeMaintenanceError(
                    "QWEN_RUNTIME_STABLE_BELOW_MINIMUM"
                )
            if not self._update_available:
                raise QwenRuntimeMaintenanceError(
                    "QWEN_RUNTIME_UPDATE_NOT_AVAILABLE"
                )
            operation_id = uuid4().hex
            self._operation_id = operation_id
            self._state = "running"
            self._error_code = None
            thread = threading.Thread(
                target=self._run,
                args=(operation_id, manifest),
                name="tda-qwen-runtime-update",
                daemon=True,
            )
            self._thread = thread
            thread.start()
        return self.snapshot(refresh_manifest=False)

    def _download(
        self,
        manifest: QwenRuntimeDownloadManifest,
    ) -> Path:
        deadline = time.monotonic() + _OPERATION_TIMEOUT_SECONDS
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise QwenRuntimeMaintenanceError("QWEN_RUNTIME_UPDATE_TIMEOUT")
            try:
                return download_qwen_runtime(
                    manifest,
                    self.cache_root,
                    timeout=min(300.0, remaining),
                    prefer_bits=True,
                )
            except NetworkError as exc:
                if exc.code != _BACKGROUND_DOWNLOAD_CODE:
                    raise
                if time.monotonic() >= deadline:
                    raise QwenRuntimeMaintenanceError(
                        "QWEN_RUNTIME_UPDATE_TIMEOUT"
                    ) from exc
                time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))

    def _run(
        self,
        operation_id: str,
        manifest: QwenRuntimeDownloadManifest,
    ) -> None:
        try:
            before = inspect_qwen_runtime(self.runtime_root, verify_worker=True)
            target = self.runtime_root / "qwen" / manifest.version
            repairing = bool(
                (
                    before.get("status") == "corrupt"
                    and before.get("version") == manifest.version
                )
                or target.exists()
                or target.is_symlink()
            )
            archive = self._download(manifest)
            install_qwen_runtime_archive(
                archive,
                self.runtime_root,
                version=manifest.version,
                expected_sha256=manifest.bundle.archive_sha256,
                replace_corrupt=repairing,
            )
            verified = inspect_qwen_runtime(self.runtime_root, verify_worker=True)
            if (
                verified.get("status") != "ready"
                or verified.get("version") != manifest.version
                or not qwen_runtime_version_compatible(manifest.version)
            ):
                raise QwenRuntimeMaintenanceError(
                    "QWEN_RUNTIME_INSTALL_VERIFY_FAILED"
                )
            with self._lock:
                if self._operation_id != operation_id:
                    return
                self._state = "completed"
                self._error_code = None
                self._set_manifest(manifest, stable_status="available")
            if self.system_log is not None:
                self.system_log.write(
                    "info",
                    "runtime",
                    "QWEN_RUNTIME_UPDATE_COMPLETED",
                    "Qwen runtime Stable update completed",
                    {
                        "version": manifest.version,
                        "repaired": repairing,
                    },
                )
        except BaseException as exc:
            code = _safe_error_code(exc)
            with self._lock:
                if self._operation_id != operation_id:
                    return
                self._state = "failed"
                self._error_code = code
                self._update_available = True
            if self.system_log is not None:
                self.system_log.write(
                    "error",
                    "runtime",
                    code,
                    "Qwen runtime Stable update failed",
                    {"stable_version": manifest.version},
                )
