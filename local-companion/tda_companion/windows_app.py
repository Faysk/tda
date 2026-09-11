from __future__ import annotations

import argparse
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

import uvicorn

from . import VERSION
from .api import create_app
from .__main__ import RootLock

PRODUCTION_ORIGIN = "https://dnd.faysk.dev"
PROCESSING_URL = f"{PRODUCTION_ORIGIN}/edit/processamento"
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43,256}$")


def default_roots() -> tuple[Path, Path]:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        root = Path(local_app_data) / "TDA"
    else:
        root = Path.home() / ".tda"
    return root / "Companion", root / "Data"


def validate_origin(origin: str) -> str:
    parsed = urlsplit(origin)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username
        or "*" in origin
        or (parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost"))
    ):
        raise ValueError("EXACT_HTTPS_OR_LOOPBACK_ORIGIN_REQUIRED")
    return origin


def _write_diagnostic(path: Path | None, status: str, detail: str | None = None) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_detail = "" if detail is None else re.sub(r"[^A-Za-z0-9_.:-]", "_", detail)[:160]
    line = status if not safe_detail else f"{status}:{safe_detail}"
    path.write_text(line + "\n", encoding="utf-8")


def _safe_error_detail(exc: BaseException) -> str:
    if isinstance(exc, ModuleNotFoundError):
        return f"ModuleNotFoundError.{exc.name or 'unknown'}"
    if isinstance(exc, (RuntimeError, ValueError)):
        text = str(exc)
        safe = re.sub(r"[^A-Za-z0-9_.:-]", "_", text)[:120]
        if safe:
            return f"{type(exc).__name__}.{safe}"
    return type(exc).__name__


