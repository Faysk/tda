from __future__ import annotations

import json
import zipfile
from pathlib import Path

from tda_companion.craig import (
    MAX_RAW_HEADER_BYTES,
    ingest_craig_zip,
    parse_info_text,
)
from tda_companion.craig_runtime import load_craig_package


def _flac_bytes() -> bytes:
    sample_rate = 48_000
    total_samples = sample_rate
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
    return b"fLaC" + bytes([0x80, 0, 0, 34]) + streaminfo


def _write_zip(
    path: Path,
    *,
    info_text: str | None,
    raw_header: dict[str, object] | bytes | None,
) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("1-Alice.flac", _flac_bytes())
        archive.writestr("2-Bob.flac", _flac_bytes())
        if info_text is not None:
            archive.writestr("info.txt", info_text)
        if raw_header is not None:
            payload = (
                raw_header
                if isinstance(raw_header, bytes)
                else json.dumps(raw_header, separators=(",", ":")).encode("utf-8")
                + b"\nOggS"
            )
            archive.writestr("raw.dat", payload)


def _info(*, start: str = "2026-09-19T17:20:40.056Z") -> str:
    return (
        "Recording recording-a\n\n"
        "Guild: Gaming Den (1001)\n"
        "Channel: DnD Private (2002)\n"
        "Requester: owner#0 (3003)\n"
        f"Start time: {start}\n\n"
        "Tracks:\n"
        "alice#0 (4004)\n"
        "bob#0 (5005)\n\n"
        "Notes:\n"
        "\t0:02:03: initiative rolled\n"
        "\t1:00:05: boss phase\n"
    )


def _raw(*, start: str = "2026-09-19T17:20:40.056Z") -> dict[str, object]:
    return {
        "format": 1,
        "id": "recording-a",
        "guild": "Gaming Den",
        "guildExtra": {"name": "Gaming Den", "id": "1001"},
        "channel": "DnD Private",
        "channelExtra": {"name": "DnD Private", "id": "2002", "type": 2},
        "requester": "owner#0",
        "requesterExtra": {
            "username": "owner",
            "globalName": "Owner",
            "discriminator": "0",
        },
        "requesterId": "3003",
        "startTime": start,
        "tracks": {
            "1": {
                "id": "4004",
                "username": "alice",
                "discriminator": "0",
                "globalName": "Alice Global",
                "bot": False,
                "unknown": False,
            },
            "2": {
                "id": "5005",
                "username": "bob",
                "discriminator": "0",
                "globalName": "Music Bot",
                "bot": True,
                "unknown": False,
            },
        },
    }


def test_info_parser_preserves_ids_and_timestamped_notes():
    value = parse_info_text(_info())

    assert value["guild"] == "Gaming Den"
    assert value["guild_id"] == "1001"
    assert value["channel_id"] == "2002"
    assert value["requester_id"] == "3003"
    assert value["tracks"] == [
        {
            "track": 1,
            "username": "alice",
            "discriminator": "0",
            "discord_id": "4004",
        },
        {
            "track": 2,
            "username": "bob",
            "discriminator": "0",
            "discord_id": "5005",
        },
    ]
    assert value["notes"] == [
        {"offset_seconds": 123.0, "text": "initiative rolled"},
        {"offset_seconds": 3605.0, "text": "boss phase"},
    ]


def test_ingest_reads_bounded_raw_header_and_cross_checks_info(tmp_path: Path):
    source = tmp_path / "source.zip"
    target = tmp_path / "package"
    _write_zip(source, info_text=_info(), raw_header=_raw())

    package = ingest_craig_zip(source, target)

    assert package.metadata_consistency == "consistent"
    assert package.raw_metadata_state == "parsed"
    assert package.metadata_sources == ("info_txt", "raw_dat_header")
    assert package.recording_id == "recording-a"
    assert package.guild_id == "1001"
    assert package.channel_id == "2002"
    assert package.requester_id == "3003"
    assert package.notes[0].offset_seconds == 123.0
    assert package.tracks[0].identity is not None
    assert package.tracks[0].identity.discord_id == "4004"
    assert package.tracks[0].identity.global_name == "Alice Global"
    assert package.tracks[1].identity is not None
    assert package.tracks[1].identity.bot is True

    loaded = load_craig_package(target, verify_tracks=True)
    assert loaded == package


def test_conflicting_strong_metadata_fails_closed_for_time_and_identity(tmp_path: Path):
    source = tmp_path / "source.zip"
    target = tmp_path / "package"
    raw = _raw(start="2026-09-19T17:21:40.056Z")
    raw_tracks = raw["tracks"]
    assert isinstance(raw_tracks, dict)
    row = raw_tracks["1"]
    assert isinstance(row, dict)
    row["id"] = "9999"
    _write_zip(source, info_text=_info(), raw_header=raw)

    package = ingest_craig_zip(source, target)

    assert package.metadata_consistency == "conflicting"
    assert package.start_time is None
    assert package.tracks[0].identity is not None
    assert package.tracks[0].identity.discord_id is None


def test_raw_metadata_is_optional_and_info_only_remains_valid(tmp_path: Path):
    source = tmp_path / "source.zip"
    target = tmp_path / "package"
    _write_zip(source, info_text=_info(), raw_header=None)

    package = ingest_craig_zip(source, target)

    assert package.raw_dat_present is False
    assert package.raw_metadata_state == "missing"
    assert package.metadata_sources == ("info_txt",)
    assert package.metadata_consistency == "partial"
    assert package.start_time == "2026-09-19T17:20:40.056Z"


def test_malformed_or_oversized_raw_header_does_not_block_valid_info(tmp_path: Path):
    for name, raw_header, expected_state in (
        ("invalid", b"{not-json}\nOggS", "invalid"),
        ("oversized", b"x" * (MAX_RAW_HEADER_BYTES + 1) + b"\n", "oversized"),
    ):
        source = tmp_path / f"{name}.zip"
        target = tmp_path / f"{name}-package"
        _write_zip(source, info_text=_info(), raw_header=raw_header)

        package = ingest_craig_zip(source, target)

        assert package.raw_dat_present is True
        assert package.raw_metadata_state == expected_state
        assert package.start_time == "2026-09-19T17:20:40.056Z"
        assert package.metadata_sources == ("info_txt",)
