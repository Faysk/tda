from __future__ import annotations

import json
from pathlib import Path

from tda_companion.paths import CompanionPaths, migrate_v02_layout
from tda_companion.settings import SettingsStore
from tda_companion.system_log import SystemLog


def test_v02_token_migrates_into_state_without_touching_data(tmp_path: Path):
    paths = CompanionPaths.from_root(tmp_path / "TDA")
    paths.companion_root.mkdir(parents=True)
    paths.data_root.mkdir(parents=True)
    token = "a" * 43
    (paths.companion_root / "pairing-token.txt").write_text(token + "\n", encoding="utf-8")
    database = paths.data_root / "jobs.sqlite3"
    database.write_bytes(b"existing-data")

    result = migrate_v02_layout(paths)

    assert (paths.state_root / "pairing-token.txt").read_text(encoding="utf-8").strip() == token
    assert database.read_bytes() == b"existing-data"
    assert result["migrated"] == ["pairing-token"]
    assert "DnDScribe" not in str(paths.root)


def test_migration_is_idempotent(tmp_path: Path):
    paths = CompanionPaths.from_root(tmp_path / "TDA")
    paths.companion_root.mkdir(parents=True)
    (paths.companion_root / "pairing-token.txt").write_text("b" * 43 + "\n", encoding="utf-8")
    first = migrate_v02_layout(paths)
    second = migrate_v02_layout(paths)
    assert first == second


def test_system_log_redacts_sensitive_context_and_filters(tmp_path: Path):
    log = SystemLog(tmp_path / "logs", max_bytes=4096, backups=2)
    log.write("info", "agent", "READY", "Agent ready", {"token": "never-log-this", "port": 8765})
    log.write("warning", "gpu", "GPU_BUSY", "GPU busy", {"utilization": 99})

    rows = log.tail(limit=10)
    assert len(rows) == 2
    assert rows[0]["context"]["token"] == "<redacted>"
    assert "never-log-this" not in (tmp_path / "logs" / "companion.log").read_text(encoding="utf-8")
    assert log.tail(limit=10, level="warning")[0]["code"] == "GPU_BUSY"
    assert log.tail(limit=10, component="agent")[0]["code"] == "READY"


def test_settings_are_validated_and_persisted(tmp_path: Path):
    store = SettingsStore(tmp_path / "settings.json")
    assert store.snapshot()["close_behavior"] == "hide"
    value = store.update({"theme": "dark", "show_tray": False})
    assert value["theme"] == "dark"
    assert value["show_tray"] is False
    on_disk = json.loads((tmp_path / "settings.json").read_text(encoding="utf-8"))
    assert on_disk["theme"] == "dark"
