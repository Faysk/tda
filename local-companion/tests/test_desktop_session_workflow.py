from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import tda_companion.desktop as desktop
from tda_companion.desktop import DesktopBridge


def _bridge(tmp_path: Path) -> DesktopBridge:
    paths = SimpleNamespace(
        root=tmp_path,
        data_root=tmp_path / "Data",
        cache_root=tmp_path / "Cache",
        runtime_root=tmp_path / "Runtime",
        logs_root=tmp_path / "Logs",
    )
    settings = SimpleNamespace(snapshot=lambda: {}, update=lambda value: value)
    return DesktopBridge(
        token="t" * 43,
        port=8765,
        paths=paths,
        settings=settings,
        executable=tmp_path / "TDACompanion.exe",
        start_agent=lambda: None,
    )


def _source_id() -> str:
    return "craig-" + "a" * 64


def test_select_craig_session_uses_native_callback_without_exposing_path(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    selected_path = tmp_path / "Downloads" / "sessao-sexta.zip"
    bridge.bind_select_craig_zip(lambda: selected_path)
    seen: dict[str, object] = {}

    def fake_ingest(path: Path, data_root: Path):
        seen["path"] = path
        seen["data_root"] = data_root
        return {
            "schema_version": "tda_craig_ingest_v1",
            "source_id": _source_id(),
            "source_sha256": "a" * 64,
            "source_name": "sessao-sexta.zip",
            "size_bytes": 1234,
            "track_count": 2,
            "tracks": [
                {"number": 1, "speaker": "Alice", "size_bytes": 600},
                {"number": 2, "speaker": "Bob", "size_bytes": 634},
            ],
            "recording_id": "recording-1",
            "guild": "TDA",
            "channel": "mesa",
            "start_time": None,
            "reused": False,
        }

    monkeypatch.setattr(desktop, "ingest_craig_file", fake_ingest)
    value = bridge.select_craig_session()

    assert value["selected"] is True
    assert value["source_name"] == "sessao-sexta.zip"
    assert [track["speaker"] for track in value["tracks"]] == ["Alice", "Bob"]
    assert seen == {"path": selected_path, "data_root": tmp_path / "Data"}
    assert str(selected_path) not in repr(value)


def test_select_craig_session_cancel_is_clean(tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge.bind_select_craig_zip(lambda: None)

    assert bridge.select_craig_session() == {"selected": False}


def test_start_craig_transcription_submits_canonical_job_with_idempotency(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    source_id = _source_id()
    bridge._selected_sources.add(source_id)
    monkeypatch.setattr(desktop, "load_craig_package", lambda *_args, **_kwargs: object())
    bridge.transcription_profiles = lambda: {  # type: ignore[method-assign]
        "profiles": [
            {
                "id": "qwen-quality",
                "ready": True,
                "reason": None,
            }
        ]
    }
    seen: dict[str, object] = {}

    def fake_post(path: str, body: dict, *, idempotency_key: str | None = None):
        seen.update(path=path, body=body, idempotency_key=idempotency_key)
        return {"id": "job-1", "status": "queued"}

    bridge.client.post = fake_post  # type: ignore[method-assign]
    value = bridge.start_craig_transcription(
        source_id,
        "qwen-quality",
        glossary="Valindra, Neverwinter",
        context="Sessão de D&D em português.",
    )

    assert value == {"id": "job-1", "status": "queued"}
    assert seen["path"] == "/jobs"
    assert str(seen["idempotency_key"]).startswith("desktop-")
    assert seen["body"] == {
        "kind": "transcription.craig",
        "campaign_id": "desktop-local",
        "session_id": f"local-{source_id[-24:]}",
        "source_id": source_id,
        "profile_id": "qwen-quality",
        "glossary": "Valindra, Neverwinter",
        "context": "Sessão de D&D em português.",
        "cpu": False,
    }


def test_start_craig_transcription_rejects_unselected_source(tmp_path: Path):
    bridge = _bridge(tmp_path)

    with pytest.raises(RuntimeError, match="CRAIG_SOURCE_NOT_SELECTED"):
        bridge.start_craig_transcription(_source_id(), "whisper-detailed")


def test_transcription_profiles_reports_qwen_preparation_requirement(monkeypatch, tmp_path: Path):
    bridge = _bridge(tmp_path)
    bridge.client.get = lambda path: {  # type: ignore[method-assign]
        "transcription": {
            "profiles": ["whisper-turbo", "whisper-detailed"],
            "qwen_physical_gate": {
                "qwen-quality": {"status": "missing", "ready": False},
                "qwen-fast": {"status": "missing", "ready": False},
            },
        }
    }
    monkeypatch.setattr(
        desktop,
        "inspect_whisper_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": "1.1.0"},
    )
    monkeypatch.setattr(
        desktop,
        "inspect_qwen_runtime",
        lambda *_args, **_kwargs: {"status": "ready", "version": "1.0.0"},
    )

    value = bridge.transcription_profiles()
    quality = value["profiles"][0]
    detailed = next(profile for profile in value["profiles"] if profile["id"] == "whisper-detailed")

    assert value["recommended"] == "qwen-quality"
    assert quality["label"] == "Melhor precisão"
    assert quality["ready"] is False
    assert quality["preparation_required"] is True
    assert quality["reason"] == "QWEN_GATE_MISSING"
    assert detailed["ready"] is True
