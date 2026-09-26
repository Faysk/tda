from pathlib import Path

from tda_companion.flac_metadata import flac_duration_seconds


def _flac_prefix(*, sample_rate: int, total_samples: int) -> bytes:
    packed = (
        (sample_rate & 0xFFFFF) << 44
        | (0 << 41)
        | (15 << 36)
        | (total_samples & ((1 << 36) - 1))
    )
    streaminfo = (
        (4096).to_bytes(2, "big")
        + (4096).to_bytes(2, "big")
        + (0).to_bytes(3, "big")
        + (0).to_bytes(3, "big")
        + packed.to_bytes(8, "big")
        + bytes(16)
    )
    assert len(streaminfo) == 34
    return b"fLaC" + bytes([0x80, 0, 0, 34]) + streaminfo


def test_reads_duration_from_fixed_flac_streaminfo_prefix(tmp_path: Path):
    path = tmp_path / "track.flac"
    path.write_bytes(
        _flac_prefix(sample_rate=48_000, total_samples=48_000 * 300)
        + b"ignored-frame-data"
    )

    assert flac_duration_seconds(path) == 300.0


def test_invalid_or_unbounded_flac_metadata_is_advisory_only(tmp_path: Path):
    invalid = tmp_path / "invalid.flac"
    invalid.write_bytes(b"fLaC-not-streaminfo")
    assert flac_duration_seconds(invalid) is None

    zero = tmp_path / "zero.flac"
    zero.write_bytes(_flac_prefix(sample_rate=48_000, total_samples=0))
    assert flac_duration_seconds(zero) is None

    missing = tmp_path / "missing.flac"
    assert flac_duration_seconds(missing) is None


def test_duration_read_is_exactly_42_unbuffered_bytes(monkeypatch, tmp_path):
    import io
    payload = _flac_prefix(sample_rate=48_000, total_samples=48_000 * 60)
    sizes = []
    class Prefix(io.BytesIO):
        def read(self, size=-1):
            sizes.append(size)
            assert size == 42
            return super().read(size)
    def opened(path, mode, *, buffering):
        assert mode == "rb" and buffering == 0
        return Prefix(payload + b"do-not-read-audio")
    monkeypatch.setattr(Path, "open", opened)
    assert flac_duration_seconds(tmp_path / "test.flac") == 60
    assert sizes == [42]
