from __future__ import annotations

import re
import threading
import time
from pathlib import Path
from typing import Callable
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

_BACKGROUND_DOWNLOAD_CODE = "DOWNLOAD_CONTINUES_IN_BACKGROUND"
_UPDATE_MAX_SECONDS = 2 * 60 * 60
_CODE = re.compile(r"^[A-Z0-9_]{1,96}$")


class QwenRuntimeMaintenanceError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _error_code(exc: BaseException) -> str:
    code = getattr(exc, "code", None)
    if isinstance(code, str) and _CODE.fullmatch(code):
        return code
    value = str(exc).strip()
    if _CODE.fullmatch(value):
        return value
    return "QWEN_RUNTIME_UPDATE_FAILED"


def _installed_version(state: dict[str, object]) -> str | None:
    value = state.get("version")
    return value if isinstance(value, str) else None


def _compatible_current_version(state: dict[str, object]) -> str | None:
    version = _installed_version(state)
    if state.get("status") != "ready" or version is None:
        return None
    return version


def _manifest_snapshot(
    state: dict[str, object],
    manifest: QwenRuntimeDownloadManifest,
) -> dict[str, object]:
    compatible = qwen_runtime_version_compatible(manifest.version)
    current = _compatible_current_version(state)
    update_available = (
        compatible and qwen_runtime_update_available(current, manifest)
    )
    return {
        "installed_status": str(state.get("status") or "unknown"),
        "installed_version": _installed_version(state),
        "minimum_version": MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
        "stable_status": "compatible" if compatible else "below_minimum",
        "stable_version": manifest.version,
        "stable_tag": manifest.tag,
        "stable_size": manifest.bundle.archive_size,
        "stable_part_count": len(manifest.bundle.parts),
        "update_available": update_available,
        "can_update": update_available,
    }


def inspect_qwen_runtime_update(
    runtime_root: Path,
    *,
    verify_worker: bool = True,
    manifest_fetcher: Callable[[], QwenRuntimeDownloadManifest] = fetch_qwen_runtime_manifest,
) -> dict[str, object]:
    state = inspect_qwen_runtime(runtime_root, verify_worker=verify_worker)
    base: dict[str, object] = {
        "installed_status": str(state.get("status") or "unknown"),
        "installed_version": _installed_version(state),
        "minimum_version": MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
        "stable_status": "unknown",
        "stable_version": None,
        "stable_tag": None,
        "stable_size": None,
        "stable_part_count": None,
        "update_available": None,
        "can_update": False,
    }
    try:
        manifest = manifest_fetcher()
    except Exception as exc:
        return {
            **base,
            "stable_status": "unavailable",
            "error_code": _error_code(exc),
        }
    return {**base, **_manifest_snapshot(state, manifest), "error_code": None}


