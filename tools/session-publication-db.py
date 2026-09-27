"""Isolated PostgreSQL contract for versioned session publication (#793).

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
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-session-publication-"))
root.chmod(0o700)
data = root / "data"
socket = root / "socket"
socket.mkdir(mode=0o700)
env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
started = False

ACTOR = "33333333-3333-4333-8333-333333333333"
SESSION = "22222222-2222-4222-8222-222222222222"
URL = (
    "https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/"
    + SESSION
    + "/cover/"
    + ("a" * 64)
    + ".webp"
)


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
    result = run(psql_args(), input=statement, timeout=20)
    return result.stdout.strip()


def json_line(output: str) -> dict[str, object]:
    lines = [line.strip() for line in output.splitlines() if line.strip().startswith("{")]
    if not lines:
        raise RuntimeError(f"Expected JSON row, got: {output!r}")
    value = json.loads(lines[-1])
    if not isinstance(value, dict):
        raise RuntimeError("Expected JSON object from publication RPC")
    return value


def launch(statement: str) -> tuple[subprocess.Popen[str], list[str]]:
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
    return process, []


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


def publication_sql(
    operation_id: str,
    draft_id: str,
    expected_id: str,
    application_name: str,
    hold_seconds: int = 0,
) -> str:
    call = f"""
select row_to_json(p)
from public.publish_session_editorial_atomic(
  '{ACTOR}'::uuid,
  'synthetic-campaign',
  '{SESSION}'::uuid,
  '{draft_id}'::uuid,
  '{expected_id}'::uuid,
  '{operation_id}'::uuid,
  '{URL}'
) p;
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
        repo / "supabase/tests/session_publication_fixture.sql",
        repo / "supabase/migrations/20260927203500_session_editorial_drafts.sql",
        repo / "supabase/migrations/20260927205500_session_cover_media_scope.sql",
        repo / "supabase/migrations/20260928004000_session_publications.sql",
        repo / "supabase/tests/session_publication_atomic.sql",
    ]
    for path in paths:
        try:
            run(psql_args(), input=path.read_text(encoding="utf-8"), timeout=20)
        except subprocess.CalledProcessError as exc:
            print(
                f"SESSION_PUBLICATION_SQL_FAILED {path.relative_to(repo)}",
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
select current_editorial_draft_id::text || '|' ||
       current_session_publication_id::text
from public.sessions
where id='{SESSION}'::uuid;
"""
    )
    try:
        draft_id, expected_id = current.split("|", 1)
    except ValueError as exc:
        raise RuntimeError(f"Unexpected publication fixture state: {current!r}") from exc

    before = sql(
        "select (select count(*) from public.session_publications)::text || '|' || "
        "(select count(*) from public.session_publication_operations)::text || '|' || "
        "(select count(*) from public.audit_log where action='session_publication.publish')::text;"
    )
    if before != "2|2|2":
        raise RuntimeError(f"Unexpected pre-concurrency evidence: {before}")

    first, _ = launch(
        publication_sql(
            "91000000-0000-4000-8000-000000000001",
            draft_id,
            expected_id,
            "tda_session_pub_a",
            3,
        )
    )

    wait_until(
        lambda: sql(
            "select count(*) from pg_stat_activity "
            "where application_name='tda_session_pub_a' and wait_event='PgSleep';"
        )
        == "1",
        "First session publication writer did not reach the commit hold",
    )

    second, _ = launch(
        publication_sql(
            "91000000-0000-4000-8000-000000000002",
            draft_id,
            expected_id,
            "tda_session_pub_b",
        )
    )

    blocked = False

    def second_is_blocked() -> bool:
        nonlocal_box = sql(
            "select exists("
            "select 1 from pg_stat_activity b cross join pg_stat_activity a "
            "where b.application_name='tda_session_pub_b' "
            "and a.application_name='tda_session_pub_a' "
            "and a.pid=any(pg_blocking_pids(b.pid))"
            ");"
        )
        return nonlocal_box == "t"

    wait_until(
        second_is_blocked,
        "Concurrent session publication writer was not blocked on the session CAS lock",
    )
    blocked = True

    first_result = json_line(finish(first))
    second_result = json_line(finish(second))
    if not blocked:
        raise RuntimeError("Concurrent writer blocking evidence was not observed")
    if first_result.get("status") != "published" or first_result.get("version") != 3:
        raise RuntimeError(f"Winning publication invalid: {first_result}")
    if second_result.get("status") != "stale_current":
        raise RuntimeError(f"Stale publication was not rejected: {second_result}")

    publication_id = first_result.get("publication_id")
    if not isinstance(publication_id, str):
        raise RuntimeError("Winning publication did not return an id")

    after = sql(
        "select (select count(*) from public.session_publications)::text || '|' || "
        "(select count(*) from public.session_publication_operations)::text || '|' || "
        "(select count(*) from public.audit_log where action='session_publication.publish')::text;"
    )
    if after != "3|3|3":
        raise RuntimeError(f"Concurrent publication left unexpected evidence: {after}")

    replay = json_line(
        sql(
            publication_sql(
                "91000000-0000-4000-8000-000000000001",
                draft_id,
                expected_id,
                "tda_session_pub_replay",
            )
        )
    )
    if (
        replay.get("status") != "replay"
        or replay.get("publication_id") != publication_id
        or replay.get("version") != 3
    ):
        raise RuntimeError(f"Lost-response replay was not exact: {replay}")

    final_evidence = sql(
        "select (select count(*) from public.session_publications)::text || '|' || "
        "(select count(*) from public.session_publication_operations)::text || '|' || "
        "(select count(*) from public.audit_log where action='session_publication.publish')::text;"
    )
    if final_evidence != "3|3|3":
        raise RuntimeError(
            f"Replay duplicated publication evidence: {final_evidence}"
        )

    print(
        "SESSION_PUBLICATION_DB_OK "
        "versions=3 operations=3 audits=3 concurrent_stale=1 replay=1",
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
            print(f"SESSION_PUBLICATION_DB_CLEANUP_FAILED {exc}", file=sys.stderr)
