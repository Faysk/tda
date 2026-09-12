from __future__ import annotations

import subprocess
import sys
import time

import pytest

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
    assert "stage" in events
    assert "heartbeat" in events


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
