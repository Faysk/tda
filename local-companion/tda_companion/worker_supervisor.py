from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .asr_runtime import current_whisper_worker
from .qwen_physical_gate import inspect_qwen_physical_gate
from .qwen_runtime import current_qwen_worker
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


def default_worker_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--worker"]
    return [sys.executable, "-m", "tda_companion.asr_worker"]


class WorkerSupervisor:
    """Supervise one heavy local worker without loading model code into FastAPI."""

    def __init__(
        self,
        *,
        command_factory: Callable[[], list[str]] = default_worker_command,
        startup_timeout: float = 10.0,
        heartbeat_timeout: float = 30.0,
        cancel_grace: float = 5.0,
        data_root: Path | None = None,
        models_root: Path | None = None,
        runtime_root: Path | None = None,
        state_root: Path | None = None,
    ):
        self.command_factory = command_factory
        self.startup_timeout = startup_timeout
        self.heartbeat_timeout = heartbeat_timeout
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
            except (OSError, UnicodeError, ValueError):
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
                if ready and not cancel_sent and now - last_message > self.heartbeat_timeout:
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

                if message.type == "ready":
                    ready = True
                    if on_event is not None:
                        on_event(message)
                elif message.type == "progress":
                    on_progress(message)
                elif message.type in {"stage", "event", "heartbeat"}:
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
        on_progress: Callable[[WorkerMessage], object],
        on_event: Callable[[WorkerMessage], object] | None = None,
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
        if profile_id.startswith("whisper-"):
            if self.runtime_root is None:
                raise WorkerProcessError("WHISPER_RUNTIME_UNCONFIGURED")
            worker = current_whisper_worker(self.runtime_root)
            if worker is None:
                raise WorkerProcessError("WHISPER_RUNTIME_UNAVAILABLE")
            runtime_command = [str(worker)]
            runtime_environment = {
                "TDA_ASR_RUNTIME_FAMILY": "whisper",
                "TDA_ASR_RUNTIME_VERSION": worker.parent.name,
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
            worker = current_qwen_worker(self.runtime_root, verify_worker=False)
            if worker is None:
                raise WorkerProcessError("QWEN_RUNTIME_UNAVAILABLE")
            runtime_command = [str(worker)]
            runtime_environment = {
                "TDA_ASR_RUNTIME_FAMILY": "qwen",
                "TDA_ASR_RUNTIME_VERSION": worker.parent.name,
            }

        if is_cancelled is not None and is_cancelled():
            return WorkerOutcome(
                terminal="cancelled",
                payload={"stage": "cancelled_before_worker_launch", "forced": False},
                returncode=0,
            )

        return self._run_command(
            worker_command,
            on_progress=on_progress,
            on_event=on_event,
            is_cancelled=is_cancelled,
            process_command=runtime_command,
            environment_overrides=runtime_environment,
        )