def install_qwen_runtime_update(
    runtime_root: Path,
    cache_root: Path,
    *,
    manifest_fetcher: Callable[[], QwenRuntimeDownloadManifest] = fetch_qwen_runtime_manifest,
    downloader: Callable[..., Path] = download_qwen_runtime,
    is_cancelled: Callable[[], bool] | None = None,
    on_stage: Callable[[str], None] | None = None,
) -> dict[str, object]:
    def check_cancelled() -> None:
        if is_cancelled is not None and is_cancelled():
            raise QwenRuntimeMaintenanceError("QWEN_RUNTIME_UPDATE_CANCELLED")

    check_cancelled()
    if on_stage is not None:
        on_stage("checking")
    state = inspect_qwen_runtime(runtime_root, verify_worker=True)
    manifest = manifest_fetcher()
    if not qwen_runtime_version_compatible(manifest.version):
        raise QwenRuntimeMaintenanceError("QWEN_RUNTIME_STABLE_INCOMPATIBLE")

    current = _compatible_current_version(state)
    if not qwen_runtime_update_available(current, manifest):
        return {
            "accepted": False,
            "status": state.get("status"),
            "version": _installed_version(state),
            **_manifest_snapshot(state, manifest),
        }

    target = runtime_root.resolve() / "qwen" / manifest.version
    repairing = bool(
        (state.get("status") == "corrupt" and state.get("version") == manifest.version)
        or target.exists()
        or target.is_symlink()
    )

    if on_stage is not None:
        on_stage("downloading")
    deadline = time.monotonic() + _UPDATE_MAX_SECONDS
    while True:
        check_cancelled()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise QwenRuntimeMaintenanceError("QWEN_RUNTIME_UPDATE_TIMEOUT")
        try:
            archive = downloader(
                manifest,
                cache_root,
                timeout=min(300.0, remaining),
            )
            break
        except NetworkError as exc:
            if exc.code != _BACKGROUND_DOWNLOAD_CODE:
                raise
            if time.monotonic() >= deadline:
                raise QwenRuntimeMaintenanceError(
                    "QWEN_RUNTIME_UPDATE_TIMEOUT"
                ) from exc
            time.sleep(min(1.0, max(0.0, deadline - time.monotonic())))

    if not isinstance(archive, Path):
        raise QwenRuntimeMaintenanceError("QWEN_RUNTIME_DOWNLOAD_INVALID")
    check_cancelled()

    if on_stage is not None:
        on_stage("installing")
    installed = install_qwen_runtime_archive(
        archive,
        runtime_root,
        version=manifest.version,
        expected_sha256=manifest.bundle.archive_sha256,
        replace_corrupt=repairing,
    )

    check_cancelled()
    if on_stage is not None:
        on_stage("verifying")
    verified = inspect_qwen_runtime(runtime_root, verify_worker=True)
    if (
        verified.get("status") != "ready"
        or verified.get("version") != manifest.version
        or not qwen_runtime_version_compatible(manifest.version)
    ):
        raise QwenRuntimeMaintenanceError("QWEN_RUNTIME_INSTALL_VERIFY_FAILED")

    return {
        "accepted": True,
        "status": "ready",
        "version": manifest.version,
        "worker_sha256": installed.get("worker_sha256"),
        "repaired": repairing,
        **_manifest_snapshot(verified, manifest),
    }


