from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import zipfile
from pathlib import Path, PurePosixPath
from uuid import uuid4

from .runtime_compat import whisper_runtime_version_compatible

RUNTIME_SCHEMA = "tda_asr_runtime_v1"
WHISPER_RUNTIME_ID = "whisper-ctranslate2"
WHISPER_WORKER_EXE = "TDAWhisperWorker.exe"
MAX_RUNTIME_ARCHIVE_ENTRIES = 4096
MAX_RUNTIME_UNCOMPRESSED_BYTES = 4 * 1024**3
_COPY_CHUNK = 1024 * 1024
_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_RUNTIME_BACKUP = re.compile(
    r"^\.(?P<version>[0-9]+\.[0-9]+\.[0-9]+)-[0-9a-f]{32}\.backup$"
)
_RUNTIME_PARTIAL = re.compile(
    r"^\.(?P<version>[0-9]+\.[0-9]+\.[0-9]+)-[0-9a-f]{32}\.partial$"
)


class AsrRuntimeError(RuntimeError):
    pass


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_COPY_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _worker_metadata_sha256(path: Path) -> str:
    try:
        stat_value = path.stat()
    except OSError as exc:
        raise AsrRuntimeError("ASR_RUNTIME_WORKER_MISSING") from exc
    payload = json.dumps(
        {
            "name": path.name,
            "size": stat_value.st_size,
            "mtime_ns": stat_value.st_mtime_ns,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _valid_recovery_runtime_directory(path: Path, version: str) -> bool:
    if path.is_symlink() or not path.is_dir():
        return False
    marker_path = path / ".tda-runtime.json"
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    if (
        not isinstance(marker, dict)
        or marker.get("schema") != RUNTIME_SCHEMA
        or marker.get("runtime_id") != WHISPER_RUNTIME_ID
        or marker.get("version") != version
        or marker.get("worker") != WHISPER_WORKER_EXE
        or not isinstance(marker.get("worker_sha256"), str)
        or not _SHA256.fullmatch(marker["worker_sha256"])
    ):
        return False
    worker = path / WHISPER_WORKER_EXE
    if not worker.is_file():
        return False
    try:
        return _sha256_file(worker) == marker["worker_sha256"]
    except OSError:
        return False


def recover_interrupted_whisper_runtime_install(runtime_root: Path) -> list[str]:
    """Recover only a current runtime swap proven interrupted by a previous process."""
    parent = whisper_root(runtime_root)
    if not parent.is_dir():
        return []

    selector_version: str | None = None
    try:
        selector = json.loads((parent / "current.json").read_text(encoding="utf-8"))
        value = selector.get("version") if isinstance(selector, dict) else None
        if isinstance(value, str) and _VERSION.fullmatch(value):
            selector_version = value
    except (OSError, json.JSONDecodeError):
        pass

    try:
        entries = list(parent.iterdir())
    except OSError:
        return []

    backups: dict[str, list[Path]] = {}
    partials: dict[str, list[Path]] = {}
    for candidate in entries:
        backup = _RUNTIME_BACKUP.fullmatch(candidate.name)
        if backup is not None:
            backups.setdefault(backup.group("version"), []).append(candidate)
            continue
        partial = _RUNTIME_PARTIAL.fullmatch(candidate.name)
        if partial is not None:
            partials.setdefault(partial.group("version"), []).append(candidate)

    recovered: list[str] = []
    for version in set(backups) | set(partials):
        candidates = backups.get(version, [])
        replacements = partials.get(version, [])
        target = parent / version
        if _valid_recovery_runtime_directory(target, version):
            for candidate in candidates + replacements:
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)
            continue
        if selector_version != version:
            # Inactive-version leftovers are not authoritative. They can be
            # removed without changing the selected runtime.
            for candidate in replacements:
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)
            continue

        # The selected target exists but failed verification. Move it aside so a
        # fully verified replacement can be promoted atomically. If recovery
        # cannot find anything better, this displaced target remains a fallback.
        if target.exists() or target.is_symlink():
            displaced = parent / f".{version}-{uuid4().hex}.backup"
            try:
                os.replace(target, displaced)
            except OSError:
                continue
            candidates.append(displaced)

        def modified(path: Path) -> int:
            try:
                return path.stat().st_mtime_ns
            except OSError:
                return -1

        promoted = False
        for replacement in sorted(replacements, key=modified, reverse=True):
            if not _valid_recovery_runtime_directory(replacement, version):
                continue
            try:
                os.replace(replacement, target)
            except OSError:
                continue
            recovered.append(version)
            promoted = True
            break

        if not promoted:
            ordered = sorted(candidates, key=modified, reverse=True)
            verified = [
                candidate
                for candidate in ordered
                if _valid_recovery_runtime_directory(candidate, version)
            ]
            fallback = [candidate for candidate in ordered if candidate not in verified]
            for candidate in verified + fallback:
                if candidate.is_symlink() or not candidate.is_dir():
                    continue
                try:
                    os.replace(candidate, target)
                except OSError:
                    continue
                recovered.append(version)
                promoted = True
                break

        if promoted:
            for candidate in candidates + replacements:
                if candidate.exists():
                    if candidate.is_dir() and not candidate.is_symlink():
                        shutil.rmtree(candidate, ignore_errors=True)
                    else:
                        candidate.unlink(missing_ok=True)
        else:
            for candidate in replacements:
                if candidate.is_dir() and not candidate.is_symlink():
                    shutil.rmtree(candidate, ignore_errors=True)
                else:
                    candidate.unlink(missing_ok=True)

    return recovered


