"""Isolated PostgreSQL contract for immutable Web transcript editing (#898).

Uses a fresh Unix-socket-only PostgreSQL 16 cluster with synthetic fixtures.
It never connects to Supabase Production and reads no environment credentials.
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
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-transcript-revision-edit-"))
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
        repo / "supabase/tests/transcript_revision_web_edit_fixture.sql",
        repo / "supabase/migrations/20260928104000_transcript_revision_web_edit_atomic.sql",
        repo / "supabase/tests/transcript_revision_web_edit_atomic.sql",
    ]
    output = ""
    for path in paths:
        try:
            result = run(psql_args(), input=path.read_text(encoding="utf-8"), timeout=20)
            output += result.stdout
        except subprocess.CalledProcessError as exc:
            print(
                f"TRANSCRIPT_REVISION_EDIT_SQL_FAILED {path.relative_to(repo)}",
                file=sys.stderr,
                flush=True,
            )
            if exc.stdout:
                print(exc.stdout, file=sys.stderr, flush=True)
            if exc.stderr:
                print(exc.stderr, file=sys.stderr, flush=True)
            raise

    if "TRANSCRIPT_REVISION_EDIT_SQL_OK" not in output:
        raise RuntimeError("Synthetic SQL contract did not emit its success marker")
    print(
        "TRANSCRIPT_REVISION_EDIT_DB_OK immutable=1 cas=1 replay=1 audit_metadata_only=1",
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
            print(f"TRANSCRIPT_REVISION_EDIT_DB_CLEANUP_FAILED {exc}", file=sys.stderr)
    shutil.rmtree(root, ignore_errors=True)
