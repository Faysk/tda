from __future__ import annotations

import hashlib
import json
from pathlib import Path

from tda_companion.asr_checkpoints import (
    QwenTextCheckpointWindow,
    build_checkpoint_signature,
    load_qwen_text_checkpoint,
    save_qwen_text_checkpoint,
)
from tda_companion.asr_models import get_profile
from tda_companion.craig import CraigPackage, CraigTrack
from tda_companion import qwen_checkpoint_compat
from tda_companion.qwen_checkpoint_compat import load_compatible_qwen_text_checkpoint


def _track() -> CraigTrack:
    payload = b"audio"
    return CraigTrack(
        number=1,
        speaker="Alice",
        filename="1-Alice.flac",
        path="tracks/1-Alice.flac",
        size_bytes=len(payload),
        sha256=hashlib.sha256(payload).hexdigest(),
        identity=None,
    )


def _package(track: CraigTrack) -> CraigPackage:
    return CraigPackage(
        schema_version="tda_craig_package_v1",
        source_zip="fixture.zip",
        source_sha256="a" * 64,
        recording_id="compat",
        guild=None,
        channel=None,
        requester=None,
        start_time=None,
        tracks=(track,),
        info_present=False,
        raw_dat_present=False,
    )


def _signature(
    *,
    runtime: str,
    alignment_policy: str,
):
    track = _track()
    return build_checkpoint_signature(
        _package(track),
        get_profile("qwen-fast"),
        recipe={
            "window_seconds": 60.0,
            "window_overlap_seconds": 6.0,
            "alignment_policy": alignment_policy,
        },
        context="mesa",
        glossary="Yuhara",
        runtime_fingerprint=runtime,
    )


def _windows() -> tuple[QwenTextCheckpointWindow, ...]:
    return (
        QwenTextCheckpointWindow(
            index=1,
            start=0.0,
            end=60.0,
            text="texto",
            language="Portuguese",
        ),
    )


def test_compat_bridge_source_worker_matches_versioned_physical_receipt():
    repo_root = Path(__file__).resolve().parents[2]
    receipt = json.loads(
        (
            repo_root
            / "docs"
            / "companion"
            / "runtime-acceptance"
            / "companion-qwen-runtime-rc-v1.0.10-19d9b3b64238.json"
        ).read_text(encoding="utf-8")
    )
    assert qwen_checkpoint_compat._ACCEPTED_SOURCE_WORKERS[
        ("1.0.10", "1.0.11")
    ] == frozenset({receipt["worker_sha256"]})
    assert receipt["stable_tag"] == "companion-qwen-runtime-v1.0.10"
    assert receipt["pass"] is True


def test_compat_bridge_reuses_only_declared_1_0_10_to_1_0_11_transition(tmp_path: Path):
    track = _track()
    expected = _windows()
    old = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=8c07e1c3bd34ecc53d49025a510c7547e7748b030ac6a90fdd70a2abc431e62e",
        alignment_policy="strict-overlap-v2",
    )
    current = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.11;worker_sha256=" + ("b" * 64),
        alignment_policy="strict-overlap-v3",
    )
    legacy_template = _signature(
        runtime=current.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )

    save_qwen_text_checkpoint(tmp_path, old, track, expected)

    assert load_qwen_text_checkpoint(tmp_path, current, track) is None
    compatible = load_compatible_qwen_text_checkpoint(
        tmp_path,
        current,
        track,
        templates=(legacy_template,),
    )
    assert compatible is not None
    assert compatible.windows == expected
    assert compatible.source_runtime_version == "1.0.10"
    assert compatible.source_signature_sha256 == old.digest()

    future = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.12;worker_sha256=" + ("c" * 64),
        alignment_policy="strict-overlap-v3",
    )
    future_template = _signature(
        runtime=future.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        future,
        track,
        templates=(future_template,),
    ) is None


