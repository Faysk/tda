"""Isolated PostgreSQL contract for private transcript revision edits (#898).

Uses a fresh Unix-socket-only PostgreSQL 16 cluster, synthetic fixtures only,
no environment credentials, no TCP and no Production data.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
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

ACTOR = "33333333-3333-4333-8333-333333333333"
SESSION = "22222222-2222-4222-8222-222222222222"


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


def sql(statement: str) -> str:
    return run(psql_args(), input=statement, timeout=20).stdout.strip()


def json_line(output: str) -> dict[str, object]:
    lines = [line.strip() for line in output.splitlines() if line.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"Expected JSON row, got: {output!r}")
    value = json.loads(lines[-1])
    if not isinstance(value, dict):
        raise RuntimeError("Expected JSON object from revision edit RPC")
    return value


def launch(statement: str) -> subprocess.Popen[str]:
    process = subprocess.Popen(
        psql_args(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    assert process.stdin is not None
    process.stdin.write(statement)
    process.stdin.close()
    return process


def finish(process: subprocess.Popen[str], timeout: float = 15) -> str:
    process.wait(timeout=timeout)
    assert process.stdout is not None
    assert process.stderr is not None
    output = process.stdout.read()
    error = process.stderr.read()
    if process.returncode != 0:
        raise RuntimeError(error or f"psql exited {process.returncode}")
    return output.strip()


def wait_until(predicate, message: str, timeout: float = 7) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise RuntimeError(message)


def edit_sql(
    operation_id: str,
    expected_revision_id: str,
    speaker: str,
    application_name: str,
    hold_seconds: int = 0,
) -> str:
    changes = json.dumps(
        [
            {
                "segmentKey": "r-1-seg-a",
                "speaker": speaker,
                "text": f"Texto concorrente {speaker}",
            }
        ],
        ensure_ascii=False,
    ).replace("'", "''")
    call = f"""
select row_to_json(e)
from public.save_transcript_revision_edit_atomic(
  '{ACTOR}'::uuid,
  'synthetic-campaign',
  '{SESSION}'::uuid,
  '{expected_revision_id}'::uuid,
  '{operation_id}'::uuid,
  '{changes}'::jsonb
) e;
"""
    if hold_seconds:
        return (
            f"set application_name='{application_name}'; "
            "set role service_role; begin; "
            + call
            + f"select pg_sleep({hold_seconds}); commit;"
        )
    return f"set application_name='{application_name}'; set role service_role; " + call


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
        repo / "supabase/tests/transcript_revision_edit_fixture.sql",
        repo / "supabase/migrations/20260928023000_transcript_revision_editorial_edits.sql",
        repo / "supabase/tests/transcript_revision_edit_atomic.sql",
    ]
    for path in paths:
        try:
            run(psql_args(), input=path.read_text(encoding="utf-8"), timeout=20)
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

    current = sql(
        f"""
select current_transcript_revision_id::text
from public.sessions
where id='{SESSION}'::uuid;
"""
    )
    if not current:
        raise RuntimeError("Synthetic current revision missing before concurrency probe")

    first = launch(
        edit_sql(
            "72000000-0000-4000-8000-000000000001",
            current,
            "Writer A",
            "tda_transcript_edit_a",
            3,
        )
    )

    wait_until(
        lambda: sql(
            "select count(*) from pg_stat_activity "
            "where application_name='tda_transcript_edit_a' and wait_event='PgSleep';"
        )
        == "1",
        "First transcript revision writer did not reach the commit hold",
    )

    second = launch(
        edit_sql(
            "72000000-0000-4000-8000-000000000002",
            current,
            "Writer B",
            "tda_transcript_edit_b",
        )
    )

    def second_is_blocked() -> bool:
        return (
            sql(
                "select exists("
                "select 1 from pg_stat_activity b cross join pg_stat_activity a "
                "where b.application_name='tda_transcript_edit_b' "
                "and a.application_name='tda_transcript_edit_a' "
                "and a.pid=any(pg_blocking_pids(b.pid))"
                ");"
            )
            == "t"
        )

    wait_until(
        second_is_blocked,
        "Concurrent transcript revision writer was not blocked on the session CAS lock",
    )

    first_result = json_line(finish(first))
    second_result = json_line(finish(second))

    if first_result.get("status") != "updated":
        raise RuntimeError(f"Winning revision edit invalid: {first_result}")
    if second_result.get("status") != "stale_current":
        raise RuntimeError(f"Stale revision edit was not rejected: {second_result}")

    winning_revision = first_result.get("revision_id")
    if not isinstance(winning_revision, str):
        raise RuntimeError("Winning revision edit did not return a revision id")

    final = sql(
        "select "
        "(select count(*) from public.transcript_revisions)::text || '|' || "
        "(select count(*) from public.audit_log where action='transcript_revision.edit')::text || '|' || "
        f"(select current_transcript_revision_id::text from public.sessions where id='{SESSION}'::uuid);"
    )
    if final != f"3|2|{winning_revision}":
        raise RuntimeError(f"Concurrent revision edit left unexpected evidence: {final}")

    print(
        "TRANSCRIPT_REVISION_EDIT_DB_OK "
        "revisions=3 audits=2 concurrent_stale=1 immutable_base=1 replay=1 rollback=1",
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
