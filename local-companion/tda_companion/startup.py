from __future__ import annotations

import os
from pathlib import Path

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "TDA Companion Agent"


def startup_command(executable: Path) -> str:
    resolved = str(executable.resolve())
    return f'"{resolved}" --agent --startup'


def set_start_with_windows(enabled: bool, executable: Path) -> None:
    if os.name != "nt":
        return
    import winreg

    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, RUN_VALUE, 0, winreg.REG_SZ, startup_command(executable))
        else:
            try:
                winreg.DeleteValue(key, RUN_VALUE)
            except FileNotFoundError:
                pass


def start_with_windows_enabled(executable: Path | None = None) -> bool:
    if os.name != "nt":
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_QUERY_VALUE) as key:
            value, kind = winreg.QueryValueEx(key, RUN_VALUE)
    except FileNotFoundError:
        return False
    if kind != winreg.REG_SZ or not isinstance(value, str):
        return False
    if executable is None:
        return bool(value.strip())
    return value == startup_command(executable)
