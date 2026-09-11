#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "local-companion" / "pyproject.toml"
TEST_LOCK = ROOT / "local-companion" / "requirements-test.lock"
WHISPER_RUNTIME = ROOT / "local-companion" / "runtime" / "whisper-windows-x64.json"
COMPANION_WORKFLOW = ROOT / ".github" / "workflows" / "companion.yml"

EXACT = re.compile(r"^([A-Za-z0-9_.-]+)==([^;\s]+)$")
PYTHON_312 = re.compile(r"^3\.12\.(\d+)$")
UV_WORKFLOW_PIN = re.compile(r"^\s*version:\s*['\"](\d+\.\d+\.\d+)['\"]\s*$", re.MULTILINE)
PYTHON_WORKFLOW_PIN = re.compile(r"uv venv --python (3\.12\.\d+)")


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def add_pin(pins: dict[str, str], sources: dict[str, list[str]], name: str, version: str, source: str) -> None:
    key = canonical(name)
    previous = pins.get(key)
    if previous is not None and previous != version:
        raise RuntimeError(f"DEPENDENCY_PIN_CONFLICT:{key}:{previous}:{version}")
    pins[key] = version
    sources.setdefault(key, []).append(source)


def parse_exact(spec: str) -> tuple[str, str] | None:
    match = EXACT.fullmatch(spec.strip())
    return (match.group(1), match.group(2)) if match else None


def fetch_json(url: str) -> object:
    headers = {"User-Agent": "TDA-Companion-dependency-audit/1"}
    token = os.environ.get("GITHUB_TOKEN")
    if token and "api.github.com" in url:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - fixed trusted endpoints
        return json.load(response)


def latest_pypi(name: str) -> str:
    value = fetch_json(f"https://pypi.org/pypi/{name}/json")
    if not isinstance(value, dict):
        raise RuntimeError(f"PYPI_RESPONSE_INVALID:{name}")
    info = value.get("info")
    version = info.get("version") if isinstance(info, dict) else None
    if not isinstance(version, str) or not version:
        raise RuntimeError(f"PYPI_VERSION_MISSING:{name}")
    return version


def latest_python_312() -> str:
    versions: list[tuple[int, str]] = []
    for page in range(1, 4):
        value = fetch_json(f"https://api.github.com/repos/python/cpython/tags?per_page=100&page={page}")
        if not isinstance(value, list):
            raise RuntimeError("CPYTHON_TAGS_INVALID")
        for item in value:
            name = item.get("name") if isinstance(item, dict) else None
            if not isinstance(name, str) or not name.startswith("v3.12."):
                continue
            candidate = name[1:]
            match = PYTHON_312.fullmatch(candidate)
            if match:
                versions.append((int(match.group(1)), candidate))
        if len(value) < 100:
            break
    if not versions:
        raise RuntimeError("CPYTHON_312_TAG_MISSING")
    return max(versions)[1]


def collect() -> tuple[dict[str, str], dict[str, list[str]], str]:
    pins: dict[str, str] = {}
    sources: dict[str, list[str]] = {}

    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    specs: list[str] = list(project["project"].get("dependencies", []))
    for values in project["project"].get("optional-dependencies", {}).values():
        specs.extend(values)
    specs.extend(project.get("build-system", {}).get("requires", []))
    for spec in specs:
        parsed = parse_exact(str(spec))
        if parsed:
            add_pin(pins, sources, parsed[0], parsed[1], "pyproject.toml")

    for raw in TEST_LOCK.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parsed = parse_exact(line)
        if not parsed:
            raise RuntimeError(f"TEST_LOCK_PIN_INVALID:{line}")
        add_pin(pins, sources, parsed[0], parsed[1], "requirements-test.lock")

    runtime = json.loads(WHISPER_RUNTIME.read_text(encoding="utf-8"))
    python_pin = str(runtime["python"])
    if not PYTHON_312.fullmatch(python_pin):
        raise RuntimeError("WHISPER_RUNTIME_PYTHON_PIN_INVALID")
    for name, version in runtime.get("packages", {}).items():
        add_pin(pins, sources, str(name), str(version), "whisper-windows-x64.json")

    workflow = COMPANION_WORKFLOW.read_text(encoding="utf-8")
    uv_pins = set(UV_WORKFLOW_PIN.findall(workflow))
    if len(uv_pins) != 1:
        raise RuntimeError(f"UV_WORKFLOW_PIN_INVALID:{sorted(uv_pins)}")
    add_pin(pins, sources, "uv", next(iter(uv_pins)), "companion.yml")

    workflow_python = set(PYTHON_WORKFLOW_PIN.findall(workflow))
    if workflow_python != {python_pin}:
        raise RuntimeError(f"PYTHON_PIN_MISMATCH:{python_pin}:{sorted(workflow_python)}")

    return pins, sources, python_pin


def main() -> int:
    pins, sources, python_pin = collect()
    stale: list[str] = []

    print(f"Auditing {len(pins)} Python/PyPI pins...")
    for name in sorted(pins):
        pinned = pins[name]
        latest = latest_pypi(name)
        state = "current" if pinned == latest else "STALE"
        print(f"{name}: {pinned} -> {latest} [{state}] ({', '.join(sources[name])})")
        if pinned != latest:
            stale.append(f"{name}: pinned {pinned}, latest {latest}")

    current_python = latest_python_312()
    python_state = "current" if python_pin == current_python else "STALE"
    print(f"python: {python_pin} -> {current_python} [{python_state}]")
    if python_pin != current_python:
        stale.append(f"python: pinned {python_pin}, latest 3.12 patch {current_python}")

    if stale:
        print("\nCompanion dependency freshness requirement failed:", file=sys.stderr)
        for item in stale:
            print(f"- {item}", file=sys.stderr)
        print(
            "Update the pins and rerun all Companion/MSI/runtime gates. "
            "If the newest stable release is incompatible, document an explicit exception first.",
            file=sys.stderr,
        )
        return 1

    print("\nAll tracked Companion dependency pins are current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
