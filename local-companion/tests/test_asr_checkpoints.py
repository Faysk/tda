from __future__ import annotations

from pathlib import Path

from tda_companion.asr_checkpoints import (
    build_checkpoint_signature,
    load_track_checkpoint,
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
