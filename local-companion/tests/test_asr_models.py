from __future__ import annotations

from pathlib import Path

import pytest

from tda_companion.asr_models import (
    MODEL_MARKER,
    QWEN_FORCED_ALIGNER_MODEL_ID,
    QWEN_FORCED_ALIGNER_REVISION,
    ModelRegistryError,
    get_profile,
    inspect_model_install,
    model_path,
    public_profiles,
    write_install_marker,
)


def _write_model_fixture(root: Path, profile_id: str = "whisper-turbo") -> Path:
    profile = get_profile(profile_id)
    directory = model_path(root, profile)
    directory.mkdir(parents=True)
    for name in profile.required_files:
        (directory / name).write_bytes(f"fixture:{name}".encode("utf-8"))
    return directory


def test_registry_has_exact_four_v03_profiles():
    profiles = public_profiles()
    assert [item["id"] for item in profiles] == [
        "whisper-turbo",
        "whisper-detailed",
        "qwen-fast",
        "qwen-quality",
    ]
    assert get_profile("whisper-turbo").model_id == "dropbox-dash/faster-whisper-large-v3-turbo"
    assert get_profile("whisper-turbo").revision == "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
    assert get_profile("whisper-detailed").revision == "edaa852ec7e145841d8ffdb056a99866b5f0a478"
    assert get_profile("qwen-fast").model_id == "Qwen/Qwen3-ASR-0.6B-hf"
    assert get_profile("qwen-quality").model_id == "Qwen/Qwen3-ASR-1.7B-hf"
    assert get_profile("qwen-fast").revision == "7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c"
    assert get_profile("qwen-quality").revision == "bcd2b5b7f32b480ab5790554cfa8347f246a14f3"
    assert QWEN_FORCED_ALIGNER_MODEL_ID == "Qwen/Qwen3-ForcedAligner-0.6B-hf"
    assert QWEN_FORCED_ALIGNER_REVISION == "c07281df297b9905d24a508279258cccf987a064"
    assert get_profile("qwen-fast").alignment == QWEN_FORCED_ALIGNER_MODEL_ID
    assert get_profile("qwen-quality").alignment == QWEN_FORCED_ALIGNER_MODEL_ID
    assert get_profile("qwen-fast").alignment_revision == QWEN_FORCED_ALIGNER_REVISION
    assert get_profile("qwen-quality").alignment_revision == QWEN_FORCED_ALIGNER_REVISION
    assert "model.safetensors" in get_profile("qwen-fast").required_files
    assert "model.safetensors" in get_profile("qwen-quality").required_files


def test_unknown_profile_is_rejected():
    with pytest.raises(ModelRegistryError, match="ASR_PROFILE_UNKNOWN"):
        get_profile("whisper-magic")


def test_tda_model_marker_records_identity_and_integrity(tmp_path: Path):
    profile = get_profile("whisper-turbo")
    directory = _write_model_fixture(tmp_path)

    marker = write_install_marker(directory, profile)
    state = inspect_model_install(tmp_path, profile, verify_hash=True)

    assert (directory / MODEL_MARKER).is_file()
    assert "dnd-scribe" not in MODEL_MARKER.lower()
    assert marker["profile_id"] == profile.id
    assert marker["model_id"] == profile.model_id
    assert marker["revision"] == profile.revision
    assert marker["alignment"] == profile.alignment
    assert marker["alignment_revision"] == profile.alignment_revision
    assert len(str(marker["content_sha256"])) == 64
    assert state["status"] == "ready"
    assert state["content_sha256"] == marker["content_sha256"]


def test_qwen_native_checkpoint_marker_is_reproducible(tmp_path: Path):
    profile = get_profile("qwen-fast")
    directory = _write_model_fixture(tmp_path, profile.id)
    marker = write_install_marker(directory, profile)
    state = inspect_model_install(tmp_path, profile, verify_hash=True)

    assert marker["model_id"].endswith("-hf")
    assert marker["alignment"] == QWEN_FORCED_ALIGNER_MODEL_ID
    assert marker["alignment_revision"] == QWEN_FORCED_ALIGNER_REVISION
    assert state["status"] == "ready"


def test_model_integrity_detects_tampering(tmp_path: Path):
    profile = get_profile("whisper-detailed")
    directory = _write_model_fixture(tmp_path, profile.id)
    write_install_marker(directory, profile)
    assert inspect_model_install(tmp_path, profile, verify_hash=True)["status"] == "ready"

    (directory / "config.json").write_text("tampered", encoding="utf-8")
    assert inspect_model_install(tmp_path, profile, verify_hash=True)["status"] == "corrupt"


def test_incomplete_whisper_model_never_becomes_ready(tmp_path: Path):
    profile = get_profile("whisper-turbo")
    directory = model_path(tmp_path, profile)
    directory.mkdir(parents=True)
    (directory / "config.json").write_text("{}", encoding="utf-8")

    state = inspect_model_install(tmp_path, profile)
    assert state["status"] == "incomplete"
    with pytest.raises(ModelRegistryError, match="MODEL_REQUIRED_FILES_MISSING"):
        write_install_marker(directory, profile)
