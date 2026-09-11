from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

DEFAULT_SETTINGS: dict[str, Any] = {
    "schema": 1,
    "start_with_windows": True,
    "show_tray": True,
    "check_updates": True,
    "theme": "system",
    "close_behavior": "hide",
}


class SettingsStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        if not self.path.exists():
            self._write(dict(DEFAULT_SETTINGS))

    def _read(self) -> dict[str, Any]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = {}
        value = dict(DEFAULT_SETTINGS)
        if isinstance(raw, dict):
            for key in DEFAULT_SETTINGS:
                if key in raw:
                    value[key] = raw[key]
        return value

    def _write(self, value: dict[str, Any]) -> None:
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, self.path)

    @staticmethod
    def _validate(value: dict[str, Any]) -> None:
        for key in ("start_with_windows", "show_tray", "check_updates"):
            if not isinstance(value.get(key), bool):
                raise ValueError(f"INVALID_SETTING:{key}")
        if value.get("theme") not in {"system", "light", "dark"}:
            raise ValueError("INVALID_SETTING:theme")
        if value.get("close_behavior") not in {"hide", "close_ui"}:
            raise ValueError("INVALID_SETTING:close_behavior")

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            value = self._read()
            self._validate(value)
            return value

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        allowed = set(DEFAULT_SETTINGS) - {"schema"}
        if any(key not in allowed for key in changes):
            raise ValueError("INVALID_SETTING_KEY")
        with self._lock:
            value = self._read()
            value.update(changes)
            self._validate(value)
            self._write(value)
            return value
