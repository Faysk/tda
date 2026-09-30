"""Scratch PostgreSQL 16 contract for first-class campaign registry (#1123).

Runs only synthetic fixtures in a fresh Unix-socket-only cluster. It applies the
forward migration exactly once and verifies cross-campaign identity, lifecycle,
route aliases, legacy compatibility and logical FK isolation. No environment
credentials, TCP access or Production data are used.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
from typing import Iterable

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-campaign-registry-"))
root.chmod(0o700)
data = root / "data"
socket = root / "socket"
socket.mkdir(mode=0o700)
env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
started = False


def run(args: Iterable[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        check=True,
        capture_output=True,
        text=True,
        env=env,
        **kwargs,
    )


def psql_args() -> list[str]:
    return [
        str(binary / "psql"),
        "-X",
        "-h",
        str(socket),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-Atq",
    ]


try:
    run(
        [
            str(binary / "initdb"),
            "-D",
            str(data),
            "-U",
            "postgres",
            "--auth-local=trust",
            "--auth-host=reject",
            "--encoding=UTF8",
            "--no-locale",
        ],
        timeout=20,
    )
    with (data / "postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(
            "\nlisten_addresses=''\n"
            f"unix_socket_directories='{socket}'\n"
            "unix_socket_permissions=0700\n"
        )
    run(
        [
            str(binary / "pg_ctl"),
            "-D",
            str(data),
            "-l",
            str(root / "postgres.log"),
            "-w",
            "start",
        ],
        timeout=20,
    )
    started = True

    paths = [
        repo / "supabase/tests/campaign_registry_fixture.sql",
        repo / "supabase/migrations/20260930161500_first_class_campaign_registry.sql",
        repo / "supabase/tests/campaign_registry.sql",
    ]
    output_parts: list[str] = []
    for path in paths:
        try:
            result = run(
                psql_args(),
                input=path.read_text(encoding="utf-8"),
                timeout=20,
            )
            output_parts.append(result.stdout)
        except subprocess.CalledProcessError as exc:
            print(
                f"CAMPAIGN_REGISTRY_SQL_FAILED {path.relative_to(repo)}",
                file=sys.stderr,
                flush=True,
            )
            if exc.stdout:
                print(exc.stdout, file=sys.stderr, flush=True)
            if exc.stderr:
                print(exc.stderr, file=sys.stderr, flush=True)
            raise

    output = "\n".join(output_parts)
    if "CAMPAIGN_REGISTRY_SQL_OK" not in output:
        raise RuntimeError("campaign registry SQL assertions did not emit success marker")

    print(
        "CAMPAIGN_REGISTRY_DB_OK "
        "campaigns=3 legacy_uuid_preserved=1 second_identity_only=1 "
        "source_collision_isolated=1 entity_slug_collision_isolated=1 "
        "cross_campaign_fk_rejected=1 lifecycle=active_archived "
        "public_alias_guard=1 legacy_insert_compatible=1",
        flush=True,
    )
finally:
    if started:
        try:
            run(
                [
                    str(binary / "pg_ctl"),
                    "-D",
                    str(data),
                    "-m",
                    "fast",
                    "-w",
                    "stop",
                ],
                timeout=20,
            )
        except Exception as exc:  # pragma: no cover - cleanup diagnostic
            print(f"CAMPAIGN_REGISTRY_DB_CLEANUP_FAILED {exc}", file=sys.stderr)
    shutil.rmtree(root, ignore_errors=True)
