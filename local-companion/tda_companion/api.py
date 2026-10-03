import asyncio
import hashlib
import hmac
import json
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Annotated, Callable, Literal

from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from . import VERSION
from .asr_models import get_profile, inspect_model_install
from .asr_runtime import (
    inspect_whisper_runtime,
    recover_interrupted_whisper_runtime_install,
)
from .attempt_fence import (
    AttemptFenceError,
    claim_attempt_outcome,
    read_attempt_outcome,
)
from .browser_session import BrowserSessionManager
from .benchmark_evidence import (
    BenchmarkEvidenceError,
    load_bundle as load_benchmark_bundle,
    private_export_zip,
    telemetry_summary_from_bytes,
    verified_profile_bytes,
)
from .benchmark_quality import (
    BenchmarkQualityError,
    quality_summary as benchmark_quality_summary,
    reference_private as benchmark_reference_private,
    save_reference as save_benchmark_reference,
)
from .craig import CraigPackageError
from .craig_ingest import (
    recover_interrupted_craig_repairs,
    remove_incomplete_craig_staging,
    remove_incomplete_craig_uploads,
)
from .craig_runtime import load_craig_package
from .network import NetworkError
from .profile_preparation import (
    ProfilePreparationError,
    ProfilePreparationManager,
    profile_catalog,
    whisper_model_ready,
)
from .publication_target import PublicationTargetError, bind_publication_target, repair_publication_target
from .qwen_physical_gate import inspect_qwen_physical_gate
from .qwen_runtime import recover_interrupted_qwen_runtime_install
from .qwen_runtime_maintenance import (
    QwenRuntimeMaintenanceError,
    QwenRuntimeMaintenanceManager,
)
from .session_participants import observed_session_tracks, resolve_session_participants
from .session_assemblies import (
    SessionAssemblyError,
    build_session_assembly,
    list_session_assemblies,
    load_session_assembly,
)
from .store import Conflict, Store
from .session_timeline import (
    automatic_placements,
    classify_start_time,
    enrich_workspace_timeline,
    package_duration_seconds,
    validate_overlap_boundary,
)
from .system_log import SystemLog
from .telemetry import SystemTelemetry
from .transcription_runs import (
    TranscriptionRunError,
    load_run,
    maintain_legacy_transcripts,
    recover_deleted_run_cleanup,
    run_id_for,
)
from .whisper_runtime_maintenance import (
    WhisperRuntimeMaintenanceError,
    rollback_whisper_runtime,
)
from .worker_event_schema import sanitize_worker_event
from .worker_supervisor import WorkerProcessError, WorkerSupervisor

_PRODUCT_ID = "tda-companion"
_ID_PATTERN = r"^[A-Za-z0-9_-]{1,128}$"
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_WORKER_SHUTDOWN_FAST_SECONDS = 20.0
LOCAL_JSON_BODY_MAX_BYTES = 4096
TRANSCRIPTION_TEXT_MAX_CHARS = 1200

_BROWSER_JOB_PATH = re.compile(
    r"^/api/v1/jobs/[A-Za-z0-9_-]{1,128}(?:/(?:cancel|retry|delete|events|result))?$"
)
_BROWSER_BENCHMARK_PATH = re.compile(
    r"^/api/v1/benchmarks/benchmark-[0-9a-f]{32}"
    r"(?:/profiles/(?:whisper-turbo|whisper-detailed|qwen-fast|qwen-quality)/(?:transcript|metrics|events|telemetry)"
    r"|/export|/reference|/quality)?$"
)
_BROWSER_SESSION_WORKSPACE_PATH = re.compile(
    r"^/api/v1/session-workspaces/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}"
    r"(?:/(?:parts(?:/(?:detach|reorder|timing|run))?|timeline/derive|participants|intent))?$"
)
_BROWSER_SESSION_ASSEMBLY_PATH = re.compile(
    r"^/api/v1/session-workspaces/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}/"
    r"assemblies(?:/[0-9a-f]{64})?$"
)


def _browser_route_allowed(method: str, path: str) -> bool:
    """Scope ephemeral browser credentials to the Web product surface only."""
    if re.fullmatch(r"/api/v1/sources/[A-Za-z0-9_-]{1,128}/runs/[A-Za-z0-9_-]{1,196}/publication-target/repair", path):
        return method == "POST"
    if path in {
        "/api/v1/capabilities",
        "/api/v1/preparation",
        "/api/v1/preparation/cancel",
        "/api/v1/qwen-runtime",
        "/api/v1/qwen-runtime/check",
        "/api/v1/qwen-runtime/update",
        "/api/v1/system",
        "/api/v1/lifecycle",
        "/api/v1/jobs",
    }:
        return (
            method == "GET"
            or (method == "POST" and path in {
                "/api/v1/preparation",
                "/api/v1/preparation/cancel",
                "/api/v1/qwen-runtime/check",
                "/api/v1/qwen-runtime/update",
                "/api/v1/lifecycle",
                "/api/v1/jobs",
            })
        )
    if _BROWSER_BENCHMARK_PATH.fullmatch(path) is not None:
        return method == "GET" or (method == "POST" and path.endswith("/reference"))
    if _BROWSER_SESSION_WORKSPACE_PATH.fullmatch(path) is not None:
        return method in {"GET", "POST"}
    if _BROWSER_SESSION_ASSEMBLY_PATH.fullmatch(path) is not None:
        return method in {"GET", "POST"}
    match = _BROWSER_JOB_PATH.fullmatch(path)
    if match is None:
        return False
    if path.endswith(("/events", "/result")):
        return method == "GET"
    if path.endswith(("/cancel", "/retry", "/delete")):
        return method == "POST"
    return method == "GET"



class SyntheticJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["synthetic.fixture"]
    campaign_id: str = Field(pattern=_ID_PATTERN)
    session_id: str = Field(pattern=_ID_PATTERN)
    source_id: str = Field(pattern=_ID_PATTERN)
    units: int = Field(ge=1, le=100)


class CraigBenchmarkJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["benchmark.craig"]
    campaign_id: str = Field(pattern=_ID_PATTERN)
    session_id: str = Field(pattern=_ID_PATTERN)
    source_id: str = Field(pattern=_ID_PATTERN)
    glossary: str = Field(default="", max_length=TRANSCRIPTION_TEXT_MAX_CHARS)
    context: str = Field(default="", max_length=TRANSCRIPTION_TEXT_MAX_CHARS)


class BenchmarkReferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_revision: int = Field(ge=0, le=1_000_000)
    provenance: Literal["manual", "imported", "profile_seed"] = "manual"
    seed_profile_id: Literal["whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality"] | None = None
    tracks: list[dict[str, Any]]
    terms: list[str] = Field(default_factory=list)


class CraigTranscriptionJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["transcription.craig"]
    campaign_id: str = Field(pattern=_ID_PATTERN)
    session_id: str = Field(pattern=_ID_PATTERN)
    source_id: str = Field(pattern=_ID_PATTERN)
    profile_id: Literal[
        "whisper-turbo",
        "whisper-detailed",
        "qwen-fast",
        "qwen-quality",
    ]
    glossary: str = Field(default="", max_length=TRANSCRIPTION_TEXT_MAX_CHARS)
    context: str = Field(default="", max_length=TRANSCRIPTION_TEXT_MAX_CHARS)
    cpu: bool = False


JobRequest = Annotated[
    SyntheticJobRequest | CraigTranscriptionJobRequest | CraigBenchmarkJobRequest,
    Field(discriminator="kind"),
]


class BrowserSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SessionWorkspaceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SessionTranscriptionIntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    request_id: str = Field(pattern=_ID_PATTERN)
    profile_id: Literal[
        "whisper-turbo",
        "whisper-detailed",
        "qwen-fast",
        "qwen-quality",
    ]
    context: str = Field(default="", max_length=TRANSCRIPTION_TEXT_MAX_CHARS)
    glossary: str = Field(default="", max_length=TRANSCRIPTION_TEXT_MAX_CHARS)


class SessionWorkspaceAttachRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source_id: str = Field(pattern=r"^craig-[0-9a-f]{64}$")
    expected_revision: int = Field(ge=0)


class SessionWorkspaceDetachRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    part_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    expected_revision: int = Field(ge=0)


class SessionWorkspaceReorderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    part_ids: list[str] = Field(max_length=64)
    expected_revision: int = Field(ge=0)


class SessionWorkspaceTimingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    part_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    expected_revision: int = Field(ge=0)
    session_offset_seconds: float = Field(ge=0)
    trim_start_seconds: float = Field(default=0.0, ge=0)
    trim_end_seconds: float | None = Field(default=None, ge=0)
    gap_confirmed: bool = False
    overlap_resolution: Literal[
        "prefer_earlier_until",
        "prefer_later_from",
    ] | None = None
    overlap_boundary_seconds: float | None = Field(default=None, ge=0)


class SessionWorkspaceDeriveTimelineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_revision: int = Field(ge=0)


class SessionParticipantAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    observation_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    participant_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class SessionParticipantMappingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_revision: int = Field(ge=0)
    assignments: list[SessionParticipantAssignmentRequest] = Field(max_length=16384)


class SessionWorkspaceSelectRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    part_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    run_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,196}$")
    expected_revision: int = Field(ge=0)


class SessionAssemblyBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_revision: int = Field(ge=0)


class ProfilePreparationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source_id: str = Field(pattern=r"^craig-[0-9a-f]{64}$")
    profile_id: Literal[
        "whisper-turbo",
        "whisper-detailed",
        "qwen-fast",
        "qwen-quality",
    ]
    purpose: Literal["transcription", "benchmark"] = "transcription"


class ProfilePreparationCancelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_operation_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class WhisperRuntimeRollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$", max_length=32)


class LifecycleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["pause", "resume"]


class AgentControlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["shutdown"]
    force: bool = False


_ERROR_SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}
_PUBLIC_ERROR_CODE = re.compile(r"^[A-Z][A-Z0-9_]{0,95}$")
_FALLBACK_ERROR_CODE = "INTERNAL_ERROR"


def _public_error_code(code: object) -> str:
    if isinstance(code, str) and _PUBLIC_ERROR_CODE.fullmatch(code) is not None:
        return code
    return _FALLBACK_ERROR_CODE


def _public_error_code_from_exception(exc: BaseException) -> str:
    if exc.args:
        return _public_error_code(exc.args[0])
    return _FALLBACK_ERROR_CODE


def error(code, status, recoverable=False):
    safe_code = _public_error_code(code)
    return JSONResponse(
        {"error": {"code": safe_code, "recoverable": bool(recoverable)}},
        status_code=status,
        headers=_ERROR_SECURITY_HEADERS,
    )


