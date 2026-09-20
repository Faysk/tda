from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Any

from .asr_models import (
    QWEN_FORCED_ALIGNER_MODEL_ID,
    QWEN_FORCED_ALIGNER_REVISION,
    get_profile,
)
from .qwen_physical_gate import GATE_SCHEMA as QWEN_GATE_SCHEMA

PHYSICAL_ACCEPTANCE_SUITE_SCHEMA = "tda_physical_acceptance_suite_v2"
REQUIRED_PHYSICAL_PROFILES = (
    "whisper-turbo",
    "whisper-detailed",
    "qwen-fast",
    "qwen-quality",
)

_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_SOURCE_SHA = re.compile(r"^[a-f0-9]{40}$")
_RC_TAG = re.compile(
    r"^companion-rc-v(?P<version>[0-9]+\.[0-9]+\.[0-9]+)-(?P<prefix>[a-f0-9]{12})$"
)
_VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
_COMPUTE_CAPABILITY = re.compile(r"^[0-9]+\.[0-9]+$")
_FORBIDDEN_KEYS = frozenset(
    {
        "text",
        "words",
        "segments",
        "audio",
        "audio_path",
        "transcript",
        "path",
        "token",
        "authorization",
        "password",
    }
)
_PRIVACY_PROOF_KEYS = frozenset(
    {"contains_audio", "contains_transcript", "contains_token", "contains_paths"}
)


def _canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class PhysicalAcceptanceSuiteError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _sha(value: object, code: str) -> str:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
        raise PhysicalAcceptanceSuiteError(code)
    return value


def _timestamp(value: object) -> str:
    if not isinstance(value, str) or len(value) > 64:
        raise PhysicalAcceptanceSuiteError("PHYSICAL_ACCEPTANCE_TIMESTAMP_INVALID")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_TIMESTAMP_INVALID"
        ) from exc
    if parsed.tzinfo is None:
        raise PhysicalAcceptanceSuiteError("PHYSICAL_ACCEPTANCE_TIMESTAMP_INVALID")
    return value


def _capability(value: object) -> tuple[int, int]:
    if not isinstance(value, str) or _COMPUTE_CAPABILITY.fullmatch(value) is None:
        raise PhysicalAcceptanceSuiteError("PHYSICAL_ACCEPTANCE_GPU_INVALID")
    major, minor = value.split(".", 1)
    return int(major), int(minor)


def _validate_privacy(value: object, *, depth: int = 0) -> None:
    if depth > 24:
        raise PhysicalAcceptanceSuiteError("PHYSICAL_ACCEPTANCE_TOO_DEEP")
    if isinstance(value, dict):
        for raw_key, child in value.items():
            key = str(raw_key).casefold()
            if key in _PRIVACY_PROOF_KEYS:
                if child is not False:
                    raise PhysicalAcceptanceSuiteError(
                        "PHYSICAL_ACCEPTANCE_PRIVACY_INVALID"
                    )
                continue
            if key in _FORBIDDEN_KEYS:
                raise PhysicalAcceptanceSuiteError(
                    "PHYSICAL_ACCEPTANCE_PRIVATE_FIELD"
                )
            _validate_privacy(child, depth=depth + 1)
        return
    if isinstance(value, list):
        for child in value:
            _validate_privacy(child, depth=depth + 1)
        return
    if isinstance(value, str):
        if len(value) > 1024:
            raise PhysicalAcceptanceSuiteError(
                "PHYSICAL_ACCEPTANCE_STRING_TOO_LARGE"
            )
        if re.search(r"[A-Za-z]:\\", value) or value.startswith("/") or "Bearer " in value:
            raise PhysicalAcceptanceSuiteError(
                "PHYSICAL_ACCEPTANCE_PRIVATE_VALUE"
            )


