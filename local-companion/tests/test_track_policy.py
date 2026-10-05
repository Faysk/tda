from __future__ import annotations

import pytest

from tda_companion.craig import CraigIdentity, CraigPackage, CraigTrack
from tda_companion.track_policy import (
    ALL_TRACKS_POLICY_VERSION,
    DEFAULT_TRACK_POLICY_VERSION,
    EXCLUDE_CONFIRMED_BOTS_POLICY_VERSION,
    CraigTrackPolicyError,
    apply_craig_track_selection,
    policy_for_request,
    select_craig_tracks,
)


def _track(number: int, *, bot: bool | None) -> CraigTrack:
    return CraigTrack(
        number=number,
        speaker=f"speaker-{number}",
        filename=f"{number}-speaker.flac",
        path=f"track-{number:06d}.flac",
        size_bytes=8,
        sha256=f"{number}" * 64,
        identity=CraigIdentity(
            username=f"user-{number}",
            discriminator=None,
            discord_id=str(number),
            bot=bot,
        ),
        duration_seconds=float(number),
    )


def _package(*tracks: CraigTrack) -> CraigPackage:
    return CraigPackage(
        schema_version="tda_craig_ingest_v1",
        source_zip="fixture.zip",
        source_sha256="a" * 64,
        recording_id="fixture",
        guild=None,
        channel=None,
        requester=None,
        start_time=None,
        tracks=tuple(tracks),
        info_present=False,
        raw_dat_present=True,
    )


def test_default_policy_excludes_only_confirmed_bots():
    package = _package(
        _track(1, bot=False),
        _track(2, bot=True),
        _track(3, bot=None),
    )
    selection = select_craig_tracks(package)

    assert DEFAULT_TRACK_POLICY_VERSION == EXCLUDE_CONFIRMED_BOTS_POLICY_VERSION
    assert selection.included_track_numbers == (1, 3)
    assert selection.ignored_track_numbers == (2,)
    filtered = apply_craig_track_selection(package, selection)
    assert [track.number for track in filtered.tracks] == [1, 3]
    assert filtered.source_sha256 == package.source_sha256


def test_all_tracks_policy_is_explicit_override():
    package = _package(_track(1, bot=False), _track(2, bot=True))
    selection = select_craig_tracks(
        package,
        policy_version=ALL_TRACKS_POLICY_VERSION,
    )

    assert policy_for_request(include_bot_tracks=True) == ALL_TRACKS_POLICY_VERSION
    assert selection.included_track_numbers == (1, 2)
    assert selection.ignored_track_numbers == ()


def test_unknown_identity_is_not_treated_as_bot():
    package = _package(_track(1, bot=None))
    selection = select_craig_tracks(package)
    assert selection.included_track_numbers == (1,)
    assert selection.ignored_track_numbers == ()


def test_all_confirmed_bots_fail_with_specific_code():
    package = _package(_track(1, bot=True), _track(2, bot=True))
    with pytest.raises(
        CraigTrackPolicyError,
        match="TRANSCRIPTION_NO_ELIGIBLE_TRACKS",
    ):
        select_craig_tracks(package)
