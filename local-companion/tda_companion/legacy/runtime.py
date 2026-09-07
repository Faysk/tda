from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


_DLL_HANDLES: list[Any] = []
_DLL_PATHS: set[str] = set()


@dataclass(frozen=True)
class ModelProfile:
    name: str
    label: str
    description: str
    model_name: str
    model_id: str
    revision: str


@dataclass(frozen=True)
class TranscriptionPlan:
    profile: str
    model_name: str
    model_id: str
    model_revision: str
    device: str
    compute_type: str
    fallback_compute_type: str | None
    cpu_requested: bool

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


MODEL_PROFILES = {
    "fast": ModelProfile(
        name="fast",
        label="Rápido",
        description="Whisper large-v3-turbo para amostras e processamento mais veloz.",
        model_name="large-v3-turbo",
        model_id="dropbox-dash/faster-whisper-large-v3-turbo",
        revision="a3a0f4ee91afb49a1e120893a5bc6284a53869fa",
    ),
    "detailed": ModelProfile(
        name="detailed",
        label="Detalhado",
        description="Whisper large-v3 priorizando a melhor qualidade disponível nesta stack.",
        model_name="large-v3",
        model_id="Systran/faster-whisper-large-v3",
        revision="edaa852ec7e145841d8ffdb056a99866b5f0a478",
    ),
}


def public_profiles() -> list[dict[str, Any]]:
    return [
        {
            "name": profile.name,
            "label": profile.label,
            "description": profile.description,
            "model": profile.model_name,
        }
        for profile in MODEL_PROFILES.values()
    ]


def configure_cuda_dlls() -> list[str]:
    """Expose pip-installed NVIDIA DLLs to CTranslate2 on Windows."""
    if sys.platform != "win32" or not hasattr(os, "add_dll_directory"):
        return []
    site_packages = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    candidates = [
        site_packages / "cublas" / "bin",
        site_packages / "cudnn" / "bin",
        site_packages / "cuda_nvrtc" / "bin",
    ]
    configured: list[str] = []
    for directory in candidates:
        if not directory.is_dir():
            continue
        resolved = str(directory.resolve())
        key = resolved.lower()
        if key not in _DLL_PATHS:
            _DLL_HANDLES.append(os.add_dll_directory(resolved))
            _DLL_PATHS.add(key)
        configured.append(resolved)
    if configured:
        current = os.environ.get("PATH", "")
        current_lower = current.lower()
        missing = [item for item in configured if item.lower() not in current_lower]
        if missing:
            os.environ["PATH"] = os.pathsep.join(missing + [current])
    return configured


def _nvidia_smi_path() -> str | None:
    found = shutil.which("nvidia-smi")
    if found:
        return found
    program_files = os.environ.get("ProgramFiles")
    if not program_files:
        return None
    candidate = Path(program_files) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe"
    return str(candidate) if candidate.is_file() else None