_NON_RECOVERABLE_CONFLICTS = frozenset(
    {
        "IDEMPOTENCY_CONFLICT",
        "IDEMPOTENCY_STATE_INVALID",
        "IDEMPOTENCY_OPERATION_REMOVED",
        "JOB_TERMINAL",
        "JOB_NOT_RETRYABLE",
        "QWEN_CPU_UNSUPPORTED",
        "AGENT_CONTROL_UNAVAILABLE",
        "JOB_STEP_KIND_INVALID",
        "JOB_STAGE_INVALID",
        "WORKER_PROGRESS_MISMATCH",
        "WORKER_EVENT_CODE_INVALID",
        "WORKER_EVENT_LEVEL_INVALID",
        "WORKER_EVENT_DATA_INVALID",
        "RECOVERED_RESULT_KIND_INVALID",
        "JOB_UNITS_INVALID",
        "WORKER_RESULT_INCOMPLETE",
        "RESULT_ARTIFACT_UNAVAILABLE",
        "RESULT_ARTIFACT_MISMATCH",
    }
)


def conflict_recoverable(code: str) -> bool:
    return code not in _NON_RECOVERABLE_CONFLICTS


_NON_RECOVERABLE_PREPARATION_ERRORS = frozenset(
    {
        "CRAIG_SOURCE_INVALID",
        "TRANSCRIPTION_PROFILE_INVALID",
    }
)


def preparation_recoverable(code: str) -> bool:
    return code not in _NON_RECOVERABLE_PREPARATION_ERRORS


_BENCHMARK_PROFILES = (
    "whisper-turbo",
    "whisper-detailed",
    "qwen-fast",
    "qwen-quality",
)
_BENCHMARK_SAMPLE_SECONDS = 300.0


