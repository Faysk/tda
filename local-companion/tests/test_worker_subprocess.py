from __future__ import annotations

import subprocess
import sys
import threading
import time

import pytest

import tda_companion.worker_supervisor as supervisor_module
from tda_companion.worker_protocol import (
    WorkerCancelCommand,
    WorkerMessage,
    WorkerProtocolError,
    WorkerRunCommand,
)
from tda_companion.worker_supervisor import WorkerProcessError, WorkerSupervisor


def test_protocol_roundtrip_and_sequence_fence():
    command = WorkerRunCommand(
        job_id="job-123",
        attempt=2,
        kind="synthetic.fixture",
        payload={"units": 3, "completed": 1},
    )
    decoded = WorkerRunCommand.decode(command.encode())
    assert decoded == command

    message = WorkerMessage.create(
        job_id="job-123",
        attempt=2,
        seq=4,
        type="progress",
        payload={"completed": 2, "total": 3, "unit": "items"},
    )
    value = WorkerMessage.decode(
        message.encode(),
        expected_job_id="job-123",
        expected_attempt=2,
        previous_seq=3,
    )
    assert value.payload["completed"] == 2
    with pytest.raises(WorkerProtocolError, match="WORKER_SEQUENCE_REPLAY"):
        WorkerMessage.decode(message.encode(), previous_seq=4)


def test_protocol_rejects_cross_job_and_oversized_input():
    message = WorkerMessage.create(job_id="job-a", attempt=1, seq=0, type="ready")
    with pytest.raises(WorkerProtocolError, match="WORKER_JOB_MISMATCH"):
        WorkerMessage.decode(message.encode(), expected_job_id="job-b")
    with pytest.raises(WorkerProtocolError, match="WORKER_LINE_SIZE_INVALID"):
        WorkerRunCommand.decode(b"x" * (64 * 1024 + 1))


