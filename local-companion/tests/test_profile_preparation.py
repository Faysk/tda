from __future__ import annotations

import time
from pathlib import Path

import pytest

import tda_companion.profile_preparation as preparation
from tda_companion.profile_preparation import (
    ProfilePreparationError,
    ProfilePreparationManager,
)


def _manager(tmp_path: Path) -> ProfilePreparationManager:
    root = tmp_path / "TDA"
    return ProfilePreparationManager(
        data_root=root / "Data",
        models_root=root / "Models",
        runtime_root=root / "Runtime",
        state_root=root / "State",
        cache_root=root / "Cache",
    )


def test_qwen_preparation_runs_in_background_and_reports_truthful_stages(
    tmp_path: Path,
    monkeypatch,
):
    manager = _manager(tmp_path)
    source_id = "craig-" + "a" * 64
    catalog_calls = 0

    monkeypatch.setattr(
        preparation,
        "load_craig_package",
        lambda _root, verify_tracks=False: object(),
    )

    def catalog(*_args):
        nonlocal catalog_calls
        catalog_calls += 1
        return [
            {
                "id": "qwen-quality",
                "engine": "qwen3",
                "ready": catalog_calls >= 2,
                "preparation_required": catalog_calls < 2,
                "reason": None if catalog_calls >= 2 else "QWEN_RUNTIME_REQUIRED",
            }
        ]

    monkeypatch.setattr(preparation, "profile_catalog", catalog)
    monkeypatch.setattr(
        preparation,
        "_install_qwen_runtime",
        lambda _runtime, _cache: {"status": "ready", "version": "1.0.6"},
    )

    def prepare_qwen(**kwargs):
        kwargs["progress"]("runtime_probe", {"profile_id": "qwen-quality"})
        kwargs["progress"]("physical_gate", {"track_number": 2})
        kwargs["progress"]("physical_gate_ready", {"track_number": 2})
        return {"ready": True}

    monkeypatch.setattr(preparation, "prepare_qwen_profile_from_craig", prepare_qwen)

    started = manager.start(source_id, "qwen-quality")
    assert started["state"] == "running"
    assert started["source_id"] == source_id

    deadline = time.monotonic() + 2
    while manager.snapshot()["active"] is True and time.monotonic() < deadline:
        time.sleep(0.01)

    final = manager.snapshot()
    assert final["state"] == "completed"
    assert final["stage"] == "complete"
    assert final["error_code"] is None
    assert final["elapsed_seconds"] >= 0


def test_preparation_reuses_same_request_and_rejects_competing_work(
    tmp_path: Path,
    monkeypatch,
):
    manager = _manager(tmp_path)
    source_a = "craig-" + "a" * 64
    source_b = "craig-" + "b" * 64
    release = False

    monkeypatch.setattr(
        preparation,
        "load_craig_package",
        lambda _root, verify_tracks=False: object(),
    )
    monkeypatch.setattr(
        preparation,
        "profile_catalog",
        lambda *_args: [
            {
                "id": "whisper-turbo",
                "engine": "whisper",
                "ready": False,
                "preparation_required": True,
                "reason": "WHISPER_RUNTIME_REQUIRED",
            }
        ],
    )

    def install(_runtime, _cache):
        nonlocal release
        deadline = time.monotonic() + 1
        while not release and time.monotonic() < deadline:
            time.sleep(0.01)
        raise preparation.ProfilePreparationError("TEST_STOP")

    monkeypatch.setattr(preparation, "_install_whisper_runtime", install)

    first = manager.start(source_a, "whisper-turbo")
    same = manager.start(source_a, "whisper-turbo")
    assert same["operation_id"] == first["operation_id"]

    with pytest.raises(
        ProfilePreparationError,
        match="TRANSCRIPTION_PREPARATION_ALREADY_RUNNING",
    ):
        manager.start(source_b, "whisper-turbo")

    release = True
