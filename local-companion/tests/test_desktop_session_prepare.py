from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import tda_companion.desktop_session_bridge as session_bridge
from tda_companion.desktop_session_bridge import SessionDesktopBridge


def _bridge(tmp_path: Path) -> SessionDesktopBridge:
    paths = SimpleNamespace(
        root=tmp_path,
        state_root=tmp_path / "State",
        data_root=tmp_path / "Data",
        cache_root=tmp_path / "Cache",
        models_root=tmp_path / "Models",
        runtime_root=tmp_path / "Runtime",
        logs_root=tmp_path / "Logs",
    )
    settings = SimpleNamespace(snapshot=lambda: {}, update=lambda value: value)
    bridge = SessionDesktopBridge(
        token="t" * 43,
        port=8765,
        paths=paths,
        settings=settings,
        executable=tmp_path / "TDACompanion.exe",
        start_agent=lambda: None,
    )
    bridge._has_running_job = lambda: False  # type: ignore[method-assign]
    return bridge


def _source_id() -> str:
    return "craig-" + "a" * 64


def test_prepare_whisper_installs_runtime_and_defers_model_to_job(tmp_path: Path):
    bridge = _bridge(tmp_path)
    source_id = _source_id()
    bridge._selected_sources.add(source_id)
    states = iter(
        [
            {"profiles": [{"id": "whisper-detailed", "ready": False}]},
            {"profiles": [{"id": "whisper-detailed", "ready": True}]},
        ]
    )
    bridge.transcription_profiles = lambda: next(states)  # type: ignore[method-assign]
    bridge.install_whisper_runtime = lambda: {  # type: ignore[method-assign]
        "accepted": True,
        "version": "1.1.0",
    }

    value = bridge.prepare_transcription_profile(source_id, "whisper-detailed")

    assert value == {
        "ready": True,
        "profile_id": "whisper-detailed",
        "prepared": True,
        "runtime_version": "1.1.0",
        "model_prepare_on_job": True,
    }


def test_prepare_qwen_installs_runtime_runs_real_gate_then_requires_capability(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    source_id = _source_id()
    bridge._selected_sources.add(source_id)
    states = iter(
        [
            {"profiles": [{"id": "qwen-quality", "ready": False}]},
            {"profiles": [{"id": "qwen-quality", "ready": True}]},
        ]
    )
    bridge.transcription_profiles = lambda: next(states)  # type: ignore[method-assign]
    bridge.install_qwen_runtime = lambda: {  # type: ignore[method-assign]
        "accepted": True,
        "version": "1.0.1",
    }
    seen: dict[str, object] = {}

    def fake_prepare(**kwargs):
        seen.update(kwargs)
        return {
            "ready": True,
            "profile_id": "qwen-quality",
            "gpu_name": "NVIDIA GeForce RTX 4070 Laptop GPU",
            "audio_seconds": 180.0,
        }

    monkeypatch.setattr(session_bridge, "prepare_qwen_profile_from_craig", fake_prepare)
    value = bridge.prepare_transcription_profile(source_id, "qwen-quality")

    assert value["ready"] is True
    assert value["prepared"] is True
    assert value["runtime_version"] == "1.0.1"
    assert value["gpu_name"] == "NVIDIA GeForce RTX 4070 Laptop GPU"
    assert seen["source_id"] == source_id
    assert seen["profile_id"] == "qwen-quality"
    assert seen["models_root"] == tmp_path / "Models"


def test_prepare_blocks_while_transcription_is_running(tmp_path: Path):
    bridge = _bridge(tmp_path)
    source_id = _source_id()
    bridge._selected_sources.add(source_id)
    bridge._has_running_job = lambda: True  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB"):
        bridge.prepare_transcription_profile(source_id, "qwen-quality")
