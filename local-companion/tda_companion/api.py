import asyncio
import hmac
import re
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import VERSION
from .store import Conflict, Store
from .telemetry import SystemTelemetry


class JobRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: Literal['synthetic.fixture']
    campaign_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
    session_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
    source_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,128}$')
    units: int = Field(ge=1, le=100)


class LifecycleRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['pause', 'resume']


def error(code, status, recoverable=False):
    return JSONResponse({'error': {'code': code, 'recoverable': recoverable}}, status_code=status)


def create_app(root, token, origins, port=8765, run_worker=True):
    if not re.fullmatch(r'[A-Za-z0-9_-]{43,256}', token):
        raise ValueError('TOKEN_TOO_SHORT')
    store = Store(root)
    telemetry = SystemTelemetry()
    worker_healthy = True

    async def worker():
        nonlocal worker_healthy
        while True:
            try:
                claimed = store.claim()
                if claimed:
                    try:
                        while store.step(*claimed):
                            await asyncio.sleep(0)
                    except Exception:
                        store.fail(*claimed)
                worker_healthy = True
            except Exception:
                # Storage can be temporarily unavailable/full. Stop claiming and
                # advertise preparing; retry recovery only after storage responds.
                worker_healthy = False
                await asyncio.sleep(1)
                try:
                    store.recover()
                except Exception:
                    continue
            await asyncio.sleep(0.1)

    @asynccontextmanager
    async def lifespan(_):
        store.recover()
        task = asyncio.create_task(worker()) if run_worker else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            store.recover()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    app.state.telemetry = telemetry
    app.router.redirect_slashes = False

    @app.middleware('http')
    async def guard(request: Request, call_next):
        if request.headers.get('host') != f'127.0.0.1:{port}':
            return error('HOST_REJECTED', 403)
        origin = request.headers.get('origin')
        if origin is not None and origin not in origins:
            return error('ORIGIN_REJECTED', 403)
        cors = {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'} if origin else {}
        if request.method == 'OPTIONS':
            if not origin:
                return error('ORIGIN_REQUIRED', 403)
            headers = {h.strip().lower() for h in request.headers.get('access-control-request-headers', '').split(',') if h.strip()}
            if request.headers.get('access-control-request-method') not in ('GET', 'POST') or not headers <= {'authorization', 'content-type', 'idempotency-key'}:
                return error('PREFLIGHT_REJECTED', 403)
            return JSONResponse({}, headers={**cors, 'Access-Control-Allow-Methods': 'GET, POST',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
                'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '60'})
        public = request.method == 'GET' and request.url.path == '/api/v1/health'
        response = None
        if not public and not hmac.compare_digest(request.headers.get('authorization', '').encode('utf-8'), f'Bearer {token}'.encode('ascii')):
            response = error('UNAUTHORIZED', 401)
        elif request.method == 'POST':
            if not origin:
                response = error('ORIGIN_REQUIRED', 403)
            elif request.headers.get('content-type', '').split(';')[0].strip() != 'application/json':
                response = error('JSON_REQUIRED', 415)
            else:
                # Bound actual streamed input too (Content-Length alone is not trustworthy).
                body = bytearray()
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > 4096:
                        response = error('BODY_TOO_LARGE', 413)
                        break
                if response is None:
                    request._body = bytes(body)
        if response is None:
            try:
                response = await call_next(request)
            except Exception:
                # Never return exception text, paths, tokens or submitted content.
                response = error('LOCAL_STORAGE_OR_RUNTIME_ERROR', 503, True)
        response.headers.update({**cors, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
        return response

    @app.exception_handler(Conflict)
    async def conflict(_, exc):
        return error(str(exc), 409, True)

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return error('JOB_NOT_FOUND', 404)

    @app.exception_handler(RequestValidationError)
    async def invalid(_, exc):
        return error('INVALID_REQUEST', 422)

    def health_value():
        return dict(api_version='1', service_version=VERSION,
                    lifecycle='preparing' if not worker_healthy else
                    'paused' if store.setting('paused') == 'true' else 'ready')

    @app.get('/api/v1/health')
    def health():
        return health_value()

    @app.get('/api/v1/version')
    def version():
        return dict(api_version='1', service_version=VERSION)

    @app.get('/api/v1/capabilities')
    def capabilities():
        return dict(
            capabilities=['synthetic.fixture', 'job.events', 'system.telemetry'],
            sync=False,
            device=dict(id=store.setting('device'), label='TDA local'),
        )

    @app.get('/api/v1/system')
    def system():
        # Telemetry is intentionally best-effort and must not affect queue health.
        return telemetry.snapshot()

    @app.get('/api/v1/lifecycle')
    def lifecycle():
        return health_value()

    @app.post('/api/v1/lifecycle')
    def change_lifecycle(body: LifecycleRequest):
        store.pause(body.action == 'pause')
        return health_value()

    @app.get('/api/v1/jobs')
    def jobs():
        return {'jobs': store.jobs()}

    @app.post('/api/v1/jobs')
    def submit(body: JobRequest, idempotency_key: str = Header(pattern=r'^[A-Za-z0-9_-]{1,128}$')):
        return store.submit(idempotency_key, body.model_dump())

    @app.get('/api/v1/jobs/{job_id}')
    def job(job_id: str):
        return store.get(job_id)

    @app.post('/api/v1/jobs/{job_id}/{action}')
    def action(job_id: str, action: Literal['cancel', 'retry']):
        return store.action(job_id, action)

    @app.get('/api/v1/jobs/{job_id}/events')
    def events(job_id: str):
        return {'events': store.events(job_id)}

    @app.get('/api/v1/jobs/{job_id}/result')
    def result(job_id: str):
        return store.result(job_id)

    return app