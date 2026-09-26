from __future__ import annotations

import errno
from pathlib import Path

import pytest

import tda_companion.atomic_storage as storage


@pytest.mark.parametrize("stage", ["write", "file_sync", "replace"])
def test_failure_before_replace_preserves_destination(monkeypatch, tmp_path, stage):
    target = tmp_path / "draft.json"
    target.write_bytes(b"original")

    def fail(*args, **kwargs):
        raise OSError("synthetic private path must not leak")

    if stage == "write":
        original_open = Path.open
        def open_file(path, mode="r", *args, **kwargs):
            return fail() if mode == "xb" else original_open(path, mode, *args, **kwargs)
        monkeypatch.setattr(Path, "open", open_file)
    elif stage == "file_sync":
        monkeypatch.setattr(storage.os, "fsync", fail)
    else:
        monkeypatch.setattr(storage, "_replace", fail)
    with pytest.raises(storage.AtomicStorageError) as error:
        storage.atomic_write(target, b"candidate")
    assert not error.value.ambiguous
    assert error.value.stage == stage
    assert str(error.value) == "LOCAL_WRITE_FAILED"
    assert target.read_bytes() == b"original"
    assert not list(tmp_path.glob("*.partial"))


def test_failure_after_replace_is_ambiguous_without_compensating_write(monkeypatch, tmp_path):
    target = tmp_path / "draft.json"
    target.write_bytes(b"original")
    def unsupported(_directory):
        raise OSError(errno.EINVAL, "filesystem does not support directory sync")
    monkeypatch.setattr(storage, "sync_namespace", unsupported)
    with pytest.raises(storage.AtomicStorageError) as error:
        storage.atomic_write(target, b"candidate")
    assert error.value.ambiguous
    assert error.value.stage == "namespace_sync"
    assert str(error.value) == "LOCAL_WRITE_UNCONFIRMED"
    assert target.read_bytes() == b"candidate"
    assert not list(tmp_path.glob("*.partial"))


def test_replace_that_changes_destination_then_raises_is_ambiguous(monkeypatch, tmp_path):
    target = tmp_path / "draft.json"
    original_replace = storage._replace
    def interrupted(source, target, storage_class):
        original_replace(source, target, storage_class)
        raise OSError("interrupted after rename")
    monkeypatch.setattr(storage, "_replace", interrupted)
    with pytest.raises(storage.AtomicStorageError) as error:
        storage.atomic_write(target, b"candidate")
    assert error.value.ambiguous
    assert target.read_bytes() == b"candidate"


def test_posix_fences_file_then_replace_then_every_new_namespace(monkeypatch, tmp_path):
    target = tmp_path / "new" / "nested" / "run.json"
    events = []
    monkeypatch.setattr(storage, "_WINDOWS", False)
    original_sync, original_replace = storage.os.fsync, storage._replace
    def sync_file(descriptor):
        events.append("file")
        original_sync(descriptor)
    def replace_file(source, target, storage_class):
        assert source.parent == target.parent
        events.append("replace")
        original_replace(source, target, storage_class)
    monkeypatch.setattr(storage.os, "fsync", sync_file)
    monkeypatch.setattr(storage, "_replace", replace_file)
    monkeypatch.setattr(storage, "_directory_sync", lambda directory: events.append(directory))
    assert storage.atomic_write(target, b"valid") == "posix_file_and_namespace_sync_v1"
    assert events == ["file", "replace", target.parent, *target.parent.parents]


@pytest.mark.skipif(storage._WINDOWS, reason="POSIX directory handles are unavailable on Windows")
def test_real_posix_directory_sync(tmp_path):
    target = tmp_path / "new" / "nested" / "run.json"
    assert storage.atomic_write(target, b"valid") == "posix_file_and_namespace_sync_v1"
    assert target.read_bytes() == b"valid"


@pytest.mark.skipif(not storage._WINDOWS, reason="native Windows rename smoke")
def test_real_windows_write_through_and_readback(tmp_path):
    target = tmp_path / "new" / "nested" / "run.json"
    assert storage.atomic_write(target, b"first") == "windows_file_sync_write_through_v1"
    storage.atomic_write(target, b"second")
    assert target.read_bytes() == b"second"


def test_projection_does_not_pay_authoritative_sync_cost(monkeypatch, tmp_path):
    def fail(*_):
        raise AssertionError("projection must not claim or pay for an authority fence")
    monkeypatch.setattr(storage.os, "fsync", fail)
    monkeypatch.setattr(storage, "sync_namespace", fail)
    target = tmp_path / "summary.json"
    assert storage.atomic_write(target, b"derived", storage_class="projection") == "atomic_visibility_v1"
    assert target.read_bytes() == b"derived"


def test_orphan_partial_does_not_replace_valid_destination(tmp_path):
    target = tmp_path / "draft.json"
    target.write_bytes(b"original")
    stale = tmp_path / ".draft.json.orphan.partial"
    stale.write_bytes(b"incomplete")
    storage.atomic_write(target, b"replacement")
    assert target.read_bytes() == b"replacement"
    assert stale.read_bytes() == b"incomplete"