def _benchmark_sample_identity(package) -> str:
    payload = {
        "schema": "tda_benchmark_sample_v1",
        "source_sha256": package.source_sha256,
        "start_seconds": 0.0,
        "end_seconds": _BENCHMARK_SAMPLE_SECONDS,
        "tracks": [
            {"number": track.number, "sha256": track.sha256}
            for track in package.tracks
        ],
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def create_app(
    root,
    token,
    origins,
    port=8765,
    run_worker=True,
    system_log: SystemLog | None = None,
    shutdown_callback: Callable[[], None] | None = None,
    models_root: Path | None = None,
):
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,256}", token):
        raise ValueError("TOKEN_TOO_SHORT")
    data_root = Path(root).resolve()
    resolved_models_root = (
        models_root.resolve() if models_root is not None else data_root.parent / "Models"
    )
    resolved_state_root = data_root.parent / "State"
    resolved_runtime_root = data_root.parent / "Runtime"
    resolved_cache_root = data_root.parent / "Cache"

    recovered_whisper = recover_interrupted_whisper_runtime_install(
        resolved_runtime_root
    )
    recovered_qwen = recover_interrupted_qwen_runtime_install(
        resolved_runtime_root
    )
    if system_log is not None:
        for version in recovered_whisper:
            system_log.write(
                "warning",
                "runtime",
                "WHISPER_RUNTIME_SWAP_RECOVERED",
                "Recovered Whisper runtime after an interrupted install swap",
                {"version": version},
            )
        for version in recovered_qwen:
            system_log.write(
                "warning",
                "runtime",
                "QWEN_RUNTIME_SWAP_RECOVERED",
                "Recovered Qwen runtime after an interrupted install swap",
                {"version": version},
            )

    store = Store(data_root)
    telemetry = SystemTelemetry()
    browser_sessions = BrowserSessionManager()
    preparation_manager = ProfilePreparationManager(
        data_root=data_root,
        models_root=resolved_models_root,
        runtime_root=resolved_runtime_root,
        state_root=resolved_state_root,
        cache_root=resolved_cache_root,
        system_log=system_log,
    )
    qwen_runtime_manager = QwenRuntimeMaintenanceManager(
        runtime_root=resolved_runtime_root,
        cache_root=resolved_cache_root,
        system_log=system_log,
    )
    worker_supervisor = WorkerSupervisor(
        data_root=data_root,
        models_root=resolved_models_root,
        runtime_root=resolved_runtime_root,
    )
    worker_healthy = True
    worker_wake = asyncio.Event()
    worker_stop = threading.Event()
    active_worker_lock = threading.Lock()
    active_worker: dict[str, object | None] = {"job_id": None, "cancel": None}
    source_gate = threading.RLock()

    def claim_under_source_gate():
        with source_gate:
            if worker_stop.is_set():
                return None
            return store.claim()

    def start_preparation_under_source_gate(
        source_id: str,
        profile_id: str,
        purpose: str,
    ):
        with source_gate:
            if worker_stop.is_set():
                raise ProfilePreparationError("AGENT_SHUTTING_DOWN")
            if purpose == "transcription":
                return preparation_manager.start(source_id, profile_id)
            return preparation_manager.start(source_id, profile_id, purpose)

    def staged_package_under_source_gate(source_id: str):
        with source_gate:
            return staged_package(source_id, verify_tracks=False)

    def claim_cancel_under_source_gate(
        source_id: str,
        job_id: str,
        attempt: int,
    ) -> str:
        with source_gate:
            package_root, _package = staged_package(source_id, verify_tracks=False)
            try:
                return claim_attempt_outcome(
                    package_root,
                    job_id,
                    attempt,
                    "cancel",
                )
            except AttemptFenceError as exc:
                raise Conflict(str(exc)) from None

    def transcription_run_visible(
        package_root: Path,
        summary: dict[str, object],
    ) -> bool:
        job_id = summary.get("job_id")
        attempt = summary.get("attempt")
        if not isinstance(job_id, str) or isinstance(attempt, bool) or not isinstance(attempt, int):
            # Legacy imported transcripts have no queue identity and remain visible.
            return True
        try:
            decision = read_attempt_outcome(package_root, job_id, attempt)
        except AttemptFenceError:
            # A corrupt arbitration marker must never make a run more visible.
            return False
        if decision == "cancel":
            return False
        try:
            state = store.get(job_id)
        except KeyError:
            receipt = store.terminal_receipt(job_id)
            if receipt is not None:
                # Cleanup preserves the last terminal queue fact. A legacy
                # pre-fence succeeded run remains visible, while failed,
                # interrupted and cancelled work cannot be promoted by deletion.
                return (
                    receipt.get("attempt") == attempt
                    and receipt.get("status") == "succeeded"
                )
            # A durable commit fence remains authoritative even if an older
            # cleanup predates terminal receipts. Missing authority fails closed.
            return decision == "commit"
        current_attempt = state.get("attempt")
        if isinstance(current_attempt, bool) or not isinstance(current_attempt, int):
            return False
        if attempt < current_attempt:
            # Advancing to a retry is not proof that an older attempt committed.
            return decision == "commit"
        if attempt > current_attempt:
            return False
        # Current succeeded rows preserve compatibility with pre-fence runs while
        # the live row still supplies explicit terminal provenance.
        return state.get("status") == "succeeded"

    def source_in_use(source_id: str) -> bool:
        # Queue status changes to cancelled before the isolated worker necessarily
        # exits. Keep the Craig source owned until clear_active_worker() proves the
        # native/CUDA process is no longer using its staged tracks.
        with active_worker_lock:
            active_job_id = active_worker.get("job_id")
        if isinstance(active_job_id, str):
            try:
                active_body = store.body(active_job_id)
            except KeyError:
                active_body = {}
            if (
                active_body.get("kind") in {"transcription.craig", "benchmark.craig"}
                and active_body.get("source_id") == source_id
            ):
                return True

        if store.has_running_source(source_id):
            return True
        preparation = preparation_manager.snapshot()
        return (
            preparation.get("active") is True
            and preparation.get("source_id") == source_id
        )

    def register_active_worker(job_id: str) -> threading.Event:
        cancel = threading.Event()
        with active_worker_lock:
            active_worker["job_id"] = job_id
            active_worker["cancel"] = cancel
        try:
            if store.get(job_id)["status"] == "cancelled":
                cancel.set()
        except KeyError:
            cancel.set()
        return cancel

    def active_worker_is(job_id: str) -> bool:
        with active_worker_lock:
            return active_worker.get("job_id") == job_id


    def signal_active_worker_cancel(job_id: str) -> None:
        cancel: threading.Event | None = None
        with active_worker_lock:
            if active_worker.get("job_id") == job_id:
                value = active_worker.get("cancel")
                if isinstance(value, threading.Event):
                    cancel = value
        if cancel is not None:
            cancel.set()

    def clear_active_worker(job_id: str, cancel: threading.Event) -> None:
        with active_worker_lock:
            if (
                active_worker.get("job_id") == job_id
                and active_worker.get("cancel") is cancel
            ):
                active_worker["job_id"] = None
                active_worker["cancel"] = None

    # Serializes the instant where a queued job becomes running with the instant
    # where first-use preparation becomes active. Without this gate, the API and
    # queue worker could race between "no running job" and Store.claim(), allowing
    # a model/runtime preparation to contend with a freshly claimed GPU job.
    dispatch_gate = asyncio.Lock()
    started_at = time.time()

    def log(level: str, component: str, code: str, message: str, context=None) -> None:
        if system_log is not None:
            system_log.write(level, component, code, message, context)

    removed_uploads = remove_incomplete_craig_uploads(data_root)
    if removed_uploads:
        log(
            "warning",
            "ingest",
            "CRAIG_UPLOAD_PARTIALS_CLEANED",
            "Removed non-resumable Craig upload snapshots left by an interrupted process",
            {"count": removed_uploads},
        )

    removed_staging = remove_incomplete_craig_staging(data_root)
    if removed_staging:
        log(
            "warning",
            "ingest",
            "CRAIG_STAGING_PARTIALS_CLEANED",
            "Removed extracted Craig staging left by an interrupted ingest",
            {"count": removed_staging},
        )

    for recovered_source in recover_interrupted_craig_repairs(
        data_root,
        source_gate=source_gate,
    ):
        log(
            "warning",
            "ingest",
            "CRAIG_STAGING_REPAIR_RECOVERED",
            "Recovered Craig staging after an interrupted repair swap",
            {"source_id": recovered_source},
        )

    def staged_package(source_id: str, *, verify_tracks: bool = False):
        if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", source_id) is None:
            raise CraigPackageError("CRAIG_STAGING_PATH_INVALID")
        staging = (data_root / "staging").resolve()
        # Resolve a known direct child rather than constructing a filesystem path
        # from an HTTP route parameter. Reparse targets still face confinement.
        try:
            package_root = next(
                (child.resolve() for child in staging.iterdir() if child.name == source_id),
                None,
            )
        except (FileNotFoundError, NotADirectoryError) as exc:
            raise CraigPackageError("CRAIG_MANIFEST_NOT_FOUND") from exc
        if package_root is None:
            raise CraigPackageError("CRAIG_MANIFEST_NOT_FOUND")
        if package_root.parent != staging:
            raise CraigPackageError("CRAIG_STAGING_PATH_INVALID")
        return package_root, load_craig_package(package_root, verify_tracks=verify_tracks)

    def _sha256_text(value: object) -> str:
        return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()

    def local_transcription_result(
        job_id: str,
        body: dict,
        *,
        run_id: str,
        digest: str,
    ) -> dict:
        return {
            "schema_version": "tda_local_result_v1",
            "campaign_id": body["campaign_id"],
            "session_id": body["session_id"],
            "source_id": body["source_id"],
            "job_id": job_id,
            "transcription": {
                "schema_version": "tda_transcript_v1",
                "profile_id": body["profile_id"],
                "artifact": "transcript.json",
                "run_id": run_id,
                "sha256": digest,
            },
            "sync": {"status": "not_configured"},
        }

    def finalize_transcription_result(
        job_id: str,
        attempt: int,
        body: dict,
        worker_payload: dict,
    ) -> dict:
        if (
            worker_payload.get("kind") != "transcription.craig"
            or worker_payload.get("source_id") != body["source_id"]
            or worker_payload.get("profile_id") != body["profile_id"]
            or worker_payload.get("schema_version") != "tda_transcript_v1"
            or worker_payload.get("artifact") != "transcript.json"
        ):
            raise WorkerProcessError("WORKER_RESULT_INVALID", recoverable=False)
        digest = worker_payload.get("sha256")
        run_id = worker_payload.get("run_id")
        if not isinstance(digest, str) or not _SHA256_PATTERN.fullmatch(digest):
            raise WorkerProcessError("WORKER_RESULT_HASH_INVALID", recoverable=False)
        if not isinstance(run_id, str):
            raise WorkerProcessError("WORKER_RESULT_RUN_INVALID", recoverable=False)

        package_root, package = staged_package(body["source_id"], verify_tracks=False)
        try:
            manifest = load_run(package_root, run_id, verify_content=True)
        except TranscriptionRunError as exc:
            raise WorkerProcessError(
                "WORKER_RESULT_RUN_INVALID",
                recoverable=False,
            ) from exc
        if (
            manifest.get("job_id") != job_id
            or manifest.get("attempt") != attempt
            or manifest.get("source_id") != body["source_id"]
            or manifest.get("source_sha256") != package.source_sha256
            or manifest.get("profile_id") != body["profile_id"]
            or manifest.get("artifact") != "transcript.json"
            or manifest.get("transcript_sha256") != digest
            or manifest.get("context_sha256") != _sha256_text(body.get("context"))
            or manifest.get("glossary_sha256") != _sha256_text(body.get("glossary"))
            or not isinstance(manifest.get("stats"), dict)
            or manifest["stats"].get("track_count") != body.get("units")
            or len(package.tracks) != body.get("units")
        ):
            raise WorkerProcessError("WORKER_RESULT_RUN_MISMATCH", recoverable=False)

        try:
            bind_publication_target(
                package_root,
                run_id=run_id,
                job_id=job_id,
                attempt=attempt,
                campaign_slug=body["campaign_id"],
                source_session_id=body["session_id"],
                source_id=body["source_id"],
                transcript_sha256=digest,
            )
        except PublicationTargetError as exc:
            code = str(exc)
            raise WorkerProcessError(
                code if re.fullmatch(r"[A-Z0-9_]{1,96}", code) else "PUBLICATION_TARGET_INVALID",
                recoverable=code == "PUBLICATION_TARGET_WRITE_FAILED",
            ) from exc

        return local_transcription_result(
            job_id,
            body,
            run_id=run_id,
            digest=digest,
        )

    def reconcile_completed_transcription_runs() -> None:
        for active in store.reconciliation_candidates():
            job_id = str(active["id"])
            attempt = int(active["attempt"])
            body = active["body"]
            if body.get("kind") != "transcription.craig" or attempt < 1:
                continue
            try:
                with source_gate:
                    package_root, package = staged_package(
                        body["source_id"],
                        verify_tracks=False,
                    )
                    run_id = run_id_for(job_id, attempt)
                    manifest = load_run(package_root, run_id, verify_content=True)
            except (KeyError, CraigPackageError, TranscriptionRunError, ValueError):
                continue
            digest = manifest.get("transcript_sha256")
            if (
                manifest.get("job_id") != job_id
                or manifest.get("attempt") != attempt
                or manifest.get("source_id") != body.get("source_id")
                or manifest.get("source_sha256") != package.source_sha256
                or manifest.get("profile_id") != body.get("profile_id")
                or manifest.get("artifact") != "transcript.json"
                or manifest.get("context_sha256") != _sha256_text(body.get("context"))
                or manifest.get("glossary_sha256") != _sha256_text(body.get("glossary"))
                or not isinstance(manifest.get("stats"), dict)
                or manifest["stats"].get("track_count") != body.get("units")
                or len(package.tracks) != body.get("units")
                or not isinstance(digest, str)
                or not _SHA256_PATTERN.fullmatch(digest)
            ):
                continue
            try:
                bind_publication_target(
                    package_root,
                    run_id=run_id,
                    job_id=job_id,
                    attempt=attempt,
                    campaign_slug=body["campaign_id"],
                    source_session_id=body["session_id"],
                    source_id=body["source_id"],
                    transcript_sha256=digest,
                )
            except PublicationTargetError:
                continue
            result = local_transcription_result(
                job_id,
                body,
                run_id=run_id,
                digest=digest,
            )
            if store.complete_recovered(job_id, attempt, result):
                log(
                    "warning",
                    "worker",
                    "JOB_RECOVERED_FROM_IMMUTABLE_RUN",
                    "Recovered a completed transcription run after Agent interruption",
                    {"job_id": job_id, "attempt": attempt, "run_id": run_id},
                )

    async def reconcile_durable_run_after_failure(body: dict) -> None:
        if body.get("kind") != "transcription.craig":
            return
        try:
            await asyncio.to_thread(reconcile_completed_transcription_runs)
        except Exception:
            # Failure reconciliation is opportunistic here. The original job
            # failure remains durable/retryable, and startup/retry reconciliation
            # will attempt the same immutable-run recovery again later.
            log(
                "warning",
                "worker",
                "JOB_RECOVERY_CHECK_FAILED",
                "Could not check for a durable transcription run immediately after worker failure",
            )

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
        while not worker_stop.is_set():
            claimed: tuple[str, int] | None = None
            job_cancel: threading.Event | None = None
            try:
                preparation_active = False
                runtime_maintenance_active = False
                async with dispatch_gate:
                    preparation_active = (
                        preparation_manager.snapshot().get("active") is True
                    )
                    runtime_maintenance_active = (
                        qwen_runtime_manager.snapshot().get("active") is True
                    )
                    claimed = (
                        None
                        if preparation_active or runtime_maintenance_active
                        else await asyncio.to_thread(claim_under_source_gate)
                    )
                    if claimed is not None:
                        # Register ownership before releasing dispatch_gate. There
                        # is no await between the committed claim and this marker,
                        # so cancel/delete cannot observe a running attempt without
                        # an in-memory active-worker fence.
                        job_cancel = register_active_worker(claimed[0])
                if preparation_active or runtime_maintenance_active:
                    worker_healthy = True
                    await asyncio.sleep(0.25)
                    continue
                if claimed:
                    job_id, attempt = claimed
                    state = store.get(job_id)
                    if state["status"] == "cancelled":
                        if job_cancel is not None:
                            clear_active_worker(job_id, job_cancel)
                        worker_healthy = True
                        continue
                    body = store.body(job_id)
                    log(
                        "info",
                        "worker",
                        "JOB_CLAIMED",
                        "Job claimed",
                        {"job_id": job_id, "attempt": attempt, "kind": body["kind"]},
                    )
                    if body["kind"] in {"transcription.craig", "benchmark.craig"}:
                        # Persist a truthful stage before supervisor-side runtime
                        # validation so the UI never looks frozen before the first
                        # worker message arrives.
                        store.set_stage(job_id, attempt, "runtime_validation")
                        store.record_worker_event(
                            job_id,
                            attempt,
                            "WORKER_DISPATCH_PREPARING",
                            {
                                **(
                                    {"profile_id": body["profile_id"]}
                                    if body["kind"] == "transcription.craig"
                                    else {}
                                ),
                                **(
                                    {"benchmark": True}
                                    if body["kind"] == "benchmark.craig"
                                    else {}
                                ),
                            },
                        )
                        log(
                            "info",
                            "worker",
                            "WORKER_DISPATCH_PREPARING",
                            "Validating sealed runtime receipt before worker launch",
                            {
                                "job_id": job_id,
                                **(
                                    {"profile_id": body["profile_id"]}
                                    if body["kind"] == "transcription.craig"
                                    else {"benchmark": True}
                                ),
                            },
                        )

                    if job_cancel is None:
                        raise RuntimeError("ACTIVE_WORKER_REGISTRATION_MISSING")
                    noisy_event_last_at: dict[str, float] = {}
                    noisy_event_interval = 5.0
                    worker_event_drift_seen: set[str] = set()

                    def is_cancelled() -> bool:
                        return worker_stop.is_set() or job_cancel.is_set()

                    def commit_progress(message) -> None:
                        current = store.get(job_id)
                        if current["status"] == "cancelled":
                            return
                        if current["status"] != "running" or current["attempt"] != attempt:
                            raise WorkerProcessError(
                                "WORKER_STALE_ATTEMPT",
                                recoverable=False,
                            )
                        expected = int(message.payload["completed"])
                        actual = int(current["progress"]["completed"])
                        if expected != actual + 1:
                            raise WorkerProcessError(
                                "WORKER_PROGRESS_GAP",
                                recoverable=False,
                            )
                        if body["kind"] == "synthetic.fixture":
                            store.step(job_id, attempt)
                        else:
                            store.progress(
                                job_id,
                                attempt,
                                completed=expected,
                                total=int(message.payload["total"]),
                                stage=str(message.payload.get("stage") or "transcription"),
                            )

                    def observe_event(message) -> None:
                        if message.type == "ready":
                            store.touch(job_id, attempt)
                            log(
                                "info",
                                "worker",
                                "WORKER_READY",
                                "Worker process accepted the job",
                                {
                                    "job_id": job_id,
                                    "profile_id": body.get("profile_id"),
                                },
                            )
                            return
                        if message.type == "heartbeat":
                            store.touch(job_id, attempt)
                            return
                        if message.type == "stage":
                            stage = str(message.payload.get("stage") or "worker")[:64]
                            store.set_stage(job_id, attempt, stage)
                            log(
                                "info",
                                "worker",
                                "WORKER_STAGE",
                                "Worker stage changed",
                                {"job_id": job_id, "stage": stage},
                            )
                            return
                        if message.type == "event":
                            sanitized_event = sanitize_worker_event(message.payload)
                            code = sanitized_event.code
                            data = sanitized_event.data
                            if (
                                sanitized_event.drift_reason is not None
                                and sanitized_event.drift_reason not in worker_event_drift_seen
                            ):
                                worker_event_drift_seen.add(sanitized_event.drift_reason)
                                log(
                                    "warning",
                                    "worker",
                                    "WORKER_EVENT_SCHEMA_DRIFT",
                                    "Worker diagnostic metadata did not match the browser-visible event contract",
                                    {
                                        "job_id": job_id,
                                        "reason": sanitized_event.drift_reason,
                                        "rejected_field_count": sanitized_event.rejected_field_count,
                                    },
                                )
                            store.record_worker_activity(
                                job_id,
                                attempt,
                                code,
                                data,
                            )
                            if code in {
                                "QWEN_WINDOW_TRANSCRIBED",
                                "WHISPER_SEGMENT_TRANSCRIBED",
                                "MODEL_DOWNLOAD_PROGRESS",
                            }:
                                now = time.monotonic()
                                last = noisy_event_last_at.get(code)
                                if last is not None and now - last < noisy_event_interval:
                                    return
                                noisy_event_last_at[code] = now
                            store.record_worker_event(
                                job_id,
                                attempt,
                                code,
                                data,
                                level=sanitized_event.level,
                            )
                            if code == "COMPATIBILITY_MIRROR_WRITE_FAILED":
                                log(
                                    "warning",
                                    "worker",
                                    code,
                                    "Immutable run completed but the legacy transcript mirror could not be updated",
                                    {"job_id": job_id, **data},
                                )
                            if code == "QWEN_ALIGNMENT_WINDOW_FAILED":
                                log(
                                    "error",
                                    "worker",
                                    code,
                                    "Qwen alignment failed for one bounded window",
                                    {"job_id": job_id, **data},
                                )
                            if code in {
                                "MODEL_DOWNLOAD_PROGRESS",
                                "QWEN_WINDOW_TRANSCRIBED",
                                "WHISPER_SEGMENT_TRANSCRIBED",
                                "ASR_CHECKPOINT_REUSED",
                                "ASR_CHECKPOINT_SAVED",
                            }:
                                safe_log_data = {
                                    key: value
                                    for key, value in data.items()
                                    if key
                                    in {
                                        "stage",
                                        "track",
                                        "total_tracks",
                                        "window",
                                        "segment",
                                        "downloaded_bytes",
                                        "total_bytes",
                                        "profile",
                                        "reason",
                                        "compute_type",
                                    }
                                }
                                log(
                                    "info",
                                    "worker",
                                    code,
                                    "Worker reported progress detail",
                                    {"job_id": job_id, **safe_log_data},
                                )

                    try:
                        if body["kind"] == "synthetic.fixture":
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
                        elif body["kind"] == "transcription.craig":
                            outcome = await asyncio.to_thread(
                                worker_supervisor.run_craig,
                                job_id=job_id,
                                attempt=attempt,
                                source_id=body["source_id"],
                                profile_id=body["profile_id"],
                                glossary=body.get("glossary", ""),
                                context=body.get("context", ""),
                                cpu=bool(body.get("cpu", False)),
                                on_progress=commit_progress,
                                on_event=observe_event,
                                is_cancelled=is_cancelled,
                            )
                        elif body["kind"] == "benchmark.craig":
                            outcome = await asyncio.to_thread(
                                worker_supervisor.run_benchmark,
                                job_id=job_id,
                                attempt=attempt,
                                source_id=body["source_id"],
                                glossary=body.get("glossary", ""),
                                context=body.get("context", ""),
                                sample_identity_sha256=body["sample_identity_sha256"],
                                sample_seconds=float(body["sample_seconds"]),
                                on_progress=commit_progress,
                                on_event=observe_event,
                                is_cancelled=is_cancelled,
                            )
                        else:
                            raise WorkerProcessError("WORKER_KIND_UNSUPPORTED")

                        final_state = store.get(job_id)
                        if outcome.terminal == "result" and body["kind"] == "benchmark.craig":
                            payload = outcome.payload
                            if (
                                payload.get("schema_version") != "tda_processing_benchmark_v1"
                                or payload.get("kind") != "benchmark.craig"
                                or payload.get("source_id") != body["source_id"]
                                or payload.get("sample_identity_sha256")
                                != body["sample_identity_sha256"]
                                or payload.get("sample_seconds") != body["sample_seconds"]
                                or payload.get("execution_mode")
                                not in {
                                    "prepared_artifacts_fresh_worker_per_profile_v1",
                                    "prepared_artifacts_fresh_worker_per_profile+async_telemetry_v2",
                                }
                                or not isinstance(payload.get("profiles"), list)
                                or len(payload["profiles"]) != len(_BENCHMARK_PROFILES)
                                or [item.get("profile_id") for item in payload["profiles"]]
                                != list(_BENCHMARK_PROFILES)
                                or not isinstance(payload.get("benchmark_id"), str)
                                or re.fullmatch(r"benchmark-[0-9a-f]{32}", payload["benchmark_id"]) is None
                                or not isinstance(payload.get("bundle_manifest_sha256"), str)
                                or _SHA256_PATTERN.fullmatch(payload["bundle_manifest_sha256"]) is None
                                or isinstance(payload.get("bundle_size_bytes"), bool)
                                or not isinstance(payload.get("bundle_size_bytes"), int)
                                or payload["bundle_size_bytes"] < 1
                            ):
                                raise WorkerProcessError(
                                    "BENCHMARK_RESULT_INVALID",
                                    recoverable=False,
                                )
                            result = {
                                **payload,
                                "job_id": job_id,
                                "campaign_id": body["campaign_id"],
                                "session_id": body["session_id"],
                                "track_count": body["track_count"],
                                "audio_work_seconds": body["audio_work_seconds"],
                                "prepared": body["prepared"],
                            }
                            if not store.complete(job_id, attempt, result):
                                raise WorkerProcessError("WORKER_STALE_ATTEMPT")
                            final_state = store.get(job_id)
                        if outcome.terminal == "result" and body["kind"] == "transcription.craig":
                            if final_state["status"] == "cancelled":
                                log(
                                    "info",
                                    "worker",
                                    "WORKER_RESULT_DISCARDED_AFTER_CANCEL",
                                    "Worker finished after the operator cancelled the job; queue result was discarded",
                                    {"job_id": job_id, "attempt": attempt},
                                )
                            else:
                                if outcome.payload.get("forced_teardown") is True:
                                    store.record_worker_event(
                                        job_id,
                                        attempt,
                                        "WORKER_RESULT_TEARDOWN_FORCED",
                                        {"returncode": outcome.returncode},
                                        level="warning",
                                    )
                                    log(
                                        "warning",
                                        "worker",
                                        "WORKER_RESULT_TEARDOWN_FORCED",
                                        "Worker emitted a durable result but required forced process teardown afterwards",
                                        {
                                            "job_id": job_id,
                                            "attempt": attempt,
                                            "returncode": outcome.returncode,
                                        },
                                    )
                                result = await asyncio.to_thread(
                                    finalize_transcription_result,
                                    job_id,
                                    attempt,
                                    body,
                                    outcome.payload,
                                )
                                if not store.complete(job_id, attempt, result):
                                    raise WorkerProcessError("WORKER_STALE_ATTEMPT")
                                final_state = store.get(job_id)
                        if (
                            outcome.terminal == "cancelled"
                            and final_state["status"] == "running"
                            and not worker_stop.is_set()
                        ):
                            final_state = store.action(job_id, "cancel")
                        if outcome.terminal == "cancelled" and outcome.payload.get("forced") is True:
                            log(
                                "warning",
                                "worker",
                                "WORKER_CANCEL_FORCED",
                                "Worker did not acknowledge cancellation within the grace period and was stopped",
                                {"job_id": job_id},
                            )
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
                        code = (
                            exc.code
                            if body["kind"] in {"transcription.craig", "benchmark.craig"}
                            else "FIXTURE_EXECUTION_FAILED"
                        )
                        store.fail(
                            job_id,
                            attempt,
                            code,
                            recoverable=exc.recoverable,
                        )
                        log(
                            "error",
                            "worker",
                            "WORKER_PROCESS_FAILED",
                            "Worker process failed",
                            {"job_id": job_id, "worker_code": exc.code},
                        )
                        await reconcile_durable_run_after_failure(body)
                    except Conflict as exc:
                        code = str(exc)
                        store.fail(
                            job_id,
                            attempt,
                            code,
                            recoverable=conflict_recoverable(code),
                        )
                        log(
                            "error",
                            "worker",
                            "WORKER_CONTRACT_FAILED",
                            "Worker violated the local queue contract",
                            {"job_id": job_id, "worker_code": code},
                        )
                        await reconcile_durable_run_after_failure(body)
                    except Exception:
                        code = (
                            "WORKER_EXECUTION_FAILED"
                            if body["kind"] in {"transcription.craig", "benchmark.craig"}
                            else "FIXTURE_EXECUTION_FAILED"
                        )
                        store.fail(job_id, attempt, code)
                        log(
                            "error",
                            "worker",
                            "JOB_EXECUTION_FAILED",
                            "Job execution failed",
                            {"job_id": job_id},
                        )
                        await reconcile_durable_run_after_failure(body)
                    finally:
                        clear_active_worker(job_id, job_cancel)
                    worker_healthy = True
                    continue
                worker_healthy = True
                await wait_for_work()
            except asyncio.CancelledError:
                if claimed is not None and job_cancel is not None:
                    clear_active_worker(claimed[0], job_cancel)
                raise
            except Exception:
                if claimed is not None and job_cancel is not None:
                    clear_active_worker(claimed[0], job_cancel)
                worker_healthy = False
                log("error", "storage", "QUEUE_RECOVERY_REQUIRED", "Queue storage temporarily unavailable")
                await asyncio.sleep(1)
                try:
                    await asyncio.to_thread(reconcile_completed_transcription_runs)
                    await asyncio.to_thread(store.recover)
                    worker_healthy = True
                except Exception:
                    continue

    @asynccontextmanager
    async def lifespan(_):
        delete_cleanup = await asyncio.to_thread(recover_deleted_run_cleanup, data_root)
        if any(delete_cleanup.values()):
            level = "warning" if delete_cleanup["pending"] or delete_cleanup["failed"] else "info"
            log(
                level,
                "storage",
                "LOCAL_RUN_DELETE_RECOVERY",
                "Recovered tombstoned local-run cleanup after Agent interruption",
                delete_cleanup,
            )
        legacy_maintenance = await asyncio.to_thread(maintain_legacy_transcripts, data_root)
        if any(legacy_maintenance.values()):
            log("info", "storage", "LEGACY_TRANSCRIPT_MAINTENANCE", "Local legacy maintenance completed", legacy_maintenance)
        reconcile_completed_transcription_runs()
        store.recover()
        log("info", "agent", "API_STARTING", "Local API starting", {"port": port, "pid": os.getpid()})
        task = asyncio.create_task(worker()) if run_worker else None
        try:
            yield
        finally:
            preparation_manager.request_cancel()
            qwen_runtime_manager.request_cancel()
            worker_stop.set()
            worker_wake.set()
            if task:
                try:
                    # asyncio.to_thread does not cancel the underlying worker
                    # thread. Give the supervisor time to deliver cancellation to
                    # the isolated native/CUDA process and return cleanly.
                    # Supervisor cancellation can spend the grace period in
                    # native/CUDA code and then another bounded terminate/kill
                    # sequence. Keep the coroutine alive long enough for that
                    # fenced teardown to finish instead of abandoning its thread.
                    await asyncio.wait_for(
                        asyncio.shield(task),
                        timeout=_WORKER_SHUTDOWN_FAST_SECONDS,
                    )
                except TimeoutError:
                    log(
                        "warning",
                        "worker",
                        "WORKER_SHUTDOWN_TIMEOUT",
                        "Worker did not stop within the fast shutdown window; keeping the data-root fence until it exits",
                    )
                    # Do not cancel the asyncio wrapper here: asyncio.to_thread()
                    # cannot cancel the underlying supervisor thread. Returning
                    # from lifespan would let AgentController release the sole
                    # data-root lock while that worker could still own SQLite,
                    # staged audio or a native/CUDA process.
                    await task
            preparation_stopped = await asyncio.to_thread(
                preparation_manager.wait,
                8.0,
            )
            if not preparation_stopped:
                log(
                    "warning",
                    "preparation",
                    "PREPARATION_SHUTDOWN_TIMEOUT",
                    "Profile preparation did not stop within the fast shutdown window; keeping the data-root fence until it exits",
                )
                # Preparation runs in-process and may still be mutating Runtime,
                # Models or gate receipts. Returning from lifespan here would let
                # AgentController release the sole data-root lock while that
                # thread remained alive. Wait fail-closed; AgentController has its
                # own bounded stop timeout and deliberately retains the lock when
                # this teardown takes too long.
                await asyncio.to_thread(preparation_manager.wait)
            runtime_maintenance_stopped = await asyncio.to_thread(
                qwen_runtime_manager.wait,
                8.0,
            )
            if not runtime_maintenance_stopped:
                log(
                    "warning",
                    "runtime",
                    "QWEN_RUNTIME_UPDATE_SHUTDOWN_TIMEOUT",
                    "Qwen Runtime maintenance did not stop within the fast shutdown window; keeping the data-root fence until it exits",
                )
                await asyncio.to_thread(qwen_runtime_manager.wait)
            await asyncio.to_thread(reconcile_completed_transcription_runs)
            await asyncio.to_thread(store.recover)
            log("info", "agent", "API_STOPPED", "Local API stopped")

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    app.state.telemetry = telemetry
    app.state.browser_sessions = browser_sessions
    app.state.preparation_manager = preparation_manager
    app.state.qwen_runtime_manager = qwen_runtime_manager
    app.state.system_log = system_log
    app.state.worker_wake = worker_wake
    app.state.source_gate = source_gate
    app.state.source_in_use = source_in_use
    app.state.transcription_run_visible = transcription_run_visible
    app.state.data_root = data_root
    app.state.models_root = resolved_models_root
    app.state.state_root = resolved_state_root
    app.state.runtime_root = resolved_runtime_root
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
        public_health = request.method == "GET" and request.url.path == "/api/v1/health"
        browser_bootstrap = (
            request.method == "POST" and request.url.path == "/api/v1/session"
        )
        public = public_health or browser_bootstrap
        authorization = request.headers.get("authorization", "")
        master_authorized = hmac.compare_digest(
            authorization.encode("utf-8"),
            f"Bearer {token}".encode("ascii"),
        )
        browser_token = (
            authorization[len("Bearer "):]
            if authorization.startswith("Bearer ")
            else ""
        )
        browser_authorized = browser_sessions.validate(browser_token, origin)
        response = None
        if not public and not (master_authorized or browser_authorized):
            response = error("UNAUTHORIZED", 401)
        elif (
            not public
            and not master_authorized
            and browser_authorized
            and not _browser_route_allowed(request.method, request.url.path)
        ):
            response = error("BROWSER_SESSION_SCOPE_REJECTED", 403)
        elif request.method == "POST":
            if not origin:
                response = error("ORIGIN_REQUIRED", 403)
            elif request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
                response = error("JSON_REQUIRED", 415)
            else:
                body_bytes = bytearray()
                body_limit = (
                    8 * 1024 * 1024
                    if _BROWSER_BENCHMARK_PATH.fullmatch(request.url.path) is not None
                    and request.url.path.endswith("/reference")
                    else LOCAL_JSON_BODY_MAX_BYTES
                )
                async for chunk in request.stream():
                    body_bytes.extend(chunk)
                    if len(body_bytes) > body_limit:
                        response = error("BODY_TOO_LARGE", 413)
                        break
                if response is None:
                    request._body = bytes(body_bytes)
        if response is None:
            try:
                response = await call_next(request)
            except Exception:
                log("error", "api", "REQUEST_FAILED", "Local request failed", {"path": request.url.path})
                response = error("LOCAL_STORAGE_OR_RUNTIME_ERROR", 503, True)
        response.headers.update({**cors, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        return response

    @app.exception_handler(Conflict)
    async def conflict(_, exc: Conflict):
        return error(exc.code, 409, conflict_recoverable(exc.code))

    @app.exception_handler(KeyError)
    async def missing(_, exc):
        return error("JOB_NOT_FOUND", 404)

    @app.exception_handler(RequestValidationError)
    async def invalid(_, exc):
        return error("INVALID_REQUEST", 422)

    def health_value():
        return dict(
            product_id=_PRODUCT_ID,
            api_version="1",
            service_version=VERSION,
            pid=os.getpid(),
            port=port,
            lifecycle="preparing"
            if (
                not worker_healthy
                or preparation_manager.snapshot().get("active") is True
                or qwen_runtime_manager.snapshot().get("active") is True
            )
            else "paused"
            if store.setting("paused") == "true"
            else "ready",
        )

    @app.get("/api/v1/health")
    def health():
        return health_value()

    @app.post("/api/v1/session")
    def browser_session(_: BrowserSessionRequest, request: Request):
        origin = request.headers.get("origin")
        if origin is None or origin not in origins:
            return error("ORIGIN_REQUIRED", 403)
        session = browser_sessions.issue(origin)
        return {
            "schema": "tda_loopback_session_v1",
            "token": session.token,
            "expires_in_seconds": session.expires_in_seconds,
        }

    @app.get("/api/v1/version")
    def version():
        return dict(product_id=_PRODUCT_ID, api_version="1", service_version=VERSION)

    @app.get("/api/v1/capabilities")
    def capabilities():
        features = [
            "synthetic.fixture",
            "job.events",
            "job.events.cursor",
            "job.list.cursor",
            "transcription.runs.catalog",
            "processing.benchmark",
            "processing.benchmark.runtime-readiness-v2",
            "processing.benchmark.evidence-v1",
            "processing.benchmark.reference-v1",
            "system.telemetry",
            "worker.subprocess",
            "transcription.prepare",
            "transcription.prepare.cancel",
            "runtime.qwen.check",
            "runtime.qwen.update",
            "transcription.review",
            "transcription.review.base",
            "transcription.target.repair",
            "transcription.session-workspace",
            "transcription.session-intent",
            "transcription.session-timeline",
            "transcription.session-participants",
            "transcription.session-assembly",
            "transcription.session-assembly.review",
        ]
        catalog = profile_catalog(
            resolved_state_root,
            resolved_runtime_root,
            resolved_models_root,
        )
        profiles = [
            str(item["id"])
            for item in catalog
            if item.get("ready") is True
        ]
        if profiles:
            features.append("transcription.craig")
        if system_log is not None:
            features.extend(["agent.desktop", "agent.logs"])
        if shutdown_callback is not None:
            features.append("agent.control")
        return dict(
            capabilities=features,
            sync=False,
            device=dict(id=store.setting("device"), label="TDA local"),
            transcription={
                "profiles": profiles,
                "catalog": catalog,
                "qwen_physical_gate": {
                    profile_id: inspect_qwen_physical_gate(
                        resolved_state_root,
                        resolved_runtime_root,
                        resolved_models_root,
                        profile_id=profile_id,
                    )
                    for profile_id in ("qwen-fast", "qwen-quality")
                },
            },
        )

    @app.get("/api/v1/preparation")
    def preparation_status():
        return preparation_manager.snapshot()

    @app.post("/api/v1/preparation")
    async def prepare_profile(body: ProfilePreparationRequest):
        async with dispatch_gate:
            if store.has_active_transcription_jobs():
                return error(
                    "TRANSCRIPTION_PREPARATION_BLOCKED_BY_ACTIVE_JOB",
                    409,
                    True,
                )
            if qwen_runtime_manager.snapshot().get("active") is True:
                return error(
                    "TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNTIME_UPDATE",
                    409,
                    True,
                )
            try:
                value = await asyncio.to_thread(
                    start_preparation_under_source_gate,
                    body.source_id,
                    body.profile_id,
                    body.purpose,
                )
            except ProfilePreparationError as exc:
                status = (
                    409
                    if exc.code == "TRANSCRIPTION_PREPARATION_ALREADY_RUNNING"
                    else 400
                )
                return error(
                    exc.code,
                    status,
                    preparation_recoverable(exc.code),
                )
        worker_wake.set()
        return value

    @app.post("/api/v1/preparation/cancel")
    def cancel_preparation(body: ProfilePreparationCancelRequest):
        try:
            return preparation_manager.request_cancel(
                body.expected_operation_id
            )
        except ProfilePreparationError as exc:
            return error(
                exc.code,
                409
                if exc.code == "TRANSCRIPTION_PREPARATION_STALE_OPERATION"
                else 400,
                preparation_recoverable(exc.code),
            )

    @app.post("/api/v1/whisper-runtime/rollback")
    async def whisper_runtime_rollback(body: WhisperRuntimeRollbackRequest):
        # Hold the same dispatch gate used for job claims and preparation starts
        # for the entire selector/download transaction. That makes the "idle"
        # check atomic instead of a Desktop-side preflight with a race window.
        async with dispatch_gate:
            if preparation_manager.snapshot().get("active") is True:
                return error(
                    "RUNTIME_ROLLBACK_BLOCKED_BY_TRANSCRIPTION_PREPARATION",
                    409,
                    True,
                )
            if qwen_runtime_manager.snapshot().get("active") is True:
                return error(
                    "RUNTIME_ROLLBACK_BLOCKED_BY_RUNTIME_MAINTENANCE",
                    409,
                    True,
                )
            if store.has_active_jobs():
                return error(
                    "RUNTIME_ROLLBACK_BLOCKED_BY_RUNNING_JOB",
                    409,
                    True,
                )
            try:
                value = await asyncio.to_thread(
                    rollback_whisper_runtime,
                    resolved_runtime_root,
                    resolved_cache_root,
                    target_version=body.version,
                )
            except WhisperRuntimeMaintenanceError as exc:
                return error(str(exc), 409, True)
            except NetworkError as exc:
                return error(exc.code, 503, True)
        worker_wake.set()
        log(
            "warning",
            "runtime",
            "WHISPER_RUNTIME_ROLLBACK_COMPLETED",
            "Whisper Runtime rollback completed by explicit operator action",
            {
                "previous_version": value.get("previous_version"),
                "version": value.get("version"),
                "source": value.get("source"),
            },
        )
        return value

    @app.get("/api/v1/qwen-runtime")
    def qwen_runtime_status():
        return qwen_runtime_manager.snapshot()

    @app.post("/api/v1/qwen-runtime/check")
    async def qwen_runtime_check():
        async with dispatch_gate:
            if qwen_runtime_manager.snapshot().get("active") is True:
                try:
                    return qwen_runtime_manager.start_check()
                except QwenRuntimeMaintenanceError as exc:
                    return error(exc.code, 409, True)
            try:
                return qwen_runtime_manager.start_check()
            except QwenRuntimeMaintenanceError as exc:
                return error(exc.code, 409, True)

    @app.post("/api/v1/qwen-runtime/update")
    async def qwen_runtime_update():
        async with dispatch_gate:
            if preparation_manager.snapshot().get("active") is True:
                return error(
                    "QWEN_RUNTIME_UPDATE_BLOCKED_BY_PREPARATION",
                    409,
                    True,
                )
            if store.has_active_jobs():
                return error(
                    "RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB",
                    409,
                    True,
                )
            try:
                value = qwen_runtime_manager.start_update()
            except QwenRuntimeMaintenanceError as exc:
                return error(exc.code, 409, True)
        worker_wake.set()
        return value

    @app.get("/api/v1/system")
    def system():
        return telemetry.snapshot()

    @app.get("/api/v1/agent")
    def agent():
        return {
            **health_value(),
            "uptime_seconds": max(0, round(time.time() - started_at, 1)),
        }

    @app.post("/api/v1/agent/control")
    async def agent_control(body: AgentControlRequest):
        if shutdown_callback is None:
            raise Conflict("AGENT_CONTROL_UNAVAILABLE")
        if (
            (
                store.has_running_jobs()
                or preparation_manager.snapshot().get("active") is True
                or qwen_runtime_manager.snapshot().get("active") is True
            )
            and not body.force
        ):
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

    def session_workspace_source_facts(value):
        facts = {}
        for part in value["parts"]:
            source_id = part["source_id"]
            try:
                _, package = staged_package_under_source_gate(source_id)
                classified = classify_start_time(getattr(package, "start_time", None))
                facts[source_id] = {
                    "source_state": "ready",
                    "start_time": getattr(package, "start_time", None),
                    "start_confidence": classified["confidence"],
                    "start_utc": classified["instant_utc"],
                    "start_epoch_seconds": classified["epoch_seconds"],
                    "duration_seconds": package_duration_seconds(package),
                }
            except (CraigPackageError, ValueError):
                facts[source_id] = {
                    "source_state": "invalid",
                    "start_time": None,
                    "start_confidence": "missing",
                    "start_utc": None,
                    "start_epoch_seconds": None,
                    "duration_seconds": None,
                }
        return facts

    def session_workspace_response(value):
        return enrich_workspace_timeline(
            value,
            session_workspace_source_facts(value),
        )

    @app.get("/api/v1/session-workspaces/{campaign_id}/{session_id}")
    def session_workspace(campaign_id: str, session_id: str):
        try:
            value = store.session_workspace(campaign_id, session_id)
        except Conflict as exc:
            if str(exc) == "SESSION_WORKSPACE_NOT_FOUND":
                return error("SESSION_WORKSPACE_NOT_FOUND", 404)
            raise
        return session_workspace_response(value)

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}")
    def create_session_workspace(
        campaign_id: str,
        session_id: str,
        _: SessionWorkspaceCreateRequest,
    ):
        return session_workspace_response(
            store.ensure_session_workspace(campaign_id, session_id)
        )

    @app.get("/api/v1/session-workspaces/{campaign_id}/{session_id}/intent")
    def session_transcription_intent(campaign_id: str, session_id: str):
        try:
            return store.session_transcription_intent(campaign_id, session_id)
        except Conflict as exc:
            if str(exc) == "SESSION_TRANSCRIPTION_INTENT_NOT_FOUND":
                return error("SESSION_TRANSCRIPTION_INTENT_NOT_FOUND", 404)
            raise

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/intent")
    def save_session_transcription_intent(
        campaign_id: str,
        session_id: str,
        body: SessionTranscriptionIntentRequest,
    ):
        return store.save_session_transcription_intent(
            campaign_id,
            session_id,
            body.request_id,
            body.profile_id,
            body.context,
            body.glossary,
        )

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/parts")
    def attach_session_workspace_part(
        campaign_id: str,
        session_id: str,
        body: SessionWorkspaceAttachRequest,
    ):
        try:
            staged_package_under_source_gate(body.source_id)
        except (CraigPackageError, ValueError) as exc:
            raise Conflict("SESSION_WORKSPACE_SOURCE_UNAVAILABLE") from exc
        return session_workspace_response(
            store.attach_session_source(
                campaign_id,
                session_id,
                body.source_id,
                body.expected_revision,
            )
        )

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/parts/detach")
    def detach_session_workspace_part(
        campaign_id: str,
        session_id: str,
        body: SessionWorkspaceDetachRequest,
    ):
        return session_workspace_response(
            store.detach_session_part(
                campaign_id,
                session_id,
                body.part_id,
                body.expected_revision,
            )
        )

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/parts/reorder")
    def reorder_session_workspace_parts(
        campaign_id: str,
        session_id: str,
        body: SessionWorkspaceReorderRequest,
    ):
        return session_workspace_response(
            store.reorder_session_parts(
                campaign_id,
                session_id,
                body.part_ids,
                body.expected_revision,
            )
        )

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/parts/timing")
    def update_session_workspace_part_timing(
        campaign_id: str,
        session_id: str,
        body: SessionWorkspaceTimingRequest,
    ):
        current = store.session_workspace(campaign_id, session_id)
        target = next(
            (part for part in current["parts"] if part["part_id"] == body.part_id),
            None,
        )
        if target is None:
            raise Conflict("SESSION_WORKSPACE_PART_NOT_FOUND")
        try:
            _, package = staged_package_under_source_gate(target["source_id"])
        except (CraigPackageError, ValueError) as exc:
            raise Conflict("SESSION_WORKSPACE_SOURCE_UNAVAILABLE") from exc
        duration = package_duration_seconds(package)
        if duration is None:
            raise Conflict("SESSION_WORKSPACE_SOURCE_DURATION_UNAVAILABLE")
        local_end = (
            body.trim_end_seconds
            if body.trim_end_seconds is not None
            else duration
        )
        if (
            body.trim_start_seconds >= duration
            or local_end > duration
            or local_end <= body.trim_start_seconds
        ):
            raise Conflict("SESSION_WORKSPACE_TRIM_RANGE_INVALID")

        candidate_parts = [
            {
                **part,
                **(
                    {
                        "timeline_mode": "manual",
                        "session_offset_seconds": body.session_offset_seconds,
                        "trim_start_seconds": body.trim_start_seconds,
                        "trim_end_seconds": body.trim_end_seconds,
                        "gap_confirmed": body.gap_confirmed,
                        "overlap_resolution": body.overlap_resolution,
                        "overlap_boundary_seconds": body.overlap_boundary_seconds,
                    }
                    if part["part_id"] == body.part_id
                    else {}
                ),
            }
            for part in current["parts"]
        ]
        candidate = {
            **current,
            "ordering_mode": "manual",
            "parts": candidate_parts,
        }
        candidate_timeline = enrich_workspace_timeline(
            candidate,
            session_workspace_source_facts(candidate),
        )
        try:
            validate_overlap_boundary(candidate_timeline, body.part_id)
        except ValueError as exc:
            raise Conflict(str(exc)) from exc

        return session_workspace_response(
            store.update_session_part_timing(
                campaign_id,
                session_id,
                body.part_id,
                body.expected_revision,
                session_offset_seconds=body.session_offset_seconds,
                trim_start_seconds=body.trim_start_seconds,
                trim_end_seconds=body.trim_end_seconds,
                gap_confirmed=body.gap_confirmed,
                overlap_resolution=body.overlap_resolution,
                overlap_boundary_seconds=body.overlap_boundary_seconds,
            )
        )

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/timeline/derive")
    def derive_session_workspace_timeline(
        campaign_id: str,
        session_id: str,
        body: SessionWorkspaceDeriveTimelineRequest,
    ):
        current = store.session_workspace(campaign_id, session_id)
        facts = session_workspace_source_facts(current)
        if any(value["source_state"] != "ready" for value in facts.values()):
            raise Conflict("SESSION_WORKSPACE_SOURCE_UNAVAILABLE")
        try:
            placements = automatic_placements(current["parts"], facts)
        except ValueError as exc:
            raise Conflict(str(exc)) from exc
        return session_workspace_response(
            store.apply_automatic_session_timeline(
                campaign_id,
                session_id,
                placements,
                body.expected_revision,
            )
        )

    def session_participant_projection(campaign_id: str, session_id: str):
        workspace = session_workspace_response(
            store.session_workspace(campaign_id, session_id)
        )
        packages: dict[str, object | None] = {}
        for part in workspace["parts"]:
            source_id = part["source_id"]
            try:
                _, package = staged_package_under_source_gate(source_id)
                packages[source_id] = package
            except (CraigPackageError, ValueError):
                packages[source_id] = None
        manual = {
            row["observation_id"]: row["participant_id"]
            for row in store.session_participant_assignments(campaign_id, session_id)
        }
        return workspace, packages, resolve_session_participants(
            workspace,
            packages,
            manual,
        )

    @app.get("/api/v1/session-workspaces/{campaign_id}/{session_id}/participants")
    def session_workspace_participants(campaign_id: str, session_id: str):
        try:
            _, _, projection = session_participant_projection(campaign_id, session_id)
        except Conflict as exc:
            if str(exc) == "SESSION_WORKSPACE_NOT_FOUND":
                return error("SESSION_WORKSPACE_NOT_FOUND", 404)
            raise
        return projection

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/participants")
    def update_session_workspace_participants(
        campaign_id: str,
        session_id: str,
        body: SessionParticipantMappingRequest,
    ):
        workspace, packages, _ = session_participant_projection(campaign_id, session_id)
        observations = {
            row["observation_id"]: row
            for row in observed_session_tracks(workspace, packages)
        }
        normalized = []
        seen = set()
        for assignment in body.assignments:
            if assignment.observation_id in seen:
                raise Conflict("SESSION_PARTICIPANT_MAPPING_INVALID")
            seen.add(assignment.observation_id)
            observation = observations.get(assignment.observation_id)
            if observation is None:
                raise Conflict("SESSION_PARTICIPANT_OBSERVATION_NOT_FOUND")
            normalized.append(
                {
                    "observation_id": assignment.observation_id,
                    "participant_id": assignment.participant_id,
                    "source_id": observation["source_id"],
                    "track_number": observation["track_number"],
                }
            )
        store.replace_session_participant_assignments(
            campaign_id,
            session_id,
            normalized,
            body.expected_revision,
        )
        _, _, projection = session_participant_projection(campaign_id, session_id)
        return projection

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/parts/run")
    def select_session_workspace_part_run(
        campaign_id: str,
        session_id: str,
        body: SessionWorkspaceSelectRunRequest,
    ):
        with source_gate:
            current = store.session_workspace(campaign_id, session_id)
            target = next(
                (part for part in current["parts"] if part["part_id"] == body.part_id),
                None,
            )
            if target is None:
                raise Conflict("SESSION_WORKSPACE_PART_NOT_FOUND")
            try:
                package_root, _package = staged_package_under_source_gate(target["source_id"])
                manifest = load_run(package_root, body.run_id, verify_content=True)
            except (CraigPackageError, TranscriptionRunError) as exc:
                raise Conflict("SESSION_ASSEMBLY_RUN_INVALID") from exc
            if (
                manifest.get("source_id") != target["source_id"]
                or manifest.get("source_sha256") != target["source_id"].removeprefix("craig-")
            ):
                raise Conflict("SESSION_ASSEMBLY_SOURCE_HASH_MISMATCH")
            if not transcription_run_visible(package_root, manifest):
                raise Conflict("SESSION_ASSEMBLY_RUN_NOT_VISIBLE")
            updated = store.select_session_part_run(
                campaign_id,
                session_id,
                body.part_id,
                body.run_id,
                body.expected_revision,
            )
        return session_workspace_response(updated)

    @app.get("/api/v1/session-workspaces/{campaign_id}/{session_id}/assemblies")
    def session_assemblies(campaign_id: str, session_id: str):
        return list_session_assemblies(data_root, campaign_id, session_id)

    @app.get("/api/v1/session-workspaces/{campaign_id}/{session_id}/assemblies/{assembly_id}")
    def session_assembly(campaign_id: str, session_id: str, assembly_id: str):
        try:
            return load_session_assembly(
                data_root,
                campaign_id,
                session_id,
                assembly_id,
                verify_transcript=True,
            )
        except SessionAssemblyError as exc:
            code = _public_error_code_from_exception(exc)
            return error(code, 404 if code == "SESSION_ASSEMBLY_NOT_FOUND" else 409)

    @app.post("/api/v1/session-workspaces/{campaign_id}/{session_id}/assemblies")
    def create_session_assembly(
        campaign_id: str,
        session_id: str,
        body: SessionAssemblyBuildRequest,
    ):
        with source_gate:
            current = store.session_workspace(campaign_id, session_id)
            if current["revision"] != body.expected_revision:
                raise Conflict("SESSION_WORKSPACE_REVISION_CONFLICT")
            workspace, packages, participant_mapping = session_participant_projection(
                campaign_id, session_id
            )
            if workspace["revision"] != body.expected_revision:
                raise Conflict("SESSION_WORKSPACE_REVISION_CONFLICT")
            package_roots: dict[str, Path] = {}
            for part in workspace["parts"]:
                try:
                    package_root, _package = staged_package_under_source_gate(part["source_id"])
                except (CraigPackageError, ValueError) as exc:
                    raise Conflict("SESSION_ASSEMBLY_SOURCE_UNAVAILABLE") from exc
                package_roots[part["source_id"]] = package_root
            try:
                return build_session_assembly(
                    data_root,
                    workspace,
                    participant_mapping,
                    package_roots,
                    run_visible=transcription_run_visible,
                )
            except SessionAssemblyError as exc:
                raise Conflict(str(exc)) from exc

    @app.get("/api/v1/jobs")
    def jobs(
        request: Request,
        scope: Literal["all", "active", "history"] = "all",
        cursor: Annotated[str | None, Query(min_length=1, max_length=512)] = None,
        limit: Annotated[int, Query(ge=1, le=200)] = 100,
    ):
        # Preserve the historical wire exactly for clients that did not negotiate
        # job.list.cursor. Cursor-aware clients opt in by sending any list query.
        if not request.query_params:
            return {"jobs": store.jobs()}
        try:
            return store.jobs_page(scope=scope, cursor=cursor, limit=limit)
        except Conflict as exc:
            code = _public_error_code_from_exception(exc)
            if code.startswith("JOB_LIST_"):
                if re.fullmatch(r"JOB_LIST_[A-Z0-9_]{1,64}", code):
                    return error(code, 422)
                return error("JOB_LIST_INVALID", 422)
            raise

    @app.post("/api/v1/jobs")
    async def submit(body: JobRequest, idempotency_key: str = Header(pattern=_ID_PATTERN)):
        payload = body.model_dump()
        if body.kind == "transcription.craig":
            async with dispatch_gate:
                if qwen_runtime_manager.snapshot().get("active") is True:
                    raise Conflict("QWEN_RUNTIME_MAINTENANCE_BUSY")
                if body.profile_id.startswith("qwen-"):
                    # Qwen is fail-closed before consulting the staged source: an
                    # unaccepted GPU/profile must not trigger source filesystem work.
                    if body.cpu:
                        raise Conflict("QWEN_CPU_UNSUPPORTED")
                    gate = await asyncio.to_thread(
                        inspect_qwen_physical_gate,
                        resolved_state_root,
                        resolved_runtime_root,
                        resolved_models_root,
                        profile_id=body.profile_id,
                    )
                    if gate.get("ready") is not True:
                        raise Conflict("QWEN_PHYSICAL_ACCEPTANCE_REQUIRED")
                    try:
                        _, package = await asyncio.to_thread(
                            staged_package_under_source_gate,
                            body.source_id,
                        )
                    except CraigPackageError as exc:
                        raise Conflict(str(exc)) from None
                else:
                    # Whisper keeps source validation first so a missing/invalid Craig
                    # package is reported deterministically even on an unprepared PC.
                    try:
                        _, package = await asyncio.to_thread(
                            staged_package_under_source_gate,
                            body.source_id,
                        )
                    except CraigPackageError as exc:
                        raise Conflict(str(exc)) from None
                    whisper = await asyncio.to_thread(
                        inspect_whisper_runtime,
                        resolved_runtime_root,
                        verify_worker=False,
                    )
                    if whisper.get("status") != "ready":
                        raise Conflict("WHISPER_RUNTIME_UNAVAILABLE")
                    model = await asyncio.to_thread(
                        inspect_model_install,
                        resolved_models_root,
                        get_profile(body.profile_id),
                        verify_hash=False,
                    )
                    if not whisper_model_ready(model):
                        raise Conflict("WHISPER_MODEL_PREPARATION_REQUIRED")
                payload["units"] = len(package.tracks)
                durations = [
                    float(track.duration_seconds)
                    for track in package.tracks
                    if isinstance(track.duration_seconds, (int, float))
                    and not isinstance(track.duration_seconds, bool)
                    and track.duration_seconds >= 0
                ]
                if len(durations) == len(package.tracks):
                    payload["audio_work_seconds"] = sum(durations)
                    payload["track_durations_seconds"] = durations
                value = store.submit(idempotency_key, payload)
        elif body.kind == "benchmark.craig":
            async with dispatch_gate:
                if qwen_runtime_manager.snapshot().get("active") is True:
                    raise Conflict("QWEN_RUNTIME_MAINTENANCE_BUSY")
                if await asyncio.to_thread(store.has_active_transcription_jobs):
                    raise Conflict("BENCHMARK_RESOURCE_BUSY")
                try:
                    _, package = await asyncio.to_thread(
                        staged_package_under_source_gate,
                        body.source_id,
                    )
                except CraigPackageError as exc:
                    raise Conflict(str(exc)) from None
                if not package.tracks or any(
                    track.duration_seconds is None
                    or float(track.duration_seconds) < _BENCHMARK_SAMPLE_SECONDS
                    for track in package.tracks
                ):
                    raise Conflict("BENCHMARK_SAMPLE_TOO_SHORT")
                catalog = await asyncio.to_thread(
                    profile_catalog,
                    resolved_state_root,
                    resolved_runtime_root,
                    resolved_models_root,
                )
                benchmark_state = {
                    str(item.get("id")): item
                    for item in catalog
                }
                if any(
                    benchmark_state.get(profile, {}).get("benchmark_ready") is not True
                    for profile in _BENCHMARK_PROFILES
                ):
                    whisper_blocked = any(
                        benchmark_state.get(profile, {}).get("benchmark_reason")
                        == "WHISPER_BENCHMARK_RUNTIME_REQUIRED"
                        for profile in ("whisper-turbo", "whisper-detailed")
                    )
                    raise Conflict(
                        "WHISPER_BENCHMARK_RUNTIME_REQUIRED"
                        if whisper_blocked
                        else "BENCHMARK_PROFILES_NOT_READY"
                    )
                payload.update(
                    units=len(_BENCHMARK_PROFILES),
                    sample_seconds=_BENCHMARK_SAMPLE_SECONDS,
                    sample_identity_sha256=_benchmark_sample_identity(package),
                    track_count=len(package.tracks),
                    audio_work_seconds=round(
                        _BENCHMARK_SAMPLE_SECONDS * len(package.tracks),
                        3,
                    ),
                    profiles=list(_BENCHMARK_PROFILES),
                    prepared=True,
                )
                value = store.submit(idempotency_key, payload)
        else:
            value = store.submit(idempotency_key, payload)
        worker_wake.set()
        return value

    @app.get("/api/v1/benchmarks/{benchmark_id}")
    def benchmark_manifest(benchmark_id: str):
        try:
            return load_benchmark_bundle(data_root, benchmark_id)
        except BenchmarkEvidenceError as exc:
            return error(str(exc), 409, False)

    @app.get("/api/v1/benchmarks/{benchmark_id}/profiles/{profile_id}/{artifact}")
    def benchmark_profile_artifact(
        benchmark_id: str,
        profile_id: Literal["whisper-turbo", "whisper-detailed", "qwen-fast", "qwen-quality"],
        artifact: Literal["transcript", "metrics", "events", "telemetry"],
    ):
        try:
            payload = verified_profile_bytes(data_root, benchmark_id, profile_id, artifact)
        except BenchmarkEvidenceError as exc:
            return error(str(exc), 409, False)
        if artifact == "telemetry":
            try:
                return JSONResponse(
                    telemetry_summary_from_bytes(payload),
                    headers={"Cache-Control": "no-store"},
                )
            except BenchmarkEvidenceError as exc:
                return error(str(exc), 409, False)
        media_type = "application/x-ndjson" if artifact == "events" else "application/json"
        return Response(content=payload, media_type=media_type, headers={"Cache-Control": "no-store"})

    @app.get("/api/v1/benchmarks/{benchmark_id}/export")
    def benchmark_export(benchmark_id: str):
        try:
            payload = private_export_zip(data_root, benchmark_id)
        except (BenchmarkEvidenceError, BenchmarkQualityError) as exc:
            return error(str(exc), 409, False)
        return Response(
            content=payload,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="TDA-Benchmark-{benchmark_id}.zip"',
                "Cache-Control": "no-store",
            },
        )

    @app.get("/api/v1/benchmarks/{benchmark_id}/reference")
    def benchmark_reference(benchmark_id: str):
        try:
            value = benchmark_reference_private(data_root, benchmark_id)
        except (BenchmarkEvidenceError, BenchmarkQualityError) as exc:
            return error(str(exc), 409, False)
        return {"reference": value}

    @app.post("/api/v1/benchmarks/{benchmark_id}/reference")
    def benchmark_reference_save(benchmark_id: str, body: BenchmarkReferenceRequest):
        try:
            return save_benchmark_reference(data_root, benchmark_id, body.model_dump())
        except BenchmarkQualityError as exc:
            code = str(exc)
            return error(code, 409 if code.endswith("CONFLICT") else 422, False)
        except BenchmarkEvidenceError as exc:
            return error(str(exc), 409, False)

    @app.get("/api/v1/benchmarks/{benchmark_id}/quality")
    def benchmark_quality(benchmark_id: str):
        try:
            return benchmark_quality_summary(data_root, benchmark_id)
        except (BenchmarkEvidenceError, BenchmarkQualityError) as exc:
            return error(str(exc), 409, False)

    @app.get("/api/v1/jobs/{job_id}")
    def job(job_id: str):
        return store.get(job_id)

    def repair_run_target(source_id: str, run_id: str):
        with source_gate:
            package_root, package = staged_package(source_id, verify_tracks=False)
            manifest = load_run(package_root, run_id, verify_content=True)
            if not transcription_run_visible(package_root, manifest):
                raise PublicationTargetError("PUBLICATION_TARGET_RUN_NOT_VISIBLE")
            try:
                origin_job = store.get(manifest["job_id"])
            except KeyError:
                origin_job = None
            return repair_publication_target(
                package_root, run_id, job=origin_job,
                body=store.body(manifest["job_id"]) if origin_job else None,
                result=store.result(manifest["job_id"]) if origin_job else None,
                source_sha256=package.source_sha256, track_count=len(package.tracks),
            )

    @app.post("/api/v1/sources/{source_id}/runs/{run_id}/publication-target/repair")
    def repair_target(source_id: str, run_id: str):
        try:
            return {"publication_target": repair_run_target(source_id, run_id)}
        except (PublicationTargetError, TranscriptionRunError, CraigPackageError) as exc:
            public_code = {
                "PUBLICATION_TARGET_PROVENANCE_UNAVAILABLE": "PUBLICATION_TARGET_PROVENANCE_UNAVAILABLE",
                "PUBLICATION_TARGET_PROVENANCE_MISMATCH": "PUBLICATION_TARGET_PROVENANCE_MISMATCH",
                "PUBLICATION_TARGET_ORIGIN_CONFLICT": "PUBLICATION_TARGET_ORIGIN_CONFLICT",
                "PUBLICATION_TARGET_CONFLICT": "PUBLICATION_TARGET_CONFLICT",
                "PUBLICATION_TARGET_RUN_NOT_VISIBLE": "PUBLICATION_TARGET_RUN_NOT_VISIBLE",
            }.get(str(exc), "PUBLICATION_TARGET_REPAIR_FAILED")
            return error(public_code, 409, False)

    @app.post("/api/v1/jobs/{job_id}/{action}")
    async def action(job_id: str, action: Literal["cancel", "retry", "delete"]):
        if action == "delete":
            if active_worker_is(job_id):
                raise Conflict("JOB_ACTIVE")
            with source_gate:
                current = store.get(job_id)
                body = store.body(job_id)
                if current["status"] == "succeeded" and body.get("kind") == "transcription.craig":
                    try:
                        result = store.result(job_id)
                        repair_run_target(body["source_id"], result["transcription"]["run_id"])
                    except (PublicationTargetError, TranscriptionRunError, CraigPackageError, KeyError) as exc:
                        raise Conflict("PUBLICATION_TARGET_CLEANUP_BLOCKED") from exc
                return store.remove(job_id)
        if action == "retry":
            body = store.body(job_id)
            if body.get("kind") == "transcription.craig":
                async with dispatch_gate:
                    await asyncio.to_thread(reconcile_completed_transcription_runs)
                    current = store.get(job_id)
                    if current["status"] == "succeeded":
                        return current
                    value = store.action(job_id, action)
            else:
                value = store.action(job_id, action)
            worker_wake.set()
            return value
        if action == "cancel":
            current = store.get(job_id)
            if current["status"] == "cancelled":
                return current
            body = store.body(job_id)
            if (
                current["status"] == "running"
                and body.get("kind") == "transcription.craig"
            ):
                attempt = current.get("attempt")
                if isinstance(attempt, bool) or not isinstance(attempt, int) or attempt < 1:
                    raise Conflict("ATTEMPT_FENCE_ATTEMPT_INVALID")
                winner = await asyncio.to_thread(
                    claim_cancel_under_source_gate,
                    str(body["source_id"]),
                    job_id,
                    attempt,
                )
                if winner == "commit":
                    latest = store.get(job_id)
                    if latest["status"] == "succeeded":
                        raise Conflict("JOB_TERMINAL")
                    raise Conflict("JOB_COMMIT_IN_PROGRESS")
            value = store.action(job_id, action)
            signal_active_worker_cancel(job_id)
            return value
        return store.action(job_id, action)

    @app.get("/api/v1/jobs/{job_id}/activity")
    def activity(
        job_id: str,
        attempt: Annotated[int | None, Query(ge=1)] = None,
    ):
        return store.activity(job_id, attempt=attempt)

    @app.get("/api/v1/jobs/{job_id}/events")
    def events(
        job_id: str,
        after_seq: Annotated[int | None, Query(ge=0)] = None,
        before_seq: Annotated[int | None, Query(ge=0)] = None,
        limit: Annotated[int, Query(ge=1, le=200)] = 100,
    ):
        if after_seq is not None and before_seq is not None:
            return error("INVALID_REQUEST", 422)
        return store.events_page(
            job_id,
            after_seq=after_seq,
            before_seq=before_seq,
            limit=limit,
        )

    @app.get("/api/v1/jobs/{job_id}/result")
    def result(job_id: str):
        value = store.result(job_id)
        transcription = value.get("transcription") if isinstance(value, dict) else None
        if not isinstance(transcription, dict):
            return value

        body = store.body(job_id)
        job_state = store.get(job_id)
        run_id = transcription.get("run_id")
        digest = transcription.get("sha256")
        attempt = job_state.get("attempt")
        if (
            not isinstance(run_id, str)
            or not isinstance(digest, str)
            or isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or attempt < 1
            or run_id != run_id_for(job_id, attempt)
        ):
            raise Conflict("RESULT_ARTIFACT_MISMATCH")
        try:
            with source_gate:
                package_root, package = staged_package(
                    body["source_id"],
                    verify_tracks=False,
                )
                manifest = load_run(package_root, run_id, verify_content=True)
        except (KeyError, CraigPackageError, TranscriptionRunError, ValueError) as exc:
            raise Conflict("RESULT_ARTIFACT_UNAVAILABLE") from exc

        if (
            manifest.get("job_id") != job_id
            or manifest.get("attempt") != attempt
            or manifest.get("source_id") != body.get("source_id")
            or manifest.get("source_sha256") != package.source_sha256
            or manifest.get("profile_id") != body.get("profile_id")
            or manifest.get("artifact") != "transcript.json"
            or manifest.get("transcript_sha256") != digest
            or manifest.get("context_sha256") != _sha256_text(body.get("context"))
            or manifest.get("glossary_sha256") != _sha256_text(body.get("glossary"))
            or not isinstance(manifest.get("stats"), dict)
            or manifest["stats"].get("track_count") != body.get("units")
            or len(package.tracks) != body.get("units")
        ):
            raise Conflict("RESULT_ARTIFACT_MISMATCH")
        return value

    return app
