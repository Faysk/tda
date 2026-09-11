from __future__ import annotations

import argparse
import json


def _probe() -> int:
    """Import the packaged ASR stack without loading/downloading any model."""
    try:
        import av
        import ctranslate2
        import faster_whisper
    except Exception as exc:
        print(
            json.dumps(
                {
                    "schema": "tda_whisper_runtime_probe_v1",
                    "ready": False,
                    "error": type(exc).__name__,
                },
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 1

    try:
        device_count = int(ctranslate2.get_cuda_device_count())
    except Exception:
        device_count = 0
    print(
        json.dumps(
            {
                "schema": "tda_whisper_runtime_probe_v1",
                "ready": True,
                "faster_whisper": getattr(faster_whisper, "__version__", "unknown"),
                "ctranslate2": getattr(ctranslate2, "__version__", "unknown"),
                "av": getattr(av, "__version__", "unknown"),
                "cuda_device_count": device_count,
            },
            sort_keys=True,
            separators=(",", ":"),
        ),
        flush=True,
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="TDAWhisperWorker")
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    if args.probe:
        return _probe()

    from tda_companion.asr_worker import run_worker_stdio

    return run_worker_stdio()


if __name__ == "__main__":
    raise SystemExit(main())