def _candidate_binding(
    receipt: dict[str, Any],
    candidate: dict[str, Any],
) -> None:
    binding = receipt.get("candidate")
    if not isinstance(binding, dict) or set(binding) != {
        "rc_tag",
        "version",
        "source_sha",
        "source_tree_sha",
        "msi_sha256",
        "payload_manifest_sha256",
    }:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID"
        )
    assets = candidate.get("assets")
    if not isinstance(assets, dict):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID"
        )
    msi = assets.get("msi")
    payload = assets.get("payload_manifest")
    if not isinstance(msi, dict) or not isinstance(payload, dict):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID"
        )
    expected = {
        "rc_tag": candidate.get("tag"),
        "version": candidate.get("version"),
        "source_sha": candidate.get("source_sha"),
        "source_tree_sha": candidate.get("source_tree_sha"),
        "msi_sha256": msi.get("sha256"),
        "payload_manifest_sha256": payload.get("sha256"),
    }
    if binding != expected:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_CANDIDATE_MISMATCH"
        )
    tag = binding.get("rc_tag")
    version = binding.get("version")
    source_sha = binding.get("source_sha")
    tree = binding.get("source_tree_sha")
    if (
        not isinstance(tag, str)
        or not isinstance(version, str)
        or _VERSION.fullmatch(version) is None
        or not isinstance(source_sha, str)
        or _SOURCE_SHA.fullmatch(source_sha) is None
        or not isinstance(tree, str)
        or _SOURCE_SHA.fullmatch(tree) is None
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID"
        )
    match = _RC_TAG.fullmatch(tag)
    if match is None or match.group("version") != version or match.group("prefix") != source_sha[:12]:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID"
        )
    _sha(binding.get("msi_sha256"), "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID")
    _sha(
        binding.get("payload_manifest_sha256"),
        "PHYSICAL_ACCEPTANCE_CANDIDATE_INVALID",
    )


def _runtime(
    value: object,
    family: str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "version",
        "worker_sha256",
        "archive_sha256",
    }:
        raise PhysicalAcceptanceSuiteError(
            f"PHYSICAL_ACCEPTANCE_{family.upper()}_RUNTIME_INVALID"
        )
    version = value.get("version")
    if not isinstance(version, str) or _VERSION.fullmatch(version) is None:
        raise PhysicalAcceptanceSuiteError(
            f"PHYSICAL_ACCEPTANCE_{family.upper()}_RUNTIME_INVALID"
        )
    _sha(
        value.get("worker_sha256"),
        f"PHYSICAL_ACCEPTANCE_{family.upper()}_RUNTIME_INVALID",
    )
    _sha(
        value.get("archive_sha256"),
        f"PHYSICAL_ACCEPTANCE_{family.upper()}_RUNTIME_INVALID",
    )
    return value


def _whisper_result(
    value: object,
    profile_id: str,
    *,
    audio_sha256: str,
    gpu_name: str,
    driver_version: str,
) -> None:
    profile = get_profile(profile_id)
    if (
        not isinstance(value, dict)
        or value.get("schema") != "tda_whisper_gpu_acceptance_v1"
        or value.get("pass") is not True
        or value.get("profile_id") != profile.id
        or value.get("model") != profile.model_id
        or value.get("model_revision") != profile.revision
        or value.get("audio_sha256") != audio_sha256
        or value.get("model_integrity") != "sha256-full"
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_WHISPER_PROFILE_INVALID"
        )
    _sha(
        value.get("model_content_sha256"),
        "PHYSICAL_ACCEPTANCE_WHISPER_MODEL_HASH_INVALID",
    )
    gpu = value.get("gpu")
    inference = value.get("inference")
    if not isinstance(gpu, dict) or not isinstance(inference, dict):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_WHISPER_PROFILE_INVALID"
        )
    if (
        str(gpu.get("name") or "") != gpu_name
        or str(gpu.get("driver") or "") != driver_version
        or gpu.get("required_name_match") is not True
        or inference.get("device") != "cuda"
        or inference.get("transcript_written") is not False
        or int(inference.get("word_count") or 0) < 1
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_WHISPER_PROFILE_INVALID"
        )


