from __future__ import annotations

import argparse
import json
from importlib import metadata
from pathlib import Path


def _version(name: str) -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return "unavailable"


def _probe() -> int:
    try:
        import accelerate  # noqa: F401
        import av  # noqa: F401
        import huggingface_hub  # noqa: F401
        import numpy  # noqa: F401
        import pynvml  # noqa: F401
        import safetensors  # noqa: F401
        import torch
        import transformers
        from transformers import (
            AutoModelForMultimodalLM,
            AutoModelForTokenClassification,
            AutoProcessor,
            Qwen3ASRConfig,
            Qwen3ASRForConditionalGeneration,
        )

        del AutoModelForMultimodalLM, AutoModelForTokenClassification, AutoProcessor
        del Qwen3ASRConfig, Qwen3ASRForConditionalGeneration
    except Exception as exc:
        print(
            json.dumps(
                {
                    "schema": "tda_qwen_runtime_probe_v1",
                    "ready": False,
                    "error": type(exc).__name__,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 1

    available = bool(torch.cuda.is_available())
    count = int(torch.cuda.device_count()) if available else 0
    devices: list[dict[str, object]] = []
    for index in range(count):
        props = torch.cuda.get_device_properties(index)
        major, minor = torch.cuda.get_device_capability(index)
        devices.append(
            {
                "index": index,
                "name": str(props.name),
                "compute_capability": f"{major}.{minor}",
                "total_memory_bytes": int(props.total_memory),
            }
        )
    print(
        json.dumps(
            {
                "schema": "tda_qwen_runtime_probe_v1",
                "ready": True,
                "python_packages": {
                    "torch": _version("torch"),
                    "transformers": _version("transformers"),
                    "accelerate": _version("accelerate"),
                    "huggingface_hub": _version("huggingface-hub"),
                    "safetensors": _version("safetensors"),
                    "av": _version("av"),
                    "numpy": _version("numpy"),
                    "nvidia_ml_py": _version("nvidia-ml-py"),
                },
                "transformers": transformers.__version__,
                "torch_cuda": str(torch.version.cuda or "none"),
                "cuda_available": available,
                "cuda_device_count": count,
                "bf16_supported": bool(torch.cuda.is_bf16_supported()) if available else False,
                "qwen3_asr_native": True,
                "forced_aligner_native": True,
                "devices": devices,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ),
        flush=True,
    )
    return 0


def _read_context(path: Path | None) -> str:
    if path is None:
        return ""
    try:
        value = path.resolve().read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError("ACCEPTANCE_CONTEXT_FILE_INVALID") from exc
    if len(value) > 16_384:
        raise RuntimeError("ACCEPTANCE_CONTEXT_FILE_TOO_LARGE")
    return value


def _acceptance(args: argparse.Namespace) -> int:
    from tda_companion.qwen_acceptance import (
        ACCEPTANCE_SCHEMA,
        QwenAcceptanceError,
        run_qwen_gpu_acceptance,
    )

    if args.audio is None or args.models_root is None:
        print(
            json.dumps(
                {"schema": ACCEPTANCE_SCHEMA, "pass": False, "error": "ACCEPTANCE_ARGUMENTS_REQUIRED"},
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 64
    try:
        receipt = run_qwen_gpu_acceptance(
            args.audio,
            args.models_root,
            profile_id=args.profile,
            glossary=_read_context(args.glossary_file),
            context=_read_context(args.context_file),
            required_gpu_name=args.require_gpu_name,
            transcript_out=args.transcript_out,
        )
    except QwenAcceptanceError as exc:
        print(
            json.dumps(
                {"schema": ACCEPTANCE_SCHEMA, "pass": False, "error": exc.code},
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 66
    except RuntimeError as exc:
        code = str(exc)
        if not code.startswith("ACCEPTANCE_"):
            code = "ACCEPTANCE_FAILED"
        print(
            json.dumps(
                {"schema": ACCEPTANCE_SCHEMA, "pass": False, "error": code},
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 66
    except BaseException:
        print(
            json.dumps(
                {"schema": ACCEPTANCE_SCHEMA, "pass": False, "error": "ACCEPTANCE_FAILED"},
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 70

    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="TDAQwenWorker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--probe", action="store_true")
    mode.add_argument("--acceptance", action="store_true")
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--models-root", type=Path)
    parser.add_argument(
        "--profile",
        choices=("qwen-fast", "qwen-quality"),
        default="qwen-fast",
    )
    parser.add_argument("--require-gpu-name")
    parser.add_argument("--transcript-out", type=Path)
    parser.add_argument("--glossary-file", type=Path)
    parser.add_argument("--context-file", type=Path)
    args = parser.parse_args()
    if args.probe:
        return _probe()
    if args.acceptance:
        return _acceptance(args)

    from tda_companion.asr_worker import run_worker_stdio

    return run_worker_stdio()


if __name__ == "__main__":
    raise SystemExit(main())
