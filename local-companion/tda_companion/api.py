import asyncio
import hmac
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Callable, Literal

from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import VERSION
from .store import Conflict, Store
from .system_log import SystemLog
from .telemetry import SystemTelemetry
from .worker_supervisor import WorkerProcessError, WorkerSupervisor


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["synthetic.fixture"]
    campaign_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    source_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    units: int = Field(ge=1, le=100)


class LifecycleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["pause", "resume"]


class AgentControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["shutdown"]
    force: bool = False


def error(code, status, recoverable=False):
    return JSONResponse({"error": {"code": code, "recoverable": recoverable}}, status_code=status)


def create_app(
    root,
    token,
    origins,
    port=8765,
    run_worker=True,
    system_log: SystemLog | None = None,
    shutdown_callback: Callable[[], None] | None = None,
):
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,256}", token):
        raise ValueError("TOKEN_TOO_SHORT")
    store = Store(root)
    telemetry = SystemTelemetry()
    worker_supervisor = WorkerSupervisor()
    worker_healthy = True
    worker_wake = asyncio.Event()
    started_at = time.time()

    def log(level: str, component: str, code: str, message: str, context=None) -> None:
        if system_log is not None:
            system_log.write(level, component, code, message, context)

    async def wait_for_work() -> None:
        try:
            await asyncio.wait_for(worker_wake.wait(), timeout=5.0)
        except TimeoutError:
            pass
        finally:
            worker_wake.clear()

    async def worker():
        nonlocal worker_healthy
        log("info", "worker", "QUEUE_WORKER_STARTED", "Queue worker started")
        while True:
            try:
                claimed = store.claim()
                if claimed:
                    job_id, attempt = claimed
                    state = store.get(job_id)
                    log(
                        "info",
                        "worker",
                        "JOB_CLAIMED",
                        "Job claimed",
                        {"job_id": job_id, "attempt": attempt},
                    )

                    def is_cancelled() -> bool:
                        try:
                            return store.get(job_id)["status"] == "cancelled"
                        except KeyError:
                            return True

                    def commit_progress(message) -> None:
                        current = store.get(job_id)
                        if current["status"] == "cancelled":
                            return
                        if current["status"] != "running" or current["attempt"] != attempt:
                            raise RuntimeError("WORKER_STALE_ATTEMPT")
                        expected = int(message.payload["completed"])
                        actual = int(current["progress"]["completed"])
                        if expected != actual + 1:
                            raise RuntimeError("WORKER_PROGRESS_GAP")
                        store.step(job_id, attempt)

                    def observe_event(message) -> None:
                        if message.type == "stage":
                            stage = str(message.payload.get("stage") or "worker")[:64]
                            log(
                                "info",
                                "worker",
                                "WORKER_STAGE",
                                "Worker stage changed",
                                {"job_id": job_id, "stage": stage},
                            )

                    try:
                        outcome = await asyncio.to_thread(
                            worker_supervisor.run_fixture,
                            job_id=job_id,
                            attempt=attempt,
                            units=int(state["progress"]["total"]),
                            completed=int(state["progress"]["completed"]),
                            on_progress=commit_progress,
                            on_event=observe_event,
                            is_cancelled=is_cancelled,
                        )
                        final_state = store.get(job_id)
                        if outcome.terminal == "result" and final_state["status"] not in {
                            "succeeded",
                            "cancelled",
                        }:
                            raise WorkerProcessError("WORKER_RESULT_INCOMPLETE")
                        log(
                            "info",
                            "worker",
                            "WORKER_FINISHED",
                            "Worker process finished",
                            {"job_id": job_id, "terminal": outcome.terminal},
                        )
                    except WorkerProcessError as exc:
                        store.fail(job_id, attempt)
                        log(
                            "error",
                            "worker",
                            "WORKER_PROCESS_FAILED",
                            "Worker process failed",
                            {"job_id": job_id, "worker_code": exc.code},
                        )
                    except Exception:
                        store.fail(job_id, attempt)
                        log(
                            "error",
                            "worker",
                            "JOB_EXECUTION_FAILED",
                            "Job execution failed",
                            {"job_id": job_id},
                        )
                    worker_healthy = True
                    continue
                worker_healthy = True
                await wait_for_work()
            except asyncio.CancelledError:
                raise
            except Exception:
                worker_healthy = False
                log("error", "storage", "QUEUE_RECOVERY_REQUIRED", "Queue storage temporarily unavailable")
                await asyncio.sleep(1)
                try:
                    store.recover()
                    worker_healthy = True
                except Exception:
                    continue

    @asynccontextmanager
    async def lifespan(_):
        store.recover()
        log("info", "agent", "API_STARTING", "Local API starting", {"port": port, "pid": os.getpid()})
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
            log("info", "agent", "API_STOPPED", "Local API stopped")

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    app.state.telemetry = telemetry
    app.state.system_log = system_log
    app.state.worker_wake = worker_wake
    app.router.redirect_slashes = False

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.headers.get("host") != f"127.0.0.1:{port}":
            return error("HOST_REJECTED", 403)
        origin = request.headers.get("origin")
        if origin is not None and origin not in origins:
            return error("ORIGIN_REJECTED", 403)
        cors = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else {}
        if request.method == "OPTIONS":
            if not origin:
                return error("ORIGIN_REQUIRED", 403)
            headers = {
                value.strip().lower()
                for value in request.headers.get("access-control-request-headers", "").split(",")
                if value.strip()
            }
            if (
                request.headers.get("access-control-request-method") not in ("GET", "POST")
                or not headers <= {"authorization", "content-type", "idempotency-key"}
            ):
                return error("PREFLIGHT_REJECTED", 403)
            return JSONResponse(
                {},
                headers={
                    **cors,
                    "Access-Control-Allow-Methods": "GET, POST",
                    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
                    "Access-Control-Allow-Private-Network": "true",
                    "Access-Control-Max-Age": "60",
                },
            )
        public = request.method == "GET" and request.url.path == "/api/v1/health"
        response = None
        if not public and not hmac.compare_digest(
            request.headers.get("authorization", "").encode("utf-8"),
            f"Bearer {token}".encode("ascii"),
        ):
            response = error("UNAUTHORIZED", 401)
        elif request.method == "POST":
            if not origin:
                response = error("ORIGIN_REQUIRED", 403)
            elif request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
                response = error("JSON_REQUIRED", 415)
            else:
                body = bytearray()
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > 4096:
                        response = error("BODY_TOO_LARGE", 413)
                        break
                if response is None:
                    request._body = bytes(body)
        if response is None:
            try:
                response = await call_next(request)
            except Exception:
                log("error", "api", "REQUEST_FAILED", "Local request failed", {"path": request.url.path})
                response = error("LOCAL_STORAGE_OR_RUNTIME_ERROR", 503, True)
        response.headers.update({**cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        return response

    @app.exception_handler(Conflict)
    async def conflict(_, exc):
        return error(str(exc), 409, True)

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return error("JOB_NOT_FOUND", 404)

    @app.exception_handler(RequestValidationError)
    async def invalid(_, exc):
        return error("INVALID_REQUEST", 422)

    def health_value():
        return dict(
            api_version="1",
            service_version=VERSION,
            lifecycle="preparing"
            if not worker_healthy
            else "paused"
            if store.setting("paused") == "true"
            else "ready",
        )

    @app.get("/api/v1/health")
    def health():
        return health_value()

    @app.get("/api/v1/version")
    def version():
        return dict(api_version="1", service_version=VERSION)

    @app.get("/api/v1/capabilities")
    def capabilities():
        features = ["synthetic.fixture", "job.events", "system.telemetry", "worker.subprocess"]
        if system_log is not None:
            features.extend(["agent.desktop", "agent.logs"])
        if shutdown_callback is not None:
            features.append("agent.control")
        return dict(
            capabilities=features,
            sync=False,
            device=dict(id=store.setting("device"), label="TDA local"),
        )

    @app.get("/api/v1/system")
    def system():
        return telemetry.snapshot()

    @app.get("/api/v1/agent")
    def agent():
        return {
            **health_value(),
            "pid": os.getpid(),
            "port": port,
            "uptime_seconds": max(0, round(time.time() - started_at, 1)),
        }

    @app.post("/api/v1/agent/control")
    async def agent_control(body: AgentControlRequest):
        if shutdown_callback is None:
            raise Conflict("AGENT_CONTROL_UNAVAILABLE")
        if store.has_running_jobs() and not body.force:
            raise Conflict("AGENT_BUSY")
        log(
            "warning",
            "agent",
            "AGENT_FORCE_SHUTDOWN_REQUESTED" if body.force else "AGENT_SHUTDOWN_REQUESTED",
            "Agent forced shutdown requested" if body.force else "Agent shutdown requested",
        )
        asyncio.get_running_loop().call_later(0.25, shutdown_callback)
        return {"accepted": True, "action": body.action, "force": body.force}

    @app.get("/api/v1/logs")
    def logs(
        limit: int = Query(default=200, ge=1, le=500),
        level: Literal["debug", "info", "warning", "error"] | None = None,
        component: str | None = Query(default=None, min_length=1, max_length=64),
    ):
        if system_log is None:
            return {"logs": []}
        return {"logs": system_log.tail(limit=limit, level=level, component=component)}

    @app.get("/api/v1/lifecycle")
    def lifecycle():
        return health_value()

    @app.post("/api/v1/lifecycle")
    async def change_lifecycle(body: LifecycleRequest):
        store.pause(body.action == "pause")
        log(
            "info",
            "queue",
            "QUEUE_PAUSED" if body.action == "pause" else "QUEUE_RESUMED",
            f"Queue {body.action}d",
        )
        if body.action == "resume":
            worker_wake.set()
        return health_value()

    @app.get("/api/v1/jobs")
    def jobs():
        return {"jobs": store.jobs()}

    @app.post("/api/v1/jobs")
    async def submit(body: JobRequest, idempotency_key: str = Header(pattern=r"^[A-Za-z0-9_-]{1,128}$")):
        value = store.submit(idempotency_key, body.model_dump())
        worker_wake.set()
        return value

    @app.get("/api/v1/jobs/{job_id}")
    def job(job_id: str):
        return store.get(job_id)

    @app.post("/api/v1/jobs/{job_id}/{action}")
    async def action(job_id: str, action: Literal["cancel", "retry"]):
        value = store.action(job_id, action)
        if action == "retry":
            worker_wake.set()
        return value

    @app.get("/api/v1/jobs/{job_id}/events")
    def events(job_id: str):
        return {"events": store.events(job_id)}

    @app.get("/api/v1/jobs/{job_id}/result")
    def result(job_id: str):
        return store.result(job_id)

    return app
