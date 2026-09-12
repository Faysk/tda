from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SECRET_KEYS = ("token", "authorization", "cookie", "password", "secret")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sanitize(value: Any, *, depth: int = 0) -> Any:
    if depth > 4:
        return "<max-depth>"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:320]
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in list(value.items())[:32]:
            name = str(key)[:80]
            if any(marker in name.lower() for marker in _SECRET_KEYS):
                clean[name] = "<redacted>"
            else:
                clean[name] = _sanitize(item, depth=depth + 1)
        return clean
    if isinstance(value, (list, tuple)):
        return [_sanitize(item, depth=depth + 1) for item in list(value)[:32]]
    return str(value)[:320]


class SystemLog:
    def __init__(self, root: Path, *, max_bytes: int = 10 * 1024 * 1024, backups: int = 5):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "companion.log"
        self.max_bytes = max(1024, int(max_bytes))
        self.backups = max(1, int(backups))
        self._lock = threading.Lock()

    def _rotate(self, incoming_bytes: int) -> None:
        try:
            current = self.path.stat().st_size
        except FileNotFoundError:
            current = 0
        if current + incoming_bytes <= self.max_bytes:
            return
        oldest = self.root / f"companion.log.{self.backups}"
        oldest.unlink(missing_ok=True)
        for index in range(self.backups - 1, 0, -1):
            source = self.root / f"companion.log.{index}"
            target = self.root / f"companion.log.{index + 1}"
            if source.exists():
                os.replace(source, target)
        if self.path.exists():
            os.replace(self.path, self.root / "companion.log.1")

    def write(
        self,
        level: str,
        component: str,
        code: str,
        message: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        record = {
            "at": _now(),
            "level": level.lower() if level.lower() in {"debug", "info", "warning", "error"} else "info",
            "component": str(component)[:64],
            "code": str(code)[:96],
            "message": str(message)[:512],
            "context": _sanitize(context or {}),
        }
        encoded = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        with self._lock:
            self._rotate(len(encoded))
            with self.path.open("ab") as handle:
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())

    def tail(
        self,
        *,
        limit: int = 200,
        level: str | None = None,
        component: str | None = None,
    ) -> list[dict[str, Any]]:
        limit = min(max(int(limit), 1), 500)
        files = [self.root / f"companion.log.{index}" for index in range(self.backups, 0, -1)] + [self.path]
        rows: list[dict[str, Any]] = []
        for path in files:
            if not path.is_file():
                continue
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line in lines:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(row, dict):
                    continue
                if level and row.get("level") != level:
                    continue
                if component and row.get("component") != component:
                    continue
                rows.append(row)
        return rows[-limit:]