def _qwen_result(
    value: object,
    gate: object,
    profile_id: str,
    *,
    audio_sha256: str,
    gpu_name: str,
    driver_version: str,
    compute_capability: str,
    qwen_runtime: dict[str, Any],
) -> None:
    profile = get_profile(profile_id)
    if (
        not isinstance(value, dict)
        or value.get("schema") != "tda_qwen_gpu_acceptance_v1"
        or value.get("pass") is not True
        or value.get("profile_id") != profile.id
        or value.get("model") != profile.model_id
        or value.get("model_revision") != profile.revision
        or value.get("alignment_model") != QWEN_FORCED_ALIGNER_MODEL_ID
        or value.get("alignment_revision") != QWEN_FORCED_ALIGNER_REVISION
        or value.get("audio_sha256") != audio_sha256
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_QWEN_PROFILE_INVALID"
        )

    cuda = value.get("cuda")
    gpu = value.get("gpu")
    alignment_gpu = value.get("alignment_gpu")
    inference = value.get("inference")
    alignment = value.get("alignment")
    if not all(
        isinstance(item, dict)
        for item in (cuda, gpu, alignment_gpu, inference, alignment)
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_QWEN_PROFILE_INVALID"
        )
    devices = cuda.get("devices")
    first = devices[0] if isinstance(devices, list) and devices and isinstance(devices[0], dict) else {}
    if (
        cuda.get("available") is not True
        or cuda.get("execution_ready") is not True
        or str(cuda.get("driver_version") or "") != driver_version
        or str(first.get("name") or "") != gpu_name
        or str(first.get("compute_capability") or "") != compute_capability
        or str(gpu.get("name") or "") != gpu_name
        or str(alignment_gpu.get("name") or "") != gpu_name
        or gpu.get("required_name_match") is not True
        or alignment_gpu.get("required_name_match") is not True
        or inference.get("device") != "cuda"
        or inference.get("transcript_written") is not False
        or int(alignment.get("word_count") or 0) < 1
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_QWEN_PROFILE_INVALID"
        )

    if (
        not isinstance(gate, dict)
        or gate.get("schema") != QWEN_GATE_SCHEMA
        or gate.get("profile_id") != profile.id
        or gate.get("contains_audio") is not False
        or gate.get("contains_transcript") is not False
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_QWEN_GATE_INVALID"
        )
    runtime = gate.get("runtime")
    model = gate.get("model")
    aligner = gate.get("aligner")
    gate_gpu = gate.get("gpu")
    if not all(isinstance(item, dict) for item in (runtime, model, aligner, gate_gpu)):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_QWEN_GATE_INVALID"
        )
    binding = {
        "schema": QWEN_GATE_SCHEMA,
        "profile_id": profile.id,
        "runtime": runtime,
        "model": model,
        "aligner": aligner,
    }
    if (
        runtime.get("version") != qwen_runtime["version"]
        or runtime.get("worker_sha256") != qwen_runtime["worker_sha256"]
        or runtime.get("archive_sha256") != qwen_runtime["archive_sha256"]
        or model.get("model_id") != profile.model_id
        or model.get("revision") != profile.revision
        or aligner.get("model_id") != QWEN_FORCED_ALIGNER_MODEL_ID
        or aligner.get("revision") != QWEN_FORCED_ALIGNER_REVISION
        or str(gate_gpu.get("name") or "") != gpu_name
        or str(gate_gpu.get("compute_capability") or "") != compute_capability
        or gate.get("binding_sha256") != _canonical_sha256(binding)
        or gate.get("acceptance_sha256") != _canonical_sha256(value)
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_QWEN_GATE_MISMATCH"
        )
    for row, code in (
        (model, "PHYSICAL_ACCEPTANCE_QWEN_MODEL_HASH_INVALID"),
        (aligner, "PHYSICAL_ACCEPTANCE_QWEN_ALIGNER_HASH_INVALID"),
    ):
        _sha(row.get("content_sha256"), code)
        _sha(row.get("metadata_sha256"), code)


