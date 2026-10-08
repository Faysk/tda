from pathlib import Path
import zipfile

import pytest

from tda_companion.craig import CraigPackageError, ingest_craig_zip, inspect_craig_zip
from tda_companion.craig_runtime import load_craig_package


def test_plain_audio_names_survive_durable_reload(tmp_path: Path):
    source = tmp_path / "conversation.zip"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("Faysk3.flac", b"fLaC-fixture-one")
        archive.writestr("AUDIO THOM.flac", b"fLaC-fixture-two")
    target = tmp_path / "staged"
    package = ingest_craig_zip(source, target)
    loaded = load_craig_package(target)
    assert [(track.number, track.speaker, track.filename, track.path, track.original_filename)
            for track in loaded.tracks] == [
        (1, "AUDIO THOM", "1-AUDIO THOM.flac", "tracks/track-000001.flac", "AUDIO THOM.flac"),
        (2, "Faysk3", "2-Faysk3.flac", "tracks/track-000002.flac", "Faysk3.flac"),
    ]
    assert [track.sha256 for track in loaded.tracks] == [track.sha256 for track in package.tracks]
    assert loaded.start_time is None
    assert all(track.identity is None and track.timeline_offset_seconds == 0 for track in loaded.tracks)


@pytest.mark.parametrize("extra", ["../escape.flac", "nested/audio.flac", "script.exe", "info.txt", "1-Craig.flac"])
def test_plain_archive_does_not_weaken_content_boundaries(tmp_path: Path, extra: str):
    source = tmp_path / "bad.zip"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("Speaker.flac", b"fLaC-audio")
        archive.writestr(extra, b"unexpected")
    with pytest.raises(CraigPackageError):
        inspect_craig_zip(source)
    assert not (tmp_path / "escape.flac").exists()
