from __future__ import annotations

import argparse
import json
import math
import multiprocessing
import tempfile
import wave
from pathlib import Path


def _bootstrap_whisper_runtime():
    """Initialize native ASR imports in the known-good frozen Windows order."""
    import av
    import ctranslate2
    import faster_whisper
    from faster_whisper import WhisperModel
    import pynvml  # noqa: F401 - proves physical acceptance telemetry is packaged

    if not callable(WhisperModel):
        raise RuntimeError("WHISPER_MODEL_CLASS_INVALID")
    return av, ctranslate2, faster_whisper, WhisperModel


def _decode_smoke() -> int:
    """Decode generated WAV/FLAC through Faster-Whisper without a model or GPU."""
    schema = "tda_whisper_decode_smoke_v1"
    sample_rate = 16_000
    sample_count = sample_rate
    try:
        av, _ctranslate2, _faster_whisper, _WhisperModel = _bootstrap_whisper_runtime()
        import numpy as np
        from faster_whisper.audio import decode_audio

        timeline = np.arange(sample_count, dtype=np.float64)
        pcm = (
            np.sin((2.0 * math.pi * 440.0 * timeline) / sample_rate) * 6_000
        ).astype(np.int16)

        with tempfile.TemporaryDirectory(prefix="tda-whisper-decode-smoke-") as temp_value:
            root = Path(temp_value)
            wav_path = root / "fixture.wav"
            with wave.open(str(wav_path), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(sample_rate)
                handle.writeframes(pcm.tobytes())

            flac_path = root / "fixture.flac"
            with av.open(str(flac_path), mode="w", format="flac") as container:
                stream = container.add_stream("flac", rate=sample_rate)
                frame = av.AudioFrame.from_ndarray(
                    pcm.reshape(1, -1),
                    format="s16",
                    layout="mono",
                )
                frame.sample_rate = sample_rate
                for packet in stream.encode(frame):
                    container.mux(packet)
                for packet in stream.encode(None):
                    container.mux(packet)

            formats: dict[str, dict[str, int]] = {}
            for name, path in (("wav", wav_path), ("flac", flac_path)):
                decoded = decode_audio(str(path), sampling_rate=sample_rate)
                decoded_count = int(decoded.shape[0])
                if decoded.ndim != 1 or decoded_count != sample_count:
                    raise RuntimeError("WHISPER_DECODE_SMOKE_SAMPLE_MISMATCH")
                formats[name] = {
                    "sample_rate": sample_rate,
                    "sample_count": decoded_count,
                }

        print(
            json.dumps(
                {"schema": schema, "ready": True, "formats": formats},
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 0
    except Exception as exc:
        code = (
            "WHISPER_DECODER_DEPENDENCY_INCOMPATIBLE"
            if isinstance(exc, TypeError) and "metadata_errors" in str(exc)
            else "WHISPER_DECODE_SMOKE_FAILED"
        )
        print(
            json.dumps(
                {"schema": schema, "ready": False, "error": code},
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 66


def _probe() -> int:
    """Exercise the same native bootstrap used by normal worker mode."""
    try:
        av, ctranslate2, faster_whisper, WhisperModel = _bootstrap_whisper_runtime()
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
        supported = (
            sorted(ctranslate2.get_supported_compute_types("cuda", 0))
            if device_count > 0
            else []
        )
    except Exception:
        device_count = 0
        supported = []
    print(
        json.dumps(
            {
                "schema": "tda_whisper_runtime_probe_v1",
                "ready": True,
                "faster_whisper": getattr(faster_whisper, "__version__", "unknown"),
                "ctranslate2": getattr(ctranslate2, "__version__", "unknown"),
                "av": getattr(av, "__version__", "unknown"),
                "nvml": True,
                "whisper_model_imported": getattr(WhisperModel, "__name__", "") == "WhisperModel",
                "whisper_model_module": getattr(WhisperModel, "__module__", "unknown"),
                "cuda_device_count": device_count,
                "cuda_compute_types": supported,
            },
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


def _prepare_model(args: argparse.Namespace) -> int:
    _bootstrap_whisper_runtime()
    from tda_companion.asr_models import get_profile, inspect_model_install
    from tda_companion.asr_whisper import WhisperRuntimeError, prepare_whisper_model

    schema = "tda_whisper_model_prepare_v1"
    if args.models_root is None:
        print(
            json.dumps(
                {"schema": schema, "ready": False, "error": "WHISPER_MODELS_ROOT_REQUIRED"},
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 64

    try:
        profile = get_profile(args.profile)
        if profile.engine != "whisper":
            raise WhisperRuntimeError("WHISPER_PROFILE_REQUIRED")
        before = inspect_model_install(args.models_root, profile, verify_hash=False)
        prepare_whisper_model(args.models_root, profile)
        state = inspect_model_install(args.models_root, profile, verify_hash=True)
        digest = state.get("content_sha256")
        if state.get("status") != "ready" or not isinstance(digest, str) or len(digest) != 64:
            raise WhisperRuntimeError("WHISPER_MODEL_INTEGRITY_FAILED")
        print(
            json.dumps(
                {
                    "schema": schema,
                    "ready": True,
                    "profile_id": profile.id,
                    "prepared": before.get("status") != "ready",
                    "content_sha256": digest,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 0
    except WhisperRuntimeError as exc:
        print(
            json.dumps(
                {"schema": schema, "ready": False, "error": exc.code},
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 66
    except BaseException:
        print(
            json.dumps(
                {"schema": schema, "ready": False, "error": "WHISPER_MODEL_PREPARATION_FAILED"},
                sort_keys=True,
                separators=(",", ":"),
            ),
            flush=True,
        )
        return 70


def _acceptance(args: argparse.Namespace) -> int:
    _bootstrap_whisper_runtime()
    from tda_companion.asr_acceptance import ACCEPTANCE_SCHEMA, WhisperAcceptanceError, run_whisper_gpu_acceptance

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
        receipt = run_whisper_gpu_acceptance(
            args.audio,
            args.models_root,
            profile_id=args.profile,
            glossary=_read_context(args.glossary_file),
            context=_read_context(args.context_file),
            required_gpu_name=args.require_gpu_name,
            transcript_out=args.transcript_out,
        )
    except WhisperAcceptanceError as exc:
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
    parser = argparse.ArgumentParser(prog="TDAWhisperWorker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--probe", action="store_true")
    mode.add_argument("--decode-smoke", action="store_true")
    mode.add_argument("--acceptance", action="store_true")
    mode.add_argument("--prepare-model", action="store_true")
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--models-root", type=Path)
    parser.add_argument(
        "--profile",
        choices=("whisper-turbo", "whisper-detailed"),
        default="whisper-turbo",
    )
    parser.add_argument("--require-gpu-name")
    parser.add_argument("--transcript-out", type=Path)
    parser.add_argument("--glossary-file", type=Path)
    parser.add_argument("--context-file", type=Path)
    args = parser.parse_args()
    if args.probe:
        return _probe()
    if args.decode_smoke:
        return _decode_smoke()
    if args.acceptance:
        return _acceptance(args)
    if args.prepare_model:
        return _prepare_model(args)

    # Normal worker mode uses the same single-threaded bootstrap ordering as the
    # frozen probe, but first confirms that the adjacent runtime marker matches
    # the exact sealed artifact selected and injected by the supervisor.
    from tda_companion.asr_worker import run_worker_stdio
    from tda_companion.runtime_artifact import verify_frozen_runtime_artifact

    def bootstrap_worker_runtime():
        verify_frozen_runtime_artifact()
        _av, _ctranslate2, _faster_whisper, WhisperModel = _bootstrap_whisper_runtime()
        from tda_companion.asr_whisper import bind_preloaded_whisper_model_class

        bind_preloaded_whisper_model_class(WhisperModel)

    return run_worker_stdio(pre_worker_bootstrap=bootstrap_worker_runtime)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
