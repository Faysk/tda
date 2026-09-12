from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import winreg
from ctypes import wintypes
from pathlib import Path

PRODUCTION_ORIGIN = "https://dnd.faysk.dev"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "TDA Companion Agent"
PRODUCT_KEY = r"Software\Faysk\TDA Companion"
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_TERMINATE = 0x0001
SYNCHRONIZE = 0x00100000
TH32CS_SNAPPROCESS = 0x00000002
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
WAIT_TIMEOUT = 0x00000102


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    ]


def local_root() -> Path:
    value = os.environ.get("LOCALAPPDATA")
    if not value:
        raise RuntimeError("LOCALAPPDATA_NOT_FOUND")
    return Path(value).resolve() / "TDA"


def _token(root: Path) -> str | None:
    for path in (
        root / "State" / "pairing-token.txt",
        root / "Companion" / "pairing-token.txt",
    ):
        try:
            value = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if len(value) >= 43:
            return value
    return None


def _agent_post(root: Path, port: int, *, force: bool) -> bool:
    token = _token(root)
    if not token:
        return False
    payload = json.dumps({"action": "shutdown", "force": force}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/v1/agent/control",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Origin": PRODUCTION_ORIGIN,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:  # noqa: S310 - fixed loopback URL
            return response.status == 200
    except (OSError, urllib.error.URLError, urllib.error.HTTPError):
        return False


def _health(port: int) -> bool:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/v1/health",
        headers={"Cache-Control": "no-store"},
    )
    try:
        with urllib.request.urlopen(request, timeout=0.4) as response:  # noqa: S310 - fixed loopback URL
            return response.status == 200
    except Exception:
        return False


def _wait_agent_down(port: int, timeout: float = 8.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not _health(port):
            return True
        time.sleep(0.15)
    return not _health(port)


def _remove_startup_value() -> None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            try:
                winreg.DeleteValue(key, RUN_VALUE)
            except FileNotFoundError:
                pass
    except FileNotFoundError:
        pass


def _process_image(pid: int) -> Path | None:
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        length = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(length.value)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)):
            return None
        return Path(buffer.value).resolve()
    finally:
        kernel32.CloseHandle(handle)


def _installed_companion_pids(root: Path) -> list[int]:
    kernel32 = ctypes.windll.kernel32
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == INVALID_HANDLE_VALUE:
        return []
    versions = (root / "Companion" / "versions").resolve()
    prefix = str(versions).casefold() + os.sep.casefold()
    result: list[int] = []
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    try:
        ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while ok:
            if entry.szExeFile.casefold() == "tdacompanion.exe":
                image = _process_image(int(entry.th32ProcessID))
                if image is not None and str(image).casefold().startswith(prefix):
                    result.append(int(entry.th32ProcessID))
            ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    return result


def _terminate_pid(pid: int) -> None:
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, False, pid)
    if not handle:
        return
    try:
        kernel32.TerminateProcess(handle, 0)
        kernel32.WaitForSingleObject(handle, 3000)
    finally:
        kernel32.CloseHandle(handle)


def prepare_uninstall(root: Path, port: int = 8765) -> None:
    _remove_startup_value()
    if _health(port):
        _agent_post(root, port, force=True)
        _wait_agent_down(port, timeout=8)
    for pid in _installed_companion_pids(root):
        if pid != os.getpid():
            _terminate_pid(pid)


def _wait_parent(pid: int | None, timeout: float = 30.0) -> None:
    if not pid:
        return
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(SYNCHRONIZE, False, int(pid))
    if not handle:
        return
    try:
        milliseconds = max(0, int(timeout * 1000))
        kernel32.WaitForSingleObject(handle, milliseconds)
    finally:
        kernel32.CloseHandle(handle)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run_msiexec(arguments: list[str]) -> None:
    completed = subprocess.run(
        ["msiexec.exe", *arguments, "/norestart"],
        check=False,
        timeout=600,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if completed.returncode not in (0, 3010):
        raise RuntimeError(f"MSI_EXIT_CODE:{completed.returncode}")


def _write_receipt(root: Path, name: str, value: dict[str, object]) -> None:
    folder = root / "Cache" / "maintenance"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    os.replace(temporary, path)


def install_update(
    root: Path,
    msi: Path,
    expected_sha256: str,
    expected_version: str,
    parent_pid: int | None,
    port: int,
) -> None:
    _wait_parent(parent_pid)
    if not msi.is_file() or _sha256(msi).casefold() != expected_sha256.casefold():
        raise RuntimeError("UPDATE_HASH_MISMATCH")
    prepare_uninstall(root, port)
    _run_msiexec(["/i", str(msi), "/passive"])
    marker = root / "Companion" / "current-version.txt"
    installed = marker.read_text(encoding="utf-8").strip() if marker.is_file() else ""
    if installed != expected_version:
        raise RuntimeError("UPDATE_VERSION_MISMATCH")
    executable = root / "Companion" / "versions" / expected_version / "TDACompanion.exe"
    if not executable.is_file():
        raise RuntimeError("UPDATED_EXECUTABLE_MISSING")
    subprocess.Popen(
        [str(executable), "--agent", "--startup"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    _write_receipt(
        root,
        "last-update.json",
        {"version": expected_version, "sha256": expected_sha256, "status": "installed", "at": time.time()},
    )
    subprocess.Popen([str(executable), "--ui"], close_fds=True)


def _product_code() -> str:
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, PRODUCT_KEY, 0, winreg.KEY_READ) as key:
        value, _kind = winreg.QueryValueEx(key, "ProductCode")
    text = str(value).strip()
    if not text.startswith("{") or not text.endswith("}"):
        raise RuntimeError("PRODUCT_CODE_INVALID")
    return text


def _purge_user_data(root: Path) -> None:
    for name in ("State", "Data", "Logs", "Cache", "Models", "Runtime"):
        shutil.rmtree(root / name, ignore_errors=True)
    # MSI owns Companion. Remove it only after msiexec completed and only if it
    # still contains generated leftovers rather than another installed version.
    companion = root / "Companion"
    if companion.exists():
        shutil.rmtree(companion, ignore_errors=True)
    try:
        root.rmdir()
    except OSError:
        pass


def uninstall(root: Path, *, purge: bool, parent_pid: int | None, port: int) -> None:
    _wait_parent(parent_pid)
    product_code = _product_code()
    prepare_uninstall(root, port)
    _run_msiexec(["/x", product_code, "/passive"])
    if purge:
        _purge_user_data(root)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="TDACompanionMaintenance")
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--prepare-uninstall", action="store_true")
    actions.add_argument("--install-update", action="store_true")
    actions.add_argument("--uninstall", action="store_true")
    parser.add_argument("--root", type=Path)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--parent-pid", type=int)
    parser.add_argument("--msi", type=Path)
    parser.add_argument("--sha256")
    parser.add_argument("--version")
    parser.add_argument("--purge", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = (args.root or local_root()).resolve()
    try:
        if args.prepare_uninstall:
            prepare_uninstall(root, args.port)
        elif args.install_update:
            if args.msi is None or not args.sha256 or not args.version:
                raise RuntimeError("UPDATE_ARGUMENTS_REQUIRED")
            install_update(root, args.msi.resolve(), args.sha256, args.version, args.parent_pid, args.port)
        else:
            uninstall(root, purge=bool(args.purge), parent_pid=args.parent_pid, port=args.port)
        return 0
    except BaseException as exc:
        try:
            _write_receipt(root, "last-maintenance-error.json", {"error": type(exc).__name__, "at": time.time()})
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
