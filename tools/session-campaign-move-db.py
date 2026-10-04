"""Scratch PostgreSQL 16 gate for safe session campaign moves (#1129 / #1454).

Uses only synthetic fixtures in a fresh Unix-socket-only cluster. It composes the
campaign registry + authorization candidates, the v1 fail-closed boundary and
the populated-session v2 boundary. It proves schema drift detection, explicit
reconciliation, immutable-history attribution, replay and real concurrent
stale-writer races without Production credentials or private narrative data.
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
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-session-campaign-move-"))
root.chmod(0o700)
data = root / "data"
socket = root / "socket"
socket.mkdir(mode=0o700)
env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
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


def sql(statement: str) -> str:
    return run(psql_args(), input=statement, timeout=20).stdout.strip()


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
    assert process.stdout is not None and process.stderr is not None
    out = process.stdout.read()
    err = process.stderr.read()
    if process.returncode != 0:
        raise RuntimeError(err or f"psql exited {process.returncode}")
    return out.strip()


def assert_concurrent_move(
    *,
    label: str,
    call: str,
    first_operation: str,
    second_operation: str,
) -> None:
    first_sql = call.replace("__OPERATION_ID__", first_operation)
    second_sql = call.replace("__OPERATION_ID__", second_operation)
    first = launch(
        f"set application_name='tda_{label}_a'; set role service_role; "
        f"begin; {first_sql} select pg_sleep(3); commit;"
    )
    deadline = time.monotonic() + 7
    while time.monotonic() < deadline:
        if (
            sql(
                "select count(*) from pg_stat_activity "
                f"where application_name='tda_{label}_a' and wait_event='PgSleep';"
            )
            == "1"
        ):
            break
        time.sleep(0.05)
    else:
        if first.poll() is not None:
            assert first.stdout is not None and first.stderr is not None
            raise RuntimeError(
                f"{label}: first writer exited before transaction hold: "
                + first.stdout.read()
                + first.stderr.read()
            )
        raise RuntimeError(f"{label}: first writer did not hold transaction")

    second = launch(
        f"set application_name='tda_{label}_b'; set role service_role; {second_sql}"
    )
    deadline = time.monotonic() + 7
    blocked = False
    while time.monotonic() < deadline:
        if (
            sql(
                "select exists("
                "select 1 from pg_stat_activity b cross join pg_stat_activity a "
                f"where b.application_name='tda_{label}_b' "
                f"and a.application_name='tda_{label}_a' "
                "and a.pid=any(pg_blocking_pids(b.pid)));"
            )
            == "t"
        ):
            blocked = True
            break
        time.sleep(0.05)
    if not blocked:
        raise RuntimeError(f"{label}: concurrent writer did not block on session row")

    first_out = finish(first)
    second_out = finish(second)
    if '"status": "moved"' not in first_out and '"status":"moved"' not in first_out:
        raise RuntimeError(f"{label}: first move did not commit: {first_out}")
    if (
        '"status": "conflict"' not in second_out
        and '"status":"conflict"' not in second_out
    ):
        raise RuntimeError(
            f"{label}: stale concurrent move did not conflict: {second_out}"
        )


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
            f"\nlisten_addresses=''\nunix_socket_directories='{socket}'"
            "\nunix_socket_permissions=0700\n"
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
        repo / "supabase/candidates/20260930174200_first_class_campaign_registry.sql",
        repo / "supabase/tests/campaign_authorization_fixture.sql",
        repo / "supabase/candidates/20260930191500_harden_campaign_discovery_authorization.sql",
        repo / "supabase/tests/session_campaign_move_fixture.sql",
        repo / "supabase/migrations/20261004023000_session_campaign_move.sql",
        repo / "supabase/tests/session_campaign_move.sql",
        repo / "supabase/migrations/20261004180000_session_campaign_move_v2.sql",
        repo / "supabase/tests/session_campaign_move_v2.sql",
    ]
    output: list[str] = []
    for path in paths:
        try:
            output.append(
                run(
                    psql_args(),
                    input=path.read_text(encoding="utf-8"),
                    timeout=35,
                ).stdout
            )
        except subprocess.CalledProcessError as exc:
            print(
                f"SESSION_CAMPAIGN_MOVE_SQL_FAILED {path.relative_to(repo)}",
                file=sys.stderr,
            )
            print(exc.stdout or "", file=sys.stderr)
            print(exc.stderr or "", file=sys.stderr)
            raise

    joined = "\n".join(output)
    if "SESSION_CAMPAIGN_MOVE_SQL_OK" not in joined:
        raise RuntimeError("v1 assertions did not emit success marker")
    if "SESSION_CAMPAIGN_MOVE_V2_SQL_OK" not in joined:
        raise RuntimeError("v2 assertions did not emit success marker")

    v1_call = """select public.move_session_campaign_atomic(
      '90000000-0000-4000-8000-000000000006'::uuid,
      '30000000-0000-4000-8000-000000000006'::uuid,
      'yuhara-main','antes-que-seja-tarde',
      '41000000-0000-4000-8000-000000000012'::uuid,
      'move-concurrent',
      '__OPERATION_ID__'::uuid
    );"""
    assert_concurrent_move(
        label="move_v1",
        call=v1_call,
        first_operation="61000000-0000-4000-8000-000000000012",
        second_operation="61000000-0000-4000-8000-000000000013",
    )

    v2_call = """select public.move_session_campaign_atomic_v2(
      '90000000-0000-4000-8000-000000000006'::uuid,
      '30000000-0000-4000-8000-000000000006'::uuid,
      'yuhara-main','antes-que-seja-tarde',
      '41000000-0000-4000-8000-000000000023'::uuid,
      'move-concurrent-v2',
      '__OPERATION_ID__'::uuid,
      '{}'::jsonb
    );"""
    assert_concurrent_move(
        label="move_v2",
        call=v2_call,
        first_operation="61000000-0000-4000-8000-000000000023",
        second_operation="61000000-0000-4000-8000-000000000024",
    )

    print(
        "SESSION_CAMPAIGN_MOVE_DB_OK "
        "v1_preflight=1 v1_atomic=1 "
        "v2_registry=1 v2_populated=1 v2_publication_unpublish=1 "
        "v2_media_receipt=1 v2_manual_reconcile=1 v2_canon_hard_block=1 "
        "v2_replay=1 v2_operation_conflict=1 "
        "v1_concurrent_conflict=1 v2_concurrent_conflict=1 "
        "synthetic=1 containsPrivateNarrativeData=false productionMutation=false",
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
        except Exception as exc:
            print(
                f"SESSION_CAMPAIGN_MOVE_DB_CLEANUP_FAILED {exc}",
                file=sys.stderr,
            )
    shutil.rmtree(root, ignore_errors=True)
