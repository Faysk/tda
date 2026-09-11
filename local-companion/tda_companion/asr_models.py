from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

MODEL_MARKER = ".tda-model.json"
MODEL_MARKER_SCHEMA = "tda_model_install_v1"
_COPY_CHUNK = 1024 * 1024


class ModelRegistryError(ValueError):
    pass


@dataclass(frozen=True)
class AsrProfile:
    id: str
    engine: Literal["whisper", "qwen3"]
    label: str
    description: str
    model_id: str
    revision: str | None
    directory: str
    language: str
    alignment: str
    required_files: tuple[str, ...] = ()

    def public_dict(self) -> dict[str, str | None]:
        return {
            "id": self.id,
            "engine": self.engine,
            "label": self.label,
            "description": self.description,
            "model": self.model_id,
            "language": self.language,
            "alignment": self.alignment,
        }


_PROFILES = (
    AsrProfile(
        id="whisper-turbo",
        engine="whisper",
        label="Whisper Turbo",
        description="Whisper large-v3-turbo para processamento mais veloz.",
        model_id="dropbox-dash/faster-whisper-large-v3-turbo",
        revision="a3a0f4ee91afb49a1e120893a5bc6284a53869fa",
        directory="whisper-large-v3-turbo",
        language="pt",
        alignment="native",
        required_files=("config.json", "model.bin", "tokenizer.json", "preprocessor_config.json"),
    ),
    AsrProfile(
        id="whisper-detailed",
        engine="whisper",
        label="Whisper Detalhado",
        description="Whisper large-v3 priorizando qualidade na stack CTranslate2.",
        model_id="Systran/faster-whisper-large-v3",
        revision="edaa852ec7e145841d8ffdb056a99866b5f0a478",
        directory="whisper-large-v3",
        language="pt",
        alignment="native",
        required_files=("config.json", "model.bin", "tokenizer.json", "preprocessor_config.json"),
    ),
    AsrProfile(
        id="qwen-fast",
        engine="qwen3",
        label="Qwen Rápido",
        description="Qwen3-ASR 0.6B para menor uso de VRAM e iteração rápida.",
        model_id="Qwen/Qwen3-ASR-0.6B",
        revision=None,
        directory="qwen3-asr-0.6b",
        language="Portuguese",
        alignment="Qwen/Qwen3-ForcedAligner-0.6B",
    ),
    AsrProfile(
        id="qwen-quality",
        engine="qwen3",
        label="Qwen Qualidade",
        description="Qwen3-ASR 1.7B para priorizar qualidade textual.",
        model_id="Qwen/Qwen3-ASR-1.7B",
        revision=None,
        directory="qwen3-asr-1.7b",
        language="Portuguese",
        alignment="Qwen/Qwen3-ForcedAligner-0.6B",
    ),
)

PROFILE_REGISTRY = {profile.id: profile for profile in _PROFILES}


def get_profile(profile_id: str) -> AsrProfile:
    try:
        return PROFILE_REGISTRY[profile_id]
    except KeyError as exc:
        raise ModelRegistryError("ASR_PROFILE_UNKNOWN") from exc


def public_profiles() -> list[dict[str, str | None]]:
    return [profile.public_dict() for profile in _PROFILES]


def model_path(models_root: Path, profile: AsrProfile | str) -> Path:
    value = get_profile(profile) if isinstance(profile, str) else profile
    return models_root.resolve() / value.directory


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_COPY_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compute_model_content_sha256(directory: Path) -> str:
    root = directory.resolve()
    if not root.is_dir():
        raise ModelRegistryError("MODEL_DIRECTORY_MISSING")
    files = sorted(
        (
            path
            for path in root.rglob("*")
            if path.is_file() and path.name != MODEL_MARKER and not path.name.endswith(".partial")
        ),
        key=lambda path: path.relative_to(root).as_posix(),
    )
    if not files:
        raise ModelRegistryError("MODEL_CONTENT_EMPTY")
    digest = hashlib.sha256()
    for path in files:
        relative = path.relative_to(root).as_posix()
        stat = path.stat()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(stat.st_size).encode("ascii"))
        digest.update(b"\0")
        digest.update(_sha256_file(path).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_install_marker(directory: Path, profile: AsrProfile) -> dict[str, object]:
    root = directory.resolve()
    missing = [name for name in profile.required_files if not (root / name).is_file()]
    if missing:
        raise ModelRegistryError("MODEL_REQUIRED_FILES_MISSING")
    payload: dict[str, object] = {
        "schema": MODEL_MARKER_SCHEMA,
        "profile_id": profile.id,
        "engine": profile.engine,
        "model_id": profile.model_id,
        "revision": profile.revision,
        "content_sha256": compute_model_content_sha256(root),
        "installed_at": _utc_now(),
    }
    temporary = root / f"{MODEL_MARKER}.partial"
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    os.replace(temporary, root / MODEL_MARKER)
    return payload


def _read_marker(path: Path) -> dict[str, object] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def inspect_model_install(
    models_root: Path,
    profile: AsrProfile | str,
    *,
    verify_hash: bool = False,
) -> dict[str, object]:
    value = get_profile(profile) if isinstance(profile, str) else profile
    directory = model_path(models_root, value)
    if not directory.is_dir():
        return {"profile": value.public_dict(), "status": "missing", "path": str(directory)}

    missing = [name for name in value.required_files if not (directory / name).is_file()]
    marker = _read_marker(directory / MODEL_MARKER)
    if missing or marker is None:
        return {
            "profile": value.public_dict(),
            "status": "incomplete",
            "path": str(directory),
            "missing": missing,
        }

    expected_identity = (
        marker.get("schema") == MODEL_MARKER_SCHEMA
        and marker.get("profile_id") == value.id
        and marker.get("engine") == value.engine
        and marker.get("model_id") == value.model_id
        and marker.get("revision") == value.revision
        and isinstance(marker.get("content_sha256"), str)
        and len(str(marker.get("content_sha256"))) == 64
    )
    if not expected_identity:
        return {"profile": value.public_dict(), "status": "corrupt", "path": str(directory)}

    if verify_hash:
        try:
            actual = compute_model_content_sha256(directory)
        except ModelRegistryError:
            return {"profile": value.public_dict(), "status": "corrupt", "path": str(directory)}
        if actual != marker["content_sha256"]:
            return {"profile": value.public_dict(), "status": "corrupt", "path": str(directory)}

    return {
        "profile": value.public_dict(),
        "status": "ready",
        "path": str(directory),
        "revision": value.revision,
        "content_sha256": marker["content_sha256"],
        "installed_at": marker.get("installed_at"),
    }
