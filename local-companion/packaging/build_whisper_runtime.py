from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "local-companion" / "runtime" / "whisper-windows-x64.json"
ENTRY = ROOT / "local-companion" / "packaging" / "whisper_runtime_entry.py"
OUTPUT = ROOT / "local-companion" / "out" / "whisper-runtime"
REQUIRED_DLLS = ("cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll", "cudart64_12.dll")
NVIDIA_DISTRIBUTIONS = (
    "nvidia-cublas-cu12",
    "nvidia-cudnn-cu12",
    "nvidia-cuda-runtime-cu12",
)


def run(*args: str, cwd: Path | None = None) -> str:
    value = subprocess.run(args, cwd=cwd or ROOT, check=True, text=True, capture_output=True)
    return value.stdout.strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def distribution_files(python: Path, name: str, suffix: str) -> list[Path]:
    script = (
        "import importlib.metadata as m,json,sys;"
        "d=m.distribution(sys.argv[1]);"
        "suffix=sys.argv[2].lower();"
        "print(json.dumps([str(d.locate_file(f)) for f in (d.files or []) "
        "if str(f).lower().endswith(suffix)]))"
    )
    values = json.loads(run(str(python), "-c", script, name, suffix))
    return [Path(value) for value in values if isinstance(value, str)]


def distribution_license_files(python: Path, name: str) -> list[Path]:
    script = (
        "import importlib.metadata as m,json,sys,pathlib;"
        "d=m.distribution(sys.argv[1]);"
        "items=[];"
        "[(items.append(str(d.locate_file(f)))) for f in (d.files or []) "
        "if pathlib.PurePosixPath(str(f).replace('\\\\','/')).name.lower() "
        "in {'license','license.txt','license.rst','copying','copying.txt'}];"
        "print(json.dumps(items))"
    )
    values = json.loads(run(str(python), "-c", script, name))
    return [Path(value) for value in values if isinstance(value, str)]


def copy_runtime_dlls(python: Path, built: Path) -> dict[str, int]:
    copied: dict[str, int] = {}
    license_root = built / "licenses"
    for distribution in NVIDIA_DISTRIBUTIONS:
        dlls = [path for path in distribution_files(python, distribution, ".dll") if path.is_file()]
        if not dlls:
            raise RuntimeError(f"WHISPER_RUNTIME_NVIDIA_DLLS_MISSING:{distribution}")
        copied[distribution] = len(dlls)
        for source in dlls:
            target = built / source.name
            if target.exists() and sha256(target) != sha256(source):
                raise RuntimeError(f"WHISPER_RUNTIME_DLL_COLLISION:{source.name}")
            if not target.exists():
                shutil.copy2(source, target)

        notices = [path for path in distribution_license_files(python, distribution) if path.is_file()]
        if not notices:
            raise RuntimeError(f"WHISPER_RUNTIME_LICENSE_MISSING:{distribution}")
        target_dir = license_root / distribution
        target_dir.mkdir(parents=True, exist_ok=True)
        seen: set[str] = set()
        for source in notices:
            name = source.name
            candidate = name
            index = 2
            while candidate.casefold() in seen:
                candidate = f"{source.stem}-{index}{source.suffix}"
                index += 1
            seen.add(candidate.casefold())
            shutil.copy2(source, target_dir / candidate)
    return copied


def _smoke_installer(archive: Path, version: str, digest: str) -> dict:
    sys.path.insert(0, str(ROOT / "local-companion"))
    from tda_companion.asr_runtime import (  # noqa: PLC0415
        inspect_whisper_runtime,
        install_whisper_runtime_archive,
    )

    with tempfile.TemporaryDirectory(prefix="tda-whisper-install-") as value:
        runtime_root = Path(value) / "Runtime"
        install_whisper_runtime_archive(
            archive,
            runtime_root,
            version=version,
            expected_sha256=digest,
        )
        state = inspect_whisper_runtime(runtime_root, verify_worker=True)
        if state.get("status") != "ready" or state.get("version") != version:
            raise RuntimeError("WHISPER_RUNTIME_INSTALL_SMOKE_FAILED")
        worker = Path(str(state["worker"]))
        probe = json.loads(run(str(worker), "--probe"))
        if not probe.get("ready") or not probe.get("nvml"):
            raise RuntimeError("WHISPER_RUNTIME_INSTALLED_PROBE_FAILED")
        return probe


