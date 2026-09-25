from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
import tda_companion.asr_checkpoints as checkpoints_module
from tda_companion.asr_checkpoints import (
    QwenTextCheckpointWindow,
    build_checkpoint_signature,
    load_compatible_qwen_text_checkpoint,
    load_qwen_text_checkpoint,
    load_track_checkpoint,
    save_qwen_text_checkpoint,
    save_track_checkpoint,
)
from tda_companion.asr_models import get_profile
from tda_companion.craig import CraigPackage, CraigTrack
from tda_companion.transcript import TranscriptSegment, TranscriptTrack, TranscriptWord


def _source_track() -> CraigTrack:
    return CraigTrack(
        number=1,
        speaker="Alice",
        filename="1-Alice.flac",
        path="tracks/1-Alice.flac",
        size_bytes=123,
        sha256="b" * 64,
        identity=None,
        timeline_offset_seconds=0.0,
    )


def _package(track: CraigTrack) -> CraigPackage:
    return CraigPackage(
        schema_version="tda_craig_package_v1",
        source_zip="fixture.zip",
        source_sha256="a" * 64,
        recording_id="fixture",
        guild=None,
        channel=None,
        requester=None,
        start_time=None,
        tracks=(track,),
        info_present=False,
        raw_dat_present=False,
    )


def _transcript_track(track: CraigTrack) -> TranscriptTrack:
    return TranscriptTrack(
        number=track.number,
        speaker=track.speaker,
        source_filename=track.filename,
        source_sha256=track.sha256,
        duration_seconds=2.0,
        timeline_offset_seconds=track.timeline_offset_seconds,
        identity=None,
        segments=(
            TranscriptSegment(
                id="1-0",
                start=0.1,
                end=0.8,
                text="Olá mesa",
                words=(
                    TranscriptWord(text="Olá", start=0.1, end=0.3, confidence=0.9),
                    TranscriptWord(text="mesa", start=0.4, end=0.8, confidence=0.95),
                ),
            ),
        ),
    )


def _text_windows() -> tuple[QwenTextCheckpointWindow, ...]:
    return (
        QwenTextCheckpointWindow(
            index=1,
            start=0.0,
            end=2.0,
            text="Olá mesa",
            language="Portuguese",
        ),
        QwenTextCheckpointWindow(
            index=2,
            start=1.5,
            end=3.0,
            text="Segunda janela",
            language="Portuguese",
        ),
    )


def _signature(*, context: str = "mesa"):
    track = _source_track()
    return build_checkpoint_signature(
        _package(track),
        get_profile("whisper-turbo"),
        recipe={"vad": {"silence_ms": 500}, "beam": 5},
        context=context,
        glossary="Yuhara",
        runtime_fingerprint="faster-whisper=1.2.1;ctranslate2=4.8.2",
    )


def _qwen_signature(
    *,
    context: str = "mesa",
    runtime: str = "qwen-runtime-a",
    alignment_policy: str = "strict-overlap-v2",
):
    track = _source_track()
    return build_checkpoint_signature(
        _package(track),
        get_profile("qwen-fast"),
        recipe={
            "window_seconds": 60.0,
            "window_overlap_seconds": 6.0,
            "alignment_policy": alignment_policy,
        },
        context=context,
        glossary="Yuhara",
        runtime_fingerprint=runtime,
    )


def test_checkpoint_roundtrip_reuses_only_exact_source_and_signature(tmp_path: Path):
    track = _source_track()
    signature = _signature()
    expected = _transcript_track(track)

    path = save_track_checkpoint(tmp_path, signature, track, expected)
    assert path.is_file()
    restored = load_track_checkpoint(tmp_path, signature, track)
    assert restored == expected

    changed_context = _signature(context="outra mesa")
    assert load_track_checkpoint(tmp_path, changed_context, track) is None

    changed_track = CraigTrack(
        **{**track.__dict__, "sha256": "c" * 64},
    )
    assert load_track_checkpoint(tmp_path, signature, changed_track) is None


def test_corrupt_or_oversized_checkpoint_is_ignored(tmp_path: Path):
    track = _source_track()
    signature = _signature()
    path = save_track_checkpoint(tmp_path, signature, track, _transcript_track(track))

    path.write_text("{not-json", encoding="utf-8")
    assert load_track_checkpoint(tmp_path, signature, track) is None


def test_qwen_text_checkpoint_roundtrip_requires_exact_signature_and_track(tmp_path: Path):
    track = _source_track()
    signature = _qwen_signature()
    expected = _text_windows()

    path = save_qwen_text_checkpoint(tmp_path, signature, track, expected)
    assert path.is_file()
    assert load_qwen_text_checkpoint(tmp_path, signature, track) == expected

    assert load_qwen_text_checkpoint(
        tmp_path,
        _qwen_signature(context="outra mesa"),
        track,
    ) is None
    changed_track = CraigTrack(**{**track.__dict__, "sha256": "c" * 64})
    assert load_qwen_text_checkpoint(tmp_path, signature, changed_track) is None


def test_qwen_text_checkpoint_compatibility_bridge_reuses_only_declared_transition(
    tmp_path: Path,
):
    track = _source_track()
    expected = _text_windows()
    old_runtime = "checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=" + ("a" * 64)
    new_runtime = "checkpoint=qwen-track-v3;runtime=1.0.11;worker_sha256=" + ("b" * 64)
    old_signature = _qwen_signature(runtime=old_runtime, alignment_policy="strict-overlap-v2")
    current_signature = _qwen_signature(runtime=new_runtime, alignment_policy="strict-overlap-v3")
    legacy_template = _qwen_signature(runtime=new_runtime, alignment_policy="strict-overlap-v2")

    save_qwen_text_checkpoint(tmp_path, old_signature, track, expected)

    assert load_qwen_text_checkpoint(tmp_path, current_signature, track) is None
    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        current_signature,
        track,
        templates=(legacy_template,),
    ) == expected

    future_signature = _qwen_signature(
        runtime="checkpoint=qwen-track-v3;runtime=1.0.12;worker_sha256=" + ("c" * 64),
        alignment_policy="strict-overlap-v3",
    )
    future_template = _qwen_signature(
        runtime=future_signature.runtime_fingerprint,
        alignment_policy="strict-overlap-v2",
    )
    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        future_signature,
        track,
        templates=(future_template,),
    ) is None


