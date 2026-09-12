from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from tda_companion.qwen_runtime_bundle import (
    MAX_PART_BYTES,
    QwenRuntimeBundleError,
    QwenRuntimePart,
    assemble_qwen_runtime_bundle,
    build_qwen_runtime_bundle_manifest,
    parse_qwen_runtime_bundle_manifest,
    verify_qwen_runtime_parts,
)


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _part(version: str, index: int, payload: bytes) -> QwenRuntimePart:
    return QwenRuntimePart(
        index=index,
        name=f"TDAQwenRuntime-{version}-windows-x64.zip.part{index:03d}",
        size=len(payload),
        sha256=_sha(payload),
    )


def test_bundle_assembles_multiple_verified_parts_atomically(tmp_path: Path):
    version = "1.0.0"
    first = b"runtime-first-half"
    second = b"runtime-second-half"
    archive = first + second
    parts_root = tmp_path / "parts"
    parts_root.mkdir()
    parts = (_part(version, 1, first), _part(version, 2, second))
    for part, payload in zip(parts, (first, second), strict=True):
        (parts_root / part.name).write_bytes(payload)

    manifest = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256=_sha(archive),
        parts=parts,
    )
    target = assemble_qwen_runtime_bundle(manifest, parts_root, tmp_path / "assembled")

    assert target.name == "TDAQwenRuntime-1.0.0-windows-x64.zip"
    assert target.read_bytes() == archive
    assert not list((tmp_path / "assembled").glob("*.partial"))


def test_bundle_supports_single_part_without_changing_contract(tmp_path: Path):
    payload = b"small-enough-runtime"
    version = "1.0.1"
    part = _part(version, 1, payload)
    parts_root = tmp_path / "parts"
    parts_root.mkdir()
    (parts_root / part.name).write_bytes(payload)
    manifest = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256=_sha(payload),
        parts=(part,),
    )

    target = assemble_qwen_runtime_bundle(manifest, parts_root, tmp_path / "assembled")
    assert target.read_bytes() == payload


def test_manifest_requires_contiguous_index_and_exact_names():
    payload = b"part"
    digest = _sha(payload)
    base = {
        "schema": "tda_qwen_runtime_bundle_v1",
        "runtime_id": "qwen3-transformers",
        "platform": "windows-x64",
        "version": "1.0.0",
        "archive": {
            "name": "TDAQwenRuntime-1.0.0-windows-x64.zip",
            "size": len(payload),
            "sha256": digest,
        },
        "parts": [
            {
                "index": 2,
                "name": "TDAQwenRuntime-1.0.0-windows-x64.zip.part002",
                "size": len(payload),
                "sha256": digest,
            }
        ],
    }
    with pytest.raises(QwenRuntimeBundleError, match="PART_SEQUENCE_INVALID"):
        parse_qwen_runtime_bundle_manifest(base)

    base["parts"][0]["index"] = 1
    base["parts"][0]["name"] = "../runtime.part001"
    with pytest.raises(QwenRuntimeBundleError, match="PART_NAME_INVALID"):
        parse_qwen_runtime_bundle_manifest(base)


def test_manifest_rejects_release_asset_at_or_above_two_gib():
    digest = "a" * 64
    value = {
        "schema": "tda_qwen_runtime_bundle_v1",
        "runtime_id": "qwen3-transformers",
        "platform": "windows-x64",
        "version": "1.0.0",
        "archive": {
            "name": "TDAQwenRuntime-1.0.0-windows-x64.zip",
            "size": MAX_PART_BYTES + 1,
            "sha256": digest,
        },
        "parts": [
            {
                "index": 1,
                "name": "TDAQwenRuntime-1.0.0-windows-x64.zip.part001",
                "size": MAX_PART_BYTES + 1,
                "sha256": digest,
            }
        ],
    }
    with pytest.raises(QwenRuntimeBundleError, match="PART_SIZE_INVALID"):
        parse_qwen_runtime_bundle_manifest(value)


def test_bundle_rejects_missing_wrong_size_and_tampered_parts(tmp_path: Path):
    version = "1.0.0"
    payload = b"correct"
    part = _part(version, 1, payload)
    manifest = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256=_sha(payload),
        parts=(part,),
    )
    parts_root = tmp_path / "parts"
    parts_root.mkdir()

    with pytest.raises(QwenRuntimeBundleError, match="PART_MISSING"):
        verify_qwen_runtime_parts(manifest, parts_root)

    target = parts_root / part.name
    target.write_bytes(b"x")
    with pytest.raises(QwenRuntimeBundleError, match="PART_SIZE_MISMATCH"):
        verify_qwen_runtime_parts(manifest, parts_root)

    target.write_bytes(b"tampered")
    tampered = QwenRuntimePart(
        index=1,
        name=part.name,
        size=len(b"tampered"),
        sha256=part.sha256,
    )
    tampered_manifest = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256=_sha(b"tampered"),
        parts=(tampered,),
    )
    with pytest.raises(QwenRuntimeBundleError, match="PART_HASH_MISMATCH"):
        verify_qwen_runtime_parts(tampered_manifest, parts_root)


def test_bundle_rejects_wrong_final_archive_hash_and_cleans_partial(tmp_path: Path):
    version = "1.0.0"
    payload = b"valid-part"
    part = _part(version, 1, payload)
    parts_root = tmp_path / "parts"
    parts_root.mkdir()
    (parts_root / part.name).write_bytes(payload)
    manifest = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256="0" * 64,
        parts=(part,),
    )
    destination = tmp_path / "assembled"

    with pytest.raises(QwenRuntimeBundleError, match="ARCHIVE_HASH_MISMATCH"):
        assemble_qwen_runtime_bundle(manifest, parts_root, destination)
    assert not (destination / "TDAQwenRuntime-1.0.0-windows-x64.zip").exists()
    assert not list(destination.glob("*.partial"))


def test_failed_bundle_never_replaces_previous_verified_archive(tmp_path: Path):
    version = "1.0.0"
    payload = b"new-candidate"
    part = _part(version, 1, payload)
    parts_root = tmp_path / "parts"
    parts_root.mkdir()
    (parts_root / part.name).write_bytes(payload)
    manifest = build_qwen_runtime_bundle_manifest(
        version=version,
        archive_sha256="f" * 64,
        parts=(part,),
    )
    destination = tmp_path / "assembled"
    destination.mkdir()
    existing = destination / "TDAQwenRuntime-1.0.0-windows-x64.zip"
    existing.write_bytes(b"previous-verified-archive")

    with pytest.raises(QwenRuntimeBundleError, match="ARCHIVE_HASH_MISMATCH"):
        assemble_qwen_runtime_bundle(manifest, parts_root, destination)
    assert existing.read_bytes() == b"previous-verified-archive"
    assert not list(destination.glob("*.partial"))
