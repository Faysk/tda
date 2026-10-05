from __future__ import annotations

import os
import json
import queue
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .asr_runtime import inspect_whisper_runtime
from .benchmark_bundles import BENCHMARK_PROFILES, benchmark_id_for
from .benchmark_diagnostics import BenchmarkDiagnosticsError, BenchmarkProfileDiagnostics
from .qwen_physical_gate import inspect_qwen_physical_gate
from .qwen_runtime import inspect_qwen_runtime
from .runtime_artifact import RUNTIME_ARTIFACT_ENV, runtime_artifact
from .runtime_compat import (
    qwen_runtime_benchmark_compatible,
    whisper_runtime_benchmark_compatible,
)
from .worker_protocol import (
    MAX_LINE_BYTES,
    WorkerCancelCommand,
    WorkerMessage,
    WorkerProtocolError,
    WorkerRunCommand,
)


class WorkerProcessError(RuntimeError):
    def __init__(self, code: str, *, recoverable: bool = True):
        super().__init__(code)
        self.code = code
        self.recoverable = recoverable


@dataclass(frozen=True)
class WorkerOutcome:
    terminal: str
    payload: dict
    returncode: int


_BENCHMARK_PROFILE_LOCAL_FAILURES = frozenset(
    {
        # Signal-bearing audio that Qwen cannot recognize remains a real failed
        # profile, but it does not invalidate the shared source or independent
        # later profiles in the same benchmark attempt.
        "QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN",
    }
)


def _benchmark_profile_failure_is_local(exc: WorkerProcessError) -> bool:
    return exc.recoverable and exc.code in _BENCHMARK_PROFILE_LOCAL_FAILURES


def default_worker_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--worker"]
    return [sys.executable, "-m", "tda_companion.asr_worker"]


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def _benchmark_profile_evidence_valid(
    receipt: dict,
    profile_id: str,
    *,
    benchmark_id: str,
    sample_identity_sha256: str,
) -> bool:
    lineage = receipt.get("execution_lineage")
    if not isinstance(lineage, dict) or lineage.get("schema_version") != "tda_execution_lineage_v1":
        return False
    expected_family = "whisper" if profile_id.startswith("whisper-") else "qwen"
    expected_runtime_id = (
        "whisper-ctranslate2" if expected_family == "whisper" else "qwen3-transformers"
    )
    runtime_version = lineage.get("runtime_version")
    runtime_is_benchmark_compatible = (
        whisper_runtime_benchmark_compatible(runtime_version)
        if expected_family == "whisper" and isinstance(runtime_version, str)
        else qwen_runtime_benchmark_compatible(runtime_version)
        if expected_family == "qwen" and isinstance(runtime_version, str)
        else False
    )
    artifact = lineage.get("runtime_artifact")
    gpu = lineage.get("gpu")
    device = lineage.get("device")
    return (
        receipt.get("profile_id") == profile_id
        and receipt.get("benchmark_id") == benchmark_id
        and receipt.get("sample_identity_sha256") == sample_identity_sha256
        and receipt.get("artifact_available") is True
        and _is_sha256(receipt.get("transcript_sha256"))
        and isinstance(receipt.get("transcript_size_bytes"), int)
        and not isinstance(receipt.get("transcript_size_bytes"), bool)
        and receipt["transcript_size_bytes"] > 0
        and receipt.get("sample_seconds") == 300.0
        and lineage.get("runtime_family") == expected_family
        and isinstance(runtime_version, str)
        and runtime_is_benchmark_compatible
        and isinstance(artifact, dict)
        and artifact.get("runtime_id") == expected_runtime_id
        and artifact.get("version") == runtime_version
        and _is_sha256(artifact.get("worker_sha256"))
        and _is_sha256(artifact.get("archive_sha256"))
        and isinstance(device, str)
        and device.casefold().startswith("cuda")
        and isinstance(gpu, dict)
        and gpu.get("vendor") == "NVIDIA"
        and isinstance(gpu.get("model"), str)
        and bool(str(gpu.get("model")).strip())
    )


