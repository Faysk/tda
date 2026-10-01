"""Scratch PostgreSQL 16 gate for safe session campaign moves (#1129).

Uses synthetic rows only in a fresh Unix-socket-only cluster. It validates
preflight blockers, origin/destination authorization, atomic commit, audit,
destination collision, idempotent replay and a real concurrent move race.
No environment credentials, TCP access, Production data or private content.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Iterable

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-session-move-"))
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


def psql_sql(sql: str, timeout: int = 25) -> subprocess.CompletedProcess[str]:
    return run(psql_args(), input=sql, timeout=timeout)


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

    candidate = repo / "supabase/candidates/20261001023000_safe_session_campaign_move.sql"
    paths = [
        repo / "supabase/tests/session_campaign_move_fixture.sql",
        candidate,
        candidate,
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

    if "SESSION_CAMPAIGN_MOVE_SQL_OK" not in "\n".join(output_parts):
        raise RuntimeError("session move SQL assertions did not emit success marker")

    # Real race: the first transaction holds the moved session row after the RPC;
    # the second request must serialize and report conflict with zero second receipt.
    first_sql = """
BEGIN;
SELECT status
FROM public.move_session_campaign_atomic(
  '60000000-0000-4000-8000-000000000012',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000012',
  'concurrent-source',
  'campaign-a',
  'campaign-b'
);
SELECT pg_sleep(1.5);
COMMIT;
"""
    second_sql = """
SELECT status
FROM public.move_session_campaign_atomic(
  '60000000-0000-4000-8000-000000000013',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000012',
  'concurrent-source',
  'campaign-a',
  'campaign-c'
);
"""
    first = subprocess.Popen(
        psql_args(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    assert first.stdin is not None
    first.stdin.write(first_sql)
    first.stdin.close()
    time.sleep(0.25)
    second = psql_sql(second_sql, timeout=10)
    first_stdout = first.stdout.read() if first.stdout is not None else ""
    first_stderr = first.stderr.read() if first.stderr is not None else ""
    first_return = first.wait(timeout=10)
    if first_return != 0:
        raise RuntimeError(f"first concurrent move failed: {first_stderr}")
    if "moved" not in first_stdout:
        raise RuntimeError(f"first concurrent move did not commit: {first_stdout}")
    if "conflict" not in second.stdout:
        raise RuntimeError(
            "second concurrent move did not serialize to conflict: " + second.stdout
        )

    integrity = psql_sql(
        """
SELECT
  (SELECT count(*) FROM public.session_campaign_move_operations
   WHERE session_id='40000000-0000-4000-8000-000000000012')::text
  || ':' ||
  (SELECT count(*) FROM public.audit_log
   WHERE action='session_campaign_move'
     AND session_id='40000000-0000-4000-8000-000000000012')::text
  || ':' ||
  (SELECT slug FROM public.campaigns c
   JOIN public.sessions s ON s.campaign_id=c.id
   WHERE s.id='40000000-0000-4000-8000-000000000012');
"""
    ).stdout.strip()
    if integrity != "1:1:campaign-b":
        raise RuntimeError("concurrent move left partial/duplicate state: " + integrity)

    print(
        "SESSION_CAMPAIGN_MOVE_DB_OK "
        "candidate_replay=1 preflight_zero_write=1 source_identity_bound=1 "
        "origin_destination_auth=1 archived_target_blocked=1 "
        "transcript_blocked=1 draft_blocked=1 published_blocked=1 "
        "publication_history_blocked=1 media_blocked=1 canon_review_blocked=1 "
        "entity_participant_blocked=1 lineage_blocked=1 scoped_access_blocked=1 "
        "destination_collision_blocked=1 atomic_commit=1 metadata_audit=1 "
        "lost_response_replay=1 operation_conflict=1 concurrent_conflict=1 "
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
        except Exception as exc:  # pragma: no cover
            print(f"SESSION_CAMPAIGN_MOVE_DB_CLEANUP_FAILED {exc}", file=sys.stderr)
    shutil.rmtree(root, ignore_errors=True)
