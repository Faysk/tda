from __future__ import annotations

import tomllib
from pathlib import Path

import tda_companion


def test_runtime_version_matches_package_metadata():
    pyproject = Path(__file__).resolve().parents[1] / "pyproject.toml"
    project = tomllib.loads(pyproject.read_text(encoding="utf-8"))["project"]
    assert tda_companion.VERSION == project["version"]
