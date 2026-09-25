from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from tda_companion import VERSION
from tda_companion.asr_models import (
    QWEN_FORCED_ALIGNER_MODEL_ID,
    QWEN_FORCED_ALIGNER_REVISION,
    get_profile,
)
from tda_companion.installed_acceptance import INSTALLED_ACCEPTANCE_SCHEMA, REQUIRED_OBSERVATIONS
from tda_companion.physical_acceptance_suite import (
    PHYSICAL_ACCEPTANCE_SUITE_SCHEMA,
    REQUIRED_PHYSICAL_PROFILES,
)
from tda_companion.qwen_physical_gate import GATE_SCHEMA as QWEN_GATE_SCHEMA
from tda_companion.runtime_compat import (
    MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
    MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
)
from tda_companion.payload_evidence import create_payload_manifest
from tda_companion.release_evidence import (
    ReleaseEvidenceError,
    build_candidate_manifest,
    build_promotion_evidence,
    sha256_file,
    verify_acceptance_receipt,
    verify_candidate_files,
)

SOURCE_SHA = "1" * 40
TREE_SHA = "a" * 40


def _candidate_files(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    msi = tmp_path / "TDACompanion-x64.msi"
    msi.write_bytes(b"candidate-msi-bytes")
    checksum = tmp_path / "TDACompanion-x64.msi.sha256"
    checksum.write_text(f"{sha256_file(msi)}  TDACompanion-x64.msi", encoding="ascii")
    archive = tmp_path / f"TDACompanion-{VERSION}-windows-x64.zip"
    archive.write_bytes(b"candidate-zip-bytes")
    app = tmp_path / "app"
    app.mkdir()
    for index, name in enumerate(
        (
            "TDACompanion.exe",
            "TDACompanionMaintenance.exe",
            "run-physical-acceptance.ps1",
            "run-installed-acceptance.ps1",
            "install-rc-runtimes.ps1",
        ),
        start=1,
    ):
        (app / name).write_bytes(f"payload-{index}-{name}".encode())
    payload = tmp_path / "TDACompanion-payload-manifest.json"
    create_payload_manifest(
        app,
        version=VERSION,
        source_sha=SOURCE_SHA,
        source_tree_sha=TREE_SHA,
        destination=payload,
    )
    return msi, checksum, archive, payload


def _manifest(tmp_path: Path) -> dict[str, object]:
    msi, checksum, archive, payload = _candidate_files(tmp_path)
    return build_candidate_manifest(
        source_sha=SOURCE_SHA,
        source_tree_sha=TREE_SHA,
        workflow_run_id=12345,
        msi_path=msi,
        checksum_path=checksum,
        zip_path=archive,
        payload_manifest_path=payload,
    )


def _bits_evidence() -> dict[str, object]:
    return {
        "schema": "tda_bits_resume_evidence_v1",
        "pass": True,
        "job_id_sha256": "5" * 64,
        "bytes_before": 1024,
        "bytes_after": 4096,
        "bytes_total": 8192,
        "state_before": "Transferring",
        "state_after": "Transferring",
        "same_job": True,
        "reused_job": True,
        "contains_paths": False,
        "contains_url": False,
    }


def _receipt(manifest: dict[str, object]) -> dict[str, object]:
    assets = manifest["assets"]
    assert isinstance(assets, dict)
    msi = assets["msi"]
    payload = assets["payload_manifest"]
    assert isinstance(msi, dict) and isinstance(payload, dict)
    return {
        "schema": INSTALLED_ACCEPTANCE_SCHEMA,
        "pass": True,
        "accepted_at": "2026-09-13T20:00:00+00:00",
        "stage": "completed",
        "version": VERSION,
        "contains_token": False,
        "contains_paths": False,
        "contains_transcript": False,
        "artifact": {
            "version": VERSION,
            "source_sha": manifest["source_sha"],
            "source_tree_sha": manifest["source_tree_sha"],
            "msi_sha256": msi["sha256"],
            "payload_manifest_sha256": payload["sha256"],
            "executable_sha256": "2" * 64,
            "maintenance_helper_sha256": "3" * 64,
        },
        "checks": {
            "observations": {name: True for name in REQUIRED_OBSERVATIONS},
            "background_download_resume": _bits_evidence(),
            "craig_fixture": {"track_count": 4, "zip_sha256": "4" * 64},
            "diagnostics": {
                "overall": "degraded",
                "capabilities": {
                    "core": {"state": "ready", "severity": "info"},
                    "network": {"state": "ready", "severity": "info"},
                    "maintenance": {"state": "ready", "severity": "info"},
                    "whisper": {"state": "degraded", "severity": "degraded"},
                    "qwen": {"state": "degraded", "severity": "degraded"},
                },
            },
        },
    }


def _canonical(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _physical_receipt(manifest: dict[str, object]) -> dict[str, object]:
    assets = manifest["assets"]
    assert isinstance(assets, dict)
    msi = assets["msi"]
    payload = assets["payload_manifest"]
    assert isinstance(msi, dict) and isinstance(payload, dict)
    audio_sha = "5" * 64
    gpu_name = "NVIDIA GeForce RTX 4070 Laptop GPU"
    driver = "999.1"
    compute = "8.9"
    whisper_runtime = {
        "version": MIN_COMPATIBLE_WHISPER_RUNTIME_VERSION,
        "worker_sha256": "6" * 64,
        "archive_sha256": "7" * 64,
    }
    qwen_runtime = {
        "version": MIN_COMPATIBLE_QWEN_RUNTIME_VERSION,
        "worker_sha256": "8" * 64,
        "archive_sha256": "9" * 64,
    }

    def whisper(profile_id: str):
        profile = get_profile(profile_id)
        return {
            "schema": "tda_whisper_gpu_acceptance_v1",
            "pass": True,
            "profile_id": profile.id,
            "model": profile.model_id,
            "model_revision": profile.revision,
            "model_content_sha256": "a" * 64,
            "model_integrity": "sha256-full",
            "audio_sha256": audio_sha,
            "gpu": {
                "name": gpu_name,
                "driver": driver,
                "required_name_match": True,
            },
            "inference": {
                "device": "cuda",
                "word_count": 10,
                "transcript_written": False,
            },
        }

    def qwen(profile_id: str):
        profile = get_profile(profile_id)
        return {
            "schema": "tda_qwen_gpu_acceptance_v1",
            "pass": True,
            "profile_id": profile.id,
            "model": profile.model_id,
            "model_revision": profile.revision,
            "alignment_model": QWEN_FORCED_ALIGNER_MODEL_ID,
            "alignment_revision": QWEN_FORCED_ALIGNER_REVISION,
            "audio_sha256": audio_sha,
            "cuda": {
                "available": True,
                "device_count": 1,
                "execution_ready": True,
                "driver_version": driver,
                "devices": [
                    {
                        "name": gpu_name,
                        "compute_capability": compute,
                    }
                ],
            },
            "gpu": {
                "name": gpu_name,
                "required_name_match": True,
            },
            "alignment_gpu": {
                "name": gpu_name,
                "required_name_match": True,
            },
            "inference": {
                "device": "cuda",
                "transcript_written": False,
            },
            "alignment": {"word_count": 10},
        }

    results = {
        "whisper-turbo": whisper("whisper-turbo"),
        "whisper-detailed": whisper("whisper-detailed"),
        "qwen-fast": qwen("qwen-fast"),
        "qwen-quality": qwen("qwen-quality"),
    }

    def gate(profile_id: str):
        profile = get_profile(profile_id)
        runtime = {
            "runtime_id": "qwen3-transformers",
            **qwen_runtime,
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
            "acceptance_sha256": _canonical(results[profile_id]),
            "gpu": {
                "name": gpu_name,
                "compute_capability": compute,
            },
            "contains_audio": False,
            "contains_transcript": False,
        }

    return {
        "schema": PHYSICAL_ACCEPTANCE_SUITE_SCHEMA,
        "pass": True,
        "accepted_at": "2026-09-20T20:00:00+00:00",
        "candidate": {
            "rc_tag": manifest["tag"],
            "version": manifest["version"],
            "source_sha": manifest["source_sha"],
            "source_tree_sha": manifest["source_tree_sha"],
            "msi_sha256": msi["sha256"],
            "payload_manifest_sha256": payload["sha256"],
        },
        "required_gpu_name": "RTX 4070",
        "audio_sha256": audio_sha,
        "profiles": list(REQUIRED_PHYSICAL_PROFILES),
        "runtimes": {
            "whisper": whisper_runtime,
            "qwen": qwen_runtime,
        },
        "hardware": {
            "gpu_name": gpu_name,
            "driver_version": driver,
            "compute_capability": compute,
        },
        "probes": {
            "whisper": {"ready": True},
            "qwen": {"ready": True},
        },
        "results": results,
        "qwen_gates": {
            "qwen-fast": gate("qwen-fast"),
            "qwen-quality": gate("qwen-quality"),
        },
        "transcripts_written": False,
        "contains_audio": False,
        "contains_transcript": False,
        "contains_token": False,
        "contains_paths": False,
    }


def test_candidate_manifest_pins_source_tree_and_all_distribution_bytes(tmp_path: Path):
    manifest = _manifest(tmp_path)
    assert manifest["tag"] == f"companion-rc-v{VERSION}-{'1' * 12}"
    assert manifest["source_sha"] == SOURCE_SHA
    assert manifest["source_tree_sha"] == TREE_SHA
    verify_candidate_files(manifest, tmp_path)


def test_candidate_files_fail_when_msi_changes_after_manifest(tmp_path: Path):
    manifest = _manifest(tmp_path)
    (tmp_path / "TDACompanion-x64.msi").write_bytes(b"changed")
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ASSET_"):
        verify_candidate_files(manifest, tmp_path)


def test_candidate_rejects_payload_manifest_for_other_source_tree(tmp_path: Path):
    msi, checksum, archive, payload = _candidate_files(tmp_path)
    value = json.loads(payload.read_text(encoding="utf-8"))
    value["source_tree_sha"] = "b" * 40
    payload.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_PAYLOAD_TREE_MISMATCH"):
        build_candidate_manifest(
            source_sha=SOURCE_SHA,
            source_tree_sha=TREE_SHA,
            workflow_run_id=12345,
            msi_path=msi,
            checksum_path=checksum,
            zip_path=archive,
            payload_manifest_path=payload,
        )


def test_acceptance_receipt_must_match_candidate_source_msi_tree_and_payload(tmp_path: Path):
    manifest = _manifest(tmp_path)
    receipt = _receipt(manifest)
    receipt["artifact"]["msi_sha256"] = "f" * 64
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_MSI_MISMATCH"):
        verify_acceptance_receipt(receipt, manifest)

    receipt = _receipt(manifest)
    receipt["artifact"]["source_tree_sha"] = "b" * 40
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_TREE_MISMATCH"):
        verify_acceptance_receipt(receipt, manifest)

    receipt = _receipt(manifest)
    receipt["artifact"]["payload_manifest_sha256"] = "f" * 64
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_PAYLOAD_MISMATCH"):
        verify_acceptance_receipt(receipt, manifest)


def test_acceptance_receipt_requires_every_physical_observation(tmp_path: Path):
    manifest = _manifest(tmp_path)
    receipt = _receipt(manifest)
    receipt["checks"]["observations"]["agent_recovery"] = False
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_OBSERVATIONS_INVALID"):
        verify_acceptance_receipt(receipt, manifest)


def test_acceptance_receipt_requires_measured_same_job_bits_progress(tmp_path: Path):
    manifest = _manifest(tmp_path)
    receipt = _receipt(manifest)
    receipt["checks"]["background_download_resume"]["same_job"] = False
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_BITS_INVALID"):
        verify_acceptance_receipt(receipt, manifest)

    receipt = _receipt(manifest)
    receipt["checks"]["background_download_resume"]["bytes_after"] = 1024
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_BITS_INVALID"):
        verify_acceptance_receipt(receipt, manifest)


def test_acceptance_receipt_requires_operational_core_network_and_maintenance(tmp_path: Path):
    manifest = _manifest(tmp_path)
    receipt = _receipt(manifest)
    receipt["checks"]["diagnostics"]["capabilities"]["network"]["state"] = "blocked"
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_CAPABILITY_NOT_READY"):
        verify_acceptance_receipt(receipt, manifest)


def test_acceptance_receipt_rejects_extra_top_level_or_nested_payload(tmp_path: Path):
    manifest = _manifest(tmp_path)
    receipt = _receipt(manifest)
    receipt["extra"] = "must-not-be-carried-into-release-evidence"
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_SCHEMA_INVALID"):
        verify_acceptance_receipt(receipt, manifest)
    receipt = _receipt(manifest)
    receipt["checks"]["craig_fixture"]["speaker_names"] = ["private"]
    with pytest.raises(ReleaseEvidenceError, match="RELEASE_ACCEPTANCE_CRAIG_INVALID"):
        verify_acceptance_receipt(receipt, manifest)


def test_promotion_evidence_reuses_exact_candidate_bytes(tmp_path: Path):
    manifest = _manifest(tmp_path)
    receipt = _receipt(manifest)
    physical = _physical_receipt(manifest)
    manifest_path = tmp_path / "TDACompanion-candidate.json"
    receipt_path = tmp_path / "TDACompanion-acceptance.json"
    physical_path = tmp_path / "TDACompanion-physical-acceptance.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    physical_path.write_text(json.dumps(physical), encoding="utf-8")
    evidence = build_promotion_evidence(
        candidate_manifest_path=manifest_path,
        acceptance_receipt_path=receipt_path,
        physical_acceptance_receipt_path=physical_path,
        assets_root=tmp_path,
    )
    assert evidence["schema"] == "tda_companion_promotion_v3"
    assert evidence["candidate_tag"] == manifest["tag"]
    assert evidence["stable_tag"] == f"companion-v{VERSION}"
    assert evidence["source_sha"] == manifest["source_sha"]
    assert evidence["source_tree_sha"] == manifest["source_tree_sha"]
    assert evidence["installed_acceptance_receipt_sha256"] == sha256_file(
        receipt_path
    )
    assert evidence["physical_acceptance_receipt_sha256"] == sha256_file(
        physical_path
    )
    assert evidence["assets"] == manifest["assets"]


def test_promotion_evidence_fails_without_valid_physical_suite(tmp_path: Path):
    manifest = _manifest(tmp_path)
    receipt = _receipt(manifest)
    manifest_path = tmp_path / "TDACompanion-candidate.json"
    receipt_path = tmp_path / "TDACompanion-acceptance.json"
    physical_path = tmp_path / "TDACompanion-physical-acceptance.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    physical = _physical_receipt(manifest)
    physical["profiles"] = ["whisper-turbo"]
    physical_path.write_text(json.dumps(physical), encoding="utf-8")

    with pytest.raises(
        ReleaseEvidenceError,
        match="PHYSICAL_ACCEPTANCE_PROFILES_INCOMPLETE",
    ):
        build_promotion_evidence(
            candidate_manifest_path=manifest_path,
            acceptance_receipt_path=receipt_path,
            physical_acceptance_receipt_path=physical_path,
            assets_root=tmp_path,
        )
