from dataclasses import replace
import json

import pytest

from tda_companion.transcript import (TranscriptDocument, TranscriptEngine, TranscriptTrack,
    TranscriptValidationError, duration_metrics, stats_for_tracks)


def _document(pairs):
    tracks = tuple(TranscriptTrack(number=i, speaker=f"Person{i}", source_filename=f"{i}-Person{i}.flac",
        source_sha256="b" * 64, duration_seconds=duration, timeline_offset_seconds=offset,
        segments=()) for i, (offset, duration) in enumerate(pairs, 1))
    return TranscriptDocument(recording_id=None, source_sha256="a" * 64, language="pt",
        engine=TranscriptEngine(engine="test", model="test", profile="whisper-turbo", device="cpu",
                                compute_type="float32", alignment="native"),
        tracks=tracks, stats=stats_for_tracks(tracks, processing_seconds=9))


@pytest.mark.parametrize("pairs,expected", [
    ([(0, 300), (0, 180)], (480, 300)),
    ([(0, 60), (120, 30)], (90, 150)),
    ([(10, 30), (20, 10)], (40, 40)),
])
def test_preflight_and_final_metrics_agree_even_without_speech(pairs, expected):
    document = _document(pairs)
    document.validate()
    assert duration_metrics(pairs) == expected
    assert document.stats.audio_work_seconds == expected[0]
    assert document.stats.session_duration_seconds == expected[1]
    assert document.stats.rtf == round(9 / expected[0], 6)
    assert document.stats.duration_semantics == "session_extent_v1"
    assert all(not track.segments for track in document.tracks)


@pytest.mark.parametrize("metric", ["audio_work_seconds", "session_duration_seconds"])
def test_new_document_rejects_inconsistent_derived_metrics(metric):
    document = _document([(0, 60), (120, 30)])
    bad = replace(document, stats=replace(document.stats, **{metric: 1}))
    with pytest.raises(TranscriptValidationError, match="MISMATCH"):
        bad.validate()
    value = json.loads(json.dumps(document.as_dict()))
    value["stats"][metric] = 1
    with pytest.raises(TranscriptValidationError, match="MISMATCH"):
        TranscriptDocument.from_dict(value)


def test_historical_stats_remain_readable_without_reinterpretation_or_rewrite(tmp_path):
    value = _document([(0, 60), (120, 30)]).as_dict()
    value["stats"].pop("duration_semantics")
    value["stats"]["session_duration_seconds"] = 60
    path = tmp_path / "historical.json"
    original = json.dumps(value, indent=4).encode()
    path.write_bytes(original)
    document = TranscriptDocument.from_dict(json.loads(path.read_bytes()))
    assert document.stats.session_duration_seconds == 60
    assert document.stats.duration_semantics is None
    document.validate()
    assert path.read_bytes() == original


def test_unknown_duration_never_becomes_a_complete_preflight_estimate():
    assert duration_metrics([(0, 60), (120, None)]) is None
    assert _document([(0, 60), (120, None)]).stats.duration_semantics is None
