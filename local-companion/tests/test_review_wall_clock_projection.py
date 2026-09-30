from __future__ import annotations

import pytest

from tda_companion.craig_ingest_http import _with_source_absolute_time


def _review(start: float = 3.25, end: float = 4.5) -> dict[str, object]:
    return {
        "segments": [
            {
                "track_number": 1,
                "segment_id": "1-0",
                "start": 1.0,
                "end": 2.25,
                "timeline_start": start,
                "timeline_end": end,
                "text": "fala sintetica",
                "speaker": "Alice",
                "reviewed": False,
            }
        ]
    }


def test_single_source_review_projects_trusted_absolute_time_from_source_timeline():
    source_id = "craig-" + "a" * 64
    value = _with_source_absolute_time(
        _review(),
        source_id=source_id,
        source_start_time="2026-09-12T23:59:59+01:00",
    )

    segment = value["segments"][0]
    assert segment["absolute_time_state"] == "trusted_absolute"
    assert segment["absolute_start"] == "2026-09-13T00:00:02.250+01:00"
    assert segment["absolute_end"] == "2026-09-13T00:00:03.500+01:00"
    assert segment["absolute_time_source"] == source_id
    # Elapsed coordinates remain the authority and are not rewritten.
    assert segment["start"] == 1.0
    assert segment["timeline_start"] == 3.25


@pytest.mark.parametrize(
    "source_start_time",
    [None, "", "22:34:23", "2026-09-12T22:34:23", "opaque-craig-clock"],
)
def test_single_source_review_never_invents_untrusted_wall_clock(source_start_time):
    value = _with_source_absolute_time(
        _review(),
        source_id="craig-" + "b" * 64,
        source_start_time=source_start_time,
    )

    segment = value["segments"][0]
    assert segment["absolute_time_state"] == "unavailable"
    assert segment["absolute_start"] is None
    assert segment["absolute_end"] is None
    assert segment["absolute_time_source"] is None


def test_single_source_review_prefers_session_timeline_coordinate_over_track_local_time():
    source_id = "craig-" + "c" * 64
    value = _with_source_absolute_time(
        _review(start=120.0, end=121.0),
        source_id=source_id,
        source_start_time="2026-09-12T10:00:00Z",
    )

    segment = value["segments"][0]
    assert segment["absolute_start"] == "2026-09-12T10:02:00.000Z"
    assert segment["absolute_end"] == "2026-09-12T10:02:01.000Z"
