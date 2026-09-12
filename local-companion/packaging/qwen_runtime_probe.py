from __future__ import annotations

import json
import sys
from importlib import metadata


def _version(distribution: str) -> str:
    try:
        return metadata.version(distribution)
    except metadata.PackageNotFoundError:
        return "unavailable"


def main() -> int:
    try:
        import accelerate
        import av
        import huggingface_hub
        import numpy
        import pynvml
        import safetensors
        import torch
        import transformers
        from transformers import (
            AutoModelForMultimodalLM,
            AutoModelForTokenClassification,
            AutoProcessor,
            Qwen3ASRConfig,
            Qwen3ASRForConditionalGeneration,
        )

        del accelerate, av, huggingface_hub, numpy, pynvml, safetensors
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

    cuda_available = bool(torch.cuda.is_available())
    device_count = int(torch.cuda.device_count()) if cuda_available else 0
    devices: list[dict[str, object]] = []
    for index in range(device_count):
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

    payload = {
        "schema": "tda_qwen_runtime_probe_v1",
        "ready": True,
        "python": sys.version.split()[0],
        "torch": _version("torch"),
        "torch_cuda": str(torch.version.cuda or "none"),
        "transformers": transformers.__version__,
        "accelerate": _version("accelerate"),
        "huggingface_hub": _version("huggingface-hub"),
        "safetensors": _version("safetensors"),
        "av": _version("av"),
        "numpy": _version("numpy"),
        "nvidia_ml_py": _version("nvidia-ml-py"),
        "qwen3_asr_native": True,
        "forced_aligner_native": True,
        "cuda_available": cuda_available,
        "cuda_device_count": device_count,
        "bf16_supported": bool(torch.cuda.is_bf16_supported()) if cuda_available else False,
        "devices": devices,
    }
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
