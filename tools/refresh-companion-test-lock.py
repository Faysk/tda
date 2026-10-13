#!/usr/bin/env python3
"""Synchronize the Companion's exact *direct* test constraints with pyproject.toml.

Deliberately does not resolve transitives, fetch packages, change ASR runtime
manifests or claim compatibility. The uv install and Windows/Linux CI remain
mandatory after any lock update.
"""
from __future__ import annotations

import argparse
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "local-companion" / "pyproject.toml"
LOCK = ROOT / "local-companion" / "requirements-test.lock"
INCLUDED_EXTRAS = ("test", "packaging", "desktop")
EXACT = re.compile(r"^([A-Za-z0-9_.-]+)==([^;\s]+)$")


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def direct_pins(pyproject: Path) -> dict[str, tuple[str, str]]:
    data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    project = data["project"]
    extras = project.get("optional-dependencies", {})
    missing = [extra for extra in INCLUDED_EXTRAS if extra not in extras]
    if missing:
        raise ValueError(f"COMPANION_LOCK_EXTRA_MISSING:{','.join(missing)}")
    specs = [*project.get("dependencies", [])]
    for extra in INCLUDED_EXTRAS:
        specs.extend(extras[extra])
    specs.extend(data["build-system"].get("requires", []))
    pins: dict[str, tuple[str, str]] = {}
    for spec in specs:
        match = EXACT.fullmatch(spec)
        if not match:
            raise ValueError(f"COMPANION_DIRECT_PIN_NOT_EXACT:{spec}")
        name, version = match.groups()
        key = canonical(name)
        if key in pins and pins[key][1] != version:
            raise ValueError(f"COMPANION_DIRECT_PIN_CONFLICT:{key}")
        pins[key] = (name, version)
    return pins


def reconcile(text: str, pins: dict[str, tuple[str, str]]) -> tuple[str, list[str]]:
    lines = text.splitlines()
    seen: set[str] = set()
    changes: list[str] = []
    for index, raw in enumerate(lines):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = EXACT.fullmatch(stripped)
        if not match:
            raise ValueError(f"COMPANION_TEST_LOCK_INVALID:{raw}")
        name, version = match.groups()
        key = canonical(name)
        if key in seen:
            raise ValueError(f"COMPANION_TEST_LOCK_DUPLICATE:{key}")
        seen.add(key)
        if key in pins:
            expected = pins[key][1]
            if expected != version:
                lines[index] = f"{name}=={expected}"
                changes.append(f"{key}: {version} -> {expected}")
    for key in sorted(set(pins) - seen):
        name, version = pins[key]
        lines.append(f"{name}=={version}")
        changes.append(f"{key}: missing -> {version}")
    newline = "\r\n" if "\r\n" in text else "\n"
    result = newline.join(lines) + (newline if text.endswith(("\n", "\r\n")) else "")
    return result, changes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--check", action="store_true", help="Detect direct-pin drift without writing")
    actions.add_argument("--write", action="store_true", help="Reconcile direct pins only")
    args = parser.parse_args(argv)
    try:
        pins = direct_pins(PYPROJECT)
        original = LOCK.read_text(encoding="utf-8")
        updated, changes = reconcile(original, pins)
    except (ValueError, KeyError, OSError, tomllib.TOMLDecodeError) as exc:
        print(f"COMPANION_LOCK_ERROR:{exc}", file=sys.stderr)
        return 2
    if not changes:
        print(f"COMPANION_DIRECT_LOCK_OK pins={len(pins)}")
        return 0
    for change in changes:
        print(f"COMPANION_DIRECT_LOCK_DRIFT {change}")
    if args.check:
        print("Run: python tools/refresh-companion-test-lock.py --write", file=sys.stderr)
        return 1
    LOCK.write_text(updated, encoding="utf-8", newline="")
    print("COMPANION_DIRECT_LOCK_UPDATED; verify transitive resolution and all Windows/Linux/packaging CI gates before merge.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
