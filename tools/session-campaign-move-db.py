"""Scratch PostgreSQL 16 gate for safe session campaign moves (#1129).

Uses only synthetic fixtures in a fresh Unix-socket-only cluster. It composes the
#1123 registry and #1134 authorization candidates before #1129, proves blockers,
authorization, atomic move/audit, replay and a real concurrent stale-writer race.
No environment credentials, TCP access or Production data are used.
"""
from __future__ import annotations
import json, os, pathlib, shutil, subprocess, sys, tempfile, time
from typing import Iterable

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-session-campaign-move-"))
root.chmod(0o700)
data = root / "data"
socket = root / "socket"
socket.mkdir(mode=0o700)
env = {k:v for k,v in os.environ.items() if not k.startswith("PG")}
started = False

def run(args: Iterable[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(args), check=True, capture_output=True, text=True, env=env, **kwargs)

def psql_args() -> list[str]:
    return [str(binary/"psql"),"-X","-h",str(socket),"-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-Atq"]

def sql(statement: str) -> str:
    return run(psql_args(), input=statement, timeout=20).stdout.strip()

def launch(statement: str) -> subprocess.Popen[str]:
    p=subprocess.Popen(psql_args(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    assert p.stdin is not None
    p.stdin.write(statement); p.stdin.close()
    return p

def finish(p: subprocess.Popen[str], timeout: float=15) -> str:
    p.wait(timeout=timeout)
    assert p.stdout is not None and p.stderr is not None
    out=p.stdout.read(); err=p.stderr.read()
    if p.returncode != 0: raise RuntimeError(err or f"psql exited {p.returncode}")
    return out.strip()

try:
    run([str(binary/"initdb"),"-D",str(data),"-U","postgres","--auth-local=trust","--auth-host=reject","--encoding=UTF8","--no-locale"],timeout=20)
    with (data/"postgresql.conf").open("a",encoding="utf-8") as cfg:
        cfg.write(f"\nlisten_addresses=''\nunix_socket_directories='{socket}'\nunix_socket_permissions=0700\n")
    run([str(binary/"pg_ctl"),"-D",str(data),"-l",str(root/"postgres.log"),"-w","start"],timeout=20)
    started=True
    paths=[
      repo/"supabase/tests/campaign_registry_fixture.sql",
      repo/"supabase/candidates/20260930174200_first_class_campaign_registry.sql",
      repo/"supabase/tests/campaign_authorization_fixture.sql",
      repo/"supabase/candidates/20260930191500_harden_campaign_discovery_authorization.sql",
      repo/"supabase/tests/session_campaign_move_fixture.sql",
      repo/"supabase/migrations/20261004023000_session_campaign_move.sql",
      repo/"supabase/tests/session_campaign_move.sql",
      repo/"supabase/tests/session_campaign_move_v2_fixture.sql",
      repo/"supabase/migrations/20261004180000_session_campaign_move_v2.sql",
      repo/"supabase/tests/session_campaign_move_v2.sql",
    ]
    output=[]
    for path in paths:
        try:
            output.append(run(psql_args(),input=path.read_text(encoding="utf-8"),timeout=25).stdout)
        except subprocess.CalledProcessError as exc:
            print(f"SESSION_CAMPAIGN_MOVE_SQL_FAILED {path.relative_to(repo)}",file=sys.stderr)
            print(exc.stdout or "",file=sys.stderr); print(exc.stderr or "",file=sys.stderr)
            raise
    combined_output="\n".join(output)
    if "SESSION_CAMPAIGN_MOVE_SQL_OK" not in combined_output:
        raise RuntimeError("session campaign move v1 assertions did not emit success marker")
    if "SESSION_CAMPAIGN_MOVE_V2_SQL_OK" not in combined_output:
        raise RuntimeError("session campaign move v2 assertions did not emit success marker")

    call="""select public.move_session_campaign_atomic(
      '90000000-0000-4000-8000-000000000006'::uuid,
      '30000000-0000-4000-8000-000000000006'::uuid,
      'yuhara-main','antes-que-seja-tarde',
      '41000000-0000-4000-8000-000000000012'::uuid,
      'move-concurrent',
      '61000000-0000-4000-8000-000000000012'::uuid
    );"""
    first=launch("set application_name='tda_move_a'; set role service_role; begin; "+call+" select pg_sleep(3); commit;")
    deadline=time.monotonic()+7
    while time.monotonic()<deadline:
        if sql("select count(*) from pg_stat_activity where application_name='tda_move_a' and wait_event='PgSleep';")=="1":
            break
        time.sleep(.05)
    else:
        if first.poll() is not None:
            assert first.stdout is not None and first.stderr is not None
            raise RuntimeError(
                "first move writer exited before transaction hold: "
                + first.stdout.read()
                + first.stderr.read()
            )
        raise RuntimeError("first move writer did not hold transaction")

    second=launch("set application_name='tda_move_b'; set role service_role; "+call.replace("61000000-0000-4000-8000-000000000012","61000000-0000-4000-8000-000000000013"))
    deadline=time.monotonic()+7
    blocked=False
    while time.monotonic()<deadline:
        if sql("select exists(select 1 from pg_stat_activity b cross join pg_stat_activity a where b.application_name='tda_move_b' and a.application_name='tda_move_a' and a.pid=any(pg_blocking_pids(b.pid)));")=="t":
            blocked=True; break
        time.sleep(.05)
    if not blocked: raise RuntimeError("concurrent move writer did not block on session row")
    first_out=finish(first); second_out=finish(second)
    if '"status": "moved"' not in first_out and '"status":"moved"' not in first_out:
        raise RuntimeError(f"first move did not commit: {first_out}")
    if '"status": "conflict"' not in second_out and '"status":"conflict"' not in second_out:
        raise RuntimeError(f"stale concurrent move did not conflict: {second_out}")

    print("SESSION_CAMPAIGN_MOVE_DB_OK contract_v2=1 registry_drift=1 populated_lineage=1 publication_transfer=1 media_receipt=1 decisions=1 auth_source_destination=1 atomic=1 audit_sanitized=1 replay=1 operation_conflict=1 concurrent_conflict=1",flush=True)
finally:
    if started:
        try: run([str(binary/"pg_ctl"),"-D",str(data),"-m","fast","-w","stop"],timeout=20)
        except Exception as exc: print(f"SESSION_CAMPAIGN_MOVE_DB_CLEANUP_FAILED {exc}",file=sys.stderr)
    shutil.rmtree(root,ignore_errors=True)