def _nvidia_smi() -> list[dict[str, Any]]:
    executable = _nvidia_smi_path()
    if not executable:
        return []
    try:
        result = subprocess.run(
            [
                executable,
                "--query-gpu=index,name,memory.total,memory.free,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=4,
            check=True,
            creationflags=(subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0),
        )
    except (OSError, subprocess.SubprocessError):
        return []
    devices: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        parts = [item.strip() for item in line.split(",")]
        if len(parts) != 5:
            continue
        try:
            index = int(parts[0])
            total_mib = int(parts[2])
            free_mib = int(parts[3])
        except ValueError:
            continue
        devices.append(
            {
                "index": index,
                "name": parts[1],
                "memory_total_mib": total_mib,
                "memory_free_mib": free_mib,
                "driver_version": parts[4],
            }
        )
    return devices


def probe_cuda() -> dict[str, Any]:
    configured_dlls = configure_cuda_dlls()
    try:
        import ctranslate2

        count = ctranslate2.get_cuda_device_count()
        devices = _nvidia_smi()
        supported: list[str] = []
        if count > 0:
            supported = sorted(ctranslate2.get_supported_compute_types("cuda", 0))
        try:
            ct2_version = version("ctranslate2")
        except PackageNotFoundError:
            ct2_version = getattr(ctranslate2, "__version__", "unknown")
        return {
            "available": count > 0,
            "device_count": count,
            "supported_compute_types": supported,
            "devices": devices,
            "dll_directories": configured_dlls,
            "ctranslate2_version": ct2_version,
            "error": None,
        }
    except Exception as error:
        return {
            "available": False,
            "device_count": 0,
            "supported_compute_types": [],
            "devices": _nvidia_smi(),
            "dll_directories": configured_dlls,
            "ctranslate2_version": None,
            "error": f"{type(error).__name__}: {error}",
        }


def resolve_plan(
    profile_name: str,
    *,
    cpu: bool = False,
    cuda_status: dict[str, Any] | None = None,
) -> TranscriptionPlan:
    profile = MODEL_PROFILES.get(profile_name)
    if profile is None:
        raise ValueError("Perfil de transcrição inválido. Use fast ou detailed.")

    if cpu:
        return TranscriptionPlan(
            profile=profile.name,
            model_name=profile.model_name,
            model_id=profile.model_id,
            model_revision=profile.revision,
            device="cpu",
            compute_type="int8",
            fallback_compute_type=None,
            cpu_requested=True,
        )

    status = cuda_status or probe_cuda()
    if not status.get("available"):
        detail = status.get("error") or "Nenhuma GPU CUDA compatível foi encontrada."
        raise RuntimeError(
            "A GPU NVIDIA não está pronta para transcrição. "
            f"{detail} A CPU só será usada se você ativar essa opção manualmente."
        )
    supported = set(status.get("supported_compute_types") or [])
    if "float16" in supported:
        compute_type = "float16"
        fallback = "int8_float16" if "int8_float16" in supported else None
    elif "int8_float16" in supported:
        compute_type = "int8_float16"
        fallback = None
    else:
        raise RuntimeError(
            "A GPU foi encontrada, mas o CTranslate2 não informou suporte a float16 "
            "nem int8_float16. Atualize o driver NVIDIA ou use CPU manualmente."
        )
    return TranscriptionPlan(
        profile=profile.name,
        model_name=profile.model_name,
        model_id=profile.model_id,
        model_revision=profile.revision,
        device="cuda",
        compute_type=compute_type,
        fallback_compute_type=fallback,
        cpu_requested=False,
    )


def is_cuda_memory_error(error: BaseException) -> bool:
    text = f"{type(error).__name__}: {error}".lower()
    markers = (
        "out of memory",
        "not enough memory",
        "cublas_status_alloc_failed",
        "cuda_error_out_of_memory",
        "failed to allocate",
    )
    return any(marker in text for marker in markers)


def friendly_runtime_error(error: BaseException) -> str:
    text = str(error)
    lowered = text.lower()
    if is_cuda_memory_error(error):
        return (
            "A GPU ficou sem memória durante o processamento. Feche jogos, geradores de imagem, "
            "Blender ou outros aplicativos que usam VRAM e tente novamente. O DnD Scribe não "
            "muda para CPU sozinho."
        )
    if "cudnn" in lowered or "cublas" in lowered or "dll" in lowered:
        return (
            "O motor CUDA não conseguiu carregar uma biblioteca NVIDIA. Use 'Atualizar componentes' "
            "no ícone do DnD Scribe e confirme que o driver NVIDIA está atualizado."
        )
    if isinstance(error, PermissionError):
        return (
            "O Windows bloqueou temporariamente um arquivo do DnD Scribe. O programa tentou novamente, "
            "mas não conseguiu concluir a gravação com segurança. Verifique antivírus, permissões da pasta "
            "de dados e tente novamente."
        )
    return f"{type(error).__name__}: {text}"
