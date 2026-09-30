"""Validate the Lembra migration in disposable PostgreSQL.

Synthetic only: Unix socket, no TCP, no inherited PG credentials, no production
seed and no Supabase connection. The migration is executed only inside a
throwaway PostgreSQL 16 cluster.
"""

import os
import pathlib
import shutil
import subprocess
import tempfile

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-lembra-"))
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


def run_sql(sql):
    return run(psql_args, input=sql, text=True)


def run_sql_file(path):
    try:
        return run_sql(path.read_text(encoding="utf-8"))
    except subprocess.CalledProcessError as error:
        relative = path.relative_to(repo)
        raise RuntimeError(
            f"Lembra PostgreSQL contract failed in {relative}\n"
            f"stdout={error.stdout}\nstderr={error.stderr}"
        ) from error


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
    run(
        [
            str(binary / "pg_ctl"),
            "-D",
            str(data),
            "-l",
            str(root / "postgres.log"),
            "-w",
            "start",
        ]
    )
    started = True

    run_sql(
        """
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin;

        create table public.campaigns (
          id uuid primary key,
          name text not null,
          slug text not null unique,
          lifecycle text not null default 'active'
            check (lifecycle in ('active', 'archived')),
          visibility text not null default 'private'
            check (visibility in ('private', 'public'))
        );

        insert into public.campaigns(id, name, slug, lifecycle, visibility)
        values
          ('11111111-1111-4111-8111-111111111111', 'Campanha A', 'campaign-a', 'active', 'public'),
          ('22222222-2222-4222-8222-222222222222', 'Campanha B privada', 'campaign-b', 'active', 'private'),
          ('33333333-3333-4333-8333-333333333333', 'Campanha C', 'campaign-c', 'archived', 'public');
        """
    )

    run_sql_file(repo / "supabase/migrations/20260921190000_lembra_shared_library.sql")
    run_sql_file(repo / "supabase/migrations/20260930163000_lembra_campaign_classification.sql")
    receipt = run_sql_file(repo / "supabase/tests/lembra_shared_library.sql").stdout.strip()
    if "LEMBRA_SHARED_DATABASE_OK" not in receipt:
        raise RuntimeError(f"missing Lembra contract receipt: {receipt!r}")

    print("LEMBRA_SHARED_DATABASE_OK synthetic=true migration=true remote_mutation=false")
finally:
    if started:
        run([str(binary / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"])
    shutil.rmtree(root, ignore_errors=True)
