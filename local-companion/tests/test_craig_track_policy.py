from __future__ import annotations

from tda_companion.craig import CraigIdentity, CraigPackage, CraigTrack
from tda_companion.craig_track_policy import (
    CRAIG_TRACK_POLICY_VERSION,
    apply_craig_track_policy,
    craig_track_policy_sha256,
)


def _track(number: int, *, bot: bool | None) -> CraigTrack:
    return CraigTrack(
        number=number,
        speaker=f"speaker-{number}",
        filename=f"{number}-speaker.flac",
        path=f"tracks/{number}.flac",
        size_bytes=1,
        sha256=str(number) * 64,
        duration_seconds=1.0,
        identity=CraigIdentity(
            username=f"user-{number}",
            discriminator="0",
            discord_id=str(number),
            bot=bot,
        ),
    )


def _package(*tracks: CraigTrack) -> CraigPackage:
    return CraigPackage(
        schema_version="tda_craig_package_v1",
        source_zip="fixture.zip",
        source_sha256="a" * 64,
        recording_id="fixture",
        guild=None,
        channel=None,
        requester=None,
        start_time=None,
        tracks=tracks,
        info_present=True,
        raw_dat_present=True,
    )


def test_default_policy_excludes_only_tracks_explicitly_marked_bot():
    source = _package(
        _track(1, bot=False),
        _track(2, bot=True),
        _track(3, bot=None),
    )

    selected, ignored = apply_craig_track_policy(source)

    assert CRAIG_TRACK_POLICY_VERSION == "exclude_confirmed_craig_bots_v1"
    assert [track.number for track in selected.tracks] == [1, 3]
    assert ignored == (2,)
    assert [track.number for track in source.tracks] == [1, 2, 3]


def test_explicit_override_keeps_confirmed_bot_tracks():
    source = _package(_track(1, bot=False), _track(2, bot=True))

    selected, ignored = apply_craig_track_policy(
        source,
        include_bot_tracks=True,
    )

    assert selected is source
    assert ignored == ()


def test_track_policy_hash_changes_with_override():
    assert craig_track_policy_sha256(include_bot_tracks=False) != (
        craig_track_policy_sha256(include_bot_tracks=True)
    )
