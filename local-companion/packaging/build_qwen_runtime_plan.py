from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "local-companion" / "runtime" / "qwen-windows-x64.json"
PROBE = ROOT / "local-companion" / "packaging" / "qwen_runtime_probe.py"
OUTPUT = ROOT / "local-companion" / "out" / "qwen-runtime"


def run(*args: str, cwd: Path | None = None) -> str:
    try:
        value = subprocess.run(args, cwd=cwd or ROOT, check=True, text=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        if exc.stdout:
            print(exc.stdout.rstrip(), file=sys.stdout)
        if exc.stderr:
            print(exc.stderr.rstrip(), file=sys.stderr)
        raise
    return value.stdout.strip()


def directory_size(root: Path) -> int:
    total = 0
    for path in root.rglob("*"):
        if path.is_file():
            try:
                total += path.stat().st_size
            except OSError:
                pass
    return total


def _require_version(name: str, actual: str, expected: str) -> None:
    if actual != expected:
        raise RuntimeError(f"QWEN_RUNTIME_VERSION_MISMATCH:{name}:{actual}:{expected}")


def main() -> int:
    if os.name != "nt" or not sys.maxsize > 2**32:
        raise RuntimeError("QWEN_RUNTIME_WINDOWS_X64_REQUIRED")
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    if config.get("schema") != "tda_qwen_runtime_build_v1":
        raise RuntimeError("QWEN_RUNTIME_MANIFEST_SCHEMA")

    python_version = str(config["python"])
    torch_config = config["torch"]
    torch_version = str(torch_config["version"])
    torch_index = str(torch_config["index_url"])
    expected_cuda = str(torch_config["cuda_family"])
    packages = {str(name): str(version) for name, version in config["packages"].items()}

    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tda-qwen-runtime-") as temp_value:
        temp = Path(temp_value)
        venv = temp / ".venv"
        run("uv", "venv", str(venv), "--python", python_version)
        python = venv / "Scripts" / "python.exe"

        # The CUDA-specific index selects the cu132 build; the probe below enforces torch.version.cuda == 13.2.
        run(
            "uv",
            "pip",
            "install",
            "--python",
            str(python),
            "--index-url",
            torch_index,
            "--extra-index-url",
            "https://pypi.org/simple",
            f"torch=={torch_version}",
        )
        pins = [f"{name}=={version}" for name, version in packages.items()]
        run("uv", "pip", "install", "--python", str(python), *pins)

        probe = json.loads(run(str(python), str(PROBE)))
        if probe.get("schema") != "tda_qwen_runtime_probe_v1" or not probe.get("ready"):
            raise RuntimeError("QWEN_RUNTIME_PROBE_NOT_READY")
        actual_torch = str(probe.get("torch") or "")
        if not actual_torch.startswith(torch_version):
            raise RuntimeError(f"QWEN_RUNTIME_TORCH_VERSION_MISMATCH:{actual_torch}:{torch_version}")
        if str(probe.get("torch_cuda")) != expected_cuda:
            raise RuntimeError(f"QWEN_RUNTIME_CUDA_FAMILY_MISMATCH:{probe.get('torch_cuda')}:{expected_cuda}")
        _require_version("transformers", str(probe.get("transformers")), packages["transformers"])
        _require_version("accelerate", str(probe.get("accelerate")), packages["accelerate"])
        _require_version("huggingface-hub", str(probe.get("huggingface_hub")), packages["huggingface-hub"])
        _require_version("safetensors", str(probe.get("safetensors")), packages["safetensors"])
        _require_version("av", str(probe.get("av")), packages["av"])
        _require_version("numpy", str(probe.get("numpy")), packages["numpy"])
        _require_version("nvidia-ml-py", str(probe.get("nvidia_ml_py")), packages["nvidia-ml-py"])
        if not probe.get("qwen3_asr_native") or not probe.get("forced_aligner_native"):
            raise RuntimeError("QWEN_RUNTIME_TRANSFORMERS_NATIVE_SUPPORT_MISSING")

        freeze = [line for line in run("uv", "pip", "freeze", "--python", str(python)).splitlines() if line.strip()]
        report = {
            "schema": "tda_qwen_runtime_plan_v1",
            "runtime_id": config["runtime_id"],
            "version": config["version"],
            "python": python_version,
            "torch": torch_config,
            "packages": packages,
            "gpu": config["gpu"],
            "probe": probe,
            "physical_gpu_validated": False,
            "physical_gate": config["gpu"]["physical_gate"],
            "resolved_environment_bytes": directory_size(venv),
            "resolved_packages": freeze,
            "distribution_status": "candidate-plan-only",
        }
        target = OUTPUT / f"TDAQwenRuntimePlan-{config['version']}-windows-x64.json"
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"plan": str(target), "probe": probe, "bytes": report["resolved_environment_bytes"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
