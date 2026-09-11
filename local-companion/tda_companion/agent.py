from __future__ import annotations

import threading
import time
import urllib.request
from pathlib import Path

import uvicorn

from .__main__ import RootLock
from .api import create_app
from .system_log import SystemLog


def health_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/api/v1/health"


def wait_until_ready(port: int, timeout: float = 8.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(health_url(port), headers={"Cache-Control": "no-store"})
            with urllib.request.urlopen(request, timeout=0.5) as response:  # noqa: S310 - fixed loopback URL
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.1)
    return False


class AgentController:
    """Own the loopback API independently from any desktop window."""

    def __init__(
        self,
        data_root: Path,
        token: str,
        origins: frozenset[str],
        port: int,
        system_log: SystemLog | None = None,
    ):
        self.data_root = data_root
        self.token = token
        self.origins = origins
        self.port = port
        self.system_log = system_log
        self.server: uvicorn.Server | None = None
        self.thread: threading.Thread | None = None
        self.lock: RootLock | None = None
        self.server_error: BaseException | None = None

    def _serve(self) -> None:
        try:
            assert self.server is not None
            self.server.run()
        except BaseException as exc:
            self.server_error = exc

    def request_shutdown(self) -> None:
        if self.server is not None:
            self.server.should_exit = True

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.lock = RootLock(self.data_root)
        self.lock.__enter__()
        try:
            app = create_app(
                self.data_root,
                self.token,
                self.origins,
                self.port,
                system_log=self.system_log,
                shutdown_callback=self.request_shutdown,
            )
            config = uvicorn.Config(
                app,
                host="127.0.0.1",
                port=self.port,
                access_log=False,
                proxy_headers=False,
                server_header=False,
                log_level="critical",
                log_config=None,
            )
            self.server = uvicorn.Server(config)
            self.server_error = None
            self.thread = threading.Thread(target=self._serve, name="tda-companion-http", daemon=True)
            self.thread.start()
            if not wait_until_ready(self.port):
                error = self.server_error
                self.stop()
                if isinstance(error, ModuleNotFoundError):
                    raise RuntimeError(f"LOCAL_SERVICE_MISSING_MODULE:{error.name or 'unknown'}")
                if error is not None:
                    raise RuntimeError(f"LOCAL_SERVICE_RUNTIME_FAILED:{type(error).__name__}")
                raise RuntimeError("LOCAL_SERVICE_START_FAILED")
        except Exception:
            if self.lock is not None:
                self.lock.__exit__(None, None, None)
                self.lock = None
            raise

    def stop(self) -> None:
        self.request_shutdown()
        if self.thread is not None and self.thread.is_alive():
            self.thread.join(timeout=8)
        self.server = None
        self.thread = None
        if self.lock is not None:
            self.lock.__exit__(None, None, None)
            self.lock = None

    def run_forever(self, on_ready=None) -> None:
        self.start()
        if on_ready is not None:
            on_ready()
        try:
            while self.thread is not None and self.thread.is_alive():
                time.sleep(0.25)
            if self.server_error is not None:
                raise RuntimeError(f"LOCAL_SERVICE_RUNTIME_FAILED:{type(self.server_error).__name__}")
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()