class QwenRuntimeMaintenanceManager:
    """One-at-a-time browser-visible Qwen Runtime maintenance operation.

    The browser only starts/checks the operation. Manifest discovery, verified
    download and atomic runtime replacement remain local to the Companion.
    """

    def __init__(
        self,
        *,
        runtime_root: Path,
        cache_root: Path,
        system_log: SystemLog | None = None,
        manifest_fetcher: Callable[[], QwenRuntimeDownloadManifest] = fetch_qwen_runtime_manifest,
    ):
        self.runtime_root = runtime_root.resolve()
        self.cache_root = cache_root.resolve()
        self.system_log = system_log
        self.manifest_fetcher = manifest_fetcher
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._cancel = threading.Event()
        self._state: dict[str, object] = {
            "schema": "tda_qwen_runtime_maintenance_v1",
            "state": "idle",
            "active": False,
            "operation_id": None,
            "mode": None,
            "stage": "idle",
            "title": "Qwen Runtime",
            "detail": "Aguardando verificação.",
            "sequence": 0,
            "installed_status": "unknown",
            "installed_version": None,
            "minimum_version": MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
            "stable_status": "unknown",
            "stable_version": None,
            "stable_tag": None,
            "stable_size": None,
            "stable_part_count": None,
            "update_available": None,
            "can_update": False,
            "error_code": None,
        }

    def _log(self, level: str, code: str, message: str) -> None:
        if self.system_log is not None:
            self.system_log.write(level, "runtime", code, message, {})

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return dict(self._state)

    def request_cancel(self) -> bool:
        with self._lock:
            active = self._state.get("active") is True
            if active:
                self._cancel.set()
            return active

    def wait(self, timeout: float | None = None) -> bool:
        with self._lock:
            thread = self._thread
        if thread is None:
            return True
        thread.join(timeout=timeout)
        return not thread.is_alive()

    def _set(self, **changes: object) -> None:
        with self._lock:
            self._state.update(changes)
            self._state["sequence"] = int(self._state.get("sequence") or 0) + 1

    def _stage(self, stage: str) -> None:
        copy = {
            "checking": (
                "Verificando Qwen Runtime…",
                "Conferindo versão instalada e Stable oficial.",
            ),
            "downloading": (
                "Baixando Qwen Runtime…",
                "O Companion está baixando e verificando as partes oficiais.",
            ),
            "installing": (
                "Instalando Qwen Runtime…",
                "Substituição local atômica em andamento.",
            ),
            "verifying": (
                "Verificando instalação…",
                "Conferindo worker, versão e integridade após a troca.",
            ),
        }
        title, detail = copy.get(stage, ("Atualizando Qwen Runtime…", "Operação local em andamento."))
        self._set(stage=stage, title=title, detail=detail)

    def _start(self, mode: str) -> dict[str, object]:
        with self._lock:
            if self._state.get("active") is True or (
                self._thread is not None and self._thread.is_alive()
            ):
                if self._state.get("mode") == mode:
                    return dict(self._state)
                raise QwenRuntimeMaintenanceError("QWEN_RUNTIME_MAINTENANCE_BUSY")

            operation_id = uuid4().hex
            self._cancel.clear()
            self._state.update(
                {
                    "state": "running",
                    "active": True,
                    "operation_id": operation_id,
                    "mode": mode,
                    "stage": "checking",
                    "title": "Verificando Qwen Runtime…",
                    "detail": "Conferindo versão instalada e Stable oficial.",
                    "error_code": None,
                    "sequence": int(self._state.get("sequence") or 0) + 1,
                }
            )
            initial = dict(self._state)
            self._thread = threading.Thread(
                target=self._run,
                args=(operation_id, mode),
                name=f"tda-qwen-runtime-{mode}",
                daemon=True,
            )
            self._thread.start()
            return initial

    def start_check(self) -> dict[str, object]:
        return self._start("check")

    def start_update(self) -> dict[str, object]:
        return self._start("update")

    def _run(self, operation_id: str, mode: str) -> None:
        try:
            if mode == "check":
                result = inspect_qwen_runtime_update(
                    self.runtime_root,
                    verify_worker=True,
                    manifest_fetcher=self.manifest_fetcher,
                )
            else:
                result = install_qwen_runtime_update(
                    self.runtime_root,
                    self.cache_root,
                    manifest_fetcher=self.manifest_fetcher,
                    is_cancelled=self._cancel.is_set,
                    on_stage=self._stage,
                )
            with self._lock:
                if self._state.get("operation_id") != operation_id:
                    return
                self._state.update(result)
                self._state.update(
                    {
                        "state": "completed",
                        "active": False,
                        "stage": "complete",
                        "title": (
                            "Qwen Runtime atualizado."
                            if mode == "update" and result.get("accepted") is True
                            else "Qwen Runtime verificado."
                        ),
                        "detail": (
                            "Prontidão será recalculada pelo Companion."
                            if mode == "update" and result.get("accepted") is True
                            else "Estado local e Stable oficial conferidos."
                        ),
                        "error_code": result.get("error_code"),
                        "sequence": int(self._state.get("sequence") or 0) + 1,
                    }
                )
            self._log(
                "info",
                "QWEN_RUNTIME_UPDATE_COMPLETED" if mode == "update" else "QWEN_RUNTIME_CHECK_COMPLETED",
                "Qwen Runtime maintenance operation completed.",
            )
        except Exception as exc:
            code = _error_code(exc)
            try:
                local = inspect_qwen_runtime(self.runtime_root, verify_worker=False)
                installed_status = str(local.get("status") or "unknown")
                installed_version = _installed_version(local)
            except Exception:
                installed_status = "unknown"
                installed_version = None
            with self._lock:
                if self._state.get("operation_id") != operation_id:
                    return
                self._state.update(
                    {
                        "state": "failed",
                        "active": False,
                        "stage": "failed",
                        "title": "Não foi possível atualizar o Qwen Runtime."
                        if mode == "update"
                        else "Não foi possível verificar a Stable do Qwen Runtime.",
                        "detail": "Tente novamente ou abra Diagnóstico.",
                        "installed_status": installed_status,
                        "installed_version": installed_version,
                        "error_code": code,
                        "update_available": None,
                        "can_update": False,
                        "sequence": int(self._state.get("sequence") or 0) + 1,
                    }
                )
            self._log("error", code, "Qwen Runtime maintenance operation failed.")