def test_worker_process_emits_real_progress_and_result():
    process = subprocess.Popen(
        [sys.executable, "-m", "tda_companion.asr_worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    assert process.stdin is not None
    assert process.stdout is not None
    command = WorkerRunCommand(
        job_id="fixture-job",
        attempt=1,
        kind="synthetic.fixture",
        payload={"units": 3, "completed": 0},
    )
    process.stdin.write(command.encode())
    process.stdin.flush()

    messages = []
    while True:
        line = process.stdout.readline()
        assert line
        message = WorkerMessage.decode(line, expected_job_id="fixture-job", expected_attempt=1)
        messages.append(message)
        if message.type in {"result", "cancelled", "error"}:
            break
    process.stdin.close()
    assert process.wait(timeout=5) == 0
    assert [m.payload["completed"] for m in messages if m.type == "progress"] == [1, 2, 3]
    assert messages[-1].type == "result"
    assert messages[-1].payload == {"kind": "synthetic.fixture", "units": 3}


def test_supervisor_runs_fixture_without_loading_worker_in_agent():
    progress: list[int] = []
    events: list[str] = []
    supervisor = WorkerSupervisor(startup_timeout=5, heartbeat_timeout=5)
    outcome = supervisor.run_fixture(
        job_id="supervised-job",
        attempt=1,
        units=4,
        completed=1,
        on_progress=lambda message: progress.append(int(message.payload["completed"])),
        on_event=lambda message: events.append(message.type),
    )
    assert outcome.terminal == "result"
    assert progress == [2, 3, 4]
    assert "ready" in events
    assert "stage" in events
    assert "heartbeat" in events


def test_supervisor_waits_for_delayed_stdout_drain_after_worker_exit(
    monkeypatch,
    tmp_path,
):
    script = tmp_path / "fast_exit_worker.py"
    script.write_text(
        """
import sys
from tda_companion.worker_protocol import WorkerMessage, WorkerRunCommand

command = WorkerRunCommand.decode(sys.stdin.buffer.readline())
for seq, kind, payload in (
    (0, "ready", {"kind": command.kind}),
    (1, "result", {"kind": command.kind, "units": 1}),
):
    sys.stdout.write(
        WorkerMessage.create(
            job_id=command.job_id,
            attempt=command.attempt,
            seq=seq,
            type=kind,
            payload=payload,
        ).encode()
    )
sys.stdout.flush()
""",
        encoding="utf-8",
    )

    original_thread = threading.Thread

    def delayed_thread(*args, **kwargs):
        if kwargs.get("name") != "tda-worker-stdout":
            return original_thread(*args, **kwargs)
        target = kwargs["target"]

        def delayed_target():
            time.sleep(0.25)
            target()

        copied = dict(kwargs)
        copied["target"] = delayed_target
        return original_thread(*args, **copied)

    monkeypatch.setattr(supervisor_module.threading, "Thread", delayed_thread)
    supervisor = WorkerSupervisor(
        command_factory=lambda: [sys.executable, str(script)],
        startup_timeout=2,
        heartbeat_timeout=2,
    )

    outcome = supervisor.run_fixture(
        job_id="fast-exit",
        attempt=1,
        units=1,
        completed=0,
        on_progress=lambda _message: None,
    )

    assert outcome.terminal == "result"
    assert outcome.payload["units"] == 1
    assert outcome.returncode == 0


def test_supervisor_cancels_child_cooperatively():
    seen = 0
    cancelled = False

    def on_progress(_message):
        nonlocal seen, cancelled
        seen += 1
        if seen >= 1:
            cancelled = True
        time.sleep(0.01)

    supervisor = WorkerSupervisor(startup_timeout=5, heartbeat_timeout=5, cancel_grace=2)
    outcome = supervisor.run_fixture(
        job_id="cancel-job",
        attempt=1,
        units=100,
        completed=0,
        on_progress=on_progress,
        is_cancelled=lambda: cancelled,
    )
    assert outcome.terminal == "cancelled"
    assert seen < 100


def test_supervisor_cancel_survives_child_stdin_closing_before_terminal(tmp_path):
    script = tmp_path / "close_stdin_worker.py"
    script.write_text(
        """
import sys
import time
from tda_companion.worker_protocol import WorkerMessage, WorkerRunCommand

command = WorkerRunCommand.decode(sys.stdin.buffer.readline())
sys.stdin.close()
for seq, kind, payload in (
    (0, "ready", {"kind": command.kind}),
    (1, "heartbeat", {"stage": "finishing"}),
):
    sys.stdout.write(
        WorkerMessage.create(
            job_id=command.job_id,
            attempt=command.attempt,
            seq=seq,
            type=kind,
            payload=payload,
        ).encode()
    )
    sys.stdout.flush()
time.sleep(0.1)
sys.stdout.write(
    WorkerMessage.create(
        job_id=command.job_id,
        attempt=command.attempt,
        seq=2,
        type="cancelled",
        payload={"stage": "finished-after-close"},
    ).encode()
)
sys.stdout.flush()
""",
        encoding="utf-8",
    )
    supervisor = WorkerSupervisor(
        command_factory=lambda: [sys.executable, str(script)],
        startup_timeout=2,
        heartbeat_timeout=1,
        cancel_grace=0.5,
    )

    outcome = supervisor.run_fixture(
        job_id="cancel-closed-stdin",
        attempt=1,
        units=1,
        completed=0,
        on_progress=lambda _message: None,
        is_cancelled=lambda: True,
    )

    assert outcome.terminal == "cancelled"
    assert outcome.payload["stage"] == "finished-after-close"


def test_supervisor_force_stops_unresponsive_cancel_as_cancelled(tmp_path):
    script = tmp_path / "ignore_cancel_worker.py"
    script.write_text(
        """
import sys
import time
from tda_companion.worker_protocol import WorkerMessage, WorkerRunCommand

command = WorkerRunCommand.decode(sys.stdin.buffer.readline())
seq = 0

def emit(kind, payload=None):
    global seq
    message = WorkerMessage.create(
        job_id=command.job_id,
        attempt=command.attempt,
        seq=seq,
        type=kind,
        payload=payload,
    )
    seq += 1
    sys.stdout.write(message.encode())
    sys.stdout.flush()

emit("ready", {"kind": command.kind})
while True:
    emit("heartbeat", {"stage": "native-busy"})
    time.sleep(0.02)
""",
        encoding="utf-8",
    )
    supervisor = WorkerSupervisor(
        command_factory=lambda: [sys.executable, str(script)],
        startup_timeout=2,
        heartbeat_timeout=1,
        cancel_grace=0.1,
    )

    outcome = supervisor.run_fixture(
        job_id="forced-cancel",
        attempt=1,
        units=10,
        completed=0,
        on_progress=lambda _message: None,
        is_cancelled=lambda: True,
    )

    assert outcome.terminal == "cancelled"
    assert outcome.payload == {"stage": "forced_termination", "forced": True}


def test_supervisor_preserves_non_recoverable_worker_error(tmp_path):
    script = tmp_path / "fatal_worker.py"
    script.write_text(
        """
import sys
from tda_companion.worker_protocol import WorkerMessage, WorkerRunCommand

command = WorkerRunCommand.decode(sys.stdin.buffer.readline())
for seq, kind, payload in (
    (0, "ready", {"kind": command.kind}),
    (1, "error", {"code": "CRAIG_MANIFEST_INVALID", "recoverable": False}),
):
    sys.stdout.write(
        WorkerMessage.create(
            job_id=command.job_id,
            attempt=command.attempt,
            seq=seq,
            type=kind,
            payload=payload,
        ).encode()
    )
    sys.stdout.flush()
""",
        encoding="utf-8",
    )
    supervisor = WorkerSupervisor(
        command_factory=lambda: [sys.executable, str(script)],
        startup_timeout=2,
    )

    with pytest.raises(WorkerProcessError, match="CRAIG_MANIFEST_INVALID") as exc:
        supervisor.run_fixture(
            job_id="fatal-worker",
            attempt=1,
            units=1,
            completed=0,
            on_progress=lambda _message: None,
        )

    assert exc.value.recoverable is False


def test_supervisor_rejects_oversized_stdout_before_protocol_decode(tmp_path):
    script = tmp_path / "oversized_stdout_worker.py"
    script.write_text(
        """
import sys
from tda_companion.worker_protocol import WorkerRunCommand

WorkerRunCommand.decode(sys.stdin.buffer.readline())
sys.stdout.write("x" * (64 * 1024 + 1024))
sys.stdout.flush()
""",
        encoding="utf-8",
    )
    supervisor = WorkerSupervisor(
        command_factory=lambda: [sys.executable, str(script)],
        startup_timeout=2,
    )

    with pytest.raises(WorkerProcessError, match="WORKER_LINE_SIZE_INVALID") as exc:
        supervisor.run_fixture(
            job_id="oversized-stdout",
            attempt=1,
            units=1,
            completed=0,
            on_progress=lambda _message: None,
        )

    assert exc.value.recoverable is False


def test_supervisor_rejects_worker_protocol_corruption(tmp_path):
    script = tmp_path / "bad_worker.py"
    script.write_text(
        "import sys; sys.stdin.readline(); print('{bad json', flush=True)",
        encoding="utf-8",
    )
    supervisor = WorkerSupervisor(command_factory=lambda: [sys.executable, str(script)], startup_timeout=2)
    with pytest.raises(WorkerProcessError, match="WORKER_JSON_INVALID"):
        supervisor.run_fixture(
            job_id="bad-worker",
            attempt=1,
            units=1,
            completed=0,
            on_progress=lambda _message: None,
        )


def test_cancel_command_roundtrip():
    command = WorkerCancelCommand(job_id="job-cancel", attempt=7)
    assert WorkerCancelCommand.decode(command.encode()) == command
