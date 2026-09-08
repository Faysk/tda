"""Run reconciled World layout migrations in a disposable PostgreSQL cluster.

Synthetic only: Unix socket, no TCP, no inherited PG credentials, no production
seed and no Supabase connection. Exits non-zero on any fixture/migration/assertion
failure and always removes the temporary cluster afterwards.
"""

import os
import pathlib
import shutil
import subprocess
import tempfile
import time

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-world-layout-"))
root.chmod(0o700)
data = root / "data"
socket = root / "socket"
socket.mkdir(mode=0o700)
env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, env=env, **kwargs)


psql_args = [
    str(binary / "psql"),
    "-X",
    "-A",
    "-t",
    "-q",
    "-h",
    str(socket),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
]


def run_psql(sql):
    return run(psql_args, input=sql, text=True)


def scalar(sql):
    return run_psql(sql).stdout.strip()


def wait_for(sql, *, attempts=80, delay=0.05):
    for _ in range(attempts):
        if scalar(sql) == "t":
            return
        time.sleep(delay)
    raise RuntimeError(f"timed out waiting for PostgreSQL state: {sql}")


def start_psql(sql):
    return subprocess.Popen(
        psql_args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
    ), sql


def finish_psql(process, sql, *, timeout=10):
    stdout, stderr = process.communicate(sql, timeout=timeout)
    if process.returncode != 0:
        raise RuntimeError(
            f"psql concurrency session failed rc={process.returncode}\nstdout={stdout}\nstderr={stderr}"
        )
    return stdout.strip()


def assert_saved_conflict(first, second, revision, label):
    saved = f'"status": "saved"' in first and f'"revision": {revision}' in first
    conflict = f'"reason": "conflict"' in second and f'"revision": {revision}' in second
    if not saved or not conflict:
        raise RuntimeError(
            f"{label} expected saved/{revision} + conflict/{revision}; first={first!r} second={second!r}"
        )


