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
