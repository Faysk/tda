from __future__ import annotations

import importlib.util
import io
import json
import urllib.error
from pathlib import Path

import pytest


def _load_tool():
    path = Path(__file__).parents[2] / "tools" / "check-companion-dependency-freshness.py"
    spec = importlib.util.spec_from_file_location("tda_dependency_freshness_tool", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _json_response(value):
    return io.BytesIO(json.dumps(value).encode("utf-8"))


def test_registry_fetch_retries_transient_transport_failure(monkeypatch):
    tool = _load_tool()
    attempts = iter(
        [
            urllib.error.URLError(ConnectionResetError(104, "reset")),
            urllib.error.URLError(TimeoutError("timeout")),
            _json_response({"info": {"version": "1.2.3"}}),
        ]
    )
    sleeps: list[int] = []

    def fake_urlopen(_request, timeout):  # noqa: ANN001
        assert timeout == 20
        value = next(attempts)
        if isinstance(value, BaseException):
            raise value
        return value

    monkeypatch.setattr(tool.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(tool.time, "sleep", sleeps.append)

    assert tool.fetch_json("https://pypi.org/pypi/example/json") == {
        "info": {"version": "1.2.3"}
    }
    assert sleeps == [1, 2]


def test_registry_fetch_retries_429_and_5xx_only(monkeypatch):
    tool = _load_tool()
    attempts = iter(
        [
            urllib.error.HTTPError("https://pypi.org/x", 503, "busy", {}, None),
            _json_response({"ok": True}),
        ]
    )
    sleeps: list[int] = []

    def fake_urlopen(_request, timeout):  # noqa: ANN001
        value = next(attempts)
        if isinstance(value, BaseException):
            raise value
        return value

    monkeypatch.setattr(tool.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(tool.time, "sleep", sleeps.append)

    assert tool.fetch_json("https://pypi.org/x") == {"ok": True}
    assert sleeps == [1]

    permanent = urllib.error.HTTPError(
        "https://pypi.org/missing", 404, "missing", {}, None
    )
    monkeypatch.setattr(
        tool.urllib.request,
        "urlopen",
        lambda _request, timeout: (_ for _ in ()).throw(permanent),
    )
    sleeps.clear()
    with pytest.raises(urllib.error.HTTPError) as captured:
        tool.fetch_json("https://pypi.org/missing")
    assert captured.value.code == 404
    assert sleeps == []


def test_registry_fetch_fails_closed_after_bounded_retries(monkeypatch):
    tool = _load_tool()
    calls = 0
    sleeps: list[int] = []

    def fail(_request, timeout):  # noqa: ANN001
        nonlocal calls
        calls += 1
        raise urllib.error.URLError(ConnectionResetError(104, "reset"))

    monkeypatch.setattr(tool.urllib.request, "urlopen", fail)
    monkeypatch.setattr(tool.time, "sleep", sleeps.append)

    with pytest.raises(
        tool.DependencyRegistryUnavailable,
        match="DEPENDENCY_REGISTRY_UNAVAILABLE:https://pypi.org/pypi/example/json",
    ):
        tool.fetch_json("https://pypi.org/pypi/example/json")

    assert calls == 4
    assert sleeps == [1, 2, 4]


def test_python_exception_is_control_plane_metadata_not_qwen_package_input():
    tool = _load_tool()
    _pins, _sources, python_pin, _lock, exceptions = tool.collect()

    assert python_pin == "3.12.14"
    assert exceptions["python"]["version"] == python_pin
    assert "physically accepted Python 3.12.14" in exceptions["python"]["reason"]

    qwen = json.loads(tool.QWEN_RUNTIME.read_text(encoding="utf-8"))
    assert "python" not in qwen.get("dependency_freshness_exceptions", {})

    control = json.loads(tool.CONTROL_EXCEPTIONS.read_text(encoding="utf-8"))
    assert control["schema"] == "tda_companion_dependency_freshness_exceptions_v1"
    assert control["exceptions"]["python"]["version"] == python_pin


def test_duplicate_exception_ownership_fails_closed():
    tool = _load_tool()
    target = {
        "python": {
            "version": "3.12.14",
            "reason": "Existing exact compatibility exception with enough detail.",
        }
    }
    with pytest.raises(
        RuntimeError,
        match="DEPENDENCY_FRESHNESS_EXCEPTION_DUPLICATE:control:python",
    ):
        tool._merge_exceptions(
            target,
            {
                "python": {
                    "version": "3.12.14",
                    "reason": "Duplicate exact compatibility exception with enough detail.",
                }
            },
            "control",
        )


def test_python_patch_exception_is_exact_and_machine_readable(monkeypatch, capsys):
    tool = _load_tool()
    monkeypatch.setattr(
        tool,
        "collect",
        lambda: (
            {},
            {},
            "3.12.14",
            {},
            {
                "python": {
                    "version": "3.12.14",
                    "reason": "Keep the accepted runtime baseline while a separately versioned rebuild validates the newer patch.",
                }
            },
        ),
    )
    monkeypatch.setattr(tool, "latest_python_312", lambda: "3.12.15")

    assert tool.main() == 0
    output = capsys.readouterr().out
    assert "python: 3.12.14 -> 3.12.15 [COMPATIBILITY EXCEPTION]" in output
    assert "accepted runtime baseline" in output


def test_python_patch_without_exact_exception_fails_closed(monkeypatch, capsys):
    tool = _load_tool()
    monkeypatch.setattr(
        tool,
        "collect",
        lambda: ({}, {}, "3.12.14", {}, {}),
    )
    monkeypatch.setattr(tool, "latest_python_312", lambda: "3.12.15")

    assert tool.main() == 1
    captured = capsys.readouterr()
    assert "python: 3.12.14 -> 3.12.15 [STALE]" in captured.out
    assert "python: pinned 3.12.14, latest 3.12 patch 3.12.15" in captured.err


def test_whisper_pyav_compatibility_exception_is_exact_and_runtime_owned():
    tool = _load_tool()
    pins, sources, _python_pin, _lock, exceptions = tool.collect()

    assert pins["whisper/av"] == "18.1.0"
    assert sources["whisper/av"] == ["whisper-windows-x64.json"]
    assert pins["qwen/av"] == "19.0.1"
    assert sources["qwen/av"] == ["qwen-windows-x64.json"]
    assert exceptions["whisper/av"]["version"] == pins["whisper/av"]
    assert "Faster-Whisper 1.2.1" in exceptions["whisper/av"]["reason"]
    assert "WAV/FLAC decode smoke" in exceptions["whisper/av"]["reason"]

    whisper = json.loads(tool.WHISPER_RUNTIME.read_text(encoding="utf-8"))
    assert whisper["dependency_freshness_exceptions"]["av"]["version"] == "18.1.0"
