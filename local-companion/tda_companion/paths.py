from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CompanionPaths:
    root: Path
    companion_root: Path
    state_root: Path
    data_root: Path
    logs_root: Path
    cache_root: Path
    models_root: Path
    runtime_root: Path

    @classmethod
    def from_root(cls, root: Path) -> "CompanionPaths":
        root = root.resolve()
        return cls(
            root=root,
            companion_root=root / "Companion",
            state_root=root / "State",
            data_root=root / "Data",
            logs_root=root / "Logs",
            cache_root=root / "Cache",
            models_root=root / "Models",
            runtime_root=root / "Runtime",
        )

    def ensure_runtime_dirs(self) -> None:
        for path in (
            self.state_root,
            self.data_root,
            self.logs_root,
            self.cache_root,
            self.models_root,
            self.runtime_root,
        ):
            path.mkdir(parents=True, exist_ok=True)


def default_paths() -> CompanionPaths:
    local_app_data = os.environ.get("LOCALAPPDATA")
    root = Path(local_app_data) / "TDA" if local_app_data else Path.home() / ".tda"
    return CompanionPaths.from_root(root)


def migrate_v02_layout(paths: CompanionPaths) -> dict[str, object]:
    """Migrate only TDA 0.2 state into the v0.3 roots; never inspect DnDScribe."""
    paths.ensure_runtime_dirs()
    marker = paths.state_root / "migration-v03.json"
    if marker.exists():
        try:
            value = json.loads(marker.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                return value
        except (OSError, json.JSONDecodeError):
            pass

    migrated: list[str] = []
    legacy_token = paths.companion_root / "pairing-token.txt"
    new_token = paths.state_root / "pairing-token.txt"
    if legacy_token.is_file() and not new_token.exists():
        temporary = new_token.with_suffix(".tmp")
        temporary.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(legacy_token, temporary)
        os.replace(temporary, new_token)
        migrated.append("pairing-token")

    value: dict[str, object] = {
        "schema": 1,
        "source": "tda-companion-0.2",
        "migrated": migrated,
    }
    temporary_marker = marker.with_suffix(".tmp")
    temporary_marker.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    os.replace(temporary_marker, marker)
    return value