def _windows_identity() -> str:
    completed = subprocess.run(
        ["whoami"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    identity = completed.stdout.strip()
    if not identity:
        raise RuntimeError("WINDOWS_IDENTITY_UNAVAILABLE")
    return identity


def harden_token_file(path: Path) -> None:
    if os.name != "nt":
        path.chmod(0o600)
        return
    identity = _windows_identity()
    completed = subprocess.run(
        [
            "icacls",
            str(path),
            "/inheritance:r",
            "/grant:r",
            f"{identity}:(F)",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if completed.returncode != 0:
        raise RuntimeError("TOKEN_ACL_FAILED")


def ensure_pairing_token(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        token = path.read_text(encoding="utf-8").strip()
        if not TOKEN_PATTERN.fullmatch(token):
            raise RuntimeError("INVALID_EXISTING_PAIRING_TOKEN")
        harden_token_file(path)
        return token

    token = secrets.token_urlsafe(32)
    if not TOKEN_PATTERN.fullmatch(token):
        raise RuntimeError("PAIRING_TOKEN_GENERATION_FAILED")
    path.write_text(token + "\n", encoding="utf-8")
    harden_token_file(path)
    return token


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


class ServerController:
    def __init__(self, data_root: Path, token: str, origins: frozenset[str], port: int):
        self.data_root = data_root
        self.token = token
        self.origins = origins
        self.port = port
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

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.lock = RootLock(self.data_root)
        self.lock.__enter__()
        try:
            app = create_app(self.data_root, self.token, self.origins, self.port)
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
            self.thread = threading.Thread(
                target=self._serve,
                name="tda-companion-http",
                daemon=True,
            )
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
        if self.server is not None:
            self.server.should_exit = True
        if self.thread is not None and self.thread.is_alive():
            self.thread.join(timeout=5)
        self.server = None
        self.thread = None
        if self.lock is not None:
            self.lock.__exit__(None, None, None)
            self.lock = None


def run_headless(controller: ServerController, diagnostic_file: Path | None = None) -> None:
    controller.start()
    _write_diagnostic(diagnostic_file, "READY")
    try:
        while controller.thread is not None and controller.thread.is_alive():
            time.sleep(0.25)
        if controller.server_error is not None:
            raise RuntimeError(f"LOCAL_SERVICE_RUNTIME_FAILED:{type(controller.server_error).__name__}")
    finally:
        controller.stop()


def run_gui(controller: ServerController, token: str, state_root: Path) -> None:
    import tkinter as tk

    root = tk.Tk()
    root.title("TDA Companion")
    root.geometry("560x330")
    root.minsize(560, 330)
    root.maxsize(560, 330)

    frame = tk.Frame(root, padx=24, pady=22)
    frame.pack(fill="both", expand=True)

    tk.Label(frame, text="TDA Companion", font=("Segoe UI", 20, "bold")).pack(anchor="w")
    tk.Label(
        frame,
        text=f"Processamento local do TDA • v{VERSION}",
        font=("Segoe UI", 10),
    ).pack(anchor="w", pady=(2, 18))

    status = tk.StringVar(value="Conectado • 127.0.0.1:%d" % controller.port)
    tk.Label(frame, textvariable=status, font=("Segoe UI", 11, "bold")).pack(anchor="w")
    tk.Label(
        frame,
        text="O serviço fica disponível somente neste computador.",
        font=("Segoe UI", 9),
    ).pack(anchor="w", pady=(2, 18))

    tk.Label(frame, text="Token de pareamento", font=("Segoe UI", 9, "bold")).pack(anchor="w")
    token_row = tk.Frame(frame)
    token_row.pack(fill="x", pady=(6, 4))
    token_var = tk.StringVar(value=token)
    token_entry = tk.Entry(token_row, textvariable=token_var, state="readonly", font=("Consolas", 9))
    token_entry.pack(side="left", fill="x", expand=True)

    def copy_token() -> None:
        root.clipboard_clear()
        root.clipboard_append(token)
        status.set("Token copiado para a área de transferência")
        root.after(2500, lambda: status.set("Conectado • 127.0.0.1:%d" % controller.port))

    tk.Button(token_row, text="Copiar", command=copy_token, width=10).pack(side="left", padx=(8, 0))
    tk.Label(
        frame,
        text="Cole este token em Edit → Processamento. Ele permanece apenas neste PC e na memória da aba.",
        wraplength=500,
        justify="left",
        font=("Segoe UI", 8),
    ).pack(anchor="w", pady=(0, 18))

    actions = tk.Frame(frame)
    actions.pack(fill="x")
    tk.Button(
        actions,
        text="Abrir Processamento no TDA",
        command=lambda: webbrowser.open(PROCESSING_URL),
        width=28,
    ).pack(side="left")
    tk.Button(
        actions,
        text="Abrir pasta local",
        command=lambda: os.startfile(state_root.parent) if os.name == "nt" else None,
        width=18,
    ).pack(side="left", padx=(8, 0))

    def close() -> None:
        status.set("Encerrando…")
        root.update_idletasks()
        controller.stop()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.mainloop()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    state_default, data_default = default_roots()
    parser = argparse.ArgumentParser(prog="TDACompanion")
    parser.add_argument("--state-root", type=Path, default=state_default)
    parser.add_argument("--data-root", type=Path, default=data_default)
    parser.add_argument("--origin", action="append")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--diagnostic-file", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("INVALID_PORT")
    origins = args.origin or [PRODUCTION_ORIGIN]
    try:
        args.origins = frozenset(validate_origin(origin) for origin in origins)
    except ValueError as exc:
        parser.error(str(exc))
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    diagnostic_file: Path | None = args.diagnostic_file
    _write_diagnostic(diagnostic_file, "BOOTSTRAP")
    controller: ServerController | None = None
    try:
        state_root: Path = args.state_root
        data_root: Path = args.data_root
        state_root.mkdir(parents=True, exist_ok=True)
        token = ensure_pairing_token(state_root / "pairing-token.txt")
        _write_diagnostic(diagnostic_file, "TOKEN_READY")

        controller = ServerController(data_root, token, args.origins, args.port)
        if args.headless:
            run_headless(controller, diagnostic_file)
            return 0

        controller.start()
        _write_diagnostic(diagnostic_file, "READY")
        run_gui(controller, token, state_root)
        return 0
    except BaseException as exc:
        _write_diagnostic(diagnostic_file, "FAILED", _safe_error_detail(exc))
        if args.headless:
            return 1
        try:
            import tkinter as tk
            from tkinter import messagebox

            root = tk.Tk()
            root.withdraw()
            messagebox.showerror(
                "TDA Companion",
                "Não foi possível iniciar o serviço local.\n\n"
                f"Código: {_safe_error_detail(exc)}\n\n"
                "Feche outra instância do TDA Companion e tente novamente.",
            )
            root.destroy()
        finally:
            if controller is not None:
                controller.stop()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
