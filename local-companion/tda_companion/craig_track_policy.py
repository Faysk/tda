from __future__ import annotations

import hashlib
import json
from dataclasses import replace

from .craig import CraigPackage, CraigPackageError

CRAIG_TRACK_POLICY_VERSION = "exclude_confirmed_craig_bots_v1"


def craig_track_policy_sha256(*, include_bot_tracks: bool) -> str:
    payload = {
        "version": CRAIG_TRACK_POLICY_VERSION,
        "include_bot_tracks": bool(include_bot_tracks),
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def apply_craig_track_policy(
    package: CraigPackage,
    *,
    include_bot_tracks: bool = False,
) -> tuple[CraigPackage, tuple[int, ...]]:
    """Return a view over the immutable Craig source with eligible ASR tracks only.

    The staged source and its hashes are never mutated. Only an explicit Craig
    metadata flag (identity.bot is True) can exclude a track.
    """
    if include_bot_tracks:
        return package, ()

    ignored = tuple(
        track.number
        for track in package.tracks
        if track.identity is not None and track.identity.bot is True
    )
    if not ignored:
        return package, ()

    ignored_set = set(ignored)
    included = tuple(
        track for track in package.tracks if track.number not in ignored_set
    )
    if not included:
        raise CraigPackageError("CRAIG_NO_ELIGIBLE_HUMAN_TRACKS")
    return replace(package, tracks=included), ignored
