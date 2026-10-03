"""Scratch PostgreSQL 16 gate for multi-campaign authorization (#1134).

Runs only synthetic fixtures in a fresh Unix-socket-only cluster. It composes the
canonical #1123 registry migration with the #1134 authorization hardening migration, replays
both canonical layers, and proves public/Edit discovery plus access_directory
cross-campaign denial. No environment credentials, TCP access or Production data
are used.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
from typing import Iterable

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-campaign-auth-"))
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

    registry_migration = (
        repo / "supabase/migrations/20261001204525_activate_first_class_campaign_registry.sql"
    )
    authorization_migration = (
        repo / "supabase/migrations/20261001204532_harden_campaign_discovery_authorization.sql"
    )
    paths = [
        repo / "supabase/tests/campaign_registry_fixture.sql",
        registry_migration,
        registry_migration,
        repo / "supabase/tests/campaign_authorization_fixture.sql",
        authorization_migration,
        authorization_migration,
        repo / "supabase/tests/campaign_authorization.sql",
    ]

    output_parts: list[str] = []
    for path in paths:
        try:
            result = run(
                psql_args(),
                input=path.read_text(encoding="utf-8"),
                timeout=25,
            )
            output_parts.append(result.stdout)
        except subprocess.CalledProcessError as exc:
            print(
                f"CAMPAIGN_AUTHORIZATION_SQL_FAILED {path.relative_to(repo)}",
                file=sys.stderr,
                flush=True,
            )
            if exc.stdout:
                print(exc.stdout, file=sys.stderr, flush=True)
            if exc.stderr:
                print(exc.stderr, file=sys.stderr, flush=True)
            raise

    output = "\n".join(output_parts)
    if "CAMPAIGN_AUTHORIZATION_SQL_OK" not in output:
        raise RuntimeError("campaign authorization SQL assertions did not emit success marker")

    print(
        "CAMPAIGN_AUTHORIZATION_DB_OK "
        "registry_replay=1 authorization_replay=1 public_projection_minimal=1 "
        "private_archived_hidden=1 edit_discovery_scoped=1 project_tda_exact=1 "
        "legacy_project_scope_denied=1 exact_action_separation=1 revoked_grant_fresh=1 "
        "eligible_expired_denied=1 session_resource_scope_denied=1 unlinked_denied=1 "
        "access_directory_capability_bound=1 sibling_denied=1 missing_opaque=1 "
        "global_unlinked_hidden=1 archived_mutation_boundary=1 helper_oracle_closed=1 "
        "security_definer_search_path_pinned=1 browser_grants_reviewed=1",
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
            print(f"CAMPAIGN_AUTHORIZATION_DB_CLEANUP_FAILED {exc}", file=sys.stderr)
    shutil.rmtree(root, ignore_errors=True)
