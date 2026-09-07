from __future__ import annotations

import gc
import hashlib
import json
import logging
import shutil
import time
from io import BytesIO
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from .fs import atomic_write_json, replace_with_retry
from .runtime import (
    TranscriptionPlan,
    configure_cuda_dlls,
    is_cuda_memory_error,
)


ProgressCallback = Callable[[dict[str, Any]], None]


def decode_audio_prefix(path: str, seconds: int, sampling_rate: int = 16000):
    """Decode only the requested prefix instead of expanding a multi-hour track."""
    import av
    import numpy as np

    max_samples = seconds * sampling_rate
    raw = BytesIO()
    resampler = av.audio.resampler.AudioResampler(
        format="s16",
        layout="mono",
        rate=sampling_rate,
    )
    with av.open(path, mode="r", metadata_errors="ignore") as container:
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                raw.write(resampled.to_ndarray().tobytes())
                if raw.tell() // 2 >= max_samples:
                    break
            if raw.tell() // 2 >= max_samples:
                break
    samples = np.frombuffer(
        raw.getbuffer(),
        dtype=np.int16,
        count=min(max_samples, raw.tell() // 2),
    )
    return samples.astype(np.float32) / 32768.0


def merge_segments(tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    timeline: list[dict[str, Any]] = []
    for track in tracks:
        speaker = track["speaker"]
        filename = track["filename"]
        for segment in track.get("segments", []):
            text = segment.get("text", "").strip()
            if not text:
                continue
            timeline.append(
                {
                    "id": f"{speaker}-{segment['id']}",
                    "speaker": speaker,
                    "track": filename,
                    "start": round(float(segment["start"]), 3),
                    "end": round(float(segment["end"]), 3),
                    "text": text,
                    "words": segment.get("words", []),
                }
            )
    timeline.sort(key=lambda item: (item["start"], item["end"], item["speaker"]))
    return timeline


def _request_signature(
    plan: TranscriptionPlan,
    *,
    glossary: str,
    sample_minutes: int | None,
) -> str:
    payload = {
        "profile": plan.profile,
        "model_id": plan.model_id,
        "model_revision": plan.model_revision,
        "glossary": glossary,
        "sample_minutes": sample_minutes,
        "language": "pt",
        "task": "transcribe",
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _model_path(model_root: Path, plan: TranscriptionPlan) -> Path:
    return model_root / f"{plan.model_name}-{plan.model_revision[:12]}"


def _model_ready(path: Path, plan: TranscriptionPlan) -> bool:
    required = ("config.json", "model.bin", "tokenizer.json", "preprocessor_config.json")
    if not all((path / filename).is_file() for filename in required):
        return False
    marker = path / ".dnd-scribe-model.json"
    if not marker.is_file():
        return False
    try:
        payload = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return (
        payload.get("model_id") == plan.model_id
        and payload.get("revision") == plan.model_revision
    )


def _ensure_model(
    model_root: Path,
    plan: TranscriptionPlan,
    report: ProgressCallback,
) -> Path:
    from faster_whisper.utils import download_model

    model_root.mkdir(parents=True, exist_ok=True)
    target = _model_path(model_root, plan)
    if _model_ready(target, plan):
        return target

    downloads = model_root / ".downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    staging = downloads / f"{target.name}-{uuid4().hex}.partial"
    try:
        report({"stage": "downloading_model", "percent": 3, "model": plan.model_name})
        download_model(
            plan.model_id,
            output_dir=str(staging),
            revision=plan.model_revision,
        )
        required = ("config.json", "model.bin", "tokenizer.json", "preprocessor_config.json")
        missing = [filename for filename in required if not (staging / filename).is_file()]
        if missing:
            raise RuntimeError(
                "Download do modelo terminou incompleto: " + ", ".join(missing)
            )
        atomic_write_json(
            staging / ".dnd-scribe-model.json",
            {
                "model_name": plan.model_name,
                "model_id": plan.model_id,
                "revision": plan.model_revision,
            },
        )
        if target.exists():
            shutil.rmtree(target)
        replace_with_retry(staging, target)
        return target
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def _load_model(
    model_path: Path,
    plan: TranscriptionPlan,
    report: ProgressCallback,
) -> tuple[Any, str, bool]:
    from faster_whisper import WhisperModel

    stage = "loading_cpu" if plan.device == "cpu" else "loading_cuda"
    report({"stage": stage, "percent": 5, "compute_type": plan.compute_type})
    try:
        model = WhisperModel(
            str(model_path),
            device=plan.device,
            compute_type=plan.compute_type,
        )
        return model, plan.compute_type, False
    except Exception as error:
        if (
            plan.device != "cuda"
            or not plan.fallback_compute_type
            or not is_cuda_memory_error(error)
        ):
            raise
        gc.collect()
        report(
            {
                "stage": "loading_cuda_fallback",
                "percent": 5,
                "compute_type": plan.fallback_compute_type,
            }
        )
        model = WhisperModel(
            str(model_path),
            device="cuda",
            compute_type=plan.fallback_compute_type,
        )
        return model, plan.fallback_compute_type, True


def _checkpoint_path(session_dir: Path, index: int, track: dict[str, Any]) -> Path:
    stem = Path(track["filename"]).stem
    return session_dir / f"transcript-{index + 1:02d}-{stem}.json"


def _load_checkpoint(
    path: Path,
    *,
    signature: str,
    source_sha256: str | None,
) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    checkpoint = value.get("_checkpoint") or {}
    if checkpoint.get("signature") != signature:
        return None
    if source_sha256 and checkpoint.get("source_sha256") != source_sha256:
        return None
    if not isinstance(value.get("segments"), list):
        return None
    return value


def transcribe_session(
    session: dict[str, Any],
    session_dir: Path,
    update: Callable[[dict[str, Any]], None],
    *,
    plan: TranscriptionPlan,
    glossary: str,
    sample_minutes: int | None,
    progress_update: ProgressCallback | None = None,
    model_root: Path | None = None,
    logger: logging.Logger | None = None,
) -> dict[str, Any]:
    configure_cuda_dlls()
    started = time.time()
    report = progress_update or (lambda _: None)
    signature = _request_signature(
        plan,
        glossary=glossary,
        sample_minutes=sample_minutes,
    )

    session["status"] = "loading_model"
    session["error"] = None
    session["progress"] = None
    session["processing"] = {
        **plan.as_dict(),
        "effective_compute_type": plan.compute_type,
        "gpu_memory_fallback": False,
        "resume_signature": signature,
    }
    update(session)
    report({"stage": "checking_model", "percent": 1, "model": plan.model_name})

    model_root = model_root or session_dir.parent.parent / "model_files"
    model_path = _ensure_model(model_root, plan, report)
    model, effective_compute_type, used_fallback = _load_model(model_path, plan, report)
    session["processing"]["effective_compute_type"] = effective_compute_type
    session["processing"]["gpu_memory_fallback"] = used_fallback
    session["device"] = plan.device
    session["compute_type"] = effective_compute_type
    update(session)

    if logger:
        logger.info(
            "transcription_start recording_id=%s profile=%s model=%s device=%s compute=%s fallback=%s",
            session.get("recording_id"),
            plan.profile,
            plan.model_name,
            plan.device,
            effective_compute_type,
            used_fallback,
        )

    output_tracks: list[dict[str, Any]] = []
    track_count = len(session["tracks"])
    completed_tracks: list[str] = []
    for index, track in enumerate(session["tracks"]):
        checkpoint_path = _checkpoint_path(session_dir, index, track)
        checkpoint = _load_checkpoint(
            checkpoint_path,
            signature=signature,
            source_sha256=track.get("sha256"),
        )
        if checkpoint is not None:
            output_tracks.append(checkpoint)
            completed_tracks.append(track["filename"])
            percent = min(99, round(5 + ((index + 1) / max(track_count, 1)) * 94))
            report(
                {
                    "stage": "resuming",
                    "track": index + 1,
                    "total_tracks": track_count,
                    "speaker": track["speaker"],
                    "percent": percent,
                    "reused": True,
                }
            )
            continue

        session["status"] = "transcribing"
        update(session)
        report(
            {
                "stage": "transcribing",
                "track": index + 1,
                "total_tracks": track_count,
                "speaker": track["speaker"],
                "percent": round(5 + (index / max(track_count, 1)) * 94),
            }
        )

        kwargs: dict[str, Any] = {
            "language": "pt",
            "task": "transcribe",
            "beam_size": 5,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 300,
            },
            "word_timestamps": True,
            "condition_on_previous_text": False,
            "hotwords": glossary or None,
        }
        if glossary:
            kwargs["initial_prompt"] = (
                "Sessão de RPG Dungeons & Dragons em português. "
                f"Nomes e termos importantes: {glossary}"
            )
        audio_input: Any = track["path"]
        if sample_minutes:
            audio_input = decode_audio_prefix(track["path"], sample_minutes * 60)

        track_started = time.time()
        segments, info = model.transcribe(audio_input, **kwargs)
        serialized_segments = []
        last_reported_percent = -1
        for segment in segments:
            words = [
                {
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                    "word": word.word,
                    "probability": round(float(word.probability), 4),
                }
                for word in (segment.words or [])
            ]
            serialized_segments.append(
                {
                    "id": segment.id,
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "text": segment.text.strip(),
                    "avg_logprob": round(float(segment.avg_logprob), 4),
                    "words": words,
                }
            )
            track_fraction = min(1.0, float(segment.end) / max(float(info.duration), 1.0))
            overall_percent = min(
                99,
                round(5 + ((index + track_fraction) / max(track_count, 1)) * 94),
            )
            if overall_percent >= last_reported_percent + 2:
                report(
                    {
                        "stage": "transcribing",
                        "track": index + 1,
                        "total_tracks": track_count,
                        "speaker": track["speaker"],
                        "percent": overall_percent,
                    }
                )
                last_reported_percent = overall_percent

        track_elapsed = max(time.time() - track_started, 0.001)
        duration = max(float(info.duration), 0.0)
        track_result = {
            **track,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 4),
            "duration": round(duration, 3),
            "duration_after_vad": round(float(info.duration_after_vad), 3),
            "segments": serialized_segments,
            "processing": {
                "elapsed_seconds": round(track_elapsed, 2),
                "rtf": round(track_elapsed / duration, 4) if duration > 0 else None,
            },
            "_checkpoint": {
                "signature": signature,
                "source_sha256": track.get("sha256"),
                "profile": plan.profile,
                "model": plan.model_name,
                "model_revision": plan.model_revision,
                "sample_minutes": sample_minutes,
            },
        }
        output_tracks.append(track_result)
        atomic_write_json(checkpoint_path, track_result)
        completed_tracks.append(track["filename"])
        session["completed_tracks"] = completed_tracks.copy()
        update(session)
        if logger:
            logger.info(
                "track_complete recording_id=%s track=%s speaker=%s duration=%.3f elapsed=%.3f rtf=%s",
                session.get("recording_id"),
                track.get("filename"),
                track.get("speaker"),
                duration,
                track_elapsed,
                track_result["processing"]["rtf"],
            )

    elapsed = max(time.time() - started, 0.001)
    durations = [float(item.get("duration") or 0) for item in output_tracks]
    audio_work_seconds = sum(durations)
    session_duration_seconds = max(durations, default=0.0)
    session["transcript"] = merge_segments(output_tracks)
    session["transcribed_tracks"] = output_tracks
    session["status"] = "complete"
    session["mode"] = "sample" if sample_minutes else "full"
    session["profile"] = plan.profile
    session["model"] = plan.model_name
    session["model_revision"] = plan.model_revision
    session["device"] = plan.device
    session["compute_type"] = effective_compute_type
    session["elapsed_seconds"] = round(elapsed, 1)
    session["processing"].update(
        {
            "effective_compute_type": effective_compute_type,
            "gpu_memory_fallback": used_fallback,
            "audio_work_seconds": round(audio_work_seconds, 3),
            "session_duration_seconds": round(session_duration_seconds, 3),
            "rtf": round(elapsed / audio_work_seconds, 4) if audio_work_seconds > 0 else None,
        }
    )
    session["progress"] = None
    update(session)
    report(
        {
            "stage": "complete",
            "track": track_count,
            "total_tracks": track_count,
            "percent": 100,
        }
    )
    if logger:
        logger.info(
            "transcription_complete recording_id=%s profile=%s elapsed=%.3f audio_work=%.3f rtf=%s",
            session.get("recording_id"),
            plan.profile,
            elapsed,
            audio_work_seconds,
            session["processing"]["rtf"],
        )
    return session


def markdown_export(session: dict[str, Any]) -> str:
    def timestamp(seconds: float) -> str:
        value = int(seconds)
        return f"{value // 3600:02d}:{(value % 3600) // 60:02d}:{value % 60:02d}"

    lines = [
        f"# Sessão {session['recording_id']}",
        "",
        f"- Início: {session.get('start_time') or 'desconhecido'}",
        f"- Modelo: {session.get('model') or '—'}",
        f"- Perfil: {session.get('profile') or '—'}",
        f"- Formato-fonte: {session.get('format', '').upper()} multi-track",
        "",
        "## Transcrição",
        "",
    ]
    for item in session.get("transcript", []):
        lines.append(f"**[{timestamp(item['start'])}] {item['speaker']}:** {item['text']}")
        lines.append("")
    return "\n".join(lines)
