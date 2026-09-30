"""Run #1123 multi-campaign registry contracts in disposable PostgreSQL 16.

Synthetic only: Unix socket, no TCP, no inherited PG credentials, no Production
seed and no Supabase connection. Any fixture/migration/assertion failure exits
non-zero and the temporary cluster is removed.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import tempfile

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-campaign-registry-"))
root.chmod(0o700)
data = root / "data"
socket = root / "socket"
socket.mkdir(mode=0o700)
env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}


def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        env=env,
        **kwargs,
    )


psql = [
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


def sql_file(path: pathlib.Path) -> str:
    try:
        payload = "\\set VERBOSITY verbose\n" + path.read_text(encoding="utf-8")
        return run(psql, input=payload, timeout=30).stdout.strip()
    except subprocess.CalledProcessError as error:
        relative = path.relative_to(repo)
        raise RuntimeError(
            f"CAMPAIGN_REGISTRY_SQL_FAILED {relative}\n"
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

    fixture = repo / "supabase/tests/campaign_registry_fixture.sql"
    migration = repo / "supabase/candidates/20260930140000_campaign_registry_multicampaign.sql"
    assertions = repo / "supabase/tests/campaign_registry_multicampaign.sql"

    sql_file(fixture)
    sql_file(migration)
    # Replay the additive migration against the same synthetic schema. This is
    # not a DOWN migration; it proves retry/reconciliation safety for the
    # idempotent guards before any remote rollout is considered.
    sql_file(migration)
    output = sql_file(assertions)

    if "CAMPAIGN_REGISTRY_DATABASE_OK" not in output:
        raise RuntimeError(f"missing campaign registry receipt: {output!r}")

    print(output)
finally:
    if started:
        run(
            [
                str(binary / "pg_ctl"),
                "-D",
                str(data),
                "-m",
                "fast",
                "-w",
                "stop",
            ]
        )
    shutil.rmtree(root, ignore_errors=True)
