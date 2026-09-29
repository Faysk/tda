"""Transactional queue. Single supervisor owns recovery; claims are atomic."""
import base64
import json
import math
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from uuid import uuid4

from .execution_device import sanitize_execution_device
from .legacy.artifacts import sha256_json, utc_now
from .legacy.publication import build_publication_bundle


_ACTIVITY_METRICS = frozenset(
    {
        "qwen_windows_completed",
        "whisper_segments_completed",
        "model_downloaded_bytes",
    }
)
_MAX_ACTIVITY_COUNT = 1_000_000_000
_MAX_ACTIVITY_BYTES = (1 << 53) - 1


_PUBLIC_CONFLICT_CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,96}$")


class Conflict(Exception):
    def __init__(self, code: str):
        public_code = (
            code
            if isinstance(code, str) and _PUBLIC_CONFLICT_CODE.fullmatch(code) is not None
            else "LOCAL_OPERATION_CONFLICT"
        )
        self.code = public_code
        super().__init__(public_code)


class Store:
    def __init__(self, root):
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / "jobs.sqlite3"
        with self.tx() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12):
                raise RuntimeError("DATABASE_VERSION_UNSUPPORTED")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, signature TEXT NOT NULL,
                    body TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0,
                    error TEXT, result TEXT, updated TEXT NOT NULL,
                    attempt_started_at TEXT, attempt_finished_at TEXT,
                    stage_started_at TEXT, timing_state TEXT);
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
                    code TEXT NOT NULL, at TEXT NOT NULL, attempt INTEGER);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS idempotency_keys (
                    key TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    signature TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS terminal_job_receipts (
                    job_id TEXT PRIMARY KEY,
                    attempt INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    result_available INTEGER NOT NULL,
                    updated TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS job_activity (
                    job_id TEXT NOT NULL,
                    attempt INTEGER NOT NULL,
                    track INTEGER NOT NULL,
                    metric TEXT NOT NULL,
                    value INTEGER NOT NULL,
                    updated TEXT NOT NULL,
                    PRIMARY KEY(job_id, attempt, track, metric)
                );
                CREATE TABLE IF NOT EXISTS session_workspaces (
                    campaign_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0,
                    created TEXT NOT NULL,
                    updated TEXT NOT NULL,
                    PRIMARY KEY(campaign_id, session_id)
                );
                CREATE TABLE IF NOT EXISTS session_recording_parts (
                    part_id TEXT PRIMARY KEY,
                    campaign_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    selected_run_id TEXT,
                    created TEXT NOT NULL,
                    updated TEXT NOT NULL,
                    UNIQUE(campaign_id, session_id, source_id),
                    UNIQUE(campaign_id, session_id, ordinal)
                );
                CREATE INDEX IF NOT EXISTS session_recording_parts_workspace_idx
                    ON session_recording_parts(campaign_id, session_id, ordinal);
                CREATE TABLE IF NOT EXISTS session_participant_assignments (
                    campaign_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    observation_id TEXT NOT NULL,
                    participant_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    track_number INTEGER NOT NULL,
                    created TEXT NOT NULL,
                    updated TEXT NOT NULL,
                    PRIMARY KEY(campaign_id, session_id, observation_id)
                );
                CREATE INDEX IF NOT EXISTS session_participant_assignments_workspace_idx
                    ON session_participant_assignments(campaign_id, session_id);
                CREATE INDEX IF NOT EXISTS session_participant_assignments_source_idx
                    ON session_participant_assignments(campaign_id, session_id, source_id);
            """)
            event_columns = {
                row["name"] for row in db.execute("PRAGMA table_info(events)").fetchall()
            }
            if "level" not in event_columns:
                db.execute("ALTER TABLE events ADD COLUMN level TEXT NOT NULL DEFAULT 'info'")
            if "data" not in event_columns:
                db.execute("ALTER TABLE events ADD COLUMN data TEXT")
            if "attempt" not in event_columns:
                db.execute("ALTER TABLE events ADD COLUMN attempt INTEGER")
            workspace_columns = {
                row["name"]
                for row in db.execute("PRAGMA table_info(session_workspaces)").fetchall()
            }
            if "ordering_mode" not in workspace_columns:
                db.execute(
                    "ALTER TABLE session_workspaces ADD COLUMN ordering_mode "
                    "TEXT NOT NULL DEFAULT 'attachment'"
                )
            part_columns = {
                row["name"]
                for row in db.execute("PRAGMA table_info(session_recording_parts)").fetchall()
            }
            if "timeline_mode" not in part_columns:
                db.execute(
                    "ALTER TABLE session_recording_parts ADD COLUMN timeline_mode "
                    "TEXT NOT NULL DEFAULT 'unresolved'"
                )
            if "session_offset_seconds" not in part_columns:
                db.execute(
                    "ALTER TABLE session_recording_parts ADD COLUMN session_offset_seconds REAL"
                )
            if "trim_start_seconds" not in part_columns:
                db.execute(
                    "ALTER TABLE session_recording_parts ADD COLUMN trim_start_seconds "
                    "REAL NOT NULL DEFAULT 0"
                )
            if "trim_end_seconds" not in part_columns:
                db.execute(
                    "ALTER TABLE session_recording_parts ADD COLUMN trim_end_seconds REAL"
                )
            if "gap_confirmed" not in part_columns:
                db.execute(
                    "ALTER TABLE session_recording_parts ADD COLUMN gap_confirmed "
                    "INTEGER NOT NULL DEFAULT 0"
                )
            if "overlap_resolution" not in part_columns:
                db.execute(
                    "ALTER TABLE session_recording_parts ADD COLUMN overlap_resolution TEXT"
                )
            if "overlap_boundary_seconds" not in part_columns:
                db.execute(
                    "ALTER TABLE session_recording_parts ADD COLUMN overlap_boundary_seconds REAL"
                )
            job_columns = {
                row["name"] for row in db.execute("PRAGMA table_info(jobs)").fetchall()
            }
            if "execution_device" not in job_columns:
                db.execute("ALTER TABLE jobs ADD COLUMN execution_device TEXT")
            if "error_recoverable" not in job_columns:
                db.execute(
                    "ALTER TABLE jobs ADD COLUMN error_recoverable INTEGER NOT NULL DEFAULT 1"
                )
            if "attempt_started_at" not in job_columns:
                db.execute("ALTER TABLE jobs ADD COLUMN attempt_started_at TEXT")
            if "attempt_finished_at" not in job_columns:
                db.execute("ALTER TABLE jobs ADD COLUMN attempt_finished_at TEXT")
            if "stage_started_at" not in job_columns:
                db.execute("ALTER TABLE jobs ADD COLUMN stage_started_at TEXT")
            if "timing_state" not in job_columns:
                db.execute("ALTER TABLE jobs ADD COLUMN timing_state TEXT")
            db.execute(
                "INSERT OR IGNORE INTO idempotency_keys(key,job_id,signature) "
                "SELECT idem,id,signature FROM jobs"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS jobs_updated_id_idx "
                "ON jobs(updated DESC, id DESC)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS jobs_status_updated_id_idx "
                "ON jobs(status, updated DESC, id DESC)"
            )
            db.execute("PRAGMA user_version=12")
            db.execute("INSERT OR IGNORE INTO settings VALUES ('device', ?)", (str(uuid4()),))
            db.execute("INSERT OR IGNORE INTO settings VALUES ('paused', 'false')")

    @contextmanager
    def tx(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @contextmanager
    def read(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA query_only=ON")
            yield db
        finally:
            db.close()

    def setting(self, key):
        with self.read() as db:
            return db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()[0]

    def pause(self, paused):
        with self.tx() as db:
            db.execute("UPDATE settings SET value=? WHERE key='paused'", (json.dumps(paused),))

    @staticmethod
    def _workspace_identity(value, field):
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
            raise Conflict(f"SESSION_WORKSPACE_{field}_INVALID")
        return value

    @staticmethod
    def _workspace_revision(value):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise Conflict("SESSION_WORKSPACE_REVISION_INVALID")
        return value

    @staticmethod
    def _workspace_part_id(value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}", value):
            raise Conflict("SESSION_WORKSPACE_PART_INVALID")
        return value

    @staticmethod
    def _workspace_source_id(value):
        if not isinstance(value, str) or not re.fullmatch(r"craig-[0-9a-f]{64}", value):
            raise Conflict("SESSION_WORKSPACE_SOURCE_INVALID")
        return value

    @staticmethod
    def _session_workspace_dto(db, row):
        parts = db.execute(
            """
            SELECT part_id,source_id,ordinal,selected_run_id,
                   timeline_mode,session_offset_seconds,trim_start_seconds,
                   trim_end_seconds,gap_confirmed,overlap_resolution,
                   overlap_boundary_seconds,created,updated
            FROM session_recording_parts
            WHERE campaign_id=? AND session_id=?
            ORDER BY ordinal ASC, part_id ASC
            """,
            (row["campaign_id"], row["session_id"]),
        ).fetchall()
        return {
            "schema_version": "tda_session_workspace_v1",
            "campaign_id": row["campaign_id"],
            "session_id": row["session_id"],
            "revision": row["revision"],
            "ordering_mode": row["ordering_mode"] if "ordering_mode" in row.keys() else "attachment",
            "created_at": row["created"],
            "updated_at": row["updated"],
            "parts": [
                {
                    "part_id": part["part_id"],
                    "source_id": part["source_id"],
                    "ordinal": part["ordinal"],
                    "selected_run_id": part["selected_run_id"],
                    "timeline_mode": part["timeline_mode"],
                    "session_offset_seconds": part["session_offset_seconds"],
                    "trim_start_seconds": part["trim_start_seconds"],
                    "trim_end_seconds": part["trim_end_seconds"],
                    "gap_confirmed": bool(part["gap_confirmed"]),
                    "overlap_resolution": part["overlap_resolution"],
                    "overlap_boundary_seconds": part["overlap_boundary_seconds"],
                    "created_at": part["created"],
                    "updated_at": part["updated"],
                }
                for part in parts
            ],
        }

    def session_workspace(self, campaign_id, session_id):
        campaign_id = self._workspace_identity(campaign_id, "CAMPAIGN")
        session_id = self._workspace_identity(session_id, "SESSION")
        with self.read() as db:
            row = db.execute(
                "SELECT * FROM session_workspaces WHERE campaign_id=? AND session_id=?",
                (campaign_id, session_id),
            ).fetchone()
            if row is None:
                raise Conflict("SESSION_WORKSPACE_NOT_FOUND")
            return self._session_workspace_dto(db, row)

    def ensure_session_workspace(self, campaign_id, session_id):
        campaign_id = self._workspace_identity(campaign_id, "CAMPAIGN")
        session_id = self._workspace_identity(session_id, "SESSION")
        with self.tx() as db:
            now = utc_now()
            db.execute(
                """
                INSERT OR IGNORE INTO session_workspaces(
                    campaign_id,session_id,revision,created,updated,ordering_mode
                ) VALUES (?,?,0,?,?,'attachment')
                """,
                (campaign_id, session_id, now, now),
            )
            row = db.execute(
                "SELECT * FROM session_workspaces WHERE campaign_id=? AND session_id=?",
                (campaign_id, session_id),
            ).fetchone()
            return self._session_workspace_dto(db, row)

    def _session_workspace_for_update(self, db, campaign_id, session_id, expected_revision):
        campaign_id = self._workspace_identity(campaign_id, "CAMPAIGN")
        session_id = self._workspace_identity(session_id, "SESSION")
        expected_revision = self._workspace_revision(expected_revision)
        row = db.execute(
            "SELECT * FROM session_workspaces WHERE campaign_id=? AND session_id=?",
            (campaign_id, session_id),
        ).fetchone()
        if row is None:
            raise Conflict("SESSION_WORKSPACE_NOT_FOUND")
        if row["revision"] != expected_revision:
            raise Conflict("SESSION_WORKSPACE_REVISION_CONFLICT")
        return row

    @staticmethod
    def _bump_session_workspace(db, campaign_id, session_id, revision):
        now = utc_now()
        changed = db.execute(
            """
            UPDATE session_workspaces
            SET revision=?,updated=?
            WHERE campaign_id=? AND session_id=? AND revision=?
            """,
            (revision + 1, now, campaign_id, session_id, revision),
        ).rowcount
        if changed != 1:
            raise Conflict("SESSION_WORKSPACE_REVISION_CONFLICT")
        return db.execute(
            "SELECT * FROM session_workspaces WHERE campaign_id=? AND session_id=?",
            (campaign_id, session_id),
        ).fetchone()

    def attach_session_source(self, campaign_id, session_id, source_id, expected_revision):
        source_id = self._workspace_source_id(source_id)
        with self.tx() as db:
            row = self._session_workspace_for_update(
                db, campaign_id, session_id, expected_revision
            )
            existing = db.execute(
                """
                SELECT part_id FROM session_recording_parts
                WHERE campaign_id=? AND session_id=? AND source_id=?
                """,
                (row["campaign_id"], row["session_id"], source_id),
            ).fetchone()
            if existing is not None:
                return self._session_workspace_dto(db, row)
            ordinal = db.execute(
                """
                SELECT COUNT(*) FROM session_recording_parts
                WHERE campaign_id=? AND session_id=?
                """,
                (row["campaign_id"], row["session_id"]),
            ).fetchone()[0]
            now = utc_now()
            db.execute(
                """
                INSERT INTO session_recording_parts(
                    part_id,campaign_id,session_id,source_id,ordinal,
                    selected_run_id,timeline_mode,session_offset_seconds,
                    trim_start_seconds,trim_end_seconds,gap_confirmed,
                    overlap_resolution,overlap_boundary_seconds,created,updated
                ) VALUES (?,?,?,?,?,NULL,'unresolved',NULL,0,NULL,0,NULL,NULL,?,?)
                """,
                (
                    uuid4().hex,
                    row["campaign_id"],
                    row["session_id"],
                    source_id,
                    ordinal,
                    now,
                    now,
                ),
            )
            db.execute(
                "UPDATE session_workspaces SET ordering_mode='attachment' "
                "WHERE campaign_id=? AND session_id=?",
                (row["campaign_id"], row["session_id"]),
            )
            bumped = self._bump_session_workspace(
                db, row["campaign_id"], row["session_id"], row["revision"]
            )
            return self._session_workspace_dto(db, bumped)

    def select_session_part_run(
        self, campaign_id, session_id, part_id, run_id, expected_revision
    ):
        part_id = self._workspace_part_id(part_id)
        if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,196}", run_id):
            raise Conflict("SESSION_WORKSPACE_RUN_INVALID")
        with self.tx() as db:
            row = self._session_workspace_for_update(
                db, campaign_id, session_id, expected_revision
            )
            target = db.execute(
                """
                SELECT selected_run_id FROM session_recording_parts
                WHERE campaign_id=? AND session_id=? AND part_id=?
                """,
                (row["campaign_id"], row["session_id"], part_id),
            ).fetchone()
            if target is None:
                raise Conflict("SESSION_WORKSPACE_PART_NOT_FOUND")
            if target["selected_run_id"] == run_id:
                return self._session_workspace_dto(db, row)
            now = utc_now()
            changed = db.execute(
                """
                UPDATE session_recording_parts
                SET selected_run_id=?,updated=?
                WHERE campaign_id=? AND session_id=? AND part_id=?
                """,
                (run_id, now, row["campaign_id"], row["session_id"], part_id),
            ).rowcount
            if changed != 1:
                raise Conflict("SESSION_WORKSPACE_PART_NOT_FOUND")
            bumped = self._bump_session_workspace(
                db, row["campaign_id"], row["session_id"], row["revision"]
            )
            return self._session_workspace_dto(db, bumped)

    def detach_session_part(self, campaign_id, session_id, part_id, expected_revision):
        part_id = self._workspace_part_id(part_id)
        with self.tx() as db:
            row = self._session_workspace_for_update(
                db, campaign_id, session_id, expected_revision
            )
            target = db.execute(
                """
                SELECT source_id FROM session_recording_parts
                WHERE campaign_id=? AND session_id=? AND part_id=?
                """,
                (row["campaign_id"], row["session_id"], part_id),
            ).fetchone()
            if target is None:
                raise Conflict("SESSION_WORKSPACE_PART_NOT_FOUND")
            deleted = db.execute(
                """
                DELETE FROM session_recording_parts
                WHERE campaign_id=? AND session_id=? AND part_id=?
                """,
                (row["campaign_id"], row["session_id"], part_id),
            ).rowcount
            if deleted != 1:
                raise Conflict("SESSION_WORKSPACE_PART_NOT_FOUND")
            db.execute(
                """
                DELETE FROM session_participant_assignments
                WHERE campaign_id=? AND session_id=? AND source_id=?
                """,
                (row["campaign_id"], row["session_id"], target["source_id"]),
            )
            relation_reset_at = utc_now()
            db.execute(
                """
                UPDATE session_recording_parts
                SET gap_confirmed=0,overlap_resolution=NULL,
                    overlap_boundary_seconds=NULL,updated=?
                WHERE campaign_id=? AND session_id=?
                """,
                (
                    relation_reset_at,
                    row["campaign_id"],
                    row["session_id"],
                ),
            )
            parts = db.execute(
                """
                SELECT part_id FROM session_recording_parts
                WHERE campaign_id=? AND session_id=?
                ORDER BY ordinal ASC,part_id ASC
                """,
                (row["campaign_id"], row["session_id"]),
            ).fetchall()
            for ordinal, part in enumerate(parts):
                db.execute(
                    "UPDATE session_recording_parts SET ordinal=?,updated=? WHERE part_id=?",
                    (ordinal, utc_now(), part["part_id"]),
                )
            bumped = self._bump_session_workspace(
                db, row["campaign_id"], row["session_id"], row["revision"]
            )
            return self._session_workspace_dto(db, bumped)

    def reorder_session_parts(
        self, campaign_id, session_id, part_ids, expected_revision
    ):
        if (
            not isinstance(part_ids, (list, tuple))
            or len(part_ids) > 64
            or any(not isinstance(value, str) for value in part_ids)
        ):
            raise Conflict("SESSION_WORKSPACE_ORDER_INVALID")
        normalized = [self._workspace_part_id(value) for value in part_ids]
        if len(set(normalized)) != len(normalized):
            raise Conflict("SESSION_WORKSPACE_ORDER_INVALID")
        with self.tx() as db:
            row = self._session_workspace_for_update(
                db, campaign_id, session_id, expected_revision
            )
            current = db.execute(
                """
                SELECT part_id FROM session_recording_parts
                WHERE campaign_id=? AND session_id=?
                ORDER BY ordinal ASC,part_id ASC
                """,
                (row["campaign_id"], row["session_id"]),
            ).fetchall()
            current_ids = [part["part_id"] for part in current]
            if set(current_ids) != set(normalized) or len(current_ids) != len(normalized):
                raise Conflict("SESSION_WORKSPACE_ORDER_INVALID")
            if current_ids == normalized and row["ordering_mode"] == "manual":
                return self._session_workspace_dto(db, row)
            now = utc_now()
            if current_ids == normalized:
                db.execute(
                    "UPDATE session_workspaces SET ordering_mode='manual' "
                    "WHERE campaign_id=? AND session_id=?",
                    (row["campaign_id"], row["session_id"]),
                )
                bumped = self._bump_session_workspace(
                    db, row["campaign_id"], row["session_id"], row["revision"]
                )
                return self._session_workspace_dto(db, bumped)
            db.execute(
                """
                UPDATE session_recording_parts SET ordinal=ordinal+1000
                WHERE campaign_id=? AND session_id=?
                """,
                (row["campaign_id"], row["session_id"]),
            )
            for ordinal, part_id in enumerate(normalized):
                db.execute(
                    "UPDATE session_recording_parts SET ordinal=?,updated=? WHERE part_id=?",
                    (ordinal, now, part_id),
                )
            db.execute(
                """
                UPDATE session_recording_parts
                SET gap_confirmed=0,overlap_resolution=NULL,
                    overlap_boundary_seconds=NULL,updated=?
                WHERE campaign_id=? AND session_id=?
                """,
                (now, row["campaign_id"], row["session_id"]),
            )
            db.execute(
                "UPDATE session_workspaces SET ordering_mode='manual' "
                "WHERE campaign_id=? AND session_id=?",
                (row["campaign_id"], row["session_id"]),
            )
            bumped = self._bump_session_workspace(
                db, row["campaign_id"], row["session_id"], row["revision"]
            )
            return self._session_workspace_dto(db, bumped)

    @staticmethod
    def _workspace_seconds(value, field, *, nullable=False):
        if value is None and nullable:
            return None
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            or float(value) < 0
        ):
            raise Conflict(f"SESSION_WORKSPACE_{field}_INVALID")
        return float(value)

    @staticmethod
    def _workspace_overlap_resolution(value):
        if value is None:
            return None
        if value not in {"prefer_earlier_until", "prefer_later_from"}:
            raise Conflict("SESSION_WORKSPACE_OVERLAP_RESOLUTION_INVALID")
        return value

    def update_session_part_timing(
        self,
        campaign_id,
        session_id,
        part_id,
        expected_revision,
        *,
        session_offset_seconds,
        trim_start_seconds=0.0,
        trim_end_seconds=None,
        gap_confirmed=False,
        overlap_resolution=None,
        overlap_boundary_seconds=None,
    ):
        part_id = self._workspace_part_id(part_id)
        offset = self._workspace_seconds(
            session_offset_seconds, "SESSION_OFFSET"
        )
        trim_start = self._workspace_seconds(trim_start_seconds, "TRIM_START")
        trim_end = self._workspace_seconds(
            trim_end_seconds, "TRIM_END", nullable=True
        )
        if trim_end is not None and trim_end <= trim_start:
            raise Conflict("SESSION_WORKSPACE_TRIM_RANGE_INVALID")
        if not isinstance(gap_confirmed, bool):
            raise Conflict("SESSION_WORKSPACE_GAP_CONFIRMATION_INVALID")
        resolution = self._workspace_overlap_resolution(overlap_resolution)
        boundary = self._workspace_seconds(
            overlap_boundary_seconds, "OVERLAP_BOUNDARY", nullable=True
        )
        if (resolution is None) != (boundary is None):
            raise Conflict("SESSION_WORKSPACE_OVERLAP_RESOLUTION_INVALID")

        with self.tx() as db:
            row = self._session_workspace_for_update(
                db, campaign_id, session_id, expected_revision
            )
            part = db.execute(
                """
                SELECT * FROM session_recording_parts
                WHERE campaign_id=? AND session_id=? AND part_id=?
                """,
                (row["campaign_id"], row["session_id"], part_id),
            ).fetchone()
            if part is None:
                raise Conflict("SESSION_WORKSPACE_PART_NOT_FOUND")
            next_values = (
                "manual",
                offset,
                trim_start,
                trim_end,
                int(gap_confirmed),
                resolution,
                boundary,
            )
            current_values = (
                part["timeline_mode"],
                part["session_offset_seconds"],
                part["trim_start_seconds"],
                part["trim_end_seconds"],
                int(part["gap_confirmed"]),
                part["overlap_resolution"],
                part["overlap_boundary_seconds"],
            )
            if current_values == next_values:
                return self._session_workspace_dto(db, row)

            geometry_changed = current_values[1:4] != next_values[1:4]
            relation_changed = current_values[4:7] != next_values[4:7]
            if geometry_changed and not relation_changed:
                next_values = (*next_values[:4], 0, None, None)
            changed_at = utc_now()
            db.execute(
                """
                UPDATE session_recording_parts
                SET timeline_mode=?,session_offset_seconds=?,
                    trim_start_seconds=?,trim_end_seconds=?,gap_confirmed=?,
                    overlap_resolution=?,overlap_boundary_seconds=?,updated=?
                WHERE part_id=?
                """,
                (*next_values, changed_at, part_id),
            )
            if geometry_changed:
                db.execute(
                    """
                    UPDATE session_recording_parts
                    SET gap_confirmed=0,overlap_resolution=NULL,
                        overlap_boundary_seconds=NULL,updated=?
                    WHERE campaign_id=? AND session_id=? AND ordinal=?
                    """,
                    (
                        changed_at,
                        row["campaign_id"],
                        row["session_id"],
                        part["ordinal"] + 1,
                    ),
                )
            db.execute(
                "UPDATE session_workspaces SET ordering_mode='manual' "
                "WHERE campaign_id=? AND session_id=?",
                (row["campaign_id"], row["session_id"]),
            )
            bumped = self._bump_session_workspace(
                db, row["campaign_id"], row["session_id"], row["revision"]
            )
            return self._session_workspace_dto(db, bumped)

    def apply_automatic_session_timeline(
        self,
        campaign_id,
        session_id,
        placements,
        expected_revision,
    ):
        if not isinstance(placements, (list, tuple)) or len(placements) > 64:
            raise Conflict("SESSION_WORKSPACE_TIMELINE_INVALID")
        normalized = []
        for raw in placements:
            if not isinstance(raw, dict):
                raise Conflict("SESSION_WORKSPACE_TIMELINE_INVALID")
            ordinal = raw.get("ordinal")
            if (
                isinstance(ordinal, bool)
                or not isinstance(ordinal, int)
                or ordinal < 0
                or ordinal >= 64
            ):
                raise Conflict("SESSION_WORKSPACE_TIMELINE_INVALID")
            normalized.append(
                {
                    "part_id": self._workspace_part_id(raw.get("part_id")),
                    "source_id": self._workspace_source_id(raw.get("source_id")),
                    "ordinal": ordinal,
                    "session_offset_seconds": self._workspace_seconds(
                        raw.get("session_offset_seconds"), "SESSION_OFFSET"
                    ),
                }
            )
        if sorted(item["ordinal"] for item in normalized) != list(range(len(normalized))):
            raise Conflict("SESSION_WORKSPACE_TIMELINE_INVALID")
        if len({item["part_id"] for item in normalized}) != len(normalized):
            raise Conflict("SESSION_WORKSPACE_TIMELINE_INVALID")

        with self.tx() as db:
            row = self._session_workspace_for_update(
                db, campaign_id, session_id, expected_revision
            )
            current = db.execute(
                """
                SELECT part_id,source_id,timeline_mode
                FROM session_recording_parts
                WHERE campaign_id=? AND session_id=?
                ORDER BY ordinal ASC,part_id ASC
                """,
                (row["campaign_id"], row["session_id"]),
            ).fetchall()
            if any(part["timeline_mode"] == "manual" for part in current):
                raise Conflict("SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE")
            by_part = {part["part_id"]: part for part in current}
            if set(by_part) != {item["part_id"] for item in normalized}:
                raise Conflict("SESSION_WORKSPACE_TIMELINE_INVALID")
            for item in normalized:
                if by_part[item["part_id"]]["source_id"] != item["source_id"]:
                    raise Conflict("SESSION_WORKSPACE_TIMELINE_INVALID")

            db.execute(
                """
                UPDATE session_recording_parts SET ordinal=ordinal+1000
                WHERE campaign_id=? AND session_id=?
                """,
                (row["campaign_id"], row["session_id"]),
            )
            now = utc_now()
            for item in normalized:
                db.execute(
                    """
                    UPDATE session_recording_parts
                    SET ordinal=?,timeline_mode='automatic',
                        session_offset_seconds=?,gap_confirmed=0,
                        overlap_resolution=NULL,overlap_boundary_seconds=NULL,updated=?
                    WHERE part_id=?
                    """,
                    (
                        item["ordinal"],
                        item["session_offset_seconds"],
                        now,
                        item["part_id"],
                    ),
                )
            db.execute(
                "UPDATE session_workspaces SET ordering_mode='automatic' "
                "WHERE campaign_id=? AND session_id=?",
                (row["campaign_id"], row["session_id"]),
            )
            bumped = self._bump_session_workspace(
                db, row["campaign_id"], row["session_id"], row["revision"]
            )
            return self._session_workspace_dto(db, bumped)

    @staticmethod
    def _workspace_observation_id(value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}", value):
            raise Conflict("SESSION_PARTICIPANT_OBSERVATION_INVALID")
        return value

    @staticmethod
    def _workspace_participant_id(value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}", value):
            raise Conflict("SESSION_PARTICIPANT_ID_INVALID")
        return value

    def session_participant_assignments(self, campaign_id, session_id):
        campaign_id = self._workspace_identity(campaign_id, "CAMPAIGN")
        session_id = self._workspace_identity(session_id, "SESSION")
        with self.read() as db:
            workspace = db.execute(
                "SELECT 1 FROM session_workspaces WHERE campaign_id=? AND session_id=?",
                (campaign_id, session_id),
            ).fetchone()
            if workspace is None:
                raise Conflict("SESSION_WORKSPACE_NOT_FOUND")
            rows = db.execute(
                """
                SELECT observation_id,participant_id,source_id,track_number
                FROM session_participant_assignments
                WHERE campaign_id=? AND session_id=?
                ORDER BY observation_id ASC
                """,
                (campaign_id, session_id),
            ).fetchall()
            return [
                {
                    "observation_id": row["observation_id"],
                    "participant_id": row["participant_id"],
                    "source_id": row["source_id"],
                    "track_number": row["track_number"],
                }
                for row in rows
            ]

    def replace_session_participant_assignments(
        self,
        campaign_id,
        session_id,
        assignments,
        expected_revision,
    ):
        if not isinstance(assignments, (list, tuple)) or len(assignments) > 16384:
            raise Conflict("SESSION_PARTICIPANT_MAPPING_INVALID")
        normalized = []
        for raw in assignments:
            if not isinstance(raw, dict):
                raise Conflict("SESSION_PARTICIPANT_MAPPING_INVALID")
            observation_id = self._workspace_observation_id(raw.get("observation_id"))
            participant_id = self._workspace_participant_id(raw.get("participant_id"))
            source_id = self._workspace_source_id(raw.get("source_id"))
            track_number = raw.get("track_number")
            if (
                isinstance(track_number, bool)
                or not isinstance(track_number, int)
                or track_number < 1
                or track_number > 1_000_000
            ):
                raise Conflict("SESSION_PARTICIPANT_TRACK_INVALID")
            normalized.append(
                {
                    "observation_id": observation_id,
                    "participant_id": participant_id,
                    "source_id": source_id,
                    "track_number": track_number,
                }
            )
        if len({row["observation_id"] for row in normalized}) != len(normalized):
            raise Conflict("SESSION_PARTICIPANT_MAPPING_INVALID")
        normalized.sort(key=lambda row: row["observation_id"])

        with self.tx() as db:
            row = self._session_workspace_for_update(
                db, campaign_id, session_id, expected_revision
            )
            current = db.execute(
                """
                SELECT observation_id,participant_id,source_id,track_number
                FROM session_participant_assignments
                WHERE campaign_id=? AND session_id=?
                ORDER BY observation_id ASC
                """,
                (row["campaign_id"], row["session_id"]),
            ).fetchall()
            current_values = [
                {
                    "observation_id": item["observation_id"],
                    "participant_id": item["participant_id"],
                    "source_id": item["source_id"],
                    "track_number": item["track_number"],
                }
                for item in current
            ]
            if current_values == normalized:
                return self._session_workspace_dto(db, row)

            db.execute(
                """
                DELETE FROM session_participant_assignments
                WHERE campaign_id=? AND session_id=?
                """,
                (row["campaign_id"], row["session_id"]),
            )
            now = utc_now()
            for item in normalized:
                db.execute(
                    """
                    INSERT INTO session_participant_assignments(
                        campaign_id,session_id,observation_id,participant_id,
                        source_id,track_number,created,updated
                    ) VALUES (?,?,?,?,?,?,?,?)
                    """,
                    (
                        row["campaign_id"],
                        row["session_id"],
                        item["observation_id"],
                        item["participant_id"],
                        item["source_id"],
                        item["track_number"],
                        now,
                        now,
                    ),
                )
            bumped = self._bump_session_workspace(
                db, row["campaign_id"], row["session_id"], row["revision"]
            )
            return self._session_workspace_dto(db, bumped)

    def has_running_jobs(self):
        with self.read() as db:
            return db.execute("SELECT 1 FROM jobs WHERE status='running' LIMIT 1").fetchone() is not None

    def has_active_transcription_jobs(self):
        with self.read() as db:
            rows = db.execute(
                "SELECT body FROM jobs WHERE status IN ('queued','running')"
            ).fetchall()
            return any(
                json.loads(row["body"]).get("kind") in {"transcription.craig", "benchmark.craig"}
                for row in rows
            )

    def event(self, db, job_id, code, data=None, level="info", attempt=None):
        if attempt is not None and (
            isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or attempt < 1
        ):
            raise Conflict("JOB_EVENT_ATTEMPT_INVALID")
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")) if data else None
        db.execute(
            "INSERT INTO events(job_id,code,at,level,data,attempt) VALUES (?,?,?,?,?,?)",
            (job_id, code, utc_now(), level, payload, attempt),
        )

    @staticmethod
    def _timing_state(row):
        raw = row["timing_state"] if "timing_state" in row.keys() else None
        if not raw:
            return {"schema_version": "tda_job_timing_v1", "tracks": {}}
        try:
            value = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return {"schema_version": "tda_job_timing_v1", "tracks": {}}
        if (
            not isinstance(value, dict)
            or value.get("schema_version") != "tda_job_timing_v1"
            or not isinstance(value.get("tracks"), dict)
        ):
            return {"schema_version": "tda_job_timing_v1", "tracks": {}}
        return value

    @staticmethod
    def _seconds_between(started_at, finished_at):
        if not isinstance(started_at, str) or not isinstance(finished_at, str):
            return None
        try:
            start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            end = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
        except ValueError:
            return None
        value = (end - start).total_seconds()
        return max(0.0, value) if math.isfinite(value) else None

    def record_worker_event(
        self,
        job_id,
        attempt,
        code,
        data=None,
        *,
        level="info",
    ):
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,96}", code):
            raise Conflict("WORKER_EVENT_CODE_INVALID")
        if level not in {"info", "warning", "error"}:
            raise Conflict("WORKER_EVENT_LEVEL_INVALID")
        payload = data if isinstance(data, dict) else {}
        if len(payload) > 32:
            raise Conflict("WORKER_EVENT_DATA_INVALID")
        clean = {}
        for key, value in payload.items():
            if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key):
                raise Conflict("WORKER_EVENT_DATA_INVALID")
            if value is None or isinstance(value, (bool, int)):
                clean[key] = value
            elif isinstance(value, float) and math.isfinite(value):
                clean[key] = value
            elif isinstance(value, str) and len(value) <= 256:
                clean[key] = value
            else:
                raise Conflict("WORKER_EVENT_DATA_INVALID")
        with self.tx() as db:
            row = db.execute(
                "SELECT status,attempt FROM jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if not row:
                raise KeyError(job_id)
            if row["status"] != "running" or row["attempt"] != attempt:
                return False
            now = utc_now()
            if code == "ASR_EXECUTION_DEVICE":
                identity = sanitize_execution_device(clean)
                if identity is not None:
                    db.execute("UPDATE jobs SET execution_device=? WHERE id=?", (json.dumps({"attempt": attempt, **identity}), job_id))
            if code in {"TRACK_STARTED", "TRACK_COMPLETED"}:
                full_row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
                timing = self._timing_state(full_row)
                tracks = timing["tracks"]
                track = clean.get("track")
                if isinstance(track, int) and not isinstance(track, bool) and 1 <= track <= 256:
                    key = str(track)
                    item = tracks.get(key) if isinstance(tracks.get(key), dict) else {}
                    if code == "TRACK_STARTED":
                        item = {
                            "track": track,
                            "total_tracks": clean.get("total_tracks"),
                            "speaker": clean.get("speaker"),
                            "started_at": now,
                            "finished_at": None,
                            "processing_seconds": None,
                        }
                    else:
                        started = item.get("started_at")
                        item = {
                            **item,
                            "track": track,
                            "total_tracks": clean.get("total_tracks"),
                            "speaker": clean.get("speaker"),
                            "finished_at": now,
                            "processing_seconds": self._seconds_between(started, now),
                        }
                    tracks[key] = item
                    timing["tracks"] = tracks
                    db.execute(
                        "UPDATE jobs SET timing_state=? WHERE id=?",
                        (json.dumps(timing, ensure_ascii=False, separators=(",", ":")), job_id),
                    )
            self.event(db, job_id, code, clean, level=level, attempt=attempt)
            return True

    def record_activity(self, job_id, attempt, metric, value, *, track=None):
        if (
            isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or attempt < 1
            or not isinstance(metric, str)
            or metric not in _ACTIVITY_METRICS
            or isinstance(value, bool)
            or not isinstance(value, int)
            or value < 0
        ):
            raise Conflict("JOB_ACTIVITY_INVALID")
        if metric == "model_downloaded_bytes":
            if track is not None or value > _MAX_ACTIVITY_BYTES:
                raise Conflict("JOB_ACTIVITY_INVALID")
            track_key = 0
        else:
            if (
                isinstance(track, bool)
                or not isinstance(track, int)
                or track < 1
                or track > _MAX_ACTIVITY_COUNT
                or value > _MAX_ACTIVITY_COUNT
            ):
                raise Conflict("JOB_ACTIVITY_INVALID")
            track_key = track
        with self.tx() as db:
            row = db.execute(
                "SELECT status,attempt FROM jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if not row:
                raise KeyError(job_id)
            if row["status"] != "running" or row["attempt"] != attempt:
                return False
            now = utc_now()
            db.execute(
                """
                INSERT INTO job_activity(job_id,attempt,track,metric,value,updated)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(job_id,attempt,track,metric) DO UPDATE SET
                    value=CASE
                        WHEN excluded.metric = 'model_downloaded_bytes'
                        THEN excluded.value
                        WHEN excluded.value > job_activity.value
                        THEN excluded.value
                        ELSE job_activity.value
                    END,
                    updated=CASE
                        WHEN excluded.metric = 'model_downloaded_bytes'
                        THEN excluded.updated
                        WHEN excluded.value > job_activity.value
                        THEN excluded.updated
                        ELSE job_activity.updated
                    END
                """,
                (job_id, attempt, track_key, metric, value, now),
            )
            return True

    def record_worker_activity(self, job_id, attempt, code, data):
        payload = data if isinstance(data, dict) else {}
        if code == "QWEN_WINDOW_TRANSCRIBED":
            value = payload.get("completed_window_count")
            if value is None:
                return None
            return self.record_activity(
                job_id,
                attempt,
                "qwen_windows_completed",
                value,
                track=payload.get("track"),
            )
        if code == "WHISPER_SEGMENT_TRANSCRIBED":
            value = payload.get("completed_segment_count", payload.get("segment"))
            return self.record_activity(
                job_id,
                attempt,
                "whisper_segments_completed",
                value,
                track=payload.get("track"),
            )
        if code == "MODEL_DOWNLOAD_PROGRESS":
            return self.record_activity(
                job_id,
                attempt,
                "model_downloaded_bytes",
                payload.get("downloaded_bytes"),
            )
        if code == "TRACK_COMPLETED":
            accepted = None
            if "completed_window_count" in payload:
                accepted = self.record_activity(
                    job_id,
                    attempt,
                    "qwen_windows_completed",
                    payload["completed_window_count"],
                    track=payload.get("track"),
                )
            if "completed_segment_count" in payload:
                segment_accepted = self.record_activity(
                    job_id,
                    attempt,
                    "whisper_segments_completed",
                    payload["completed_segment_count"],
                    track=payload.get("track"),
                )
                accepted = segment_accepted if accepted is None else accepted and segment_accepted
            return accepted
        return None

    def activity(self, job_id, *, attempt=None):
        if attempt is not None and (
            isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or attempt < 1
        ):
            raise Conflict("JOB_ACTIVITY_ATTEMPT_INVALID")
        with self.read() as db:
            job = db.execute(
                "SELECT attempt FROM jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if not job:
                raise KeyError(job_id)
            selected_attempt = attempt if attempt is not None else int(job["attempt"])
            rows = db.execute(
                """
                SELECT track,metric,value,updated
                FROM job_activity
                WHERE job_id=? AND attempt=?
                ORDER BY track,metric
                """,
                (job_id, selected_attempt),
            ).fetchall()
        return {
            "schema_version": "tda_job_activity_v1",
            "attempt": selected_attempt,
            "metrics": [
                {
                    "track": row["track"] or None,
                    "metric": row["metric"],
                    "value": row["value"],
                    "updated_at": row["updated"],
                }
                for row in rows
            ],
        }

    def recover(self):
        with self.tx() as db:
            for row in db.execute(
                "SELECT id,attempt FROM jobs WHERE status='running'"
            ).fetchall():
                now = utc_now()
                db.execute(
                    "UPDATE jobs SET status='interrupted',stage='interrupted',error='PROCESS_INTERRUPTED',error_recoverable=1,"
                    "attempt_finished_at=?,stage_started_at=?,updated=? WHERE id=?",
                    (now, now, now, row["id"]),
                )
                self.event(db, row["id"], "PROCESS_INTERRUPTED", level="warning", attempt=row["attempt"])

    @staticmethod
    def dto(row):
        body = json.loads(row["body"])
        context = dict(
            campaign_id=body["campaign_id"],
            session_id=body["session_id"],
            source_id=body["source_id"],
        )
        if body["kind"] == "transcription.craig":
            context["profile_id"] = body["profile_id"]
            context["cpu"] = bool(body.get("cpu", False))
            audio_work = body.get("audio_work_seconds")
            if (
                isinstance(audio_work, (int, float))
                and not isinstance(audio_work, bool)
                and math.isfinite(float(audio_work))
                and audio_work >= 0
            ):
                context["audio_work_seconds"] = float(audio_work)
            durations = body.get("track_durations_seconds")
            if (
                isinstance(durations, list)
                and len(durations) <= 256
                and all(
                    isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and math.isfinite(float(value))
                    and value >= 0
                    for value in durations
                )
            ):
                context["track_durations_seconds"] = [
                    float(value) for value in durations
                ]
        elif body["kind"] == "benchmark.craig":
            context["sample_identity_sha256"] = body.get("sample_identity_sha256")
            context["sample_seconds"] = body.get("sample_seconds")
            context["profiles"] = body.get("profiles", [])
            context["prepared"] = bool(body.get("prepared", False))
        raw_device = json.loads(row["execution_device"]) if row["execution_device"] else None
        execution_device = sanitize_execution_device(raw_device) if isinstance(raw_device, dict) and raw_device.get("attempt") == row["attempt"] else None
        timing_state = Store._timing_state(row)
        now = utc_now()
        attempt_end = row["attempt_finished_at"] or (now if row["status"] == "running" else row["updated"])
        stage_end = now if row["status"] == "running" else row["updated"]
        timing = {
            "schema_version": "tda_job_timing_v1",
            "attempt_started_at": row["attempt_started_at"],
            "attempt_finished_at": row["attempt_finished_at"],
            "attempt_elapsed_seconds": Store._seconds_between(row["attempt_started_at"], attempt_end),
            "stage_started_at": row["stage_started_at"],
            "stage_elapsed_seconds": Store._seconds_between(row["stage_started_at"], stage_end),
            "tracks": sorted(
                [value for value in timing_state["tracks"].values() if isinstance(value, dict)],
                key=lambda item: item.get("track", 0),
            ),
        }
        return dict(
            timing=timing,
            execution_device=execution_device,
            id=row["id"],
            kind=body["kind"],
            status=row["status"],
            stage=row["stage"],
            progress=dict(
                completed=row["completed"],
                total=body["units"],
                unit=(
                    "tracks"
                    if body["kind"] == "transcription.craig"
                    else "profiles"
                    if body["kind"] == "benchmark.craig"
                    else "items"
                ),
            ),
            error=(
                dict(
                    code=row["error"],
                    recoverable=bool(row["error_recoverable"]),
                )
                if row["error"]
                else None
            ),
            result_available=row["result"] is not None,
            updated_at=row["updated"],
            attempt=row["attempt"],
            context=context,
        )

    @staticmethod
    def _transcription_work_signature(body):
        if body.get("kind") != "transcription.craig":
            return None
        return sha256_json(
            {
                "kind": "transcription.craig",
                "source_id": body.get("source_id"),
                "profile_id": body.get("profile_id"),
                "glossary": body.get("glossary", ""),
                "context": body.get("context", ""),
                "cpu": bool(body.get("cpu", False)),
                "units": body.get("units"),
            }
        )

    def submit(self, key, body):
        signature = sha256_json(body)
        with self.tx() as db:
            alias = db.execute(
                "SELECT job_id,signature FROM idempotency_keys WHERE key=?",
                (key,),
            ).fetchone()
            if alias:
                if alias["signature"] != signature:
                    raise Conflict("IDEMPOTENCY_CONFLICT")
                row = db.execute(
                    "SELECT * FROM jobs WHERE id=?",
                    (alias["job_id"],),
                ).fetchone()
                if not row:
                    receipt = db.execute(
                        "SELECT job_id FROM terminal_job_receipts WHERE job_id=?",
                        (alias["job_id"],),
                    ).fetchone()
                    if receipt:
                        raise Conflict("IDEMPOTENCY_OPERATION_REMOVED")
                    raise Conflict("IDEMPOTENCY_STATE_INVALID")
                return self.dto(row)
            if body.get("kind") == "transcription.craig":
                active = db.execute(
                    """
                    SELECT * FROM jobs
                    WHERE signature=? AND status IN ('queued','running')
                    ORDER BY updated DESC
                    LIMIT 1
                    """,
                    (signature,),
                ).fetchone()
                if active:
                    db.execute(
                        "INSERT INTO idempotency_keys(key,job_id,signature) VALUES (?,?,?)",
                        (key, active["id"], signature),
                    )
                    self.event(
                        db,
                        active["id"],
                        "DUPLICATE_SUBMISSION_REUSED",
                        {"status": active["status"]},
                    )
                    return self.dto(active)

                requested_work = self._transcription_work_signature(body)
                for candidate in db.execute(
                    """
                    SELECT * FROM jobs
                    WHERE status IN ('queued','running')
                    ORDER BY updated DESC
                    """
                ).fetchall():
                    candidate_body = json.loads(candidate["body"])
                    if (
                        candidate_body.get("kind") == "transcription.craig"
                        and self._transcription_work_signature(candidate_body) == requested_work
                    ):
                        raise Conflict("TRANSCRIPTION_WORK_ALREADY_ACTIVE")
            units = body.get("units")
            if isinstance(units, bool) or not isinstance(units, int) or units < 1:
                raise Conflict("JOB_UNITS_INVALID")
            job_id = str(uuid4())
            db.execute(
                "INSERT INTO jobs(id,idem,signature,body,status,stage,updated) VALUES (?,?,?,?,'queued','queued',?)",
                (job_id, key, signature, json.dumps(body), utc_now()),
            )
            db.execute(
                "INSERT INTO idempotency_keys(key,job_id,signature) VALUES (?,?,?)",
                (key, job_id, signature),
            )
            self.event(db, job_id, "QUEUED", {"total": units})
            return self.dto(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def get(self, job_id):
        with self.read() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            return self.dto(row)

    def body(self, job_id):
        with self.read() as db:
            row = db.execute("SELECT body FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            return json.loads(row["body"])

    def terminal_receipt(self, job_id):
        with self.read() as db:
            row = db.execute(
                "SELECT job_id,attempt,status,result_available,updated "
                "FROM terminal_job_receipts WHERE job_id=?",
                (job_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "job_id": row["job_id"],
                "attempt": row["attempt"],
                "status": row["status"],
                "result_available": bool(row["result_available"]),
                "updated_at": row["updated"],
            }

    @staticmethod
    def _job_cursor(scope, updated, job_id):
        payload = json.dumps(
            {
                "schema": "tda_job_list_cursor_v1",
                "scope": scope,
                "updated": updated,
                "id": job_id,
            },
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_job_cursor(cursor, scope):
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 512:
            raise Conflict("JOB_LIST_CURSOR_INVALID")
        try:
            padding = "=" * (-len(cursor) % 4)
            raw = base64.urlsafe_b64decode((cursor + padding).encode("ascii"))
            if len(raw) > 512:
                raise ValueError
            value = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError, json.JSONDecodeError):
            raise Conflict("JOB_LIST_CURSOR_INVALID") from None
        if (
            not isinstance(value, dict)
            or set(value) != {"schema", "scope", "updated", "id"}
            or value.get("schema") != "tda_job_list_cursor_v1"
            or value.get("scope") != scope
            or not isinstance(value.get("updated"), str)
            or not 1 <= len(value["updated"]) <= 64
            or not isinstance(value.get("id"), str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value["id"])
        ):
            raise Conflict("JOB_LIST_CURSOR_INVALID")
        return value["updated"], value["id"]

    @staticmethod
    def _job_scope_sql(scope):
        if scope == "all":
            return "", ()
        if scope == "active":
            return "status IN ('queued','running')", ()
        if scope == "history":
            return "status NOT IN ('queued','running')", ()
        raise Conflict("JOB_LIST_SCOPE_INVALID")

    def jobs_page(self, *, scope="all", cursor=None, limit=100):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
            raise Conflict("JOB_LIST_LIMIT_INVALID")
        scope_where, scope_params = self._job_scope_sql(scope)
        clauses = []
        params = list(scope_params)
        if scope_where:
            clauses.append(scope_where)
        if cursor is not None:
            updated, job_id = self._decode_job_cursor(cursor, scope)
            clauses.append("(updated < ? OR (updated = ? AND id < ?))")
            params.extend((updated, updated, job_id))
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.read() as db:
            rows = db.execute(
                f"SELECT * FROM jobs{where} ORDER BY updated DESC, id DESC LIMIT ?",
                (*params, limit + 1),
            ).fetchall()
            has_more = len(rows) > limit
            selected = rows[:limit]
            count_where = f" WHERE {scope_where}" if scope_where else ""
            total_matching = int(
                db.execute(
                    f"SELECT COUNT(*) AS total FROM jobs{count_where}",
                    scope_params,
                ).fetchone()["total"]
            )
            counts = {
                row["status"]: int(row["total"])
                for row in db.execute(
                    "SELECT status, COUNT(*) AS total FROM jobs GROUP BY status"
                ).fetchall()
            }
        next_cursor = None
        if has_more and selected:
            tail = selected[-1]
            next_cursor = self._job_cursor(scope, tail["updated"], tail["id"])
        return {
            "schema_version": "tda_job_page_v1",
            "scope": scope,
            "jobs": [self.dto(row) for row in selected],
            "has_more": has_more,
            "next_cursor": next_cursor,
            "total_matching": total_matching,
            "counts": counts,
        }

    def jobs(self):
        """Legacy bounded list; cursor-aware clients use jobs_page()."""
        with self.read() as db:
            return [
                self.dto(r)
                for r in db.execute(
                    "SELECT * FROM jobs ORDER BY updated DESC, id DESC LIMIT 100"
                )
            ]

    def has_running_source(self, source_id: str) -> bool:
        with self.read() as db:
            rows = db.execute(
                "SELECT body FROM jobs WHERE status='running'"
            ).fetchall()
            for row in rows:
                try:
                    body = json.loads(row["body"])
                except (TypeError, json.JSONDecodeError):
                    continue
                if (
                    body.get("kind") == "transcription.craig"
                    and body.get("source_id") == source_id
                ):
                    return True
            return False

    def reconciliation_candidates(self):
        with self.read() as db:
            rows = db.execute(
                """
                SELECT id,attempt,body,status,error_recoverable FROM jobs
                WHERE (
                    status IN ('running','interrupted')
                    OR (status='failed' AND error_recoverable=1)
                )
                  AND result IS NULL
                  AND attempt > 0
                ORDER BY updated
                """
            ).fetchall()
            return [
                {
                    "id": row["id"],
                    "attempt": row["attempt"],
                    "body": json.loads(row["body"]),
                    "status": row["status"],
                }
                for row in rows
            ]

    @staticmethod
    def _event_dto(row):
        return dict(
            seq=row["seq"],
            attempt=row["attempt"],
            code=row["code"],
            at=row["at"],
            level=row["level"],
            data=json.loads(row["data"]) if row["data"] else {},
        )

    def events_page(self, job_id, *, after_seq=None, before_seq=None, limit=100):
        if (
            isinstance(limit, bool)
            or not isinstance(limit, int)
            or not 1 <= limit <= 200
            or after_seq is not None and before_seq is not None
        ):
            raise ValueError("JOB_EVENTS_CURSOR_INVALID")
        for cursor in (after_seq, before_seq):
            if cursor is not None and (
                isinstance(cursor, bool)
                or not isinstance(cursor, int)
                or cursor < 0
            ):
                raise ValueError("JOB_EVENTS_CURSOR_INVALID")

        with self.read() as db:
            if not db.execute("SELECT 1 FROM jobs WHERE id=?", (job_id,)).fetchone():
                raise KeyError(job_id)

            params = [job_id]
            where = "job_id=?"
            descending = after_seq is None
            if after_seq is not None:
                where += " AND seq>?"
                params.append(after_seq)
                descending = False
            elif before_seq is not None:
                where += " AND seq<?"
                params.append(before_seq)

            rows = db.execute(
                "SELECT seq,code,at,level,data,attempt FROM events "
                f"WHERE {where} ORDER BY seq {'DESC' if descending else 'ASC'} LIMIT ?",
                (*params, limit + 1),
            ).fetchall()
            has_more = len(rows) > limit
            selected = rows[:limit]
            events = [self._event_dto(row) for row in selected]
            sequences = [event["seq"] for event in events]

            return {
                "events": events,
                "has_more": has_more,
                "next_after_seq": max(sequences) if sequences else after_seq,
                "next_before_seq": min(sequences) if sequences else before_seq,
            }

    def events(self, job_id):
        """Legacy latest-page helper retains the historical newest-first ordering."""
        return self.events_page(job_id)["events"]

    def remove(self, job_id):
        with self.tx() as db:
            row = db.execute(
                "SELECT status,attempt,result,updated FROM jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if not row:
                raise KeyError(job_id)
            if row["status"] not in ("succeeded", "failed", "interrupted", "cancelled"):
                raise Conflict("JOB_ACTIVE")
            # Queue rows and events are disposable operational state. Preserve the
            # terminal status/attempt before deletion so run visibility does not
            # change merely because the row disappeared. Idempotency aliases also
            # survive cleanup: replay of an accepted key must fail closed rather
            # than silently forming a new operation.
            db.execute(
                """
                INSERT INTO terminal_job_receipts(
                    job_id,attempt,status,result_available,updated
                ) VALUES (?,?,?,?,?)
                ON CONFLICT(job_id) DO UPDATE SET
                    attempt=excluded.attempt,
                    status=excluded.status,
                    result_available=excluded.result_available,
                    updated=excluded.updated
                """,
                (
                    job_id,
                    row["attempt"],
                    row["status"],
                    int(row["result"] is not None),
                    row["updated"],
                ),
            )
            db.execute("DELETE FROM events WHERE job_id=?", (job_id,))
            db.execute("DELETE FROM job_activity WHERE job_id=?", (job_id,))
            db.execute("DELETE FROM jobs WHERE id=?", (job_id,))
            return {"deleted": True, "id": job_id}

    def action(self, job_id, action):
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            body = json.loads(row["body"])
            status = row["status"]
            completed = row["completed"]
            event_attempt = (
                row["attempt"]
                if action == "cancel" and status == "running"
                else None
            )
            if action == "cancel":
                if status == "cancelled":
                    return self.dto(row)
                if status not in ("queued", "running"):
                    raise Conflict("JOB_TERMINAL")
                status = "cancelled"
            else:
                if (
                    status not in ("failed", "interrupted")
                    or not bool(row["error_recoverable"])
                ):
                    raise Conflict("JOB_NOT_RETRYABLE")
                if body["kind"] == "transcription.craig":
                    requested_work = self._transcription_work_signature(body)
                    for candidate in db.execute(
                        """
                        SELECT body FROM jobs
                        WHERE id<>? AND status IN ('queued','running')
                        """,
                        (job_id,),
                    ).fetchall():
                        candidate_body = json.loads(candidate["body"])
                        if (
                            candidate_body.get("kind") == "transcription.craig"
                            and self._transcription_work_signature(candidate_body) == requested_work
                        ):
                            raise Conflict("TRANSCRIPTION_WORK_ALREADY_ACTIVE")
                status = "queued"
                # Queue progress restarts from zero for the new attempt.
                # Engines may reuse validated per-track checkpoints, but every
                # reused track must be replayed as fresh sequential progress before
                # this attempt can commit its own immutable result.
                if body["kind"] == "transcription.craig":
                    completed = 0
            now = utc_now()
            db.execute(
                "UPDATE jobs SET status=?,stage=?,completed=?,error=NULL,error_recoverable=1,"
                "attempt_started_at=CASE WHEN ?='queued' THEN NULL ELSE attempt_started_at END,"
                "attempt_finished_at=CASE WHEN ?='queued' THEN NULL WHEN ?='cancelled' THEN ? ELSE attempt_finished_at END,"
                "stage_started_at=CASE WHEN ?='queued' THEN NULL ELSE ? END,"
                "timing_state=CASE WHEN ?='queued' THEN NULL ELSE timing_state END,updated=? WHERE id=?",
                (status, status, completed, status, status, status, now, status, now, status, now, job_id),
            )
            self.event(
                db,
                job_id,
                status.upper(),
                level="warning" if status == "cancelled" else "info",
                attempt=event_attempt,
            )
            return self.dto(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def claim(self):
        with self.tx() as db:
            if db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()[0] == "true":
                return None
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY updated LIMIT 1").fetchone()
            if not row:
                return None
            body = json.loads(row["body"])
            next_attempt = row["attempt"] + 1
            stage = "preparing" if body["kind"] == "transcription.craig" else "fixture"
            now = utc_now()
            db.execute(
                "UPDATE jobs SET status='running',stage=?,attempt=?,execution_device=NULL,"
                "attempt_started_at=?,attempt_finished_at=NULL,stage_started_at=?,timing_state=?,updated=? WHERE id=?",
                (
                    stage,
                    next_attempt,
                    now,
                    now,
                    json.dumps({"schema_version": "tda_job_timing_v1", "tracks": {}}, separators=(",", ":")),
                    now,
                    row["id"],
                ),
            )
            self.event(
                db,
                row["id"],
                "RUNNING",
                {"attempt": next_attempt, "total": body["units"]},
                attempt=next_attempt,
            )
            return row["id"], next_attempt

    def set_stage(self, job_id, attempt, stage):
        if not isinstance(stage, str) or not re.fullmatch(r"[a-z0-9_.-]{1,64}", stage):
            raise Conflict("JOB_STAGE_INVALID")
        with self.tx() as db:
            current = db.execute(
                "SELECT stage FROM jobs WHERE id=? AND status='running' AND attempt=?",
                (job_id, attempt),
            ).fetchone()
            if not current:
                return False
            now = utc_now()
            changed = db.execute(
                "UPDATE jobs SET stage=?,stage_started_at=CASE WHEN stage<>? THEN ? ELSE stage_started_at END,updated=? "
                "WHERE id=? AND status='running' AND attempt=?",
                (stage, stage, now, now, job_id, attempt),
            ).rowcount
            if changed:
                self.event(
                    db,
                    job_id,
                    "STAGE_CHANGED",
                    {"stage": stage},
                    attempt=attempt,
                )
            return bool(changed)

    def touch(self, job_id, attempt):
        """Refresh liveness for a running attempt without creating noisy events."""
        with self.tx() as db:
            return bool(
                db.execute(
                    "UPDATE jobs SET updated=? WHERE id=? AND status='running' AND attempt=?",
                    (utc_now(), job_id, attempt),
                ).rowcount
            )

    def progress(self, job_id, attempt, *, completed, total, stage):
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row["status"] != "running" or row["attempt"] != attempt:
                return False
            body = json.loads(row["body"])
            if total != body["units"] or completed != row["completed"] + 1:
                raise Conflict("WORKER_PROGRESS_MISMATCH")
            if not isinstance(stage, str) or not re.fullmatch(r"[a-z0-9_.-]{1,64}", stage):
                raise Conflict("JOB_STAGE_INVALID")
            now = utc_now()
            db.execute(
                "UPDATE jobs SET completed=?,stage=?,stage_started_at=CASE WHEN stage<>? THEN ? ELSE stage_started_at END,updated=? WHERE id=?",
                (completed, stage, stage, now, now, job_id),
            )
            self.event(
                db,
                job_id,
                "UNIT_COMMITTED",
                {"completed": completed, "total": total, "unit": "tracks"},
                attempt=attempt,
            )
            return True

    def complete(self, job_id, attempt, result):
        encoded = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row["status"] != "running" or row["attempt"] != attempt:
                return False
            body = json.loads(row["body"])
            if row["completed"] != body["units"]:
                raise Conflict("WORKER_RESULT_INCOMPLETE")
            now = utc_now()
            db.execute(
                "UPDATE jobs SET status='succeeded',stage='complete',result=?,error=NULL,"
                "attempt_finished_at=?,stage_started_at=?,updated=? WHERE id=?",
                (encoded, now, now, now, job_id),
            )
            self.event(
                db,
                job_id,
                "SUCCEEDED",
                {"total": body["units"]},
                attempt=attempt,
            )
            return True

    def complete_recovered(self, job_id, attempt, result):
        encoded = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if (
                not row
                or row["status"] not in ("running", "interrupted", "failed")
                or row["attempt"] != attempt
                or row["result"] is not None
            ):
                return False
            body = json.loads(row["body"])
            if body.get("kind") != "transcription.craig":
                raise Conflict("RECOVERED_RESULT_KIND_INVALID")
            now = utc_now()
            db.execute(
                "UPDATE jobs SET completed=?,status='succeeded',stage='complete',result=?,error=NULL,error_recoverable=1,"
                "attempt_finished_at=?,stage_started_at=?,updated=? WHERE id=?",
                (body["units"], encoded, now, now, now, job_id),
            )
            self.event(
                db,
                job_id,
                "SUCCEEDED_RECOVERED",
                {"attempt": attempt, "total": body["units"]},
                level="warning",
                attempt=attempt,
            )
            return True

    def step(self, job_id, attempt):
        """Commit a real synthetic work unit and progress together; fence stale workers."""
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row["status"] != "running" or row["attempt"] != attempt:
                return False
            body = json.loads(row["body"])
            if body["kind"] != "synthetic.fixture":
                raise Conflict("JOB_STEP_KIND_INVALID")
            completed = row["completed"] + 1
            sha256_json({"source": body["source_id"], "unit": completed})
            done = completed == body["units"]
            result = None
            if done:
                bundle = build_publication_bundle(
                    {"recording_id": body["source_id"], "format": "synthetic.fixture"},
                    {"fixture": True, "units": body["units"], "transcript": {"sha256": sha256_json([])}},
                )
                payload = {
                    key: value
                    for key, value in bundle.items()
                    if key not in ("publication_id", "generated_at")
                }
                result = json.dumps(
                    dict(
                        schema_version="tda_local_result_v1",
                        campaign_id=body["campaign_id"],
                        session_id=body["session_id"],
                        source_id=body["source_id"],
                        job_id=job_id,
                        publication_bundle=bundle,
                        sync={"status": "not_configured"},
                        import_artifacts={
                            "publication_payload_json": json.dumps(
                                payload,
                                ensure_ascii=False,
                                sort_keys=True,
                                separators=(",", ":"),
                            ),
                            "transcript_json": "[]",
                        },
                    )
                )
            now = utc_now()
            db.execute(
                "UPDATE jobs SET completed=?,status=?,stage=?,result=?,"
                "attempt_finished_at=CASE WHEN ? THEN ? ELSE attempt_finished_at END,"
                "stage_started_at=CASE WHEN ? THEN ? ELSE stage_started_at END,updated=? WHERE id=?",
                (
                    completed,
                    "succeeded" if done else "running",
                    "complete" if done else "fixture",
                    result,
                    int(done),
                    now,
                    int(done),
                    now,
                    now,
                    job_id,
                ),
            )
            self.event(
                db,
                job_id,
                "SUCCEEDED" if done else "UNIT_COMMITTED",
                {"completed": completed, "total": body["units"]},
                attempt=attempt,
            )
            return not done

    def result(self, job_id):
        with self.read() as db:
            row = db.execute("SELECT result FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            value = row["result"]
            if value is None:
                raise Conflict("RESULT_NOT_READY")
            return json.loads(value)


    def clear_local_result_reference(self, job_id, attempt):
        """Detach a deliberately deleted local artifact without rewriting queue history."""
        if (
            not isinstance(job_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", job_id)
            or isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or attempt < 1
        ):
            raise Conflict("LOCAL_RESULT_DELETE_IDENTITY_INVALID")
        with self.tx() as db:
            row = db.execute(
                "SELECT status,attempt,result FROM jobs WHERE id=?",
                (job_id,),
            ).fetchone()
            if row is None:
                return False
            if row["attempt"] != attempt or row["status"] != "succeeded":
                return False
            if row["result"] is None:
                return True
            now = utc_now()
            db.execute(
                "UPDATE jobs SET result=NULL,updated=? WHERE id=? AND status='succeeded' AND attempt=?",
                (now, job_id, attempt),
            )
            self.event(
                db,
                job_id,
                "LOCAL_RESULT_DELETED",
                {"attempt": attempt},
                level="warning",
                attempt=attempt,
            )
            return True

    def fail(
        self,
        job_id,
        attempt,
        error_code="FIXTURE_EXECUTION_FAILED",
        *,
        recoverable=True,
    ):
        if not isinstance(error_code, str) or not re.fullmatch(r"[A-Z0-9_]{1,96}", error_code):
            error_code = "WORKER_EXECUTION_FAILED"
        if not isinstance(recoverable, bool):
            recoverable = True
        with self.tx() as db:
            now = utc_now()
            changed = db.execute(
                "UPDATE jobs SET status='failed',stage='failed',error=?,error_recoverable=?,"
                "attempt_finished_at=?,stage_started_at=?,updated=? WHERE id=? AND status='running' AND attempt=?",
                (error_code, int(recoverable), now, now, now, job_id, attempt),
            ).rowcount
            if changed:
                self.event(
                    db,
                    job_id,
                    error_code,
                    level="error",
                    attempt=attempt,
                )
