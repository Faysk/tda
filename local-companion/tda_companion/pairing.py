from __future__ import annotations

import os
import re
import secrets
import subprocess
from pathlib import Path

TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43,256}$")


def _windows_identity() -> str:
    completed = subprocess.run(
        ["whoami"],
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
        creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0),
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
        ["icacls", str(path), "/inheritance:r", "/grant:r", f"{identity}:(F)"],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        raise RuntimeError("TOKEN_ACL_FAILED")


def _new_token() -> str:
    token = secrets.token_urlsafe(32)
    if not TOKEN_PATTERN.fullmatch(token):
        raise RuntimeError("PAIRING_TOKEN_GENERATION_FAILED")
    return token


def ensure_pairing_token(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        token = path.read_text(encoding="utf-8").strip()
        if not TOKEN_PATTERN.fullmatch(token):
            raise RuntimeError("INVALID_EXISTING_PAIRING_TOKEN")
        harden_token_file(path)
        return token

    return rotate_pairing_token(path)


def rotate_pairing_token(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    token = _new_token()
    temporary = path.with_suffix(".tmp")
    temporary.write_text(token + "\n", encoding="utf-8")
    harden_token_file(temporary)
    os.replace(temporary, path)
    harden_token_file(path)
    return token
