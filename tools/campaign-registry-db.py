"""Validate #1123 campaign registry candidate in disposable PostgreSQL 16.

Synthetic only: Unix socket, no TCP, no inherited PG credentials, no production
seed and no Supabase connection. The candidate is executed only inside a
throwaway PostgreSQL cluster and is replayed to prove idempotence.
"""

import os
import pathlib
import shutil
import subprocess
import tempfile

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path(os.environ.get("TDA_POSTGRES_BIN", "/usr/lib/postgresql/16/bin"))
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-campaign-registry-"))
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
            f"Campaign registry PostgreSQL contract failed in {relative}\n"
            f"stdout={error.stdout}\nstderr={error.stderr}"
        ) from error


schema = r"""
create extension if not exists pgcrypto;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  slug text not null,
  session_date date,
  arc text,
  status text not null default 'planned' check (
    status in (
      'planned', 'recording', 'uploaded', 'processing', 'ready_for_review',
      'reviewing', 'approved', 'published', 'archived', 'failed'
    )
  ),
  source_system text,
  source_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  unique (campaign_id, slug),
  unique (campaign_id, source_system, source_session_id)
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  slug text not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (campaign_id, slug)
);

insert into public.campaigns(id, name, slug, description, metadata)
values (
  '11230000-0000-4000-8000-000000000001'::uuid,
  'Yuhara Main',
  'yuhara-main',
  'Synthetic legacy campaign fixture',
  '{"synthetic":true,"legacy":true}'::jsonb
);
"""

candidate = repo / "supabase/candidates/20260930113000_campaign_registry.sql"
test = repo / "supabase/tests/campaign_registry.sql"

started = False
try:
    required = [binary / name for name in ("initdb", "pg_ctl", "psql")]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise RuntimeError(
            "PostgreSQL 16 binaries not found. Set TDA_POSTGRES_BIN to the directory "
            f"containing initdb/pg_ctl/psql. Missing: {', '.join(missing)}"
        )

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

    run_sql(schema)

    # First application proves the candidate can evolve the legacy registry.
    run_sql_file(candidate)
    run_sql_file(test)

    # Replay must not duplicate campaigns or destabilize approved identities.
    run_sql_file(candidate)
    replay = run_sql(
        """
        select count(*)
        from public.campaigns
        where slug in ('yuhara-main', 'antes-que-seja-tarde');
        """
    ).stdout.strip()
    if replay != "2":
        raise RuntimeError(f"campaign registry replay produced unexpected row count: {replay!r}")

    print("CAMPAIGN_REGISTRY_DATABASE_OK synthetic=true candidate=true replay=true remote_mutation=false")
finally:
    if started:
        run([str(binary / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"])
    shutil.rmtree(root, ignore_errors=True)
