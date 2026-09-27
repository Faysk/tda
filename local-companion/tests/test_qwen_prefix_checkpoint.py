from __future__ import annotations

from pathlib import Path

from tda_companion.asr_checkpoints import CheckpointSignature, QwenTextCheckpointWindow
from tda_companion.craig import CraigTrack
from tda_companion.qwen_prefix_checkpoint import (
    load_qwen_text_prefix_checkpoint,
    save_qwen_text_prefix_checkpoint,
    should_flush_qwen_text_prefix,
)


def _signature() -> CheckpointSignature:
    return CheckpointSignature(
        package_sha256="a" * 64,
        profile_id="qwen-fast",
        engine="qwen3",
        model_id="model",
        model_revision="rev",
        alignment="aligner",
        alignment_revision="rev",
        runtime_fingerprint="runtime",
        recipe_sha256="b" * 64,
        context_sha256="c" * 64,
        glossary_sha256="d" * 64,
    )


def _track() -> CraigTrack:
    return CraigTrack(
        number=1,
        filename="1-speaker.flac",
        speaker="speaker",
        path="track-000001.flac",
        size_bytes=4,
        sha256="e" * 64,
        timeline_offset_seconds=0.0,
        identity=None,
    )


def _window(index: int) -> QwenTextCheckpointWindow:
    start = float((index - 1) * 54)
    return QwenTextCheckpointWindow(
        index=index,
        start=start,
        end=start + 60.0,
        text=f"window {index}",
        language="Portuguese",
    )


def test_prefix_round_trip_and_corruption_fail_closed(tmp_path: Path):
    signature = _signature()
    track = _track()
    path = save_qwen_text_prefix_checkpoint(
        tmp_path,
        signature,
        track,
        [_window(1), _window(2)],
    )
    loaded = load_qwen_text_prefix_checkpoint(tmp_path, signature, track)
    assert loaded is not None
    assert [item.index for item in loaded] == [1, 2]

    path.write_text(path.read_text(encoding="utf-8")[:-3], encoding="utf-8")
    assert load_qwen_text_prefix_checkpoint(tmp_path, signature, track) is None


def test_prefix_signature_or_source_change_is_not_reused(tmp_path: Path):
    signature = _signature()
    track = _track()
    save_qwen_text_prefix_checkpoint(tmp_path, signature, track, [_window(1)])
    changed = CheckpointSignature(**{**signature.__dict__, "context_sha256": "f" * 64})
    assert load_qwen_text_prefix_checkpoint(tmp_path, changed, track) is None
    changed_track = CraigTrack(
        number=1,
        filename=track.filename,
        speaker=track.speaker,
        path=track.path,
        size_bytes=track.size_bytes,
        sha256="9" * 64,
        timeline_offset_seconds=0.0,
        identity=None,
    )
    assert load_qwen_text_prefix_checkpoint(tmp_path, signature, changed_track) is None


def test_flush_policy_commits_first_then_every_eight_windows():
    assert should_flush_qwen_text_prefix(1)
    assert not should_flush_qwen_text_prefix(2)
    assert not should_flush_qwen_text_prefix(7)
    assert should_flush_qwen_text_prefix(8)
    assert should_flush_qwen_text_prefix(16)
