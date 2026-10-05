from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable

from .craig import CraigPackage, CraigTrack

ALL_TRACKS_POLICY_VERSION = "all_tracks_v1"
EXCLUDE_CONFIRMED_BOTS_POLICY_VERSION = "exclude_confirmed_craig_bots_v1"
DEFAULT_TRACK_POLICY_VERSION = EXCLUDE_CONFIRMED_BOTS_POLICY_VERSION
SUPPORTED_TRACK_POLICY_VERSIONS = frozenset(
    {ALL_TRACKS_POLICY_VERSION, EXCLUDE_CONFIRMED_BOTS_POLICY_VERSION}
)


class CraigTrackPolicyError(ValueError):
    pass


@dataclass(frozen=True)
class CraigTrackSelection:
    policy_version: str
    included_track_numbers: tuple[int, ...]
    ignored_track_numbers: tuple[int, ...]

    @property
    def processed_track_count(self) -> int:
        return len(self.included_track_numbers)


def policy_for_request(*, include_bot_tracks: bool) -> str:
    if not isinstance(include_bot_tracks, bool):
        raise CraigTrackPolicyError("TRANSCRIPTION_TRACK_POLICY_INVALID")
    return (
        ALL_TRACKS_POLICY_VERSION
        if include_bot_tracks
        else EXCLUDE_CONFIRMED_BOTS_POLICY_VERSION
    )


def _is_confirmed_bot(track: CraigTrack) -> bool:
    return track.identity is not None and track.identity.bot is True


def select_craig_tracks(
    package: CraigPackage,
    *,
    policy_version: str = DEFAULT_TRACK_POLICY_VERSION,
    require_eligible: bool = True,
) -> CraigTrackSelection:
    if policy_version not in SUPPORTED_TRACK_POLICY_VERSIONS:
        raise CraigTrackPolicyError("TRANSCRIPTION_TRACK_POLICY_INVALID")

    if policy_version == ALL_TRACKS_POLICY_VERSION:
        included = tuple(track.number for track in package.tracks)
        ignored: tuple[int, ...] = ()
    else:
        included = tuple(
            track.number for track in package.tracks if not _is_confirmed_bot(track)
        )
        ignored = tuple(
            track.number for track in package.tracks if _is_confirmed_bot(track)
        )

    if require_eligible and not included:
        raise CraigTrackPolicyError("TRANSCRIPTION_NO_ELIGIBLE_TRACKS")
    return CraigTrackSelection(
        policy_version=policy_version,
        included_track_numbers=included,
        ignored_track_numbers=ignored,
    )


def apply_craig_track_selection(
    package: CraigPackage,
    selection: CraigTrackSelection,
) -> CraigPackage:
    expected = select_craig_tracks(
        package,
        policy_version=selection.policy_version,
        require_eligible=True,
    )
    if expected != selection:
        raise CraigTrackPolicyError("TRANSCRIPTION_TRACK_POLICY_MISMATCH")
    wanted = set(selection.included_track_numbers)
    tracks = tuple(track for track in package.tracks if track.number in wanted)
    if len(tracks) != len(wanted):
        raise CraigTrackPolicyError("TRANSCRIPTION_TRACK_POLICY_MISMATCH")
    return replace(package, tracks=tracks)


def normalize_track_numbers(values: Iterable[int], *, code: str) -> tuple[int, ...]:
    result: list[int] = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise CraigTrackPolicyError(code)
        result.append(value)
    normalized = tuple(result)
    if len(set(normalized)) != len(normalized) or tuple(sorted(normalized)) != normalized:
        raise CraigTrackPolicyError(code)
    return normalized