def test_qwen_text_checkpoint_compatibility_bridge_rejects_ambiguous_lineage(
    tmp_path: Path,
):
    track = _source_track()
    expected = _text_windows()
    new_runtime = "checkpoint=qwen-track-v3;runtime=1.0.11;worker_sha256=" + ("c" * 64)
    current_signature = _qwen_signature(runtime=new_runtime, alignment_policy="strict-overlap-v3")
    legacy_template = _qwen_signature(runtime=new_runtime, alignment_policy="strict-overlap-v2")

    for worker in ("a", "b"):
        old_signature = _qwen_signature(
            runtime="checkpoint=qwen-track-v3;runtime=1.0.10;worker_sha256=" + (worker * 64),
            alignment_policy="strict-overlap-v2",
        )
        save_qwen_text_checkpoint(tmp_path, old_signature, track, expected)

    assert load_compatible_qwen_text_checkpoint(
        tmp_path,
        current_signature,
        track,
        templates=(legacy_template,),
    ) is None


def test_qwen_text_checkpoint_rejects_corruption_tampering_and_partial_files(tmp_path: Path):
    track = _source_track()
    signature = _qwen_signature()
    path = save_qwen_text_checkpoint(tmp_path, signature, track, _text_windows())

    value = json.loads(path.read_text(encoding="utf-8"))
    value["windows"][0]["text"] = "tampered"
    path.write_text(json.dumps(value), encoding="utf-8")
    assert load_qwen_text_checkpoint(tmp_path, signature, track) is None

    path.write_text("{not-json", encoding="utf-8")
    assert load_qwen_text_checkpoint(tmp_path, signature, track) is None

    path.unlink()
    partial = path.with_name(path.name + ".interrupted.partial")
    partial.write_text("{}", encoding="utf-8")
    assert load_qwen_text_checkpoint(tmp_path, signature, track) is None


def test_qwen_text_checkpoint_size_limit_fails_closed(
    monkeypatch,
    tmp_path: Path,
):
    track = _source_track()
    signature = _qwen_signature()
    monkeypatch.setattr(checkpoints_module, "MAX_CHECKPOINT_BYTES", 128)

    with pytest.raises(ValueError, match="CHECKPOINT_SIZE_LIMIT"):
        save_qwen_text_checkpoint(tmp_path, signature, track, _text_windows())


def test_qwen_text_checkpoint_rejects_symlinked_checkpoint_root(tmp_path: Path):
    outside = tmp_path / "outside"
    outside.mkdir()
    checkpoint_root = tmp_path / ".checkpoints"
    try:
        checkpoint_root.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation unavailable on this runner")

    track = _source_track()
    signature = _qwen_signature()
    assert load_qwen_text_checkpoint(tmp_path, signature, track) is None
    with pytest.raises(ValueError, match="CHECKPOINT_PATH_SYMLINK"):
        save_qwen_text_checkpoint(tmp_path, signature, track, _text_windows())
    assert list(outside.iterdir()) == []


def test_qwen_text_signature_invalidates_every_reuse_lineage_input():
    package = _package(_source_track())
    profile = get_profile("qwen-fast")

    def digest(
        *,
        candidate=profile,
        recipe=None,
        context="mesa",
        glossary="Yuhara",
        runtime="runtime-a",
    ):
        return build_checkpoint_signature(
            package,
            candidate,
            recipe=recipe or {"window_seconds": 60, "alignment_policy": "strict-overlap-v2"},
            context=context,
            glossary=glossary,
            runtime_fingerprint=runtime,
        ).digest()

    baseline = digest()
    variants = {
        digest(candidate=replace(profile, id="qwen-fast-v2")),
        digest(candidate=replace(profile, model_id="Qwen/changed-model")),
        digest(candidate=replace(profile, revision="changed-revision")),
        digest(candidate=replace(profile, alignment="Qwen/changed-aligner")),
        digest(candidate=replace(profile, alignment_revision="changed-aligner-revision")),
        digest(recipe={"window_seconds": 61, "alignment_policy": "strict-overlap-v2"}),
        digest(context="outra mesa"),
        digest(glossary="Outro nome"),
        digest(runtime="runtime-b"),
    }

    assert baseline not in variants
    assert len(variants) == 9


def test_signature_changes_for_runtime_recipe_model_inputs():
    package = _package(_source_track())
    profile = get_profile("whisper-turbo")
    first = build_checkpoint_signature(
        package,
        profile,
        recipe={"beam": 5},
        context="mesa",
        glossary="Yuhara",
        runtime_fingerprint="runtime-a",
    )
    second = build_checkpoint_signature(
        package,
        profile,
        recipe={"beam": 6},
        context="mesa",
        glossary="Yuhara",
        runtime_fingerprint="runtime-a",
    )
    third = build_checkpoint_signature(
        package,
        profile,
        recipe={"beam": 5},
        context="mesa",
        glossary="Yuhara",
        runtime_fingerprint="runtime-b",
    )

    assert first.digest() != second.digest()
    assert first.digest() != third.digest()