def test_compat_bridge_reuses_stable_1_0_10_text_when_only_policy_changes(
    tmp_path: Path,
):
    track = _track()
    worker = "8c07e1c3bd34ecc53d49025a510c7547e7748b030ac6a90fdd70a2abc431e62e"
    old = _signature(
        runtime=f"checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256={worker}",
        alignment_policy="strict-overlap-v2",
    )
    current = _signature(
        runtime=f"checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256={worker}",
        alignment_policy="strict-overlap-v3",
    )
    legacy_template = _signature(
        runtime=current.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    save_qwen_text_checkpoint(tmp_path, old, track, _windows())

    compatible = load_compatible_qwen_text_checkpoint(
        tmp_path,
        current,
        track,
        templates=(legacy_template,),
    )

    assert compatible is not None
    assert compatible.windows == _windows()
    assert compatible.source_runtime_version == "1.0.10"
    assert compatible.source_signature_sha256 == old.digest()


def test_compat_bridge_rejects_same_version_worker_drift(tmp_path: Path):
    track = _track()
    accepted = (
        "8c07e1c3bd34ecc53d49025a510c7547e7748b030ac6a90fdd70a2abc431e62e"
    )
    old = _signature(
        runtime=f"checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256={accepted}",
        alignment_policy="strict-overlap-v2",
    )
    current = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=" + ("f" * 64),
        alignment_policy="strict-overlap-v3",
    )
    legacy_template = _signature(
        runtime=current.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    save_qwen_text_checkpoint(tmp_path, old, track, _windows())

    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        current,
        track,
        templates=(legacy_template,),
    ) is None


def test_compat_bridge_uses_exact_signature_even_with_many_stale_checkpoint_roots(
    tmp_path: Path,
):
    track = _track()
    old = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=8c07e1c3bd34ecc53d49025a510c7547e7748b030ac6a90fdd70a2abc431e62e",
        alignment_policy="strict-overlap-v2",
    )
    current = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.11;worker_sha256=" + ("b" * 64),
        alignment_policy="strict-overlap-v3",
    )
    legacy_template = _signature(
        runtime=current.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    roots = tmp_path / ".checkpoints"
    roots.mkdir()
    for index in range(300):
        (roots / f"{index:064x}").mkdir()
    save_qwen_text_checkpoint(tmp_path, old, track, _windows())

    compatible = load_compatible_qwen_text_checkpoint(
        tmp_path,
        current,
        track,
        templates=(legacy_template,),
    )

    assert compatible is not None
    assert compatible.windows == _windows()
    assert compatible.source_signature_sha256 == old.digest()


def test_compat_bridge_requires_sealed_current_worker_identity(tmp_path: Path):
    track = _track()
    old = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=8c07e1c3bd34ecc53d49025a510c7547e7748b030ac6a90fdd70a2abc431e62e",
        alignment_policy="strict-overlap-v2",
    )
    unsealed_current = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.11;torch=dev;transformers=dev",
        alignment_policy="strict-overlap-v3",
    )
    legacy_template = _signature(
        runtime=unsealed_current.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    save_qwen_text_checkpoint(tmp_path, old, track, _windows())

    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        unsealed_current,
        track,
        templates=(legacy_template,),
    ) is None


def test_compat_bridge_rejects_unaccepted_1_0_10_worker(tmp_path: Path):
    track = _track()
    current = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.11;worker_sha256=" + ("c" * 64),
        alignment_policy="strict-overlap-v3",
    )
    legacy_template = _signature(
        runtime=current.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    unaccepted = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=" + ("d" * 64),
        alignment_policy="strict-overlap-v2",
    )
    save_qwen_text_checkpoint(tmp_path, unaccepted, track, _windows())

    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        current,
        track,
        templates=(legacy_template,),
    ) is None


def test_compat_bridge_delegates_corrupt_content_to_canonical_validation(tmp_path: Path):
    track = _track()
    old = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=8c07e1c3bd34ecc53d49025a510c7547e7748b030ac6a90fdd70a2abc431e62e",
        alignment_policy="strict-overlap-v2",
    )
    current = _signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.11;worker_sha256=" + ("b" * 64),
        alignment_policy="strict-overlap-v3",
    )
    legacy_template = _signature(
        runtime=current.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    path = save_qwen_text_checkpoint(tmp_path, old, track, _windows())
    value = json.loads(path.read_text(encoding="utf-8"))
    value["content_sha256"] = "0" * 64
    path.write_text(json.dumps(value), encoding="utf-8")

    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        current,
        track,
        templates=(legacy_template,),
    ) is None
