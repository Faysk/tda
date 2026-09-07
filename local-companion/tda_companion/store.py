"""Transactional queue. Single supervisor owns recovery; claims are atomic."""
import json
import sqlite3
from contextlib import contextmanager
from uuid import uuid4

from .legacy.artifacts import sha256_json, utc_now
from .legacy.publication import build_publication_bundle


class Conflict(Exception):
    pass


class Store:
    def __init__(self, root):
        self.path = root / "jobs.sqlite3"
        with self.tx() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError("DATABASE_VERSION_UNSUPPORTED")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, signature TEXT NOT NULL,
                    body TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
                    completed INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0,
                    error TEXT, result TEXT, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
                    code TEXT NOT NULL, at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                PRAGMA user_version=1;
            """)
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

    def setting(self, key):
        with self.tx() as db:
            return db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()[0]

    def pause(self, paused):
        with self.tx() as db:
            db.execute("UPDATE settings SET value=? WHERE key='paused'", (json.dumps(paused),))

    def event(self, db, job_id, code):
        db.execute("INSERT INTO events(job_id,code,at) VALUES (?,?,?)", (job_id, code, utc_now()))

    def recover(self):
        with self.tx() as db:
            for row in db.execute("SELECT id FROM jobs WHERE status='running'").fetchall():
                db.execute("UPDATE jobs SET status='interrupted',stage='interrupted',error='PROCESS_INTERRUPTED',updated=? WHERE id=?", (utc_now(), row['id']))
                self.event(db, row['id'], 'PROCESS_INTERRUPTED')

    @staticmethod
    def dto(row):
        body = json.loads(row['body'])
        return dict(id=row['id'], kind=body['kind'], status=row['status'], stage=row['stage'],
                    progress=dict(completed=row['completed'], total=body['units'], unit='items'),
                    error=dict(code=row['error'], recoverable=True) if row['error'] else None,
                    result_available=row['result'] is not None, updated_at=row['updated'])

    def submit(self, key, body):
        signature = sha256_json(body)
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE idem=?", (key,)).fetchone()
            if row:
                if row['signature'] != signature:
                    raise Conflict('IDEMPOTENCY_CONFLICT')
                return self.dto(row)
            job_id = str(uuid4())
            db.execute("INSERT INTO jobs(id,idem,signature,body,status,stage,updated) VALUES (?,?,?,?,'queued','queued',?)",
                       (job_id, key, signature, json.dumps(body), utc_now()))
            self.event(db, job_id, 'QUEUED')
            return self.dto(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def get(self, job_id):
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            return self.dto(row)

    def jobs(self):
        with self.tx() as db:
            return [self.dto(r) for r in db.execute("SELECT * FROM jobs ORDER BY updated DESC LIMIT 100")]

    def events(self, job_id):
        self.get(job_id)
        with self.tx() as db:
            return [dict(r) for r in db.execute("SELECT seq,code,at FROM events WHERE job_id=? ORDER BY seq DESC LIMIT 100", (job_id,))]

    def action(self, job_id, action):
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            status = row['status']
            if action == 'cancel':
                if status == 'cancelled':
                    return self.dto(row)
                if status == 'succeeded':
                    raise Conflict('JOB_TERMINAL')
                status = 'cancelled'
            else:
                if status not in ('failed', 'interrupted'):
                    raise Conflict('JOB_NOT_RETRYABLE')
                status = 'queued'
            db.execute("UPDATE jobs SET status=?,stage=?,error=NULL,updated=? WHERE id=?", (status, status, utc_now(), job_id))
            self.event(db, job_id, status.upper())
            return self.dto(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def claim(self):
        with self.tx() as db:
            if db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()[0] == 'true':
                return None
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY updated LIMIT 1").fetchone()
            if not row:
                return None
            db.execute("UPDATE jobs SET status='running',stage='fixture',attempt=attempt+1,updated=? WHERE id=?", (utc_now(), row['id']))
            self.event(db, row['id'], 'RUNNING')
            return row['id'], row['attempt'] + 1

    def step(self, job_id, attempt):
        """Commit a real synthetic work unit and progress together; fence stale workers."""
        with self.tx() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row['status'] != 'running' or row['attempt'] != attempt:
                return False
            body = json.loads(row['body'])
            completed = row['completed'] + 1
            # Each fixture unit computes a digest; no audio/model/network access.
            sha256_json({'source': body['source_id'], 'unit': completed})
            done = completed == body['units']
            result = None
            if done:
                bundle = build_publication_bundle(
                    {'recording_id': body['source_id'], 'format': 'synthetic.fixture'},
                    {'fixture': True, 'units': body['units'], 'transcript': {'sha256': sha256_json([])}})
                payload = {k: v for k, v in bundle.items() if k not in ('publication_id', 'generated_at')}
                result = json.dumps(dict(schema_version='tda_local_result_v1',
                    campaign_id=body['campaign_id'], session_id=body['session_id'],
                    source_id=body['source_id'], job_id=job_id, publication_bundle=bundle,
                    sync={'status': 'not_configured'}, import_artifacts={
                        'publication_payload_json': json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')),
                        'transcript_json': '[]'}))
            db.execute("UPDATE jobs SET completed=?,status=?,stage=?,result=?,updated=? WHERE id=?",
                       (completed, 'succeeded' if done else 'running', 'complete' if done else 'fixture', result, utc_now(), job_id))
            self.event(db, job_id, 'SUCCEEDED' if done else 'UNIT_COMMITTED')
            return not done

    def result(self, job_id):
        self.get(job_id)
        with self.tx() as db:
            value = db.execute("SELECT result FROM jobs WHERE id=?", (job_id,)).fetchone()[0]
            if value is None:
                raise Conflict('RESULT_NOT_READY')
            return json.loads(value)

    def fail(self, job_id, attempt):
        with self.tx() as db:
            changed = db.execute("UPDATE jobs SET status='failed',error='FIXTURE_EXECUTION_FAILED',updated=? WHERE id=? AND status='running' AND attempt=?", (utc_now(), job_id, attempt)).rowcount
            if changed:
                self.event(db, job_id, 'FIXTURE_EXECUTION_FAILED')