class WorkerSupervisor:
    """Supervise one heavy local worker without loading model code into FastAPI."""

    def __init__(
        self,
        *,
        command_factory: Callable[[], list[str]] = default_worker_command,
        startup_timeout: float = 10.0,
        heartbeat_timeout: float = 30.0,
        runtime_bootstrap_timeout: float = 120.0,
        model_load_timeout: float = 300.0,
        cancel_grace: float = 5.0,
        data_root: Path | None = None,
        models_root: Path | None = None,
        runtime_root: Path | None = None,
        state_root: Path | None = None,
    ):
        self.command_factory = command_factory
        self.startup_timeout = startup_timeout
        self.heartbeat_timeout = heartbeat_timeout
        self.runtime_bootstrap_timeout = runtime_bootstrap_timeout
        self.model_load_timeout = model_load_timeout
        self.cancel_grace = cancel_grace
        self.data_root = data_root.resolve() if data_root is not None else None
        self.models_root = models_root.resolve() if models_root is not None else None
        self.runtime_root = (
            runtime_root.resolve()
            if runtime_root is not None
            else self.data_root.parent / "Runtime"
            if self.data_root is not None
            else None
        )
        self.state_root = (
            state_root.resolve()
            if state_root is not None
            else self.data_root.parent / "State"
            if self.data_root is not None
            else None
        )

    @staticmethod
    def _creationflags() -> int:
        if os.name != "nt":
            return 0
        return subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP

    @staticmethod
    def _drain_stderr(stream) -> None:
        try:
            while stream.read(8192):
                pass
        except (OSError, ValueError):
            pass

    @staticmethod
    def _stop_process(process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        try:
            process.terminate()
            process.wait(timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            try:
                process.kill()
            except OSError:
                pass
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass

    def _environment(
        self,
        overrides: dict[str, str] | None = None,
    ) -> dict[str, str]:
        environment = os.environ.copy()
        if self.data_root is not None:
            environment["TDA_WORKER_DATA_ROOT"] = str(self.data_root)
        if self.models_root is not None:
            environment["TDA_WORKER_MODELS_ROOT"] = str(self.models_root)
        if overrides:
            environment.update(overrides)
        return environment

    def _run_command(
        self,
        command: WorkerRunCommand,
        *,
        on_progress: Callable[[WorkerMessage], object],
        on_event: Callable[[WorkerMessage], object] | None = None,
        on_message: Callable[[WorkerMessage], object] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
        process_command: list[str] | None = None,
        environment_overrides: dict[str, str] | None = None,
    ) -> WorkerOutcome:
        encoded_command = command.encode()
        executable_command = process_command or self.command_factory()
        if not executable_command or not all(isinstance(item, str) and item for item in executable_command):
            raise WorkerProcessError("WORKER_COMMAND_INVALID")
        process = subprocess.Popen(
            executable_command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="strict",
            bufsize=1,
            close_fds=True,
            creationflags=self._creationflags(),
            env=self._environment(environment_overrides),
        )
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None

        stdout_overflow = object()
        stdout_decode_error = object()
        lines: queue.Queue[object] = queue.Queue()
        stdout_done = threading.Event()

        def read_stdout() -> None:
            try:
                while True:
                    line = process.stdout.readline(MAX_LINE_BYTES + 1)
                    if not line:
                        break
                    if len(line) > MAX_LINE_BYTES or not line.endswith("\n"):
                        lines.put(stdout_overflow)
                        return
                    lines.put(line)
            except UnicodeError:
                lines.put(stdout_decode_error)
            except (OSError, ValueError):
                pass
            finally:
                # Queue EOF before publishing the done flag. Once stdout_done is
                # visible, every preceding line (and the sentinel) is already
                # available to the supervisor and cannot be lost to poll/empty race.
                lines.put(None)
                stdout_done.set()

        reader = threading.Thread(target=read_stdout, name="tda-worker-stdout", daemon=True)
        stderr_reader = threading.Thread(
            target=self._drain_stderr,
            args=(process.stderr,),
            name="tda-worker-stderr",
            daemon=True,
        )
        reader.start()
        stderr_reader.start()

        ready = False
        previous_seq: int | None = None
        last_message = time.monotonic()
        started = last_message
        cancel_sent = False
        cancel_deadline: float | None = None
        terminal: WorkerMessage | None = None
        active_stage: str | None = None
        stage_started: float | None = None

        try:
            process.stdin.write(encoded_command)
            process.stdin.flush()

            while terminal is None:
                now = time.monotonic()
                if is_cancelled is not None and is_cancelled() and not cancel_sent:
                    try:
                        process.stdin.write(
                            WorkerCancelCommand(
                                job_id=command.job_id,
                                attempt=command.attempt,
                            ).encode()
                        )
                        process.stdin.flush()
                    except (BrokenPipeError, OSError, ValueError):
                        # The child may have closed stdin after already producing a
                        # terminal stdout message. Keep draining stdout instead of
                        # turning a cancel-vs-exit race into a false worker failure.
                        pass
                    cancel_sent = True
                    cancel_deadline = now + self.cancel_grace

                if not ready and not cancel_sent and now - started > self.startup_timeout:
                    raise WorkerProcessError("WORKER_START_TIMEOUT")
                if cancel_deadline is not None and now > cancel_deadline:
                    # Cancellation is a user-requested terminal state, not a worker
                    # failure. Heavy native/CUDA code may not return to Python in
                    # time to acknowledge stdin, so force-stop the isolated worker
                    # after a short grace period and preserve truthful cancellation.
                    self._stop_process(process)
                    return WorkerOutcome(
                        terminal="cancelled",
                        payload={"stage": "forced_termination", "forced": True},
                        returncode=process.returncode if process.returncode is not None else -1,
                    )
                # Once cancellation was accepted by the supervisor, heartbeat
                # expiry must not race it into a false worker failure. Native/CUDA
                # code can remain inside an uninterruptible call until the grace
                # deadline, at which point the isolated process is force-stopped.
                if (
                    ready
                    and not cancel_sent
                    and active_stage == "runtime_bootstrap"
                    and stage_started is not None
                    and now - stage_started > self.runtime_bootstrap_timeout
                ):
                    raise WorkerProcessError("WORKER_RUNTIME_BOOTSTRAP_TIMEOUT")
                if (
                    ready
                    and not cancel_sent
                    and active_stage == "model_load"
                    and stage_started is not None
                    and now - stage_started > self.model_load_timeout
                ):
                    raise WorkerProcessError("WORKER_MODEL_LOAD_TIMEOUT")
                if (
                    ready
                    and not cancel_sent
                    and active_stage != "runtime_bootstrap"
                    and now - last_message > self.heartbeat_timeout
                ):
                    raise WorkerProcessError("WORKER_HEARTBEAT_TIMEOUT")

                try:
                    line = lines.get(timeout=0.1)
                except queue.Empty:
                    if (
                        process.poll() is not None
                        and stdout_done.is_set()
                        and lines.empty()
                    ):
                        break
                    continue
                if line is None:
                    if process.poll() is not None:
                        break
                    continue
                if line is stdout_overflow:
                    raise WorkerProcessError(
                        "WORKER_LINE_SIZE_INVALID",
                        recoverable=False,
                    )
                if line is stdout_decode_error:
                    raise WorkerProcessError(
                        "WORKER_STDOUT_ENCODING_INVALID",
                        recoverable=False,
                    )
                if not isinstance(line, str):
                    raise WorkerProcessError(
                        "WORKER_PROTOCOL_INVALID",
                        recoverable=False,
                    )

                try:
                    message = WorkerMessage.decode(
                        line,
                        expected_job_id=command.job_id,
                        expected_attempt=command.attempt,
                        previous_seq=previous_seq,
                    )
                except WorkerProtocolError as exc:
                    raise WorkerProcessError(
                        str(exc),
                        recoverable=False,
                    ) from None
                expected_seq = 0 if previous_seq is None else previous_seq + 1
                if message.seq != expected_seq:
                    raise WorkerProcessError(
                        "WORKER_SEQUENCE_GAP",
                        recoverable=False,
                    )
                previous_seq = message.seq
                last_message = time.monotonic()

                if not ready and message.type != "ready":
                    raise WorkerProcessError(
                        "WORKER_READY_REQUIRED",
                        recoverable=False,
                    )
                if message.type == "ready" and ready:
                    raise WorkerProcessError(
                        "WORKER_READY_REPLAY",
                        recoverable=False,
                    )
                if on_message is not None:
                    on_message(message)
                if message.type == "ready":
                    ready = True
                    if on_event is not None:
                        on_event(message)
                elif message.type == "progress":
                    on_progress(message)
                elif message.type in {"stage", "event", "heartbeat"}:
                    if message.type == "stage":
                        next_stage = str(message.payload.get("stage") or "")
                        if next_stage and next_stage != active_stage:
                            active_stage = next_stage
                            stage_started = last_message
                    if on_event is not None:
                        on_event(message)
                elif message.type == "error":
                    code = str(message.payload.get("code") or "WORKER_EXECUTION_FAILED")
                    recoverable = message.payload.get("recoverable", True)
                    raise WorkerProcessError(code, recoverable=bool(recoverable))
                elif message.type in {"result", "cancelled"}:
                    terminal = message

            try:
                process.stdin.close()
            except OSError:
                pass
            try:
                returncode = process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                if terminal is not None and terminal.type in {"cancelled", "result"}:
                    # A terminal message is emitted only after the worker has
                    # completed its durable work for that outcome. Native/CUDA or
                    # interpreter teardown can still hang afterwards; force-stop
                    # the isolated process without rewriting a confirmed result
                    # or cancellation into a false failure.
                    self._stop_process(process)
                    payload = dict(terminal.payload)
                    if terminal.type == "cancelled":
                        payload["forced"] = True
                        payload.setdefault("stage", "forced_termination_after_ack")
                    else:
                        payload["forced_teardown"] = True
                    return WorkerOutcome(
                        terminal=terminal.type,
                        payload=payload,
                        returncode=process.returncode if process.returncode is not None else -1,
                    )
                raise WorkerProcessError("WORKER_EXIT_TIMEOUT") from None

            if terminal is None:
                if cancel_sent:
                    return WorkerOutcome(
                        terminal="cancelled",
                        payload={"stage": "worker_exit_after_cancel", "forced": False},
                        returncode=returncode,
                    )
                raise WorkerProcessError("WORKER_EXITED_WITHOUT_RESULT")
            if terminal.type == "result" and returncode != 0:
                raise WorkerProcessError("WORKER_NONZERO_EXIT")
            return WorkerOutcome(terminal=terminal.type, payload=terminal.payload, returncode=returncode)
        except BaseException:
            self._stop_process(process)
            raise
        finally:
            try:
                process.stdin.close()
            except (OSError, ValueError):
                pass
            try:
                process.stdout.close()
                process.stderr.close()
            except (OSError, ValueError):
                pass

    def run_fixture(
        self,
        *,
        job_id: str,
        attempt: int,
        units: int,
        completed: int,
        on_progress: Callable[[WorkerMessage], object],
        on_event: Callable[[WorkerMessage], object] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> WorkerOutcome:
        return self._run_command(
            WorkerRunCommand(
                job_id=job_id,
                attempt=attempt,
                kind="synthetic.fixture",
                payload={"units": units, "completed": completed},
            ),
            on_progress=on_progress,
            on_event=on_event,
            is_cancelled=is_cancelled,
        )

    def run_craig(
        self,
        *,
        job_id: str,
        attempt: int,
        source_id: str,
        profile_id: str,
        glossary: str,
        context: str,
        cpu: bool,
        include_bot_tracks: bool = False,
        benchmark_sample_seconds: float | None = None,
        on_progress: Callable[[WorkerMessage], object],
        on_event: Callable[[WorkerMessage], object] | None = None,
        on_message: Callable[[WorkerMessage], object] | None = None,
        on_runtime_artifact: Callable[[dict | None], object] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> WorkerOutcome:
        if self.data_root is None or self.models_root is None:
            raise WorkerProcessError("WORKER_ASR_ROOTS_UNCONFIGURED")

        worker_command = WorkerRunCommand(
            job_id=job_id,
            attempt=attempt,
            kind="transcription.craig",
            payload={
                "source_id": source_id,
                "profile_id": profile_id,
                "glossary": glossary,
                "context": context,
                "cpu": cpu,
                "include_bot_tracks": include_bot_tracks,
                **(
                    {
                        "benchmark_mode": True,
                        "benchmark_sample_seconds": benchmark_sample_seconds,
                    }
                    if benchmark_sample_seconds is not None
                    else {}
                ),
            },
        )
        # Validate all user-derived identifiers before consulting runtime state.
        # Invalid source/profile input must not cause worker lookup or filesystem activity.
        worker_command.encode()
        if is_cancelled is not None and is_cancelled():
            return WorkerOutcome(
                terminal="cancelled",
                payload={"stage": "cancelled_before_runtime", "forced": False},
                returncode=0,
            )

        runtime_command = None
        runtime_environment: dict[str, str] | None = None
        runtime_artifact_identity: dict | None = None
        if profile_id.startswith("whisper-"):
            if self.runtime_root is None:
                raise WorkerProcessError("WHISPER_RUNTIME_UNCONFIGURED")
            state = inspect_whisper_runtime(self.runtime_root, verify_worker=False)
            worker_value = state.get("worker")
            if state.get("status") != "ready" or not isinstance(worker_value, str):
                raise WorkerProcessError("WHISPER_RUNTIME_UNAVAILABLE")
            if benchmark_sample_seconds is not None:
                runtime_version = state.get("version")
                if (
                    not isinstance(runtime_version, str)
                    or not whisper_runtime_benchmark_compatible(runtime_version)
                ):
                    raise WorkerProcessError("WHISPER_BENCHMARK_RUNTIME_REQUIRED")
            worker = Path(worker_value)
            artifact = runtime_artifact(state, family="whisper", version=worker.parent.name)
            if artifact is None:
                raise WorkerProcessError("ASR_RUNTIME_IDENTITY_INVALID")
            runtime_artifact_identity = artifact
            runtime_command = [str(worker)]
            runtime_environment = {
                "TDA_ASR_RUNTIME_FAMILY": "whisper",
                "TDA_ASR_RUNTIME_VERSION": artifact["version"],
                RUNTIME_ARTIFACT_ENV: json.dumps(artifact, sort_keys=True, separators=(",", ":")),
            }
        elif profile_id.startswith("qwen-"):
            if self.runtime_root is None or self.state_root is None:
                raise WorkerProcessError("QWEN_RUNTIME_UNCONFIGURED")
            # The physical gate already performed full byte hashing before it
            # sealed this runtime/model/aligner binding. Re-hashing gigabytes on
            # every job made JOB_CLAIMED look hung and added no new trust event.
            # Normal dispatch validates the sealed identities only; diagnostics
            # and gate recording retain full-content verification.
            gate = inspect_qwen_physical_gate(
                self.state_root,
                self.runtime_root,
                self.models_root,
                profile_id=profile_id,
                verify_model_content=False,
            )
            if gate.get("ready") is not True:
                raise WorkerProcessError("QWEN_PHYSICAL_ACCEPTANCE_REQUIRED")
            state = inspect_qwen_runtime(self.runtime_root, verify_worker=False)
            worker_value = state.get("worker")
            if state.get("status") != "ready" or not isinstance(worker_value, str):
                raise WorkerProcessError("QWEN_RUNTIME_UNAVAILABLE")
            if benchmark_sample_seconds is not None:
                runtime_version = state.get("version")
                if (
                    not isinstance(runtime_version, str)
                    or not qwen_runtime_benchmark_compatible(runtime_version)
                ):
                    raise WorkerProcessError("QWEN_BENCHMARK_RUNTIME_REQUIRED")
            worker = Path(worker_value)
            artifact = runtime_artifact(state, family="qwen", version=worker.parent.name)
            if artifact is None or artifact != gate.get("runtime_artifact"):
                raise WorkerProcessError("ASR_RUNTIME_IDENTITY_INVALID")
            runtime_artifact_identity = artifact
            runtime_command = [str(worker)]
            runtime_environment = {
                "TDA_ASR_RUNTIME_FAMILY": "qwen",
                "TDA_ASR_RUNTIME_VERSION": artifact["version"],
                RUNTIME_ARTIFACT_ENV: json.dumps(artifact, sort_keys=True, separators=(",", ":")),
            }

        if is_cancelled is not None and is_cancelled():
            return WorkerOutcome(
                terminal="cancelled",
                payload={"stage": "cancelled_before_worker_launch", "forced": False},
                returncode=0,
            )

        if on_runtime_artifact is not None:
            on_runtime_artifact(runtime_artifact_identity)

        # Preserve compatibility with tests/specialized supervisors that override
        # the historical _run_command signature. The message observer is opt-in.
        if on_message is None:
            return self._run_command(
                worker_command,
                on_progress=on_progress,
                on_event=on_event,
                is_cancelled=is_cancelled,
                process_command=runtime_command,
                environment_overrides=runtime_environment,
            )
        return self._run_command(
            worker_command,
            on_progress=on_progress,
            on_event=on_event,
            on_message=on_message,
            is_cancelled=is_cancelled,
            process_command=runtime_command,
            environment_overrides=runtime_environment,
        )

    def run_benchmark(
        self,
        *,
        job_id: str,
        attempt: int,
        source_id: str,
        glossary: str,
        context: str,
        sample_identity_sha256: str,
        sample_seconds: float,
        on_progress: Callable[[WorkerMessage], object],
        on_event: Callable[[WorkerMessage], object] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> WorkerOutcome:
        profiles = BENCHMARK_PROFILES
        benchmark_id = benchmark_id_for(job_id, attempt)
        receipts: list[dict] = []
        profile_outcomes: list[dict] = []

        def commit_attempted_progress(index: int) -> None:
            on_progress(
                WorkerMessage.create(
                    job_id=job_id,
                    attempt=attempt,
                    seq=index - 1,
                    type="progress",
                    payload={
                        # Queue progress counts attempted benchmark profiles. The
                        # partial-result contract carries successful/failed counts
                        # separately so a failed profile is never called success.
                        "completed": index,
                        "total": len(profiles),
                        "unit": "profiles",
                        "stage": "benchmark",
                    },
                )
            )

        def emit_profile_event(
            code: str,
            profile_id: str,
            index: int,
            *,
            error_code: str | None = None,
            recoverable: bool | None = None,
            scope: str | None = None,
            continuation: str | None = None,
        ) -> None:
            if on_event is None:
                return
            payload = {
                "code": code,
                "stage": "benchmark",
                "profile": profile_id,
                "attempted_count": index,
                "completed_count": len(receipts),
                "failed_count": sum(
                    1 for item in profile_outcomes if item.get("status") == "failed"
                ),
            }
            if error_code is not None:
                payload.update(
                    {
                        "error_code": error_code,
                        "recoverable": bool(recoverable),
                        "scope": scope or "benchmark",
                        "continuation": continuation or "stop",
                    }
                )
            on_event(
                WorkerMessage.create(
                    job_id=job_id,
                    attempt=attempt,
                    seq=index - 1,
                    type="event",
                    payload=payload,
                )
            )

        for index, profile_id in enumerate(profiles, start=1):
            if is_cancelled is not None and is_cancelled():
                return WorkerOutcome(
                    terminal="cancelled",
                    payload={"stage": "benchmark", "forced": False},
                    returncode=0,
                )

            diagnostics = (
                BenchmarkProfileDiagnostics(
                    data_root=self.data_root,
                    job_id=job_id,
                    attempt=attempt,
                    source_id=source_id,
                    profile_id=profile_id,
                    sample_identity_sha256=sample_identity_sha256,
                    sample_seconds=sample_seconds,
                    context=context,
                    glossary=glossary,
                )
                if self.data_root is not None
                else None
            )
            if diagnostics is not None:
                diagnostics.start()
            emit_profile_event("BENCHMARK_PROFILE_STARTED", profile_id, index)

            try:
                outcome = self.run_craig(
                    job_id=job_id,
                    attempt=attempt,
                    source_id=source_id,
                    profile_id=profile_id,
                    glossary=glossary,
                    context=context,
                    cpu=False,
                    benchmark_sample_seconds=sample_seconds,
                    on_progress=lambda _message: None,
                    on_event=on_event,
                    on_message=diagnostics.observe_message if diagnostics is not None else None,
                    on_runtime_artifact=(
                        diagnostics.bind_runtime_artifact if diagnostics is not None else None
                    ),
                    is_cancelled=is_cancelled,
                )
            except BenchmarkDiagnosticsError as exc:
                if diagnostics is not None:
                    try:
                        diagnostics.finalize(status="failed", error_code=exc.code)
                    except BenchmarkDiagnosticsError:
                        pass
                profile_outcomes.append(
                    {
                        "profile_id": profile_id,
                        "status": "failed",
                        "error": {
                            "code": exc.code,
                            "recoverable": False,
                            "scope": "benchmark",
                        },
                        "artifact_available": False,
                        "continuation": {"decision": "stop", "reason": "benchmark_global"},
                    }
                )
                emit_profile_event(
                    "BENCHMARK_PROFILE_FAILED",
                    profile_id,
                    index,
                    error_code=exc.code,
                    recoverable=False,
                    scope="benchmark",
                    continuation="stop",
                )
                raise WorkerProcessError(exc.code, recoverable=False) from exc
            except WorkerProcessError as exc:
                if diagnostics is not None:
                    try:
                        diagnostics.record_supervisor_terminal(
                            status="failed",
                            code=exc.code,
                            recoverable=exc.recoverable,
                        )
                        diagnostics.finalize(status="failed", error_code=exc.code)
                    except BenchmarkDiagnosticsError as diagnostics_exc:
                        raise WorkerProcessError(
                            diagnostics_exc.code,
                            recoverable=False,
                        ) from exc
                if not _benchmark_profile_failure_is_local(exc):
                    profile_outcomes.append(
                        {
                            "profile_id": profile_id,
                            "status": "failed",
                            "error": {
                                "code": exc.code,
                                "recoverable": exc.recoverable,
                                "scope": "benchmark",
                            },
                            "artifact_available": False,
                            "continuation": {"decision": "stop", "reason": "benchmark_global"},
                        }
                    )
                    emit_profile_event(
                        "BENCHMARK_PROFILE_FAILED",
                        profile_id,
                        index,
                        error_code=exc.code,
                        recoverable=exc.recoverable,
                        scope="benchmark",
                        continuation="stop",
                    )
                    raise
                profile_outcomes.append(
                    {
                        "profile_id": profile_id,
                        "status": "failed",
                        "error": {
                            "code": exc.code,
                            "recoverable": exc.recoverable,
                            "scope": "profile",
                        },
                        "artifact_available": False,
                        "continuation": {
                            "decision": "continue",
                            "reason": "profile_local_allowlist",
                        },
                    }
                )
                emit_profile_event(
                    "BENCHMARK_PROFILE_FAILED",
                    profile_id,
                    index,
                    error_code=exc.code,
                    recoverable=exc.recoverable,
                    scope="profile",
                    continuation="continue",
                )
                commit_attempted_progress(index)
                continue
            except Exception:
                if diagnostics is not None:
                    try:
                        diagnostics.finalize(
                            status="failed",
                            error_code="BENCHMARK_PROFILE_SUPERVISOR_FAILED",
                        )
                    except BenchmarkDiagnosticsError:
                        pass
                profile_outcomes.append(
                    {
                        "profile_id": profile_id,
                        "status": "failed",
                        "error": {
                            "code": "BENCHMARK_PROFILE_SUPERVISOR_FAILED",
                            "recoverable": False,
                            "scope": "benchmark",
                        },
                        "artifact_available": False,
                        "continuation": {"decision": "stop", "reason": "benchmark_global"},
                    }
                )
                emit_profile_event(
                    "BENCHMARK_PROFILE_FAILED",
                    profile_id,
                    index,
                    error_code="BENCHMARK_PROFILE_SUPERVISOR_FAILED",
                    recoverable=False,
                    scope="benchmark",
                    continuation="stop",
                )
                raise

            if outcome.terminal != "result":
                if diagnostics is not None:
                    status = "cancelled" if outcome.terminal == "cancelled" else "failed"
                    diagnostics.finalize(
                        status=status,
                        error_code=(
                            "PROFILE_CANCELLED"
                            if status == "cancelled"
                            else "BENCHMARK_PROFILE_SUPERVISOR_FAILED"
                        ),
                    )
                return outcome

            receipt = dict(outcome.payload)
            worker_diagnostics = receipt.pop("benchmark_diagnostics", None)
            if receipt.get("schema_version") != "tda_benchmark_profile_v1":
                if diagnostics is not None:
                    diagnostics.record_supervisor_terminal(
                        status="failed",
                        code="BENCHMARK_PROFILE_RESULT_INVALID",
                        recoverable=False,
                    )
                    diagnostics.finalize(
                        status="failed",
                        receipt=receipt,
                        error_code="BENCHMARK_PROFILE_RESULT_INVALID",
                    )
                profile_outcomes.append(
                    {
                        "profile_id": profile_id,
                        "status": "failed",
                        "error": {
                            "code": "BENCHMARK_PROFILE_RESULT_INVALID",
                            "recoverable": False,
                            "scope": "benchmark",
                        },
                        "artifact_available": False,
                        "continuation": {"decision": "stop", "reason": "benchmark_global"},
                    }
                )
                emit_profile_event(
                    "BENCHMARK_PROFILE_FAILED",
                    profile_id,
                    index,
                    error_code="BENCHMARK_PROFILE_RESULT_INVALID",
                    recoverable=False,
                    scope="benchmark",
                    continuation="stop",
                )
                raise WorkerProcessError("BENCHMARK_PROFILE_RESULT_INVALID", recoverable=False)
            if not _benchmark_profile_evidence_valid(
                receipt,
                profile_id,
                benchmark_id=benchmark_id,
                sample_identity_sha256=sample_identity_sha256,
            ):
                if diagnostics is not None:
                    diagnostics.record_supervisor_terminal(
                        status="failed",
                        code="BENCHMARK_PROFILE_EVIDENCE_INVALID",
                        recoverable=False,
                    )
                    diagnostics.finalize(
                        status="failed",
                        receipt=receipt,
                        error_code="BENCHMARK_PROFILE_EVIDENCE_INVALID",
                    )
                profile_outcomes.append(
                    {
                        "profile_id": profile_id,
                        "status": "failed",
                        "error": {
                            "code": "BENCHMARK_PROFILE_EVIDENCE_INVALID",
                            "recoverable": False,
                            "scope": "benchmark",
                        },
                        "artifact_available": False,
                        "continuation": {"decision": "stop", "reason": "benchmark_global"},
                    }
                )
                emit_profile_event(
                    "BENCHMARK_PROFILE_FAILED",
                    profile_id,
                    index,
                    error_code="BENCHMARK_PROFILE_EVIDENCE_INVALID",
                    recoverable=False,
                    scope="benchmark",
                    continuation="stop",
                )
                raise WorkerProcessError("BENCHMARK_PROFILE_EVIDENCE_INVALID", recoverable=False)

            if diagnostics is not None:
                try:
                    diagnostics.finalize(
                        status="completed",
                        receipt=receipt,
                        worker_diagnostics=worker_diagnostics,
                    )
                except BenchmarkDiagnosticsError as exc:
                    raise WorkerProcessError(exc.code, recoverable=False) from exc

            receipts.append(receipt)
            profile_outcomes.append(
                {
                    "profile_id": profile_id,
                    "status": "completed",
                    "receipt": receipt,
                    "artifact_available": True,
                }
            )
            emit_profile_event("BENCHMARK_PROFILE_COMPLETED", profile_id, index)
            commit_attempted_progress(index)

        if len(receipts) != len(profiles):
            return WorkerOutcome(
                terminal="partial",
                payload={
                    "schema_version": "tda_processing_benchmark_partial_v1",
                    "kind": "benchmark.craig",
                    "status": "partial",
                    "source_id": source_id,
                    "benchmark_id": benchmark_id,
                    "sample_identity_sha256": sample_identity_sha256,
                    "sample_seconds": sample_seconds,
                    "execution_mode": "prepared_artifacts_fresh_worker_per_profile_v1",
                    "attempted_count": len(profile_outcomes),
                    "completed_count": len(receipts),
                    "failed_count": len(profile_outcomes) - len(receipts),
                    "profiles": profile_outcomes,
                },
                returncode=0,
            )

        return WorkerOutcome(
            terminal="result",
            payload={
                "schema_version": "tda_processing_benchmark_v1",
                "kind": "benchmark.craig",
                "source_id": source_id,
                "benchmark_id": benchmark_id,
                "sample_identity_sha256": sample_identity_sha256,
                "sample_seconds": sample_seconds,
                "execution_mode": "prepared_artifacts_fresh_worker_per_profile_v1",
                "profiles": receipts,
            },
            returncode=0,
        )