def whisper_root(runtime_root: Path) -> Path:
    return runtime_root.resolve() / "whisper"


def whisper_version_root(runtime_root: Path, version: str) -> Path:
    if not _VERSION.fullmatch(version):
        raise AsrRuntimeError("ASR_RUNTIME_VERSION_INVALID")
    return whisper_root(runtime_root) / version


def _safe_member(info: zipfile.ZipInfo) -> PurePosixPath:
    value = info.filename.replace("\\", "/")
    path = PurePosixPath(value)
    if (
        not value
        or value.startswith("/")
        or path.is_absolute()
        or any(part in ("", ".", "..") for part in path.parts)
    ):
        raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_PATH_INVALID")
    mode = (info.external_attr >> 16) & 0xFFFF
    if mode and stat.S_ISLNK(mode):
        raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_SYMLINK")
    return path


def _atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{uuid4().hex}.partial")
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _replacement_allowed(runtime_root: Path, version: str) -> bool:
    state = inspect_whisper_runtime(runtime_root, verify_worker=True)
    status = state.get("status")
    active_version = state.get("version")
    if status in {"missing", "corrupt"}:
        return True
    # A valid different active version may coexist with an orphan/partial target
    # directory left by a failed future update. Replacing only that inactive target
    # is safe; current.json is switched only after the replacement is complete.
    if active_version != version and status in {"ready", "incompatible"}:
        return True
    return False


