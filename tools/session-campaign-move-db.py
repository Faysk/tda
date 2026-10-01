"""Scratch PostgreSQL 16 gate for governed session campaign moves (#1129).

Composes the approved #1123 registry and #1134 authorization candidates with
synthetic session fixtures, then applies the #1129 candidate twice and runs the
move matrix. No environment credentials, TCP access or Production data are used.
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
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-session-campaign-move-"))
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

    registry = repo / "supabase/candidates/20260930174200_first_class_campaign_registry.sql"
    authorization = (
        repo / "supabase/candidates/20260930191500_harden_campaign_discovery_authorization.sql"
    )
    move = repo / "supabase/candidates/20261001013000_session_campaign_move_atomic.sql"
    paths = [
        repo / "supabase/tests/campaign_registry_fixture.sql",
        registry,
        registry,
        repo / "supabase/tests/campaign_authorization_fixture.sql",
        authorization,
        authorization,
        repo / "supabase/tests/campaign_authorization.sql",
        repo / "supabase/tests/session_campaign_move_fixture.sql",
        move,
        move,
        repo / "supabase/tests/session_campaign_move.sql",
    ]

    output_parts: list[str] = []
    for path in paths:
        try:
            result = run(
                psql_args(),
                input=path.read_text(encoding="utf-8"),
                timeout=30,
            )
            output_parts.append(result.stdout)
        except subprocess.CalledProcessError as exc:
            print(
                f"SESSION_CAMPAIGN_MOVE_SQL_FAILED {path.relative_to(repo)}",
                file=sys.stderr,
                flush=True,
            )
            if exc.stdout:
                print(exc.stdout, file=sys.stderr, flush=True)
            if exc.stderr:
                print(exc.stderr, file=sys.stderr, flush=True)
            raise

    output = "\n".join(output_parts)
    if "SESSION_CAMPAIGN_MOVE_SQL_OK" not in output:
        raise RuntimeError("session campaign move SQL assertions did not emit success marker")

    print(
        "SESSION_CAMPAIGN_MOVE_DB_OK "
        "candidate_replay=1 source_destination_auth=1 active_lifecycle=1 "
        "campaign_qualified_identity=1 destination_collision=1 same_source_cross_campaign=1 "
        "preflight=1 atomic_commit=1 transcript_children=1 editorial_draft=1 "
        "active_publication_blocked=1 campaign_media_blocked=1 participant_entity_blocked=1 "
        "canon_provenance_blocked=1 session_grants_blocked=1 optimistic_concurrency=1 "
        "lost_response_replay=1 operation_conflict=1 audit_metadata_only=1 "
        "browser_execute_denied=1",
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
            print(f"SESSION_CAMPAIGN_MOVE_DB_CLEANUP_FAILED {exc}", file=sys.stderr)
    shutil.rmtree(root, ignore_errors=True)
