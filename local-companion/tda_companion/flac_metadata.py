from __future__ import annotations

import math
from pathlib import Path

_FLAC_MARKER = b"fLaC"
_STREAMINFO_TYPE = 0
_STREAMINFO_LENGTH = 34
_STREAMINFO_TOTAL_BYTES = 4 + 4 + _STREAMINFO_LENGTH
_MAX_DURATION_SECONDS = 7 * 24 * 60 * 60


def flac_duration_seconds(path: Path) -> float | None:
    """Read FLAC STREAMINFO duration without decoding audio.

    Craig exports FLAC tracks. STREAMINFO is mandatory and first, so this reads a
    fixed 42-byte prefix only. Duration is advisory metadata for UI estimation;
    malformed/legacy files return None and never make ingest fail.
    """

    try:
        with path.open("rb", buffering=0) as handle:
            prefix = handle.read(_STREAMINFO_TOTAL_BYTES)
    except OSError:
        return None

    if len(prefix) != _STREAMINFO_TOTAL_BYTES or prefix[:4] != _FLAC_MARKER:
        return None

    header = prefix[4:8]
    block_type = header[0] & 0x7F
    block_length = int.from_bytes(header[1:4], "big")
    if block_type != _STREAMINFO_TYPE or block_length != _STREAMINFO_LENGTH:
        return None

    streaminfo = prefix[8:]
    packed = int.from_bytes(streaminfo[10:18], "big")
    sample_rate = (packed >> 44) & 0xFFFFF
    total_samples = packed & ((1 << 36) - 1)
    if sample_rate <= 0 or total_samples <= 0:
        return None

    duration = total_samples / sample_rate
    if (
        not math.isfinite(duration)
        or duration <= 0
        or duration > _MAX_DURATION_SECONDS
    ):
        return None
    return round(duration, 3)
