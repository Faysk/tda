from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

from . import VERSION
from .agent import AgentController, wait_until_ready
from .pairing import TOKEN_PATTERN, ensure_pairing_token
from .paths import default_paths, migrate_v02_layout
from .settings import SettingsStore
from .startup import set_start_with_windows
from .system_log import SystemLog

PRODUCTION_ORIGIN = "https://dnd.faysk.dev"
PROCESSING_URL = f"{PRODUCTION_ORIGIN}/edit/processamento"


def default_roots() -> tuple[Path, Path]:
    paths = default_paths()
    return paths.state_root, paths.data_root


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


def _entry_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, "-m", "tda_companion.windows_app"]


def _agent_arguments(args: argparse.Namespace) -> list[str]:
    values = [
        "--agent",
        "--state-root",
        str(args.state_root),
        "--data-root",
        str(args.data_root),
        "--logs-root",
        str(args.logs_root),
        "--port",
        str(args.port),
    ]
    for origin in sorted(args.origins):
        values.extend(["--origin", origin])
    return values


def ensure_agent_running(args: argparse.Namespace) -> subprocess.Popen | None:
    if wait_until_ready(args.port, timeout=0.6):
        return None
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    process = subprocess.Popen(
        _entry_command() + _agent_arguments(args),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=creationflags,
    )
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"LOCAL_AGENT_EXITED:{process.returncode}")
        if wait_until_ready(args.port, timeout=0.3):
            return process
    raise RuntimeError("LOCAL_AGENT_START_TIMEOUT")


def run_gui(token: str, args: argparse.Namespace) -> None:
    """Transitional UI. Product UI moves to WebView2; this window no longer owns the Agent."""
    import tkinter as tk

    root = tk.Tk()
    root.title("TDA Companion")
    root.geometry("620x370")
    root.minsize(620, 370)
    root.maxsize(620, 370)

    frame = tk.Frame(root, padx=26, pady=24)
    frame.pack(fill="both", expand=True)

    tk.Label(frame, text="TDA Companion", font=("Segoe UI", 20, "bold")).pack(anchor="w")
    tk.Label(frame, text=f"Agent local do TDA • v{VERSION}", font=("Segoe UI", 10)).pack(anchor="w", pady=(2, 18))

    status = tk.StringVar(value=f"Agente ativo • 127.0.0.1:{args.port}")
    tk.Label(frame, textvariable=status, font=("Segoe UI", 11, "bold")).pack(anchor="w")
    tk.Label(
        frame,
        text="Fechar esta janela não interrompe o processamento. O Agent continua rodando em segundo plano.",
        wraplength=550,
        justify="left",
        font=("Segoe UI", 9),
    ).pack(anchor="w", pady=(2, 18))

    tk.Label(frame, text="Token de pareamento", font=("Segoe UI", 9, "bold")).pack(anchor="w")
    token_row = tk.Frame(frame)
    token_row.pack(fill="x", pady=(6, 4))
    token_var = tk.StringVar(value=token)
    tk.Entry(token_row, textvariable=token_var, state="readonly", font=("Consolas", 9)).pack(
        side="left", fill="x", expand=True
    )

    def copy_token() -> None:
        root.clipboard_clear()
        root.clipboard_append(token)
        status.set("Token copiado")
        root.after(2200, lambda: status.set(f"Agente ativo • 127.0.0.1:{args.port}"))

    tk.Button(token_row, text="Copiar", command=copy_token, width=10).pack(side="left", padx=(8, 0))
    tk.Label(
        frame,
        text="Cole este token em Edit → Processamento. Ele permanece somente neste computador e na memória da aba.",
        wraplength=550,
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
        command=lambda: os.startfile(args.state_root.parent) if os.name == "nt" else None,
        width=18,
    ).pack(side="left", padx=(8, 0))

    tk.Label(
        frame,
        text="Esta é a interface de transição. A próxima etapa substitui esta janela pelo Desktop WebView2 do Design System TDA.",
        wraplength=550,
        justify="left",
        font=("Segoe UI", 8),
    ).pack(anchor="w", pady=(24, 0))

    root.protocol("WM_DELETE_WINDOW", root.destroy)
    root.mainloop()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    paths = default_paths()
    parser = argparse.ArgumentParser(prog="TDACompanion")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--agent", action="store_true")
    mode.add_argument("--ui", action="store_true")
    mode.add_argument("--headless", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--startup", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--state-root", type=Path, default=paths.state_root)
    parser.add_argument("--data-root", type=Path, default=paths.data_root)
    parser.add_argument("--logs-root", type=Path, default=paths.logs_root)
    parser.add_argument("--origin", action="append")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--diagnostic-file", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("INVALID_PORT")
    origins = args.origin or [PRODUCTION_ORIGIN]
    try:
        args.origins = frozenset(validate_origin(origin) for origin in origins)
    except ValueError as exc:
        parser.error(str(exc))
    if args.headless:
        args.agent = True
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    diagnostic_file: Path | None = args.diagnostic_file
    _write_diagnostic(diagnostic_file, "BOOTSTRAP")
    try:
        defaults = default_paths()
        if args.state_root.resolve() == defaults.state_root.resolve() and args.data_root.resolve() == defaults.data_root.resolve():
            migrate_v02_layout(defaults)
        args.state_root.mkdir(parents=True, exist_ok=True)
        args.data_root.mkdir(parents=True, exist_ok=True)
        args.logs_root.mkdir(parents=True, exist_ok=True)
        token = ensure_pairing_token(args.state_root / "pairing-token.txt")
        _write_diagnostic(diagnostic_file, "TOKEN_READY")
        system_log = SystemLog(args.logs_root)

        if args.agent:
            system_log.write("info", "bootstrap", "AGENT_BOOTSTRAP", "TDA Companion Agent starting", {"version": VERSION})
            controller = AgentController(args.data_root, token, args.origins, args.port, system_log)
            controller.run_forever(on_ready=lambda: _write_diagnostic(diagnostic_file, "READY"))
            return 0

        ensure_agent_running(args)
        settings = SettingsStore(args.state_root / "settings.json")
        if os.name == "nt":
            set_start_with_windows(bool(settings.snapshot()["start_with_windows"]), Path(sys.executable))
        _write_diagnostic(diagnostic_file, "READY")
        run_gui(token, args)
        return 0
    except BaseException as exc:
        _write_diagnostic(diagnostic_file, "FAILED", _safe_error_detail(exc))
        if args.agent:
            return 1
        try:
            import tkinter as tk
            from tkinter import messagebox

            root = tk.Tk()
            root.withdraw()
            messagebox.showerror(
                "TDA Companion",
                "Não foi possível iniciar o TDA Companion.\n\n"
                f"Código: {_safe_error_detail(exc)}\n\n"
                "Use Diagnóstico ou reinicie o aplicativo.",
            )
            root.destroy()
        finally:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
