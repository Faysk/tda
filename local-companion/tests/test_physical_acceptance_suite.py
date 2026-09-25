from __future__ import annotations

import hashlib
import json
from copy import deepcopy

import pytest

from tda_companion import VERSION
from tda_companion.asr_models import (
    QWEN_FORCED_ALIGNER_MODEL_ID,
    QWEN_FORCED_ALIGNER_REVISION,
    get_profile,
)
from tda_companion.physical_acceptance_suite import (
    PHYSICAL_ACCEPTANCE_SUITE_SCHEMA,
    PhysicalAcceptanceSuiteError,
    REQUIRED_PHYSICAL_PROFILES,
    verify_physical_acceptance_suite,
)
from tda_companion.qwen_physical_gate import GATE_SCHEMA as QWEN_GATE_SCHEMA
from tda_companion.runtime_compat import (
    MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
    MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
)

SOURCE_SHA = "1" * 40
TREE_SHA = "2" * 40
MSI_SHA = "3" * 64
PAYLOAD_SHA = "4" * 64
AUDIO_SHA = "5" * 64
GPU_NAME = "NVIDIA GeForce RTX 4070 Laptop GPU"
DRIVER = "999.1"
COMPUTE = "8.9"


def _canonical(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _candidate() -> dict[str, object]:
    return {
        "schema": "tda_companion_candidate_v2",
        "channel": "rc",
        "tag": f"companion-rc-v{VERSION}-{SOURCE_SHA[:12]}",
        "version": VERSION,
        "source_sha": SOURCE_SHA,
        "source_tree_sha": TREE_SHA,
        "workflow_run_id": 123,
        "assets": {
            "msi": {
                "name": "TDACompanion-x64.msi",
                "sha256": MSI_SHA,
                "size": 100,
            },
            "checksum": {
                "name": "TDACompanion-x64.msi.sha256",
                "sha256": "6" * 64,
                "size": 100,
            },
            "zip": {
                "name": f"TDACompanion-{VERSION}-windows-x64.zip",
                "sha256": "7" * 64,
                "size": 100,
            },
            "payload_manifest": {
                "name": "TDACompanion-payload-manifest.json",
                "sha256": PAYLOAD_SHA,
                "size": 100,
            },
        },
    }


def _whisper_result(profile_id: str) -> dict[str, object]:
    profile = get_profile(profile_id)
    return {
        "schema": "tda_whisper_gpu_acceptance_v1",
        "pass": True,
        "profile_id": profile.id,
        "model": profile.model_id,
        "model_revision": profile.revision,
        "model_content_sha256": "8" * 64,
        "model_integrity": "sha256-full",
        "audio_sha256": AUDIO_SHA,
        "runtime": {"faster_whisper": "1.2.1"},
        "cuda": {"device_count": 1, "supported_compute_types": ["float16"]},
        "gpu": {
            "name": GPU_NAME,
            "driver": DRIVER,
            "required_name": "RTX 4070",
            "required_name_match": True,
        },
        "inference": {
            "device": "cuda",
            "compute_type": "float16",
            "word_count": 42,
            "transcript_sha256": "9" * 64,
            "transcript_written": False,
        },
    }


def _qwen_result(profile_id: str) -> dict[str, object]:
    profile = get_profile(profile_id)
    return {
        "schema": "tda_qwen_gpu_acceptance_v1",
        "pass": True,
        "profile_id": profile.id,
        "model": profile.model_id,
        "model_revision": profile.revision,
        "alignment_model": QWEN_FORCED_ALIGNER_MODEL_ID,
        "alignment_revision": QWEN_FORCED_ALIGNER_REVISION,
        "language": "Portuguese",
        "audio_sha256": AUDIO_SHA,
        "runtime": {"torch": "test"},
        "cuda": {
            "available": True,
            "device_count": 1,
            "execution_ready": True,
            "execution_error": None,
            "driver_version": DRIVER,
            "devices": [
                {
                    "index": 0,
                    "name": GPU_NAME,
                    "compute_capability": COMPUTE,
                    "total_memory_bytes": 8 * 1024**3,
                }
            ],
        },
        "gpu": {
            "name": GPU_NAME,
            "driver": DRIVER,
            "required_name": "RTX 4070",
            "required_name_match": True,
        },
        "alignment_gpu": {
            "name": GPU_NAME,
            "driver": DRIVER,
            "required_name": "RTX 4070",
            "required_name_match": True,
        },
        "inference": {
            "device": "cuda",
            "compute_type": "bfloat16",
            "audio_seconds": 90.0,
            "rtf": 0.5,
            "transcript_sha256": "a" * 64,
            "transcript_written": False,
        },
        "alignment": {
            "compute_type": "bfloat16",
            "rtf": 0.2,
            "word_count": 42,
        },
        "total_seconds": 63.0,
    }


def _qwen_gate(
    profile_id: str,
    result: dict[str, object],
    qwen_runtime: dict[str, object],
) -> dict[str, object]:
    profile = get_profile(profile_id)
    runtime = {
        "runtime_id": "qwen3-transformers",
        "version": qwen_runtime["version"],
        "worker_sha256": qwen_runtime["worker_sha256"],
        "archive_sha256": qwen_runtime["archive_sha256"],
        "worker_metadata_sha256": "b" * 64,
    }
    model = {
        "profile_id": profile.id,
        "model_id": profile.model_id,
        "revision": profile.revision,
        "content_sha256": "c" * 64,
        "metadata_sha256": "d" * 64,
    }
    aligner = {
        "model_id": QWEN_FORCED_ALIGNER_MODEL_ID,
        "revision": QWEN_FORCED_ALIGNER_REVISION,
        "content_sha256": "e" * 64,
        "metadata_sha256": "f" * 64,
    }
    binding = {
        "schema": QWEN_GATE_SCHEMA,
        "profile_id": profile.id,
        "runtime": runtime,
        "model": model,
        "aligner": aligner,
    }
    return {
        **binding,
        "binding_sha256": _canonical(binding),
        "acceptance_sha256": _canonical(result),
        "accepted_at": "2026-09-20T18:00:00Z",
        "metadata_sealed_at": "2026-09-20T18:00:00Z",
        "required_gpu_name": "RTX 4070",
        "gpu": {
            "name": GPU_NAME,
            "compute_capability": COMPUTE,
            "total_memory_bytes": 8 * 1024**3,
        },
        "metrics": {
            "compute_type": "bfloat16",
            "audio_seconds": 90.0,
            "transcription_rtf": 0.5,
            "alignment_rtf": 0.2,
            "word_count": 42,
        },
        "contains_audio": False,
        "contains_transcript": False,
    }


def _receipt() -> dict[str, object]:
    whisper_runtime = {
        "version": MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
        "worker_sha256": "0" * 64,
        "archive_sha256": "1" * 64,
    }
    qwen_runtime = {
        "version": MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
        "worker_sha256": "2" * 64,
        "archive_sha256": "3" * 64,
    }
    results = {
        "whisper-turbo": _whisper_result("whisper-turbo"),
        "whisper-detailed": _whisper_result("whisper-detailed"),
        "qwen-fast": _qwen_result("qwen-fast"),
        "qwen-quality": _qwen_result("qwen-quality"),
    }
    return {
        "schema": PHYSICAL_ACCEPTANCE_SUITE_SCHEMA,
        "pass": True,
        "accepted_at": "2026-09-20T18:00:00+00:00",
        "candidate": {
            "rc_tag": f"companion-rc-v{VERSION}-{SOURCE_SHA[:12]}",
            "version": VERSION,
            "source_sha": SOURCE_SHA,
            "source_tree_sha": TREE_SHA,
            "msi_sha256": MSI_SHA,
            "payload_manifest_sha256": PAYLOAD_SHA,
        },
        "required_gpu_name": "RTX 4070",
        "audio_sha256": AUDIO_SHA,
        "profiles": list(REQUIRED_PHYSICAL_PROFILES),
        "runtimes": {
            "whisper": whisper_runtime,
            "qwen": qwen_runtime,
        },
        "hardware": {
            "gpu_name": GPU_NAME,
            "driver_version": DRIVER,
            "compute_capability": COMPUTE,
        },
        "probes": {
            "whisper": {"ready": True},
            "qwen": {"ready": True},
        },
        "results": results,
        "qwen_gates": {
            "qwen-fast": _qwen_gate(
                "qwen-fast",
                results["qwen-fast"],
                qwen_runtime,
            ),
            "qwen-quality": _qwen_gate(
                "qwen-quality",
                results["qwen-quality"],
                qwen_runtime,
            ),
        },
        "transcripts_written": False,
        "contains_audio": False,
        "contains_transcript": False,
        "contains_token": False,
        "contains_paths": False,
    }


def test_physical_suite_accepts_exact_candidate_and_all_four_profiles():
    verify_physical_acceptance_suite(_receipt(), _candidate())


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        (
            lambda receipt: receipt["candidate"].__setitem__(
                "msi_sha256", "f" * 64
            ),
            "PHYSICAL_ACCEPTANCE_CANDIDATE_MISMATCH",
        ),
        (
            lambda receipt: receipt.__setitem__(
                "profiles",
                ["whisper-turbo", "qwen-fast", "qwen-quality"],
            ),
            "PHYSICAL_ACCEPTANCE_PROFILES_INCOMPLETE",
        ),
        (
            lambda receipt: receipt["hardware"].__setitem__(
                "compute_capability", "7.5"
            ),
            "PHYSICAL_ACCEPTANCE_GPU_INVALID",
        ),
        (
            lambda receipt: receipt["results"]["whisper-turbo"].__setitem__(
                "model_revision", "changed"
            ),
            "PHYSICAL_ACCEPTANCE_WHISPER_PROFILE_INVALID",
        ),
        (
            lambda receipt: receipt["results"]["qwen-fast"]["cuda"].__setitem__(
                "driver_version", "changed"
            ),
            "PHYSICAL_ACCEPTANCE_QWEN_PROFILE_INVALID",
        ),
        (
            lambda receipt: receipt["qwen_gates"]["qwen-fast"]["model"].__setitem__(
                "content_sha256", "0" * 64
            ),
            "PHYSICAL_ACCEPTANCE_QWEN_GATE_MISMATCH",
        ),
        (
            lambda receipt: receipt.__setitem__("contains_paths", True),
            "PHYSICAL_ACCEPTANCE_PRIVACY_INVALID",
        ),
    ],
)
def test_physical_suite_rejects_identity_hardware_model_and_privacy_drift(
    mutation,
    code: str,
):
    receipt = deepcopy(_receipt())
    mutation(receipt)
    with pytest.raises(PhysicalAcceptanceSuiteError, match=code):
        verify_physical_acceptance_suite(receipt, _candidate())


def test_physical_suite_rejects_private_payload_even_when_proof_flags_are_false():
    receipt = _receipt()
    receipt["results"]["qwen-quality"]["text"] = "private transcript"
    with pytest.raises(
        PhysicalAcceptanceSuiteError,
        match="PHYSICAL_ACCEPTANCE_PRIVATE_FIELD",
    ):
        verify_physical_acceptance_suite(receipt, _candidate())


def test_qwen_gate_must_be_from_the_exact_acceptance_result():
    receipt = _receipt()
    receipt["results"]["qwen-fast"]["total_seconds"] = 64.0
    with pytest.raises(
        PhysicalAcceptanceSuiteError,
        match="PHYSICAL_ACCEPTANCE_QWEN_GATE_MISMATCH",
    ):
        verify_physical_acceptance_suite(receipt, _candidate())
