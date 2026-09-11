from __future__ import annotations

import hashlib
import sys
import threading
import time
from typing import BinaryIO, TextIO

from .worker_protocol import (
    MAX_LINE_BYTES,
    WorkerCancelCommand,
    WorkerMessage,
    WorkerProtocolError,
    WorkerRunCommand,
)


class _Emitter:
    def __init__(self, stream: TextIO, command: WorkerRunCommand):
        self.stream = stream
        self.command = command
        self.seq = 0
        self.lock = threading.Lock()

    def emit(self, type: str, payload: dict | None = None) -> None:
        with self.lock:
            message = WorkerMessage.create(
                job_id=self.command.job_id,
                attempt=self.command.attempt,
                seq=self.seq,
                type=type,
                payload=payload,
            )
            self.seq += 1
            self.stream.write(message.encode())
            self.stream.flush()


def _read_bounded_line(stream: BinaryIO) -> bytes:
    line = stream.readline(MAX_LINE_BYTES + 1)
    if len(line) > MAX_LINE_BYTES:
        raise WorkerProtocolError("WORKER_LINE_TOO_LARGE")
    return line


def _watch_cancel(stream: BinaryIO, command: WorkerRunCommand, cancelled: threading.Event) -> None:
    try:
        while not cancelled.is_set():
            line = _read_bounded_line(stream)
            if not line:
                return
            value = WorkerCancelCommand.decode(line)
            if value.job_id == command.job_id and value.attempt == command.attempt:
                cancelled.set()
                return
    except (OSError, ValueError, WorkerProtocolError):
        # Parent owns lifecycle. Invalid/closed control input cannot leak details
        # or keep a heavy worker alive indefinitely.
        return


def _run_fixture(command: WorkerRunCommand, emitter: _Emitter, cancelled: threading.Event) -> int:
    units = int(command.payload["units"])
    completed = int(command.payload.get("completed", 0))
    emitter.emit("ready", {"kind": command.kind})
    emitter.emit("stage", {"stage": "fixture", "label": "Synthetic fixture"})

    for current in range(completed + 1, units + 1):
        if cancelled.is_set():
            emitter.emit("cancelled", {"completed": current - 1, "total": units})
            return 0

        # Deterministic CPU work proves that the child, not FastAPI, executes the
        # unit. Real ASR adapters will replace this with model inference.
        hashlib.sha256(f"{command.job_id}:{command.attempt}:{current}".encode("utf-8")).digest()
        emitter.emit(
            "progress",
            {"completed": current, "total": units, "unit": "items", "stage": "fixture"},
        )
        emitter.emit("heartbeat", {"completed": current})
        # Keep the fixture fast but leave a real scheduling point so cooperative
        # cancellation is exercised instead of being a theoretical protocol path.
        time.sleep(0.002)

    emitter.emit("result", {"kind": command.kind, "units": units})
    return 0


def run_worker_stdio(
    stdin: BinaryIO | None = None,
    stdout: TextIO | None = None,
) -> int:
    input_stream = stdin or getattr(sys.stdin, "buffer", None)
    output_stream = stdout or sys.stdout
    if input_stream is None or output_stream is None:
        return 70

    try:
        command_line = _read_bounded_line(input_stream)
        if not command_line:
            return 64
        command = WorkerRunCommand.decode(command_line)
    except WorkerProtocolError:
        return 64

    emitter = _Emitter(output_stream, command)
    cancelled = threading.Event()
    watcher = threading.Thread(
        target=_watch_cancel,
        args=(input_stream, command, cancelled),
        name="tda-worker-control",
        daemon=True,
    )
    watcher.start()

    try:
        if command.kind == "synthetic.fixture":
            return _run_fixture(command, emitter, cancelled)
        emitter.emit("error", {"code": "WORKER_KIND_UNSUPPORTED", "recoverable": False})
        return 65
    except BaseException:
        # Never serialize exception text, paths, prompts or model output onto the
        # protocol. The Agent receives a stable diagnostic code only.
        try:
            emitter.emit("error", {"code": "WORKER_EXECUTION_FAILED", "recoverable": True})
        except BaseException:
            pass
        return 70
    finally:
        # A daemon thread blocked in BufferedReader during interpreter shutdown can
        # abort CPython. Close its local control stream and join before returning.
        cancelled.set()
        try:
            input_stream.close()
        except (OSError, ValueError):
            pass
        watcher.join(timeout=1.0)


def main() -> int:
    return run_worker_stdio()


if __name__ == "__main__":
    raise SystemExit(main())
