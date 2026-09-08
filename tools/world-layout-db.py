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
        run(
            [
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
            ],
            input=path.read_text(encoding="utf-8"),
            text=True,
        )

    print("WORLD_LAYOUT_DATABASE_OK synthetic=true")
finally:
    if started:
        run([str(binary / "pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"])
    shutil.rmtree(root, ignore_errors=True)