def main() -> int:
    if os.name != "nt" or not sys.maxsize > 2**32:
        raise RuntimeError("WHISPER_RUNTIME_WINDOWS_X64_REQUIRED")
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if config.get("schema") != "tda_whisper_runtime_build_v1":
        raise RuntimeError("WHISPER_RUNTIME_MANIFEST_SCHEMA")
    version = str(config["version"])
    packages = config["packages"]

    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tda-whisper-runtime-") as temp_value:
        temp = Path(temp_value)
        venv = temp / ".venv"
        run("uv", "venv", str(venv), "--python", str(config["python"]))
        python = venv / "Scripts" / "python.exe"
        pins = [f"{name}=={value}" for name, value in packages.items()]
        run("uv", "pip", "install", "--python", str(python), *pins)

        dist = temp / "dist"
        work = temp / "work"
        run(
            str(python), "-m", "PyInstaller",
            "--noconfirm", "--clean", "--onedir", "--console",
            "--name", "TDAWhisperWorker",
            "--paths", str(ROOT / "local-companion"),
            "--distpath", str(dist), "--workpath", str(work), "--specpath", str(work),
            "--collect-all", "faster_whisper",
            "--collect-all", "ctranslate2",
            "--collect-all", "av",
            "--hidden-import", "pynvml",
            str(ENTRY),
        )
        built = dist / "TDAWhisperWorker"
        worker = built / "TDAWhisperWorker.exe"
        if not worker.is_file():
            raise RuntimeError("WHISPER_RUNTIME_WORKER_NOT_CREATED")

        copied_dlls = copy_runtime_dlls(python, built)
        for name in REQUIRED_DLLS:
            if not (built / name).is_file():
                raise RuntimeError(f"WHISPER_RUNTIME_REQUIRED_DLL_MISSING:{name}")

        probe = json.loads(run(str(worker), "--probe"))
        if probe.get("schema") != "tda_whisper_runtime_probe_v1" or not probe.get("ready"):
            raise RuntimeError("WHISPER_RUNTIME_PROBE_NOT_READY")
        if probe.get("faster_whisper") != packages["faster-whisper"]:
            raise RuntimeError("WHISPER_RUNTIME_FASTER_WHISPER_VERSION_MISMATCH")
        if probe.get("ctranslate2") != packages["ctranslate2"]:
            raise RuntimeError("WHISPER_RUNTIME_CTRANSLATE2_VERSION_MISMATCH")
        if not probe.get("nvml"):
            raise RuntimeError("WHISPER_RUNTIME_NVML_MISSING")

        package_root = OUTPUT / f"TDAWhisperRuntime-{version}-windows-x64"
        if package_root.exists():
            shutil.rmtree(package_root)
        shutil.move(str(built), str(package_root))
        metadata = {
            "schema": "tda_whisper_runtime_artifact_v1",
            "runtime_id": config["runtime_id"],
            "version": version,
            "python": config["python"],
            "packages": packages,
            "gpu": config["gpu"],
            "probe": probe,
            "required_dlls": list(REQUIRED_DLLS),
            "nvidia_dll_counts": copied_dlls,
        }
        (package_root / "runtime-build.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        archive = OUTPUT / f"TDAWhisperRuntime-{version}-windows-x64.zip"
        if archive.exists():
            archive.unlink()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as bundle:
            for path in sorted(package_root.rglob("*")):
                if path.is_file():
                    bundle.write(path, path.relative_to(package_root).as_posix())
        digest = sha256(archive)
        sha_file = archive.with_suffix(archive.suffix + ".sha256")
        sha_file.write_text(f"{digest}  {archive.name}", encoding="ascii")
        installed_probe = _smoke_installer(archive, version, digest)
        print(
            json.dumps(
                {
                    "archive": str(archive),
                    "sha256": digest,
                    "probe": probe,
                    "installed_probe": installed_probe,
                    "nvidia_dll_counts": copied_dlls,
                },
                sort_keys=True,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