def verify_physical_acceptance_suite(
    receipt: dict[str, Any],
    candidate: dict[str, Any],
) -> None:
    expected_keys = {
        "schema",
        "pass",
        "accepted_at",
        "candidate",
        "required_gpu_name",
        "audio_sha256",
        "profiles",
        "runtimes",
        "hardware",
        "probes",
        "results",
        "qwen_gates",
        "transcripts_written",
        "contains_audio",
        "contains_transcript",
        "contains_token",
        "contains_paths",
    }
    if set(receipt) != expected_keys:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_SCHEMA_INVALID"
        )
    if (
        receipt.get("schema") != PHYSICAL_ACCEPTANCE_SUITE_SCHEMA
        or receipt.get("pass") is not True
        or receipt.get("transcripts_written") is not False
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_NOT_PASSED"
        )
    _timestamp(receipt.get("accepted_at"))
    _validate_privacy(receipt)
    _candidate_binding(receipt, candidate)

    profiles = receipt.get("profiles")
    if profiles != list(REQUIRED_PHYSICAL_PROFILES):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_PROFILES_INCOMPLETE"
        )
    audio_sha = _sha(
        receipt.get("audio_sha256"),
        "PHYSICAL_ACCEPTANCE_AUDIO_HASH_INVALID",
    )
    required_gpu_name = receipt.get("required_gpu_name")
    if not isinstance(required_gpu_name, str) or not required_gpu_name.strip():
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_GPU_INVALID"
        )

    runtimes = receipt.get("runtimes")
    if not isinstance(runtimes, dict) or set(runtimes) != {"whisper", "qwen"}:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_RUNTIMES_INVALID"
        )
    whisper_runtime = _runtime(runtimes["whisper"], "whisper")
    qwen_runtime = _runtime(runtimes["qwen"], "qwen")

    hardware = receipt.get("hardware")
    if not isinstance(hardware, dict) or set(hardware) != {
        "gpu_name",
        "driver_version",
        "compute_capability",
    }:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_GPU_INVALID"
        )
    gpu_name = hardware.get("gpu_name")
    driver = hardware.get("driver_version")
    capability = hardware.get("compute_capability")
    if (
        not isinstance(gpu_name, str)
        or not gpu_name.strip()
        or required_gpu_name.casefold() not in gpu_name.casefold()
        or not isinstance(driver, str)
        or not driver.strip()
        or not isinstance(capability, str)
        or _capability(capability) < (8, 0)
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_GPU_INVALID"
        )

    probes = receipt.get("probes")
    results = receipt.get("results")
    gates = receipt.get("qwen_gates")
    if (
        not isinstance(probes, dict)
        or set(probes) != {"whisper", "qwen"}
        or not isinstance(results, dict)
        or set(results) != set(REQUIRED_PHYSICAL_PROFILES)
        or not isinstance(gates, dict)
        or set(gates) != {"qwen-fast", "qwen-quality"}
    ):
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_RESULTS_INVALID"
        )

    for profile_id in ("whisper-turbo", "whisper-detailed"):
        _whisper_result(
            results[profile_id],
            profile_id,
            audio_sha256=audio_sha,
            gpu_name=gpu_name,
            driver_version=driver,
        )
    for profile_id in ("qwen-fast", "qwen-quality"):
        _qwen_result(
            results[profile_id],
            gates[profile_id],
            profile_id,
            audio_sha256=audio_sha,
            gpu_name=gpu_name,
            driver_version=driver,
            compute_capability=capability,
            qwen_runtime=qwen_runtime,
        )

    # Keep the local variable used so static checkers catch malformed Whisper
    # runtime rows even though per-profile Whisper receipts do not duplicate the
    # packaged worker identity.
    if not whisper_runtime["worker_sha256"]:
        raise PhysicalAcceptanceSuiteError(
            "PHYSICAL_ACCEPTANCE_WHISPER_RUNTIME_INVALID"
        )