started = False
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
        ]
    )
    with (data / "postgresql.conf").open("a", encoding="utf-8") as file:
        file.write(
            f"\nlisten_addresses=''\nunix_socket_directories='{socket}'\n"
            "unix_socket_permissions=0700\n"
        )
    run([str(binary / "pg_ctl"), "-D", str(data), "-l", str(root / "postgres.log"), "-w", "start"])
    started = True

    paths = [
        repo / "supabase/tests/world_layout_fixture.sql",
        *sorted((repo / "supabase/migrations").glob("*_world_layout_*.sql")),
        repo / "supabase/tests/world_layout_snapshot_atomic.sql",
    ]
    for path in paths:
        run_psql(path.read_text(encoding="utf-8"))

    # The SQL assertions above exercise authorization, stale conflict, idempotent
    # no-op saves and audit rollback. Reset only synthetic World state, then use
    # two real PostgreSQL sessions to prove the lock behavior under concurrency.
    run_psql(
        """
        delete from public.audit_log where action = 'world_layout.update';
        delete from public.world_layout_snapshots;
        """
    )

    first_insert_a, first_insert_a_sql = start_psql(
        """
        begin;
        set application_name = 'tda-world-layout-insert-a';
        set role service_role;
        select public.save_world_layout_snapshot_atomic(
          '44444444-4444-4444-8444-444444444444',
          '33333333-3333-4333-8333-333333333333',
          'synthetic-campaign',
          0,
          '{"node-a":{"x":100,"y":-50}}'::jsonb
        );
        select pg_sleep(3);
        commit;
        """
    )
    first_insert_a.stdin.write(first_insert_a_sql)
    first_insert_a.stdin.close()
    wait_for(
        """
        select exists (
          select 1 from pg_stat_activity
          where application_name = 'tda-world-layout-insert-a'
            and wait_event_type = 'Timeout'
            and wait_event = 'PgSleep'
        );
        """
    )

    first_insert_b, first_insert_b_sql = start_psql(
        """
        begin;
        set application_name = 'tda-world-layout-insert-b';
        set role service_role;
        select public.save_world_layout_snapshot_atomic(
          '44444444-4444-4444-8444-444444444444',
          '33333333-3333-4333-8333-333333333333',
          'synthetic-campaign',
          0,
          '{"node-a":{"x":200,"y":-50}}'::jsonb
        );
        commit;
        """
    )
    first_insert_b.stdin.write(first_insert_b_sql)
    first_insert_b.stdin.close()
    wait_for(
        """
        select exists (
          select 1 from pg_stat_activity
          where application_name = 'tda-world-layout-insert-b'
            and wait_event_type = 'Lock'
        );
        """
    )

    first_insert_a_out, first_insert_a_err = first_insert_a.communicate(timeout=10)
    first_insert_b_out, first_insert_b_err = first_insert_b.communicate(timeout=10)
    if first_insert_a.returncode != 0 or first_insert_b.returncode != 0:
        raise RuntimeError(
            "first-insert concurrency session failed\n"
            f"A rc={first_insert_a.returncode} stdout={first_insert_a_out} stderr={first_insert_a_err}\n"
            f"B rc={first_insert_b.returncode} stdout={first_insert_b_out} stderr={first_insert_b_err}"
        )
    assert_saved_conflict(first_insert_a_out, first_insert_b_out, 1, "first-insert race")
    if scalar(
        """
        select revision::text || ':' ||
               (select count(*) from public.audit_log where action = 'world_layout.update')::text
        from public.world_layout_snapshots;
        """
    ) != "1:1":
        raise RuntimeError("first-insert race must leave revision=1 and exactly one audit row")

    update_a, update_a_sql = start_psql(
        """
        begin;
        set application_name = 'tda-world-layout-update-a';
        set role service_role;
        select public.save_world_layout_snapshot_atomic(
          '44444444-4444-4444-8444-444444444444',
          '33333333-3333-4333-8333-333333333333',
          'synthetic-campaign',
          1,
          '{"node-a":{"x":300,"y":-50}}'::jsonb
        );
        select pg_sleep(3);
        commit;
        """
    )
    update_a.stdin.write(update_a_sql)
    update_a.stdin.close()
    wait_for(
        """
        select exists (
          select 1 from pg_stat_activity
          where application_name = 'tda-world-layout-update-a'
            and wait_event_type = 'Timeout'
            and wait_event = 'PgSleep'
        );
        """
    )

    update_b, update_b_sql = start_psql(
        """
        begin;
        set application_name = 'tda-world-layout-update-b';
        set role service_role;
        select public.save_world_layout_snapshot_atomic(
          '44444444-4444-4444-8444-444444444444',
          '33333333-3333-4333-8333-333333333333',
          'synthetic-campaign',
          1,
          '{"node-a":{"x":400,"y":-50}}'::jsonb
        );
        commit;
        """
    )
    update_b.stdin.write(update_b_sql)
    update_b.stdin.close()
    wait_for(
        """
        select exists (
          select 1 from pg_stat_activity
          where application_name = 'tda-world-layout-update-b'
            and wait_event_type = 'Lock'
        );
        """
    )

    update_a_out, update_a_err = update_a.communicate(timeout=10)
    update_b_out, update_b_err = update_b.communicate(timeout=10)
    if update_a.returncode != 0 or update_b.returncode != 0:
        raise RuntimeError(
            "existing-row concurrency session failed\n"
            f"A rc={update_a.returncode} stdout={update_a_out} stderr={update_a_err}\n"
            f"B rc={update_b.returncode} stdout={update_b_out} stderr={update_b_err}"
        )
    assert_saved_conflict(update_a_out, update_b_out, 2, "existing-row race")
    if scalar(
        """
        select revision::text || ':' || positions::text || ':' ||
               (select count(*) from public.audit_log where action = 'world_layout.update')::text
        from public.world_layout_snapshots;
        """
    ) != '2:{"node-a": {"x": 300, "y": -50}}:2':
        raise RuntimeError("existing-row race must preserve winner payload, revision=2 and two audit rows")

    print("WORLD_LAYOUT_DATABASE_OK synthetic=true concurrency=real")
finally:
    if started:
        run([str(binary / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"])
    shutil.rmtree(root, ignore_errors=True)