def install_whisper_runtime_archive(
    archive_path: Path,
    runtime_root: Path,
    *,
    version: str,
    expected_sha256: str,
    replace_corrupt: bool = False,
) -> dict[str, str]:
    """Install or atomically repair a prebuilt Whisper worker without global machine changes."""
    archive = archive_path.resolve()
    if not archive.is_file():
        raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_NOT_FOUND")
    if not _VERSION.fullmatch(version):
        raise AsrRuntimeError("ASR_RUNTIME_VERSION_INVALID")
    if not _SHA256.fullmatch(expected_sha256):
        raise AsrRuntimeError("ASR_RUNTIME_HASH_INVALID")
    actual_archive_sha = _sha256_file(archive)
    if actual_archive_sha != expected_sha256:
        raise AsrRuntimeError("ASR_RUNTIME_HASH_MISMATCH")

    target = whisper_version_root(runtime_root, version)
    replacing = target.exists() or target.is_symlink()
    if replacing:
        if not replace_corrupt:
            raise AsrRuntimeError("ASR_RUNTIME_VERSION_EXISTS")
        if not _replacement_allowed(runtime_root, version):
            raise AsrRuntimeError("ASR_RUNTIME_REPAIR_NOT_ALLOWED")

    parent = target.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = parent / f".{version}-{uuid4().hex}.partial"
    staging.mkdir(parents=False, exist_ok=False)
    backup: Path | None = None
    promoted = False

    try:
        try:
            package = zipfile.ZipFile(archive, "r")
        except (OSError, zipfile.BadZipFile) as exc:
            raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_INVALID") from exc
        with package:
            infos = [item for item in package.infolist() if not item.is_dir()]
            if not infos or len(infos) > MAX_RUNTIME_ARCHIVE_ENTRIES:
                raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_ENTRY_LIMIT")
            total = 0
            seen: set[str] = set()
            for info in infos:
                relative = _safe_member(info)
                key = relative.as_posix().casefold()
                if key in seen:
                    raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_DUPLICATE")
                seen.add(key)
                if info.file_size < 0:
                    raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_SIZE_INVALID")
                total += info.file_size
                if total > MAX_RUNTIME_UNCOMPRESSED_BYTES:
                    raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_SIZE_LIMIT")
                destination = staging.joinpath(*relative.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                written = 0
                with package.open(info, "r") as source, destination.open("xb") as output:
                    while True:
                        chunk = source.read(_COPY_CHUNK)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > info.file_size:
                            raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_SIZE_MISMATCH")
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if written != info.file_size:
                    raise AsrRuntimeError("ASR_RUNTIME_ARCHIVE_SIZE_MISMATCH")

        worker = staging / WHISPER_WORKER_EXE
        if not worker.is_file():
            raise AsrRuntimeError("ASR_RUNTIME_WORKER_MISSING")
        worker_sha = _sha256_file(worker)
        marker = {
            "schema": RUNTIME_SCHEMA,
            "runtime_id": WHISPER_RUNTIME_ID,
            "version": version,
            "worker": WHISPER_WORKER_EXE,
            "worker_sha256": worker_sha,
            "worker_metadata_sha256": _worker_metadata_sha256(worker),
            "archive_sha256": actual_archive_sha,
        }
        _atomic_json(staging / ".tda-runtime.json", marker)

        if replacing:
            backup = parent / f".{version}-{uuid4().hex}.backup"
            os.replace(target, backup)
        try:
            os.replace(staging, target)
            promoted = True
            _atomic_json(
                parent / "current.json",
                {
                    "schema": RUNTIME_SCHEMA,
                    "runtime_id": WHISPER_RUNTIME_ID,
                    "version": version,
                },
            )
        except BaseException:
            if promoted:
                shutil.rmtree(target, ignore_errors=True)
            if backup is not None and (backup.exists() or backup.is_symlink()):
                os.replace(backup, target)
            raise
        if backup is not None:
            if backup.is_dir() and not backup.is_symlink():
                shutil.rmtree(backup, ignore_errors=True)
            else:
                backup.unlink(missing_ok=True)
        return marker
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def inspect_whisper_runtime(runtime_root: Path, *, verify_worker: bool = False) -> dict[str, str | None]:
    parent = whisper_root(runtime_root)
    current = parent / "current.json"
    try:
        selector = json.loads(current.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "missing", "version": None, "worker": None}
    except (OSError, json.JSONDecodeError):
        return {"status": "corrupt", "version": None, "worker": None}
    if not isinstance(selector, dict) or selector.get("schema") != RUNTIME_SCHEMA:
        return {"status": "corrupt", "version": None, "worker": None}
    if selector.get("runtime_id") != WHISPER_RUNTIME_ID:
        return {"status": "corrupt", "version": None, "worker": None}
    version = selector.get("version")
    if not isinstance(version, str) or not _VERSION.fullmatch(version):
        return {"status": "corrupt", "version": None, "worker": None}
    version_root = parent / version
    marker_path = version_root / ".tda-runtime.json"
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "corrupt", "version": version, "worker": None}
    if (
        not isinstance(marker, dict)
        or marker.get("schema") != RUNTIME_SCHEMA
        or marker.get("runtime_id") != WHISPER_RUNTIME_ID
        or marker.get("version") != version
        or marker.get("worker") != WHISPER_WORKER_EXE
        or not isinstance(marker.get("worker_sha256"), str)
        or not _SHA256.fullmatch(marker["worker_sha256"])
    ):
        return {"status": "corrupt", "version": version, "worker": None}
    worker = version_root / WHISPER_WORKER_EXE
    if not worker.is_file():
        return {"status": "corrupt", "version": version, "worker": None}
    sealed_metadata = marker.get("worker_metadata_sha256")
    current_metadata: str | None = None
    metadata_drift = False
    if sealed_metadata is not None:
        if (
            not isinstance(sealed_metadata, str)
            or not _SHA256.fullmatch(sealed_metadata)
        ):
            return {"status": "corrupt", "version": version, "worker": None}
        try:
            current_metadata = _worker_metadata_sha256(worker)
        except AsrRuntimeError:
            return {"status": "corrupt", "version": version, "worker": None}
        metadata_drift = current_metadata != sealed_metadata

    if verify_worker or metadata_drift:
        try:
            if _sha256_file(worker) != marker["worker_sha256"]:
                return {"status": "corrupt", "version": version, "worker": None}
        except OSError:
            return {"status": "corrupt", "version": version, "worker": None}

    if metadata_drift or (verify_worker and sealed_metadata is None):
        try:
            current_metadata = current_metadata or _worker_metadata_sha256(worker)
            updated = dict(marker)
            updated["worker_metadata_sha256"] = current_metadata
            _atomic_json(marker_path, updated)
            marker = updated
        except (OSError, AsrRuntimeError):
            # Content identity already passed. A temporary inability to rewrite
            # the cheap seal must not misclassify the runtime as corrupt.
            pass
    if not whisper_runtime_version_compatible(version):
        return {"status": "incompatible", "version": version, "worker": None}
    return {"status": "ready", "version": version, "worker": str(worker.resolve())}


def current_whisper_worker(runtime_root: Path) -> Path | None:
    state = inspect_whisper_runtime(runtime_root, verify_worker=False)
    worker = state.get("worker")
    return Path(worker) if state.get("status") == "ready" and isinstance(worker, str) else None
