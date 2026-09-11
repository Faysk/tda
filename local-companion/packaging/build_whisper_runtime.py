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


def run(*args: str, cwd: Path | None = None) -> str:
    value = subprocess.run(args, cwd=cwd or ROOT, check=True, text=True, capture_output=True)
    return value.stdout.strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
            str(ENTRY),
        )
        built = dist / "TDAWhisperWorker"
        worker = built / "TDAWhisperWorker.exe"
        if not worker.is_file():
            raise RuntimeError("WHISPER_RUNTIME_WORKER_NOT_CREATED")

        site_packages = Path(run(str(python), "-c", "import site; print(site.getsitepackages()[0])"))
        nvidia = site_packages / "nvidia"
        dlls = sorted(nvidia.rglob("*.dll"))
        if not dlls:
            raise RuntimeError("WHISPER_RUNTIME_NVIDIA_DLLS_MISSING")
        for source in dlls:
            target = built / source.name
            if target.exists() and sha256(target) != sha256(source):
                raise RuntimeError(f"WHISPER_RUNTIME_DLL_COLLISION:{source.name}")
            if not target.exists():
                shutil.copy2(source, target)
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
        (archive.with_suffix(archive.suffix + ".sha256")).write_text(
            f"{digest}  {archive.name}", encoding="ascii"
        )
        print(json.dumps({"archive": str(archive), "sha256": digest, "probe": probe}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
