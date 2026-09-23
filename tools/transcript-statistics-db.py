"""Synthetic PostgreSQL gate for the transcript statistics read model (#537).

Creates a fresh local-only cluster, seeds synthetic rows before the candidate
migration, applies the candidate, and executes its SQL acceptance. Never reads
environment database credentials or Production data.
"""
import os
import pathlib
import subprocess
import tempfile
import sys

repo = pathlib.Path(__file__).resolve().parents[1]
binary = pathlib.Path("/usr/lib/postgresql/16/bin")
root = pathlib.Path(tempfile.mkdtemp(prefix="tda-stats-"))
root.chmod(0o700)
data, socket = root / "data", root / "socket"
socket.mkdir(mode=0o700)
env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
started = False


def run(args, *, input_text=None):
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        input=input_text,
        env=env,
        timeout=30,
    )


def psql(text):
    try:
        return run(
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
            input_text=text,
        )
    except subprocess.CalledProcessError as exc:
        if exc.stdout:
            print(exc.stdout, file=sys.stderr, flush=True)
        if exc.stderr:
            print(exc.stderr, file=sys.stderr, flush=True)
        raise


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
    with (data / "postgresql.conf").open("a", encoding="utf-8") as handle:
        handle.write(
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
        ]
    )
    started = True

    fixture = repo / "supabase/tests/transcript_import_fixture.sql"
    psql(fixture.read_text(encoding="utf-8"))

    psql(
        """
        alter table public.sessions
          add column title text not null default 'Sessão sintética',
          add column session_date date,
          add column duration_ms integer;
        grant delete on public.transcript_segments to service_role;

        insert into public.sessions(
          id, campaign_id, source_system, source_session_id, title, session_date, duration_ms
        ) values (
          '88888888-8888-4888-8888-888888888888',
          '11111111-1111-4111-8111-111111111111',
          'local_companion',
          'empty-before-migration',
          'Sessão vazia sintética',
          date '2026-09-22',
          null
        );

        insert into public.transcript_segments(
          id, session_id, source_segment_id, source_sequence, start_ms, end_ms, text,
          speaker_name, needs_review, review_status, text_chars, text_words, is_empty, metadata
        ) values (
          '77777777-7777-4777-8777-777777777777',
          '22222222-2222-4222-8222-222222222222',
          'pre-migration',
          1,
          0,
          1000,
          'um' || chr(160) || 'dois' || E'\\n' || 'três',
          'Synthetic',
          true,
          'pending',
          12,
          999,
          false,
          '{}'::jsonb
        );
        """
    )

    candidate = (
        repo
        / "supabase/candidates/20260923143000_transcript_statistics_read_model.sql"
    )
    acceptance = repo / "supabase/tests/transcript_statistics_read_model.sql"
    psql(candidate.read_text(encoding="utf-8"))
    psql(acceptance.read_text(encoding="utf-8"))
    print("TRANSCRIPT_STATISTICS_DB_PASS", flush=True)
finally:
    if started:
        subprocess.run(
            [
                str(binary / "pg_ctl"),
                "-D",
                str(data),
                "-m",
                "fast",
                "-w",
                "stop",
            ],
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
            check=False,
        )
